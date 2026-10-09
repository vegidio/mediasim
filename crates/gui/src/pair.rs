//! The Tauri commands behind the two-file result screen: each file's details, and the comparison of the pair.
//!
//! At most one comparison runs at a time. Starting one cancels any earlier one still running, so its loads stop and
//! it resolves as cancelled, and [`cancel_comparison`] stops the one in flight when the window leaves the screen.

use std::ops::Deref;
use std::path::{Path, PathBuf};

use mediasim::{CancelToken, CompareError, Media, MediaError, MediaInfo};
use serde::Serialize;
use tauri::State;
use tauri::async_runtime::spawn_blocking;

use crate::run::RunSlot;

/// Why a file's details could not be read, or two files could not be compared, as the window sees it: an object
/// tagged by `kind`.
#[derive(Debug, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PairError {
    /// The comparison was cancelled, or replaced by a newer one, before it finished.
    #[error("the comparison was cancelled")]
    Cancelled,
    /// A file could not be loaded or probed.
    #[error("{message}")]
    Load {
        /// The file it concerns.
        path: String,
        /// What went wrong, naming the file.
        message: String,
    },
    /// An image was compared with a video.
    #[error("{message}")]
    Mismatch {
        /// What was compared with what.
        message: String,
    },
    /// The blocking task panicked or was cancelled by the runtime.
    #[error("{message}")]
    Task {
        /// What went wrong.
        message: String,
    },
}

impl From<MediaError> for PairError {
    fn from(err: MediaError) -> Self {
        match err {
            MediaError::Cancelled { .. } => Self::Cancelled,
            err => Self::Load { path: err.path().to_string_lossy().into_owned(), message: err.to_string() },
        }
    }
}

impl From<CompareError> for PairError {
    fn from(err: CompareError) -> Self {
        Self::Mismatch { message: err.to_string() }
    }
}

impl From<tauri::Error> for PairError {
    fn from(err: tauri::Error) -> Self {
        Self::Task { message: crate::task_message(&err) }
    }
}

/// The comparison in flight, as Tauri managed state.
#[derive(Debug, Default)]
pub struct PairState(RunSlot);

impl Deref for PairState {
    type Target = RunSlot;

    fn deref(&self) -> &RunSlot {
        &self.0
    }
}

/// Reads one file's details from its header, without decoding it.
///
/// # Errors
///
/// A `load` error naming the file if it can't be probed, or a `task` error if the blocking task fails to finish.
#[tauri::command]
pub async fn probe_media(path: PathBuf) -> Result<MediaInfo, PairError> {
    Ok(spawn_blocking(move || Media::probe(path)).await??)
}

/// Loads `a` and `b` in parallel and returns their similarity, from `0` (completely different) to `1` (identical).
///
/// Cancels any comparison still running first.
///
/// # Errors
///
/// - `cancelled` if this comparison was cancelled or replaced before it finished.
/// - `load` naming the file that failed. When both fail, A's error is reported.
/// - `mismatch` if one file is an image and the other a video.
/// - `task` if the blocking task fails to finish.
#[tauri::command]
pub async fn compare_pair(state: State<'_, PairState>, a: PathBuf, b: PathBuf) -> Result<f64, PairError> {
    compare(&state, a, b).await
}

/// Cancels the comparison in flight, which then resolves as `cancelled`. Does nothing if none is running.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri passes command arguments by value")]
pub fn cancel_comparison(state: State<'_, PairState>) {
    state.cancel();
}

async fn compare(state: &PairState, a: PathBuf, b: PathBuf) -> Result<f64, PairError> {
    let (id, token) = state.start();
    let result = spawn_blocking(move || load_and_compare(&a, &b, &token)).await;
    state.finish(id);

    result?
}

/// Loads `a` and `b` on two threads sharing `token`, then compares them.
fn load_and_compare(a: &Path, b: &Path, token: &CancelToken) -> Result<f64, PairError> {
    let load = |path: &Path| {
        let result = Media::from_file_cancellable(path, token);
        // A real failure makes the other file pointless to finish.
        if result.as_ref().is_err_and(|err| !is_cancelled(err)) {
            token.cancel();
        }
        result
    };

    let (a, b) = std::thread::scope(|scope| {
        let a = scope.spawn(|| load(a));
        let b = scope.spawn(|| load(b));
        (join(a), join(b))
    });
    let (a, b) = pick(a, b)?;
    let similarity = a.similarity(&b)?;

    // A comparison cancelled after both loads finished must not report a result either.
    if token.is_cancelled() { Err(PairError::Cancelled) } else { Ok(similarity) }
}

/// The result of a scoped load, with a panic carried on to the blocking task, which reports it as a `task` error.
fn join<T>(handle: std::thread::ScopedJoinHandle<'_, T>) -> T {
    handle.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic))
}

/// Both media, or the error to report: a real error beats a cancellation, and A's beats B's.
fn pick(a: Result<Media, MediaError>, b: Result<Media, MediaError>) -> Result<(Media, Media), MediaError> {
    match (a, b) {
        (Ok(a), Ok(b)) => Ok((a, b)),
        (Err(a), Err(b)) if is_cancelled(&a) && !is_cancelled(&b) => Err(b),
        (Err(err), _) | (_, Err(err)) => Err(err),
    }
}

