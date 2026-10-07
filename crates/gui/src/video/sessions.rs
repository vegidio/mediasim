//! The open sessions, and the commands the window opens, pulls and closes them with.
//!
//! A session is found by a `u64` id. The registry lock is held only to find or change an entry: each session has its
//! own mutex, so two players stream in parallel and a slow segment never holds up the others. At most [`LIMIT`]
//! sessions are open, copying or encoding alike; opening one more closes the one requested from least recently, which
//! bounds what a window that never closes its sessions can leak.
//!
//! Closing a session sets its cancel flag before the entry goes, without waiting for the session's mutex, which a
//! request still encoding holds. The encode sees the flag before its next frame, stops, and the request is refused as
//! not found, so leaving a pair or seeking away leaves no encode running.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

use super::VideoError;
use super::cache::Segments;
use super::encoder::Encoders;
use super::probe::locate_video;
use super::session::{AudioMode, Session, VideoMode};
use super::transcode::EncodeError;
use crate::thumbs::{ThumbState, locate};

/// The most sessions open at once: both views' two players, a reopen after a seek while the old session is still
/// closing, and React's `StrictMode` rehearsal mount, with room to spare.
const LIMIT: usize = 8;

/// A session in the registry, and when it was last requested from.
struct Entry {
    session: Arc<Mutex<Session>>,
    /// Set when the session is closed, to stop an encode in progress.
    cancel: Arc<AtomicBool>,
    /// The registry's request count at this session's last open or request: the lowest was requested from least
    /// recently.
    last_request: u64,
}

impl Entry {
    /// Stops any encode in progress; the session itself ends when the last reference to it goes.
    fn cancel(self) -> Arc<Mutex<Session>> {
        self.cancel.store(true, Ordering::Relaxed);
        self.session
    }
}

#[derive(Default)]
struct Registry {
    /// The id the next session gets.
    next_id: u64,
    /// Opens and requests so far, which orders the sessions by recency.
    requests: u64,
    sessions: HashMap<u64, Entry>,
}

/// The open sessions, as Tauri managed state.
#[derive(Default)]
pub struct SessionState {
    registry: Mutex<Registry>,
}

/// What opening a session answers.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// The session's id.
    session: u64,
    /// The time, in seconds, the session starts from: where the window places its media.
    start: f64,
}

impl SessionState {
    fn registry(&self) -> MutexGuard<'_, Registry> {
        // Every change to the registry is a single insert or remove, never left half-done, so a poisoned lock is sound.
        self.registry.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Opens a session for the video behind `identity`, starting at `at`, carrying its video and audio as `video` and
    /// `audio` say, and encoding its video, when it does, with the encoder `encoders` has in use. Closes the session
    /// requested from least recently when there are already [`LIMIT`].
    fn open(
        &self,
        thumbs: &ThumbState,
        encoders: &Encoders,
        identity: &str,
        at: Duration,
        video: VideoMode,
        audio: AudioMode,
    ) -> Result<Opened, VideoError> {
        let admitted = locate_video(thumbs, identity)?;
        let path = admitted.path.to_str().ok_or(VideoError::Gone)?;
        let (session, start) = Session::open(path, identity, at, video, || encoders.current(), audio)?;
        let session = Arc::new(Mutex::new(session));

        let mut registry = self.registry();
        let id = registry.next_id;
        registry.next_id += 1;
        registry.requests += 1;
        let last_request = registry.requests;
        registry.sessions.insert(id, Entry { session, cancel: Arc::default(), last_request });

        let evicted = if registry.sessions.len() > LIMIT {
            let oldest = registry.sessions.iter().min_by_key(|(_, entry)| entry.last_request).map(|(id, _)| *id);
            oldest.and_then(|oldest| registry.sessions.remove(&oldest)).map(Entry::cancel)
        } else {
            None
        };
        // Ending a session closes its files and its FFmpeg contexts, which happens after the lock is released.
        drop(registry);
        drop(evicted);

        Ok(Opened { session: id, start })
    }

