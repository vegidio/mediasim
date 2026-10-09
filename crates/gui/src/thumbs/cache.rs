//! The rendition cache: encoded thumbnails kept in memory and on disk, keyed by identity and bound, with concurrent
//! requests for one rendition rendered once, on a pool of their own.
//!
//! A request waits for its rendition asynchronously, never on a thread: a hit is answered straight from the cache, a
//! miss is rendered on [`Renditions`]' own pool, and a request for a rendition already being rendered waits for that
//! render. A gallery's first paint can ask for hundreds of thumbnails, so none of that may hold a thread of Tokio's
//! blocking pool, which every command shares.

use std::num::NonZeroU32;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::time::Duration;

use mediasim::DirCache;
use rust_sak::memo::{CacheOpts, KeyBuilder, Memo, MemoError};
use serde::{Deserialize, Serialize};

/// How long a rendition is kept, on disk and in memory.
const TTL: Duration = Duration::from_hours(30 * 24);

/// The memory tier's budget.
const MEMORY_BUDGET: u64 = 256 << 20;

/// Versions the key, so a change to how renditions are made can't serve the old ones.
///
/// `bytes` being serialized as a byte string rather than a sequence did not change it: postcard writes both as a
/// length followed by the bytes, so entries written before read back unchanged.
const KEY_VERSION: &str = "thumb-v1";

/// An encoded thumbnail, as it crosses to the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rendition {
    /// Serialized in one piece, not byte by byte.
    #[serde(with = "serde_bytes")]
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

/// Why no rendition was produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Unrendered {
    /// The render returned an error: the file can't be decoded.
    #[error("the file could not be rendered")]
    Undecodable,
    /// The render panicked, or the render this request waited on was abandoned.
    #[error("the render did not finish")]
    Failed,
}

impl From<MemoError> for Unrendered {
    fn from(err: MemoError) -> Self {
        match err {
            // The error `render_on_pool` returned, handed back as it was.
            MemoError::Compute(err) => err.downcast_ref::<Self>().copied().unwrap_or(Self::Failed),
            _ => Self::Failed,
        }
    }
}

/// The cache, and the pool misses are rendered on.
#[derive(Debug)]
pub struct Renditions {
    /// `None` only if even the memory store could not be built, in which case every request renders.
    memo: Option<Memo>,
    /// As many threads as there are CPUs, since each full-size decode can take tens of megabytes. `None` only if the
    /// pool could not be built, in which case renders run on rayon's global pool, which is bounded the same way.
    pool: Option<rayon::ThreadPool>,
}

impl Renditions {
    /// Opens the cache in `dir`, memory in front of disk, or in memory alone when `dir` is `None` or the store there
    /// won't open: a broken disk cache must not break thumbnails. Infallible on purpose; see
    /// [`ThumbState::open_cache`](super::ThumbState::open_cache).
    pub fn open(dir: Option<&Path>) -> Self {
        Self::with_threads(dir, std::thread::available_parallelism().map_or(1, std::num::NonZeroUsize::get))
    }

    /// As [`open`](Self::open), with a pool of `threads` threads.
    fn with_threads(dir: Option<&Path>, threads: usize) -> Self {
        // Disk writes are made durable as `mediasim`'s `DirCache` makes them. Thumbnails are cheap to rebuild, so
        // losing the last second's on a crash is fine.
        let opts = CacheOpts::new()
            .max_capacity(MEMORY_BUDGET)
            .flush_every(DirCache::FLUSH_EVERY)
            .flush_interval(DirCache::FLUSH_INTERVAL);

        let memo = dir.and_then(|dir| Memo::memory_disk(dir, opts, TTL).ok()).or_else(|| Memo::memory(opts).ok());

        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads.max(1))
            .thread_name(|index| format!("thumbnail-{index}"))
            .build()
            .ok();

