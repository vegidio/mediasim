//! Encoded video segments, kept in memory while the application runs, so switching views, seeking back, or a second
//! player never encodes the same 2 seconds twice. Concurrent requests for one segment encode it once.

use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use media::prelude::Packet;
use rust_sak::memo::{CacheOpts, KeyBuilder, Memo, MemoError};
use serde::{Deserialize, Serialize};

use super::transcode::EncodeError;

/// The memory budget. At about 1.5 MB per 1080p segment, some 170 segments: almost six minutes of video.
const BUDGET: u64 = 256 << 20;

/// How long a segment is kept. A changed file gets a new identity, so its old segments are never asked for again and
/// go when this runs out.
const TTL: Duration = Duration::from_hours(1);

/// Versions the key, so a change to how segments are made can't serve the old ones.
const KEY_VERSION: &str = "seg-v1";

/// An encoded packet as the cache keeps it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct CachedPacket {
    /// Serialized in one piece, not byte by byte. The cache is in memory alone, so no entry outlives a format change.
    #[serde(with = "serde_bytes")]
    data: Vec<u8>,
    pts: i64,
    dts: i64,
    duration: i64,
    keyframe: bool,
}

impl From<&Packet> for CachedPacket {
    fn from(packet: &Packet) -> Self {
        Self {
            data: packet.data().to_vec(),
            pts: packet.pts(),
            dts: packet.dts(),
            duration: packet.duration(),
            keyframe: packet.is_keyframe(),
        }
    }
}

impl CachedPacket {
    fn packet(&self) -> media::Result<Packet> {
        Packet::from_data(&self.data, self.pts, self.dts, self.duration, self.keyframe)
    }
}

/// What a caller's encode hands `memo` when it fails. The error itself stays with the caller, since `memo` shares one
/// instance with every waiter and an `EncodeError` can't be cloned out of it.
#[derive(Debug, thiserror::Error)]
#[error("the segment's encode failed")]
struct Failed;

/// The cache, as Tauri managed state.
pub struct Segments {
    /// `None` only if even the memory store couldn't be built, in which case every request encodes.
    memo: Option<Memo>,
    /// How many encodes the cache has run, for the tests.
    #[cfg(test)]
    encodes: std::sync::atomic::AtomicUsize,
}

