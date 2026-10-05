//! The rendition cache: encoded thumbnails kept in memory and on disk, keyed by identity and bound, with concurrent
//! requests for one rendition rendered once.

use std::num::NonZeroU32;
use std::path::Path;
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::Duration;

use rust_sak::memo::{CacheOpts, KeyBuilder, Memo};
use serde::{Deserialize, Serialize};

/// How long a rendition is kept, on disk and in memory.
const TTL: Duration = Duration::from_hours(30 * 24);

/// The memory tier's budget.
const MEMORY_BUDGET: u64 = 256 << 20;

/// Make a disk write durable at least every this many writes, or every [`FLUSH_INTERVAL`]: the same settings as
/// `mediasim`'s `DirCache`. Thumbnails are cheap to rebuild, so losing the last second's on a crash is fine.
const FLUSH_EVERY: u32 = 64;
const FLUSH_INTERVAL: Duration = Duration::from_secs(1);

/// Versions the key, so a change to how renditions are made can't serve the old ones.
const KEY_VERSION: &str = "thumb-v1";

/// An encoded thumbnail, as it crosses to the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rendition {
    pub bytes: Vec<u8>,
    pub media_type: RenditionType,
}

/// The encoding of a [`Rendition`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenditionType {
    Jpeg,
    Png,
}

impl RenditionType {
    pub fn mime(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
        }
    }
}

/// The cache, and the permits that bound how many renders run at once.
#[derive(Debug)]
pub struct Renditions {
    /// `None` only if even the memory store could not be built, in which case every request renders.
    memo: Option<Memo>,
    permits: Permits,
}

impl Renditions {
    /// Opens the cache in `dir`, memory in front of disk, or in memory alone when `dir` is `None` or the store there
    /// won't open: a broken disk cache must not break thumbnails. Infallible on purpose; see
    /// [`ThumbState::open_cache`](super::ThumbState::open_cache).
    pub fn open(dir: Option<&Path>) -> Self {
        let opts = CacheOpts::new()
            .max_capacity(MEMORY_BUDGET)
            .flush_every(FLUSH_EVERY)
            .flush_interval(FLUSH_INTERVAL);

        let memo = dir.and_then(|dir| Memo::memory_disk(dir, opts, TTL).ok()).or_else(|| Memo::memory(opts).ok());

        let permits = std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get);

        Self { memo, permits: Permits::new(permits) }
    }

    /// The rendition for `identity` at `bound`: the cached one, or `render`'s, which is then kept. Concurrent callers
    /// for one key wait for a single render. A failed render is not kept.
    pub fn get_or_render<F, E>(&self, identity: &str, bound: NonZeroU32, render: F) -> Option<Rendition>
    where
        F: FnOnce() -> Result<Rendition, E>,
        E: std::error::Error + Send + Sync + 'static,
    {
        // Taken inside the computation, so a caller served from the cache or waiting on another's render never
        // holds one.
        let render = || {
            let _permit = self.permits.acquire();
            render()
        };

        match &self.memo {
            Some(memo) => memo.get_or_compute(&key(identity, bound), TTL, render).ok(),
            None => render().ok(),
        }
    }
}

fn key(identity: &str, bound: NonZeroU32) -> String {
    KeyBuilder::new().part(KEY_VERSION).part(identity).part(&bound.get()).finish()
}

/// A counting semaphore: a gallery's first paint can ask for hundreds of thumbnails, and each full-size decode can
/// take tens of megabytes, so only as many render at once as there are CPUs.
#[derive(Debug)]
struct Permits {
    available: Mutex<usize>,
    released: Condvar,
}

impl Permits {
    fn new(count: usize) -> Self {
        Self { available: Mutex::new(count.max(1)), released: Condvar::new() }
    }

    fn acquire(&self) -> Permit<'_> {
        let available = self.available.lock().unwrap_or_else(PoisonError::into_inner);
        let mut available = self
            .released
            .wait_while(available, |available| *available == 0)
            .unwrap_or_else(PoisonError::into_inner);
        *available -= 1;

        Permit(self)
    }
}