        Self { memo, pool }
    }

    /// The rendition for `identity` at `bound`: the cached one, or `render`'s, which is then kept. Concurrent callers
    /// for one key wait for a single render. A failed render is not kept.
    ///
    /// Must be awaited inside a Tokio runtime, which the disk tier is reached through.
    pub async fn get_or_render<F, E>(
        &self,
        identity: &str,
        bound: NonZeroU32,
        render: F,
    ) -> Result<Rendition, Unrendered>
    where
        F: FnOnce() -> Result<Rendition, E> + Send + 'static,
        E: std::error::Error,
    {
        let render = || self.render_on_pool(render);

        match &self.memo {
            Some(memo) => Ok(memo.get_or_compute_async(&key(identity, bound), TTL, render).await?),
            None => render().await,
        }
    }

    /// Runs `render` on the pool and waits for it without holding a thread. A panic is caught there, so it can't
    /// take the pool's thread or the process down, and comes back as [`Unrendered::Failed`].
    async fn render_on_pool<F, E>(&self, render: F) -> Result<Rendition, Unrendered>
    where
        F: FnOnce() -> Result<Rendition, E> + Send + 'static,
        E: std::error::Error,
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        let job = move || {
            let outcome = match catch_unwind(AssertUnwindSafe(render)) {
                Ok(Ok(rendition)) => Ok(rendition),
                Ok(Err(_)) => Err(Unrendered::Undecodable),
                Err(_) => Err(Unrendered::Failed),
            };
            // The one message the channel ever holds, so it is never full; it is closed only if the request was
            // dropped, which then needs no answer.
            let _ = sender.try_send(outcome);
        };

        match &self.pool {
            Some(pool) => pool.spawn(job),
            None => rayon::spawn(job),
        }

        receiver.recv().await.unwrap_or(Err(Unrendered::Failed))
    }
}