impl Default for Segments {
    fn default() -> Self {
        Self {
            memo: Memo::memory(CacheOpts::new().max_capacity(BUDGET)).ok(),
            #[cfg(test)]
            encodes: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

impl Segments {
    /// Segment `segment` of the video behind `identity`, as encoded under the init segment whose hash is `init`: the
    /// kept one, or `encode`'s, which is then kept.
    ///
    /// A concurrent request for the same segment waits for the one encoding it. If that one fails, is cancelled or
    /// goes away, a waiter encodes the segment itself, once, unless `cancel`, its own session's flag, is set by then.
    /// A failed or cancelled encode is never kept.
    ///
    /// # Errors
    ///
    /// The error of this caller's own encode: [`EncodeError::Cancelled`] when its session was closed.
    pub(crate) fn get_or_encode(
        &self,
        identity: &str,
        init: &str,
        segment: u64,
        cancel: &AtomicBool,
        mut encode: impl FnMut() -> Result<Vec<Packet>, EncodeError>,
    ) -> Result<Vec<Packet>, EncodeError> {
        let Some(memo) = &self.memo else { return encode() };
        let key = KeyBuilder::new().part(KEY_VERSION).part(identity).part(init).part(&segment).finish();

        // A waiter gets one more go after the encode it waited for came to nothing.
        for _ in 0..2 {
            let own = Cell::new(None);
            let compute = || {
                #[cfg(test)]
                self.encodes.fetch_add(1, Ordering::Relaxed);
                encode()
                    .map(|packets| packets.iter().map(CachedPacket::from).collect::<Vec<_>>())
                    .map_err(|err| {
                        own.set(Some(err));
                        Failed
                    })
            };

            let result = memo.get_or_compute::<Vec<CachedPacket>, _, _>(&key, TTL, compute);
            if let Some(err) = own.take() {
                return Err(err);
            }
            match result {
                Ok(cached) => return Ok(cached.iter().map(CachedPacket::packet).collect::<media::Result<_>>()?),
                // Another caller's encode failed, was cancelled, or went away.
                Err(MemoError::Compute(_) | MemoError::ComputeAbandoned) => {
                    if cancel.load(Ordering::Relaxed) {
                        return Err(EncodeError::Cancelled);
                    }
                }
                // The cache itself failed; the segment can still be encoded, just not kept.
                Err(_) => return encode(),
            }
        }

        encode()
    }

    /// How many encodes the cache has run.
    #[cfg(test)]
    pub(crate) fn encodes(&self) -> usize {
        self.encodes.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};

    use super::*;

    const IDENTITY: &str = "0123456789abcdef";

    /// A stand-in for a segment: two packets, the first a keyframe.
    fn segment(tag: u8) -> Vec<Packet> {
        vec![
            Packet::from_data(&[tag; 16], 0, 0, 1, true).unwrap(),
            Packet::from_data(&[tag; 8], 1, 1, 1, false).unwrap(),
        ]
    }

    fn data(packets: &[Packet]) -> Vec<(Vec<u8>, i64, bool)> {
        packets
            .iter()
            .map(|packet| (packet.data().to_vec(), packet.pts(), packet.is_keyframe()))
            .collect()
    }

    fn get(segments: &Segments, init: &str, index: u64, tag: u8) -> Vec<Packet> {
        segments
            .get_or_encode(IDENTITY, init, index, &AtomicBool::new(false), || Ok(segment(tag)))
            .unwrap()
    }

    #[test]
    fn a_second_request_for_a_segment_is_answered_without_encoding() {
        let segments = Segments::default();

        let first = get(&segments, "init", 2, 7);
        let second = get(&segments, "init", 2, 9);

        assert_eq!(segments.encodes(), 1);
        assert_eq!(data(&second), data(&first));
        assert_eq!(data(&first), data(&segment(7)));
    }

    #[test]
    fn another_init_segment_or_another_segment_misses() {
        let segments = Segments::default();
        get(&segments, "init", 2, 7);

        assert_eq!(data(&get(&segments, "other", 2, 8)), data(&segment(8)));
        assert_eq!(data(&get(&segments, "init", 3, 9)), data(&segment(9)));
        assert_eq!(segments.encodes(), 3);
    }

    #[test]
    fn a_changed_file_misses_since_it_has_another_identity() {
        let segments = Segments::default();
        get(&segments, "init", 2, 7);

        let changed = segments
            .get_or_encode("fedcba9876543210", "init", 2, &AtomicBool::new(false), || Ok(segment(8)))
            .unwrap();

        assert_eq!(data(&changed), data(&segment(8)));
        assert_eq!(segments.encodes(), 2);
    }

    #[test]
    fn two_requests_at_once_encode_once() {
        let segments = Arc::new(Segments::default());
        let barrier = Arc::new(Barrier::new(2));

        let threads: Vec<_> = (0..2)
            .map(|_| {
                let (segments, barrier) = (Arc::clone(&segments), Arc::clone(&barrier));
                std::thread::spawn(move || {
                    barrier.wait();
                    segments.get_or_encode(IDENTITY, "init", 0, &AtomicBool::new(false), || {
                        std::thread::sleep(Duration::from_millis(200));
                        Ok(segment(5))
                    })
                })
            })
            .collect();

        for thread in threads {
            assert_eq!(data(&thread.join().unwrap().unwrap()), data(&segment(5)));
        }
        assert_eq!(segments.encodes(), 1);
    }

    #[test]
    fn a_cancelled_encode_keeps_nothing_and_its_waiter_encodes_the_segment_itself() {
        let segments = Arc::new(Segments::default());
        let started = Arc::new(Barrier::new(2));

        let cancelled = {
            let (segments, started) = (Arc::clone(&segments), Arc::clone(&started));
            std::thread::spawn(move || {
                segments.get_or_encode(IDENTITY, "init", 0, &AtomicBool::new(true), || {
                    started.wait();
                    std::thread::sleep(Duration::from_millis(200));
                    Err(EncodeError::Cancelled)
                })
            })
        };
        started.wait();
        // Joins the cancelled encode, then encodes the segment itself.
        let waiter = get(&segments, "init", 0, 6);

        assert!(matches!(cancelled.join().unwrap(), Err(EncodeError::Cancelled)));
        assert_eq!(data(&waiter), data(&segment(6)));
        assert_eq!(segments.encodes(), 2);
        // What the waiter encoded is kept; the cancelled encode left nothing behind.
        assert_eq!(data(&get(&segments, "init", 0, 9)), data(&segment(6)));
        assert_eq!(segments.encodes(), 2);
    }

    #[test]
    fn a_waiter_whose_own_session_is_cancelled_does_not_encode() {
        let segments = Arc::new(Segments::default());
        let started = Arc::new(Barrier::new(2));

        let failing = {
            let (segments, started) = (Arc::clone(&segments), Arc::clone(&started));
            std::thread::spawn(move || {
                segments.get_or_encode(IDENTITY, "init", 0, &AtomicBool::new(true), || {
                    started.wait();
                    std::thread::sleep(Duration::from_millis(200));
                    Err(EncodeError::Cancelled)
                })
            })
        };
        started.wait();
        let waiter = segments.get_or_encode(IDENTITY, "init", 0, &AtomicBool::new(true), || Ok(segment(6)));

        assert!(failing.join().unwrap().is_err());
        assert!(matches!(waiter, Err(EncodeError::Cancelled)));
        assert_eq!(segments.encodes(), 1);
    }

    #[test]
    fn a_failed_encode_is_the_callers_own_error_and_is_retried_next_time() {
        let segments = Segments::default();

        let failed = segments.get_or_encode(IDENTITY, "init", 1, &AtomicBool::new(false), || {
            Err(EncodeError::Media(media::Error::NoVideoStream))
        });

        assert!(matches!(failed, Err(EncodeError::Media(media::Error::NoVideoStream))));
        assert_eq!(data(&get(&segments, "init", 1, 4)), data(&segment(4)));
        assert_eq!(segments.encodes(), 2);
    }
}