    /// The next segment of session `id`. A file removed or changed since, or one that fails to read or encode, closes
    /// the session; a session closed while this was being answered is not found. A hardware encoder that fails is
    /// retired from `encoders`, so sessions opened later use the next one.
    fn next(
        &self,
        thumbs: &ThumbState,
        segments: &Segments,
        encoders: &Encoders,
        id: u64,
    ) -> Result<Vec<u8>, VideoError> {
        let (session, cancel) = {
            let mut registry = self.registry();
            registry.requests += 1;
            let request = registry.requests;
            let entry = registry.sessions.get_mut(&id).ok_or(VideoError::NotFound)?;
            entry.last_request = request;
            (Arc::clone(&entry.session), Arc::clone(&entry.cancel))
        };
        // A panic mid-segment leaves the session unusable, which the error below then closes.
        let mut session = session.lock().unwrap_or_else(PoisonError::into_inner);
        if cancel.load(Ordering::Relaxed) {
            return Err(VideoError::NotFound);
        }

        if locate(thumbs, session.identity()).is_err() {
            self.close(id);
            return Err(VideoError::Gone);
        }

        let segment = session.next(segments, &cancel).map_err(|err| {
            if let (EncodeError::Encoder(_), Some(encoder)) = (&err, session.encoder()) {
                encoders.retire(&encoder);
            }
            let err = VideoError::from(err);
            if err != VideoError::NotFound {
                self.close(id);
            }
            err
        })?;
        // A request that waited on another session's encode of the same segment comes back whole even when its own
        // session was closed meanwhile; it is refused all the same.
        if cancel.load(Ordering::Relaxed) {
            return Err(VideoError::NotFound);
        }

        Ok(segment)
    }

    /// Closes session `id`, if it is open, and stops any encode in progress for it. The session ends after the
    /// registry lock is released, since that closes its files and its `FFmpeg` contexts; if a request still holds it,
    /// when that request returns.
    fn close(&self, id: u64) {
        let removed = self.registry().sessions.remove(&id).map(Entry::cancel);
        drop(removed);
    }

    /// How many sessions are open.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.registry().sessions.len()
    }
}

/// Opens a session for an admitted video, starting at or before `at` seconds:
/// - `video` is `copy`, to copy the main video stream, starting at the last keyframe at or before `at`, or `encode`,
///   to encode it to H.264, starting at the last 2-second boundary at or before `at`;
/// - `audio` is `none`, `copy` or `encode` (to AAC), for the main audio stream when the file has one.
///
/// # Errors
///
/// `notfound` for an identity never admitted or naming an image, `gone` for a file removed or changed since, and
/// `unreadable` for one that can't be read, or decoded when it is to be encoded.
#[tauri::command]
pub async fn video_open(
    app: AppHandle,
    identity: String,
    at: f64,
    video: VideoMode,
    audio: AudioMode,
) -> Result<Opened, VideoError> {
    // A time the window can't mean, such as `NaN` or a negative one, is read as the start.
    let at = Duration::try_from_secs_f64(at).unwrap_or_default();

    spawn_blocking(move || {
        app.state::<SessionState>().open(
            &app.state::<ThumbState>(),
            &app.state::<Encoders>(),
            &identity,
            at,
            video,
            audio,
        )
    })
    .await?
}

/// The next segment of a session, as raw bytes: the init segment, then one segment's fragments per call, then empty.
///
/// # Errors
///
/// `notfound` for a session that is closed or never existed, or that was closed while this was answered; `gone` when
/// its file was removed or changed; and `unreadable` when it fails to read or encode. Either of the last two closes the
/// session.
#[tauri::command]
pub async fn video_next(app: AppHandle, session: u64) -> Result<Response, VideoError> {
    let segment = spawn_blocking(move || {
        app.state::<SessionState>().next(
            &app.state::<ThumbState>(),
            &app.state::<Segments>(),
            &app.state::<Encoders>(),
            session,
        )
    })
    .await??;

    Ok(Response::new(segment))
}