fn key(identity: &str, bound: NonZeroU32) -> String {
    KeyBuilder::new().part(KEY_VERSION).part(identity).part(&bound.get()).finish()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use rust_sak::fs::mk_temp_dir;
    use tauri::async_runtime::block_on;

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
    fn counted(calls: &Arc<AtomicUsize>, byte: u8) -> impl FnOnce() -> Result<Rendition, Failed> + Send + 'static {
        let calls = Arc::clone(calls);
        move || {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(rendition(byte))
        }
    }

    fn get(
        cache: &Renditions,
        bound: NonZeroU32,
        render: impl FnOnce() -> Result<Rendition, Failed> + Send + 'static,
    ) -> Result<Rendition, Unrendered> {
        block_on(cache.get_or_render("0123456789abcdef", bound, render))
    }

    #[test]
    fn a_second_request_is_served_without_rendering() {
        let cache = Renditions::open(None);
        let calls = Arc::new(AtomicUsize::new(0));

        let first = get(&cache, bound(96), counted(&calls, 1));
        let second = get(&cache, bound(96), counted(&calls, 2));

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(first, Ok(rendition(1)));
        assert_eq!(second, first);
    }

    #[test]
    fn eight_concurrent_requests_render_once() {
        let cache = Arc::new(Renditions::open(None));
        let calls = Arc::new(AtomicUsize::new(0));

        let requests: Vec<_> = (0..8)
            .map(|_| {
                let (cache, calls) = (Arc::clone(&cache), Arc::clone(&calls));
                tauri::async_runtime::spawn(async move {
                    cache
                        .get_or_render("0123456789abcdef", bound(96), move || {
                            calls.fetch_add(1, Ordering::SeqCst);
                            // Long enough that every other request arrives while this one is rendering.
                            std::thread::sleep(Duration::from_millis(200));
                            Ok::<_, Failed>(rendition(7))
                        })
                        .await
                })
            })
            .collect();
        let answers: Vec<_> = requests.into_iter().map(|request| block_on(request).unwrap()).collect();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(answers.iter().all(|answer| answer == &Ok(rendition(7))));
    }

    #[test]
    fn different_bounds_are_kept_separately() {
        let cache = Renditions::open(None);
        let calls = Arc::new(AtomicUsize::new(0));

        let small = get(&cache, bound(96), counted(&calls, 1));
        let large = get(&cache, bound(384), counted(&calls, 2));
        let small_again = get(&cache, bound(96), counted(&calls, 3));

        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!((small, large), (Ok(rendition(1)), Ok(rendition(2))));
        assert_eq!(small_again, Ok(rendition(1)));
    }

    #[test]
    fn a_failed_render_is_not_kept() {
        let cache = Renditions::open(None);
        let calls = Arc::new(AtomicUsize::new(0));

        let counting = Arc::clone(&calls);
        let failed = get(&cache, bound(96), move || {
            counting.fetch_add(1, Ordering::SeqCst);
            Err(Failed)
        });
        let retried = get(&cache, bound(96), counted(&calls, 1));

        assert_eq!(failed, Err(Unrendered::Undecodable));
        assert_eq!(retried, Ok(rendition(1)));
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_panicking_render_fails_without_being_kept() {
        let cache = Renditions::open(None);
        let calls = Arc::new(AtomicUsize::new(0));

        let panicked = get(&cache, bound(96), || panic!("the decoder panicked"));
        let retried = get(&cache, bound(96), counted(&calls, 1));

        assert_eq!(panicked, Err(Unrendered::Failed));
        assert_eq!(retried, Ok(rendition(1)));
    }

    #[test]
    fn without_a_memo_a_panicking_render_still_fails() {
        let cache = Renditions { memo: None, ..Renditions::open(None) };

        assert_eq!(get(&cache, bound(96), || panic!("the decoder panicked")), Err(Unrendered::Failed));
    }

    #[test]
    fn a_disk_cache_keeps_renditions_across_reopening() {
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let calls = Arc::new(AtomicUsize::new(0));

        {
            let cache = Renditions::open(Some(dir.path()));
            assert!(cache.memo.as_ref().and_then(Memo::path).is_some(), "the disk tier did not open");
            get(&cache, bound(96), counted(&calls, 1)).unwrap();
            cache.memo.as_ref().unwrap().flush().unwrap();
        }

        let reopened = Renditions::open(Some(dir.path()));
        let answer = get(&reopened, bound(96), counted(&calls, 2));

        assert_eq!(answer, Ok(rendition(1)));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    /// What `serde_bytes` writes is what a `Vec<u8>` was written as before it, a length and then the bytes, so entries
    /// already on disk under [`KEY_VERSION`] still read back.
    #[test]
    fn a_rendition_is_stored_as_its_length_then_its_bytes() {
        let cache = Renditions::open(None);
        get(&cache, bound(96), || {
            Ok::<_, Failed>(Rendition { bytes: vec![9, 8, 7], media_type: RenditionType::Png })
        })
        .unwrap();

        let stored = cache.memo.as_ref().unwrap().get_bytes(&key("0123456789abcdef", bound(96))).unwrap().unwrap();

        // After the memo's own header: the length, the bytes, then `Png`'s variant index.
        assert!(stored.ends_with(&[3, 9, 8, 7, 1]), "{stored:?}");
    }

    #[test]
    fn an_unusable_directory_falls_back_to_memory() {
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let file = dir.path().join("not-a-directory");
        std::fs::write(&file, b"").unwrap();

        let cache = Renditions::open(Some(&file));
        let calls = Arc::new(AtomicUsize::new(0));

        assert!(cache.memo.as_ref().is_some_and(|memo| memo.path().is_none()));
        assert_eq!(get(&cache, bound(96), counted(&calls, 1)), Ok(rendition(1)));
    }

    #[test]
    fn the_pool_bounds_how_many_render_at_once() {
        let cache = Arc::new(Renditions::with_threads(None, 2));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));

        let requests: Vec<_> = (0..8_u32)
            .map(|index| {
                let (cache, running, peak) = (Arc::clone(&cache), Arc::clone(&running), Arc::clone(&peak));
                tauri::async_runtime::spawn(async move {
                    // A bound of its own each, so no two requests share a render.
                    cache
                        .get_or_render("0123456789abcdef", bound(16 + index), move || {
                            let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                            peak.fetch_max(now, Ordering::SeqCst);
                            std::thread::sleep(Duration::from_millis(20));
                            running.fetch_sub(1, Ordering::SeqCst);
                            Ok::<_, Failed>(rendition(1))
                        })
                        .await
                })
            })
            .collect();
        for request in requests {
            block_on(request).unwrap().unwrap();
        }

        assert_eq!(peak.load(Ordering::SeqCst), 2);
    }
}