/// One held permit, returned when dropped.
struct Permit<'a>(&'a Permits);

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        *self.0.available.lock().unwrap_or_else(PoisonError::into_inner) += 1;
        self.0.released.notify_one();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};

    use rust_sak::fs::mk_temp_dir;

    use super::*;

    fn bound(value: u32) -> NonZeroU32 {
        NonZeroU32::new(value).unwrap()
    }

    fn rendition(byte: u8) -> Rendition {
        Rendition { bytes: vec![byte; 4], media_type: RenditionType::Jpeg }
    }

    #[derive(Debug, thiserror::Error)]
    #[error("render failed")]
    struct Failed;

    /// A render that counts its calls and returns `rendition(byte)`.
    fn counted(calls: &AtomicUsize, byte: u8) -> impl FnOnce() -> Result<Rendition, Failed> + '_ {
        move || {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(rendition(byte))
        }
    }

    #[test]
    fn a_second_request_is_served_without_rendering() {
        let cache = Renditions::open(None);
        let calls = AtomicUsize::new(0);

        let first = cache.get_or_render("0123456789abcdef", bound(96), counted(&calls, 1));
        let second = cache.get_or_render("0123456789abcdef", bound(96), counted(&calls, 2));

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(first, Some(rendition(1)));
        assert_eq!(second, first);
    }

    #[test]
    fn eight_concurrent_requests_render_once() {
        let cache = Arc::new(Renditions::open(None));
        let calls = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(8));

        let answers: Vec<_> = (0..8)
            .map(|_| {
                let (cache, calls, barrier) = (Arc::clone(&cache), Arc::clone(&calls), Arc::clone(&barrier));
                std::thread::spawn(move || {
                    barrier.wait();
                    cache.get_or_render("0123456789abcdef", bound(96), || {
                        calls.fetch_add(1, Ordering::SeqCst);
                        // Long enough that every other request arrives while this one is rendering.
                        std::thread::sleep(Duration::from_millis(200));
                        Ok::<_, Failed>(rendition(7))
                    })
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(answers.iter().all(|answer| answer == &Some(rendition(7))));
    }

    #[test]
    fn different_bounds_are_kept_separately() {
        let cache = Renditions::open(None);
        let calls = AtomicUsize::new(0);

        let small = cache.get_or_render("0123456789abcdef", bound(96), counted(&calls, 1));
        let large = cache.get_or_render("0123456789abcdef", bound(384), counted(&calls, 2));
        let small_again = cache.get_or_render("0123456789abcdef", bound(96), counted(&calls, 3));

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!((small, large), (Some(rendition(1)), Some(rendition(2))));
        assert_eq!(small_again, Some(rendition(1)));
    }

    #[test]
    fn a_failed_render_is_not_kept() {
        let cache = Renditions::open(None);
        let calls = AtomicUsize::new(0);

        let failed = cache.get_or_render("0123456789abcdef", bound(96), || {
            calls.fetch_add(1, Ordering::SeqCst);
            Err(Failed)
        });
        let retried = cache.get_or_render("0123456789abcdef", bound(96), counted(&calls, 1));

        assert_eq!(failed, None);
        assert_eq!(retried, Some(rendition(1)));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_disk_cache_keeps_renditions_across_reopening() {
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let calls = AtomicUsize::new(0);

        {
            let cache = Renditions::open(Some(dir.path()));
            assert!(cache.memo.as_ref().and_then(Memo::path).is_some(), "the disk tier did not open");
            cache.get_or_render("0123456789abcdef", bound(96), counted(&calls, 1));
            cache.memo.as_ref().unwrap().flush().unwrap();
        }

        let reopened = Renditions::open(Some(dir.path()));
        let answer = reopened.get_or_render("0123456789abcdef", bound(96), counted(&calls, 2));

        assert_eq!(answer, Some(rendition(1)));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn an_unusable_directory_falls_back_to_memory() {
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let file = dir.path().join("not-a-directory");
        std::fs::write(&file, b"").unwrap();

        let cache = Renditions::open(Some(&file));
        let calls = AtomicUsize::new(0);

        assert!(cache.memo.as_ref().is_some_and(|memo| memo.path().is_none()));
        assert_eq!(cache.get_or_render("0123456789abcdef", bound(96), counted(&calls, 1)), Some(rendition(1)));
    }

    #[test]
    fn permits_bound_how_many_run_at_once() {
        let permits = Arc::new(Permits::new(2));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..8)
            .map(|_| {
                let (permits, running, peak) = (Arc::clone(&permits), Arc::clone(&running), Arc::clone(&peak));
                std::thread::spawn(move || {
                    let _permit = permits.acquire();
                    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(20));
                    running.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }

        assert_eq!(peak.load(Ordering::SeqCst), 2);
    }
}