/// Closes a session, stopping any encode in progress for it. Closing one that is already closed does nothing.
///
/// # Errors
///
/// `unreadable` only if the blocking task that closes it doesn't finish.
#[tauri::command]
pub async fn video_close(app: AppHandle, session: u64) -> Result<(), VideoError> {
    spawn_blocking(move || app.state::<SessionState>().close(session)).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::thumbs::tests::{fixture, state};
    use crate::video::fixtures::{admit, mkv, mkv_undecodable, reencoded};
    use crate::video::session::tests::boxes;

    /// Encoders with no hardware candidate, so these tests encode on `libx264` without testing anything.
    fn software() -> &'static Encoders {
        static SOFTWARE: std::sync::LazyLock<Encoders> = std::sync::LazyLock::new(|| Encoders::with(&[]));
        &SOFTWARE
    }

    fn open_as(state: &SessionState, thumbs: &ThumbState, identity: &str, video: VideoMode) -> u64 {
        state
            .open(thumbs, software(), identity, Duration::ZERO, video, AudioMode::Copy)
            .unwrap()
            .session
    }

    fn open(state: &SessionState, thumbs: &ThumbState, identity: &str) -> u64 {
        open_as(state, thumbs, identity, VideoMode::Copy)
    }

    #[test]
    fn a_session_runs_from_open_to_end() {
        let (state, thumbs, segments) = (SessionState::default(), state(), Segments::default());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let identity = admit(&thumbs, &mkv(dir.path()));

        let opened = state
            .open(&thumbs, software(), &identity, Duration::from_secs(3), VideoMode::Copy, AudioMode::Copy)
            .unwrap();
        assert!((opened.start - 2.0).abs() < 0.001);

        assert_eq!(boxes(&state.next(&thumbs, &segments, software(), opened.session).unwrap()), ["ftyp", "moov"]);
        let mut fragments = 0;
        loop {
            let segment = state.next(&thumbs, &segments, software(), opened.session).unwrap();
            if segment.is_empty() {
                break;
            }
            assert_eq!(boxes(&segment), ["moof", "mdat"]);
            fragments += 1;
        }
        // Keyframes at 2, 4, 6, 8 and 10 s.
        assert_eq!(fragments, 5);
        assert!(state.next(&thumbs, &segments, software(), opened.session).unwrap().is_empty());
    }

    #[test]
    fn the_answer_to_open_is_camel_case() {
        let json = serde_json::to_value(Opened { session: 3, start: 2.0 }).unwrap();

        assert_eq!(json, serde_json::json!({ "session": 3, "start": 2.0 }));
    }

    #[test]
    fn the_modes_are_read_as_the_window_names_them() {
        let video: Vec<VideoMode> = serde_json::from_str(r#"["copy", "encode"]"#).unwrap();
        let audio: Vec<AudioMode> = serde_json::from_str(r#"["none", "copy", "encode"]"#).unwrap();

        assert_eq!(video, [VideoMode::Copy, VideoMode::Encode]);
        assert_eq!(audio, [AudioMode::None, AudioMode::Copy, AudioMode::Encode]);
        assert!(serde_json::from_str::<VideoMode>(r#""none""#).is_err());
    }

    #[test]
    fn a_ninth_session_closes_the_least_recently_requested() {
        let (state, thumbs, segments) = (SessionState::default(), state(), Segments::default());
        let identity = admit(&thumbs, &fixture("test3.mp4"));
        let ids: Vec<_> = (0..LIMIT).map(|_| open(&state, &thumbs, &identity)).collect();
        // The first is requested from again, so the second is now the least recent.
        state.next(&thumbs, &segments, software(), ids[0]).unwrap();

        let ninth = open(&state, &thumbs, &identity);

        assert_eq!(state.len(), LIMIT);
        assert_eq!(state.next(&thumbs, &segments, software(), ids[1]), Err(VideoError::NotFound));
        assert!(state.next(&thumbs, &segments, software(), ids[0]).is_ok());
        assert!(state.next(&thumbs, &segments, software(), ninth).is_ok());
    }

    #[test]
    fn the_limit_counts_both_kinds_of_session() {
        let (state, thumbs, segments) = (SessionState::default(), state(), Segments::default());
        let identity = admit(&thumbs, &fixture("test3.mp4"));
        let copies: Vec<_> = (0..5).map(|_| open_as(&state, &thumbs, &identity, VideoMode::Copy)).collect();
        let encodes: Vec<_> = (0..3).map(|_| open_as(&state, &thumbs, &identity, VideoMode::Encode)).collect();
        // Every session but the first encode is requested from again, so that one is now the least recent.
        for id in copies.iter().chain(&encodes[1..]) {
            state.next(&thumbs, &segments, software(), *id).unwrap();
        }

        let ninth = open_as(&state, &thumbs, &identity, VideoMode::Encode);

        assert_eq!(state.len(), LIMIT);
        assert_eq!(state.next(&thumbs, &segments, software(), encodes[0]), Err(VideoError::NotFound));
        assert!(state.next(&thumbs, &segments, software(), copies[0]).is_ok());
        assert!(state.next(&thumbs, &segments, software(), ninth).is_ok());
    }

    #[test]
    fn closing_while_a_4k_segment_encodes_stops_it_promptly_and_keeps_nothing() {
        let (state, thumbs, segments) =
            (Arc::new(SessionState::default()), Arc::new(state()), Arc::new(Segments::default()));
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let identity = admit(&thumbs, &reencoded(dir.path(), "uhd.mp4", (2160, 3840), 60, 2.0));
        let id = open_as(&state, &thumbs, &identity, VideoMode::Encode);
        state.next(&thumbs, &segments, software(), id).unwrap();

        let started = Instant::now();
        let encoding = {
            let (state, thumbs, segments) = (Arc::clone(&state), Arc::clone(&thumbs), Arc::clone(&segments));
            std::thread::spawn(move || {
                let result = state.next(&thumbs, &segments, software(), id);
                (result, Instant::now())
            })
        };
        // Let the encode get well under way: a whole 4K segment takes far longer than this.
        std::thread::sleep(Duration::from_millis(150));
        state.close(id);
        let (result, returned) = encoding.join().unwrap();

        assert_eq!(result, Err(VideoError::NotFound));
        assert_eq!(segments.encodes(), 1);
        // Nothing was kept: another session encodes the segment itself.
        let other = open_as(&state, &thumbs, &identity, VideoMode::Encode);
        state.next(&thumbs, &segments, software(), other).unwrap();
        let whole = Instant::now();
        assert!(!state.next(&thumbs, &segments, software(), other).unwrap().is_empty());
        let whole = whole.elapsed();
        assert_eq!(segments.encodes(), 2);
        // Stopped before the segment was done: a fixed bound would fail on a loaded machine, where every frame is slow,
        // but the same segment encoded whole is slowed alike.
        let cancelled = returned.saturating_duration_since(started);
        assert!(cancelled < whole, "the cancelled encode took {cancelled:?}, a whole segment {whole:?}");
    }

    #[test]
    fn a_request_waiting_on_another_sessions_encode_is_not_found_once_its_own_session_closes() {
        let (state, thumbs, segments) =
            (Arc::new(SessionState::default()), Arc::new(state()), Arc::new(Segments::default()));
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let identity = admit(&thumbs, &reencoded(dir.path(), "uhd.mp4", (2160, 3840), 60, 2.0));
        let (encoding, waiting) = (
            open_as(&state, &thumbs, &identity, VideoMode::Encode),
            open_as(&state, &thumbs, &identity, VideoMode::Encode),
        );
        state.next(&thumbs, &segments, software(), encoding).unwrap();
        state.next(&thumbs, &segments, software(), waiting).unwrap();

        let request = |id| {
            let (state, thumbs, segments) = (Arc::clone(&state), Arc::clone(&thumbs), Arc::clone(&segments));
            std::thread::spawn(move || state.next(&thumbs, &segments, software(), id))
        };
        let encoder = request(encoding);
        // The second request for segment 0 joins the first one's encode rather than starting its own.
        std::thread::sleep(Duration::from_millis(100));
        let waiter = request(waiting);
        std::thread::sleep(Duration::from_millis(100));
        state.close(waiting);

        assert!(!encoder.join().unwrap().unwrap().is_empty());
        assert_eq!(waiter.join().unwrap(), Err(VideoError::NotFound));
        assert_eq!(segments.encodes(), 1);
    }

    #[test]
    fn a_removed_file_is_gone_and_closes_its_session() {
        let (state, thumbs, segments) = (SessionState::default(), state(), Segments::default());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let path = mkv(dir.path());
        let identity = admit(&thumbs, &path);
        let id = open_as(&state, &thumbs, &identity, VideoMode::Encode);
        state.next(&thumbs, &segments, software(), id).unwrap();

        std::fs::remove_file(&path).unwrap();

        assert_eq!(state.next(&thumbs, &segments, software(), id), Err(VideoError::Gone));
        assert_eq!(state.len(), 0);
        assert_eq!(state.next(&thumbs, &segments, software(), id), Err(VideoError::NotFound));
    }

    #[test]
    fn opening_a_removed_file_is_gone() {
        let (state, thumbs) = (SessionState::default(), state());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let path = mkv(dir.path());
        let identity = admit(&thumbs, &path);

        std::fs::remove_file(&path).unwrap();

        for video in [VideoMode::Copy, VideoMode::Encode] {
            let opened = state.open(&thumbs, software(), &identity, Duration::ZERO, video, AudioMode::Copy);
            assert_eq!(opened, Err(VideoError::Gone));
        }
    }

    #[test]
    fn an_image_or_an_unknown_identity_is_not_found() {
        let (state, thumbs) = (SessionState::default(), state());
        let image = admit(&thumbs, &fixture("test1.png"));

        for identity in [image.as_str(), "0123456789abcdef"] {
            let opened = state.open(&thumbs, software(), identity, Duration::ZERO, VideoMode::Copy, AudioMode::Copy);
            assert_eq!(opened, Err(VideoError::NotFound));
        }
    }

    #[test]
    fn a_file_that_cant_be_read_or_decoded_is_unreadable_and_leaves_no_session() {
        let (state, thumbs) = (SessionState::default(), state());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let path = dir.path().join("fake.mkv");
        std::fs::write(&path, b"not a video").unwrap();
        let identity = admit(&thumbs, &path);

        for video in [VideoMode::Copy, VideoMode::Encode] {
            let opened = state.open(&thumbs, software(), &identity, Duration::ZERO, video, AudioMode::Encode);
            assert!(matches!(opened, Err(VideoError::Unreadable { .. })), "{video:?}");
        }
        assert_eq!(state.len(), 0);
    }

    #[test]
    fn encoding_a_video_stream_that_cant_be_decoded_is_unreadable_at_open_and_leaves_no_session() {
        let (state, thumbs) = (SessionState::default(), state());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let identity = admit(&thumbs, &mkv_undecodable(dir.path()));

        let opened = state.open(&thumbs, software(), &identity, Duration::ZERO, VideoMode::Encode, AudioMode::Copy);

        assert!(matches!(opened, Err(VideoError::Unreadable { .. })), "{opened:?}");
        assert_eq!(state.len(), 0);
    }

    #[test]
    fn a_closed_session_is_not_found_and_closing_again_does_nothing() {
        let (state, thumbs, segments) = (SessionState::default(), state(), Segments::default());
        let identity = admit(&thumbs, &fixture("test3.mp4"));
        let id = open(&state, &thumbs, &identity);

        state.close(id);
        assert_eq!(state.next(&thumbs, &segments, software(), id), Err(VideoError::NotFound));

        state.close(id);
        state.close(12_345);
        assert_eq!(state.len(), 0);
    }

    #[test]
    fn two_sessions_advance_independently() {
        let (state, thumbs, segments) = (SessionState::default(), state(), Segments::default());
        let identity = admit(&thumbs, &fixture("test3.mp4"));
        let (a, b) = (open(&state, &thumbs, &identity), open_as(&state, &thumbs, &identity, VideoMode::Encode));

        for _ in 0..3 {
            state.next(&thumbs, &segments, software(), a).unwrap();
        }

        assert_eq!(boxes(&state.next(&thumbs, &segments, software(), b).unwrap()), ["ftyp", "moov"]);
        assert_eq!(boxes(&state.next(&thumbs, &segments, software(), a).unwrap()), ["moof", "mdat"]);
    }

    // --- a hardware encoder failing during a run ----------------------------------------------------------------

    #[test]
    fn a_hardware_encoder_that_fails_is_retired_and_later_sessions_use_the_next() {
        use crate::video::encoder::tests::GOOD;
        use crate::video::encoder::{Candidate, LIBX264};

        /// A hardware encoder that passes its test, then fails from its second segment on.
        const FAILING: Candidate = Candidate { fails_from: Some(1), ..GOOD };
        let choice = Encoders::with(&[FAILING]);
        let (state, thumbs, segments) = (SessionState::default(), state(), Segments::default());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let identity = admit(&thumbs, &mkv(dir.path()));
        let open = || state.open(&thumbs, &choice, &identity, Duration::ZERO, VideoMode::Encode, AudioMode::None);
        let (failing, kept) = (open().unwrap().session, open().unwrap().session);

        let failing_init = state.next(&thumbs, &segments, &choice, failing).unwrap();
        state.next(&thumbs, &segments, &choice, failing).unwrap();
        let encodes = segments.encodes();

        // The failing request is refused, and nothing is kept: the next request for the segment encodes it again.
        assert!(matches!(state.next(&thumbs, &segments, &choice, failing), Err(VideoError::Unreadable { .. })));
        assert_eq!(choice.current(), LIBX264);
        // The session opened before keeps its encoder, which fails it in turn, after encoding the segment again.
        assert_eq!(state.next(&thumbs, &segments, &choice, kept).unwrap(), failing_init);
        state.next(&thumbs, &segments, &choice, kept).unwrap();
        assert!(matches!(state.next(&thumbs, &segments, &choice, kept), Err(VideoError::Unreadable { .. })));
        assert_eq!(segments.encodes(), encodes + 2, "a failed segment was kept");

        // A session opened now encodes with libx264, under an init segment of its own, never served the failed
        // encoder's segments.
        let later = open().unwrap().session;
        let encodes = segments.encodes();
        assert_ne!(state.next(&thumbs, &segments, &choice, later).unwrap(), failing_init);
        for _ in 0..3 {
            assert_eq!(boxes(&state.next(&thumbs, &segments, &choice, later).unwrap()), ["moof", "mdat"]);
        }
        assert_eq!(segments.encodes(), encodes + 3, "a segment came from the failed encoder");
    }
}