fn is_cancelled(err: &MediaError) -> bool {
    matches!(err, MediaError::Cancelled { .. })
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use mediasim::MediaType;
    use serde_json::json;
    use tauri::async_runtime::block_on;

    use super::*;
    use crate::thumbs::tests::fixture;

    /// Waits until a comparison is registered in `state`.
    fn wait_until_running(state: &PairState) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while state.lock().is_none() {
            assert!(Instant::now() < deadline, "the comparison never started");
            std::thread::yield_now();
        }
    }

    #[test]
    fn fixtures_probe_with_their_type_and_size() {
        for (name, media_type) in [("test1.png", MediaType::Image), ("test3.mp4", MediaType::Video)] {
            let path = fixture(name);

            let info = block_on(probe_media(path.clone())).unwrap();

            assert_eq!(info.media_type, media_type);
            assert_eq!(info.size, std::fs::metadata(&path).unwrap().len());
        }
    }

    #[test]
    fn a_missing_file_probes_as_a_load_error_naming_it() {
        let path = fixture("missing.png");

        let err = block_on(probe_media(path.clone())).unwrap_err();

        let PairError::Load { path: named, .. } = err else {
            panic!("expected a load error, got {err:?}")
        };
        assert_eq!(named, path.to_string_lossy());
    }

    #[test]
    fn every_error_kind_serializes_as_a_tagged_object() {
        let cases = [
            (PairError::Cancelled, json!({ "kind": "cancelled" })),
            (
                PairError::Load { path: "/a/b.mp4".into(), message: "boom".into() },
                json!({ "kind": "load", "path": "/a/b.mp4", "message": "boom" }),
            ),
            (PairError::Mismatch { message: "nope".into() }, json!({ "kind": "mismatch", "message": "nope" })),
            (PairError::Task { message: "panic".into() }, json!({ "kind": "task", "message": "panic" })),
        ];

        for (err, expected) in cases {
            assert_eq!(serde_json::to_value(&err).unwrap(), expected);
        }
    }

    #[test]
    fn a_cancelled_load_is_cancelled_and_any_other_names_its_file() {
        assert_eq!(PairError::from(MediaError::Cancelled { path: "a.png".into() }), PairError::Cancelled);

        let err = PairError::from(MediaError::Unsupported { path: "a.txt".into() });

        assert_eq!(err, PairError::Load { path: "a.txt".into(), message: "unsupported file a.txt".into() });
    }

    #[test]
    fn a_file_against_itself_is_one() {
        let state = PairState::default();

        let similarity = block_on(compare(&state, fixture("test1.png"), fixture("test1.png"))).unwrap();

        assert!((similarity - 1.0).abs() < f64::EPSILON, "{similarity}");
        assert!(state.lock().is_none(), "a finished comparison is forgotten");
    }

    #[test]
    fn two_different_images_score_within_range() {
        let similarity = block_on(compare(&PairState::default(), fixture("test1.png"), fixture("test2.png"))).unwrap();

        assert!((0.0..=1.0).contains(&similarity), "{similarity}");
    }

    #[test]
    fn a_missing_b_is_a_load_error_naming_b() {
        let missing = fixture("missing.png");

        let err = block_on(compare(&PairState::default(), fixture("test1.png"), missing.clone())).unwrap_err();

        let PairError::Load { path, .. } = err else { panic!("expected a load error, got {err:?}") };
        assert_eq!(path, missing.to_string_lossy());
    }

    #[test]
    fn an_image_against_a_video_is_a_mismatch() {
        let err = block_on(compare(&PairState::default(), fixture("test1.png"), fixture("test3.mp4"))).unwrap_err();

        assert!(matches!(err, PairError::Mismatch { .. }), "{err:?}");
    }

    #[test]
    fn a_real_error_beats_a_cancellation_and_a_beats_b() {
        let cancelled = || Err(MediaError::Cancelled { path: "x".into() });
        let failed = |path: &str| Err(MediaError::Unsupported { path: path.into() });

        assert_eq!(pick(cancelled(), failed("b")).unwrap_err().path(), Path::new("b"));
        assert_eq!(pick(failed("a"), cancelled()).unwrap_err().path(), Path::new("a"));
        assert_eq!(pick(failed("a"), failed("b")).unwrap_err().path(), Path::new("a"));
        assert!(is_cancelled(&pick(cancelled(), cancelled()).unwrap_err()));
    }

    #[test]
    fn cancelling_stops_a_comparison_well_before_it_would_finish() {
        let (a, b) = (fixture("test3.mp4"), fixture("test3.mp4"));
        let started = Instant::now();
        block_on(compare(&PairState::default(), a.clone(), b.clone())).unwrap();
        let uncancelled = started.elapsed();

        let state = PairState::default();
        let (result, cancelled) = std::thread::scope(|scope| {
            let started = Instant::now();
            let comparing = scope.spawn(|| block_on(compare(&state, a, b)));
            wait_until_running(&state);
            state.cancel();
            (comparing.join().unwrap(), started.elapsed())
        });

        assert_eq!(result, Err(PairError::Cancelled));
        assert!(
            cancelled < uncancelled / 2,
            "cancelled after {cancelled:?}, against {uncancelled:?} uncancelled"
        );
    }

    #[test]
    fn a_new_comparison_cancels_the_one_it_replaces() {
        let state = PairState::default();

        let (first, second) = std::thread::scope(|scope| {
            let first = scope.spawn(|| block_on(compare(&state, fixture("test3.mp4"), fixture("test4.mp4"))));
            wait_until_running(&state);
            let second = block_on(compare(&state, fixture("test1.png"), fixture("test1.png")));
            (first.join().unwrap(), second)
        });

        assert_eq!(first, Err(PairError::Cancelled));
        assert!(second.is_ok_and(|similarity| (similarity - 1.0).abs() < f64::EPSILON));
    }
}
