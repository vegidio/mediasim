//! The open remux sessions, and the commands the window opens, pulls and closes them with.
//!
//! A session is found by a `u64` id. The registry lock is held only to find or change an entry: each session has its
//! own mutex, so two players remux in parallel and a slow segment never holds up the others. At most [`LIMIT`]
//! sessions are open; opening one more closes the one requested from least recently, which bounds what a window that
//! never closes its sessions can leak.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager};

use super::RemuxError;
use super::probe::locate_video;
use super::remux::Remux;
use crate::thumbs::{ThumbState, locate};

/// The most sessions open at once: both views' two players, a reopen after a seek while the old session is still
/// closing, and React's `StrictMode` rehearsal mount, with room to spare.
const LIMIT: usize = 8;

/// One open session and the file it reads.
struct Session {
    remux: Remux,
    identity: String,
}

/// A session in the registry, and when it was last requested from.
struct Entry {
    session: Arc<Mutex<Session>>,
    /// The registry's request count at this session's last open or request: the lowest was requested from least
    /// recently.
    last_request: u64,
}

#[derive(Default)]
struct Registry {
    /// The id the next session gets.
    next_id: u64,
    /// Opens and requests so far, which orders the sessions by recency.
    requests: u64,
    sessions: HashMap<u64, Entry>,
}

/// The open remux sessions, as Tauri managed state.
#[derive(Default)]
pub struct RemuxState {
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

impl RemuxState {
    fn registry(&self) -> MutexGuard<'_, Registry> {
        // Every change to the registry is a single insert or remove, never left half-done, so a poisoned lock is sound.
        self.registry.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Opens a session for the video behind `identity`, starting at `at`, with its audio if `audio` is set. Closes the
    /// session requested from least recently when there are already [`LIMIT`].
    fn open(&self, thumbs: &ThumbState, identity: &str, at: Duration, audio: bool) -> Result<Opened, RemuxError> {
        let admitted = locate_video(thumbs, identity)?;
        let path = admitted.path.to_str().ok_or(RemuxError::Gone)?;
        let (remux, start) = Remux::open(path, at, audio)?;
        let session = Arc::new(Mutex::new(Session { remux, identity: identity.to_owned() }));

        let mut registry = self.registry();
        let id = registry.next_id;
        registry.next_id += 1;
        registry.requests += 1;
        let last_request = registry.requests;
        registry.sessions.insert(id, Entry { session, last_request });

        let evicted = if registry.sessions.len() > LIMIT {
            let oldest = registry.sessions.iter().min_by_key(|(_, entry)| entry.last_request).map(|(id, _)| *id);
            oldest.and_then(|oldest| registry.sessions.remove(&oldest))
        } else {
            None
        };
        // Ending a session closes its file and its FFmpeg contexts, which happens after the lock is released.
        drop(registry);
        drop(evicted);

        Ok(Opened { session: id, start })
    }

    /// The next segment of session `id`. A file removed or changed since, or one that fails to read, closes the
    /// session.
    fn next(&self, thumbs: &ThumbState, id: u64) -> Result<Vec<u8>, RemuxError> {
        let session = {
            let mut registry = self.registry();
            registry.requests += 1;
            let request = registry.requests;
            let entry = registry.sessions.get_mut(&id).ok_or(RemuxError::NotFound)?;
            entry.last_request = request;
            Arc::clone(&entry.session)
        };
        // A panic mid-segment leaves the session unusable, which the error below then closes.
        let mut session = session.lock().unwrap_or_else(PoisonError::into_inner);

        if locate(thumbs, &session.identity).is_err() {
            self.close(id);
            return Err(RemuxError::Gone);
        }

        session.remux.next().map_err(|err| {
            self.close(id);
            err.into()
        })
    }

    /// Closes session `id`, if it is open. The session ends after the registry lock is released, since that closes its
    /// file and its `FFmpeg` contexts.
    fn close(&self, id: u64) {
        let removed = self.registry().sessions.remove(&id);
        drop(removed);
    }

    /// How many sessions are open.
    #[cfg(test)]
    fn len(&self) -> usize {
        self.registry().sessions.len()
    }
}

/// Opens a remux session for an admitted video, starting at the last keyframe at or before `at` seconds, with its
/// main audio stream if `audio` is set.
///
/// # Errors
///
/// `notfound` for an identity never admitted or naming an image, `gone` for a file removed or changed since, and
/// `unreadable` for one that can't be read or remuxed.
#[tauri::command]
pub async fn remux_open(app: AppHandle, identity: String, at: f64, audio: bool) -> Result<Opened, RemuxError> {
    // A time the window can't mean, such as `NaN` or a negative one, is read as the start.
    let at = Duration::try_from_secs_f64(at).unwrap_or_default();

    spawn_blocking(move || app.state::<RemuxState>().open(&app.state::<ThumbState>(), &identity, at, audio)).await?
}

/// The next segment of a session, as raw bytes: the init segment, then one fragment per call, then empty.
///
/// # Errors
///
/// `notfound` for a session that is closed or never existed, `gone` when its file was removed or changed, and
/// `unreadable` when it fails to read. Either of the last two closes the session.
#[tauri::command]
pub async fn remux_next(app: AppHandle, session: u64) -> Result<Response, RemuxError> {
    let segment = spawn_blocking(move || app.state::<RemuxState>().next(&app.state::<ThumbState>(), session)).await??;

    Ok(Response::new(segment))
}

/// Closes a session. Closing one that is already closed does nothing.
///
/// # Errors
///
/// `unreadable` only if the blocking task that closes it doesn't finish.
#[tauri::command]
pub async fn remux_close(app: AppHandle, session: u64) -> Result<(), RemuxError> {
    spawn_blocking(move || app.state::<RemuxState>().close(session)).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::thumbs::tests::{fixture, state};
    use crate::video::fixtures::{admit, mkv};
    use crate::video::remux::tests::boxes;

    fn open(state: &RemuxState, thumbs: &ThumbState, identity: &str) -> u64 {
        state.open(thumbs, identity, Duration::ZERO, true).unwrap().session
    }

    #[test]
    fn a_session_runs_from_open_to_end() {
        let (state, thumbs) = (RemuxState::default(), state());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let identity = admit(&thumbs, &mkv(dir.path()));

        let opened = state.open(&thumbs, &identity, Duration::from_secs(3), true).unwrap();
        assert!((opened.start - 2.0).abs() < 0.001);

        assert_eq!(boxes(&state.next(&thumbs, opened.session).unwrap()), ["ftyp", "moov"]);
        let mut fragments = 0;
        loop {
            let segment = state.next(&thumbs, opened.session).unwrap();
            if segment.is_empty() {
                break;
            }
            assert_eq!(boxes(&segment), ["moof", "mdat"]);
            fragments += 1;
        }
        // Keyframes at 2, 4, 6, 8 and 10 s.
        assert_eq!(fragments, 5);
        assert!(state.next(&thumbs, opened.session).unwrap().is_empty());
    }

    #[test]
    fn the_answer_to_open_is_camel_case() {
        let json = serde_json::to_value(Opened { session: 3, start: 2.0 }).unwrap();

        assert_eq!(json, serde_json::json!({ "session": 3, "start": 2.0 }));
    }

    #[test]
    fn a_ninth_session_closes_the_least_recently_requested() {
        let (state, thumbs) = (RemuxState::default(), state());
        let identity = admit(&thumbs, &fixture("test3.mp4"));
        let ids: Vec<_> = (0..LIMIT).map(|_| open(&state, &thumbs, &identity)).collect();
        // The first is requested from again, so the second is now the least recent.
        state.next(&thumbs, ids[0]).unwrap();

        let ninth = open(&state, &thumbs, &identity);

        assert_eq!(state.len(), LIMIT);
        assert_eq!(state.next(&thumbs, ids[1]), Err(RemuxError::NotFound));
        assert!(state.next(&thumbs, ids[0]).is_ok());
        assert!(state.next(&thumbs, ninth).is_ok());
    }

    #[test]
    fn a_removed_file_is_gone_and_closes_its_session() {
        let (state, thumbs) = (RemuxState::default(), state());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let path = mkv(dir.path());
        let identity = admit(&thumbs, &path);
        let id = open(&state, &thumbs, &identity);
        state.next(&thumbs, id).unwrap();

        std::fs::remove_file(&path).unwrap();

        assert_eq!(state.next(&thumbs, id), Err(RemuxError::Gone));
        assert_eq!(state.len(), 0);
        assert_eq!(state.next(&thumbs, id), Err(RemuxError::NotFound));
    }

    #[test]
    fn opening_a_removed_file_is_gone() {
        let (state, thumbs) = (RemuxState::default(), state());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let path = mkv(dir.path());
        let identity = admit(&thumbs, &path);

        std::fs::remove_file(&path).unwrap();

        assert_eq!(state.open(&thumbs, &identity, Duration::ZERO, true), Err(RemuxError::Gone));
    }

    #[test]
    fn an_image_or_an_unknown_identity_is_not_found() {
        let (state, thumbs) = (RemuxState::default(), state());
        let image = admit(&thumbs, &fixture("test1.png"));

        for identity in [image.as_str(), "0123456789abcdef"] {
            assert_eq!(state.open(&thumbs, identity, Duration::ZERO, true), Err(RemuxError::NotFound));
        }
    }

    #[test]
    fn a_file_that_is_not_a_video_inside_is_unreadable() {
        let (state, thumbs) = (RemuxState::default(), state());
        let dir = mk_temp_dir("mediasim-sessions-").unwrap();
        let path = dir.path().join("fake.mkv");
        std::fs::write(&path, b"not a video").unwrap();
        let identity = admit(&thumbs, &path);

        assert!(matches!(
            state.open(&thumbs, &identity, Duration::ZERO, true),
            Err(RemuxError::Unreadable { .. })
        ));
        assert_eq!(state.len(), 0);
    }

    #[test]
    fn a_closed_session_is_not_found_and_closing_again_does_nothing() {
        let (state, thumbs) = (RemuxState::default(), state());
        let identity = admit(&thumbs, &fixture("test3.mp4"));
        let id = open(&state, &thumbs, &identity);

        state.close(id);
        assert_eq!(state.next(&thumbs, id), Err(RemuxError::NotFound));

        state.close(id);
        state.close(12_345);
        assert_eq!(state.len(), 0);
    }

    #[test]
    fn two_sessions_advance_independently() {
        let (state, thumbs) = (RemuxState::default(), state());
        let identity = admit(&thumbs, &fixture("test3.mp4"));
        let (a, b) = (open(&state, &thumbs, &identity), open(&state, &thumbs, &identity));

        for _ in 0..3 {
            state.next(&thumbs, a).unwrap();
        }

        assert_eq!(boxes(&state.next(&thumbs, b).unwrap()), ["ftyp", "moov"]);
        assert_eq!(boxes(&state.next(&thumbs, a).unwrap()), ["moof", "mdat"]);
    }
}
