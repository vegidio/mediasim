//! The Tauri commands that move admitted files to the platform's Trash and put them back.
//!
//! The window names files by the identity [`thumbs`](crate::thumbs) gave it, never by path, so it can only send to the
//! Trash a file it was shown. Each file is checked again just before it moves: one rewritten, replaced or removed
//! since it was admitted is left alone and reported, so the user never trashes something they didn't see.
//!
//! Each move's [`Trashed`] handle is kept in [`TrashState`] under the identity it was moved as, for the rest of the
//! run. [`restore_media`] takes identities too, so the window can only restore a file this run moved, and only to
//! where it was.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use rust_sak::fs::{FsError, Trashed};
use serde::{Serialize, Serializer};
use tauri::State;
use tauri::async_runtime::spawn_blocking;

use crate::thumbs::{Admitted, ThumbState, admit_one, current_identity};

/// Why a file was not moved to the Trash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TrashFailure {
    /// The identity was never admitted.
    Unknown,
    /// The file is no longer the one admitted: its size, modification time or canonical path differs.
    Changed,
    /// The file no longer exists.
    Missing,
    /// The platform refused the move.
    Trash,
}

/// What happened to one file, as the window sees it: an object tagged by `status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum TrashOutcome {
    /// The file is in the Trash.
    Trashed,
    /// The file was left where it was.
    Failed {
        /// Why.
        reason: TrashFailure,
        /// The reason in words, to follow the file's name.
        message: String,
    },
}

/// The move could not be attempted at all.
#[derive(Debug, thiserror::Error)]
pub enum TrashError {
    /// The blocking task panicked or was cancelled.
    #[error("the Trash task did not finish: {0}")]
    Task(#[from] tauri::Error),
}

impl Serialize for TrashError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl TrashOutcome {
    fn failed(reason: TrashFailure) -> Self {
        let message = match reason {
            TrashFailure::Unknown => "it wasn't opened in this window",
            TrashFailure::Changed => "it has changed since it was opened",
            TrashFailure::Missing => "it no longer exists",
            TrashFailure::Trash => "the Trash refused it",
        };
        Self::Failed { reason, message: message.to_owned() }
    }
}

/// Something [`restore_media`] can put back: a [`Trashed`] handle, or a stand-in for one in tests, since `Trashed`
/// can only be made by a real move.
pub(crate) trait Restorable: Clone + Send + 'static {
    /// Where the file was moved from, and is restored to.
    fn original_path(&self) -> &Path;
    /// Puts the file back, as [`rust_sak::fs::restore_from_trash`] does.
    fn restore(&self) -> rust_sak::fs::Result<PathBuf>;
}

impl Restorable for Trashed {
    fn original_path(&self) -> &Path {
        Trashed::original_path(self)
    }

    fn restore(&self) -> rust_sak::fs::Result<PathBuf> {
        rust_sak::fs::restore_from_trash(self)
    }
}

/// The handle of every file moved to the Trash in this run, by the identity it was moved as, as Tauri managed state.
///
/// A handle is dropped once its file is restored. Nothing is persisted: after a restart, a file can only be restored
/// from the platform's Trash.
#[derive(Debug)]
pub struct TrashState<H = Trashed>(Mutex<HashMap<String, H>>);

impl<H> Default for TrashState<H> {
    fn default() -> Self {
        Self(Mutex::default())
    }
}

impl<H: Restorable> TrashState<H> {
    fn handles(&self) -> MutexGuard<'_, HashMap<String, H>> {
        // Handles are inserted and removed whole, so a panic elsewhere can't leave one half-written.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn insert(&self, identity: String, handle: H) {
        self.handles().insert(identity, handle);
    }

    fn get(&self, identity: &str) -> Option<H> {
        self.handles().get(identity).cloned()
    }

    fn remove(&self, identity: &str) {
        self.handles().remove(identity);
    }
}

/// Moves the admitted files named by `identities` to the platform's Trash and returns, in the same order, what
/// happened to each. A file that fails never stops the next one.
///
/// # Errors
///
/// If the blocking task fails to finish.
#[tauri::command]
pub async fn trash_media(
    thumbs: State<'_, ThumbState>,
    trash: State<'_, TrashState>,
    identities: Vec<String>,
) -> Result<Vec<TrashOutcome>, TrashError> {
    self::trash(&thumbs, &trash, identities).await
}

async fn trash(
    thumbs: &ThumbState,
    trash: &TrashState,
    identities: Vec<String>,
) -> Result<Vec<TrashOutcome>, TrashError> {
    // Looked up here, so the blocking task holds paths rather than the state.
    let admitted: Vec<_> = identities.iter().map(|identity| thumbs.lookup(identity)).collect();

    let results: Vec<_> = spawn_blocking(move || {
        identities
            .into_iter()
            .zip(admitted)
            .map(|(identity, admitted)| {
                let result = match admitted {
                    Some(admitted) => trash_one(&identity, &admitted.path),
                    None => Err(TrashOutcome::failed(TrashFailure::Unknown)),
                };
                (identity, result)
            })
            .collect()
    })
    .await?;

    Ok(results
        .into_iter()
        .map(|(identity, result)| match result {
            Ok(handle) => {
                // A newer move of the same identity replaces the older handle, whose item it would have found anyway.
                trash.insert(identity, handle);
                TrashOutcome::Trashed
            }
            Err(outcome) => outcome,
        })
        .collect())
}

/// Moves the file at `path` to the Trash if it is still the one admitted as `identity`, and returns its handle.
fn trash_one(identity: &str, path: &Path) -> Result<Trashed, TrashOutcome> {
    match current_identity(path) {
        Some(current) if current == identity => {}
        // A path that is now a folder, or unreadable, is not the file that was admitted either.
        _ if path.try_exists().is_ok_and(|exists| !exists) => return Err(TrashOutcome::failed(TrashFailure::Missing)),
        _ => return Err(TrashOutcome::failed(TrashFailure::Changed)),
    }

    rust_sak::fs::move_to_trash(path).map_err(|err| match err {
        // Removed between the check and the move.
        FsError::Io(err) if err.kind() == ErrorKind::NotFound => TrashOutcome::failed(TrashFailure::Missing),
        FsError::Trash { message, .. } => TrashOutcome::Failed { reason: TrashFailure::Trash, message },
        err => TrashOutcome::Failed { reason: TrashFailure::Trash, message: err.to_string() },
    })
}

/// Why a file was not restored from the Trash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RestoreFailure {
    /// No file was moved to the Trash as this identity in this run.
    Unknown,
    /// Something has taken the file's original path since.
    Occupied,
    /// The file is no longer in the Trash.
    Gone,
    /// The platform refused, or the restored file can no longer be admitted.
    Restore,
}

/// What happened to one file, as the window sees it: an object tagged by `status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum RestoreOutcome {
    /// The file is back at its original path and admitted again.
    Restored {
        /// The identity it is admitted as now, which can differ from the one it was moved as.
        identity: String,
    },
    /// The file stayed where it was.
    Failed {
        /// Why.
        reason: RestoreFailure,
        /// The reason in words, to follow the file's name.
        message: String,
    },
}

impl RestoreOutcome {
    fn failed(reason: RestoreFailure) -> Self {
        let message = match reason {
            RestoreFailure::Unknown => "it wasn't moved to the Trash from this window",
            RestoreFailure::Occupied => "a file with its name is already in its folder",
            RestoreFailure::Gone => "it is no longer in the Trash",
            RestoreFailure::Restore => "the Trash refused it",
        };
        Self::Failed { reason, message: message.to_owned() }
    }
}

/// Puts the files moved to the Trash as `identities` back where they were, admits them again, and returns, in the
/// same order, what happened to each. A file that fails never stops the next one, and keeps its handle, so it can be
/// tried again.
///
/// # Errors
///
/// If the blocking task fails to finish.
#[tauri::command]
pub async fn restore_media(
    thumbs: State<'_, ThumbState>,
    trash: State<'_, TrashState>,
    identities: Vec<String>,
) -> Result<Vec<RestoreOutcome>, TrashError> {
    restore(&thumbs, &trash, identities).await
}

async fn restore<H: Restorable>(
    thumbs: &ThumbState,
    trash: &TrashState<H>,
    identities: Vec<String>,
) -> Result<Vec<RestoreOutcome>, TrashError> {
    // Cloned out here, so the blocking task holds handles rather than the state.
    let handles: Vec<_> = identities.iter().map(|identity| trash.get(identity)).collect();

    let results: Vec<_> = spawn_blocking(move || {
        identities
            .into_iter()
            .zip(handles)
            .map(|(identity, handle)| {
                let result = match handle {
                    Some(handle) => restore_one(&identity, &handle),
                    None => Err(RestoreOutcome::failed(RestoreFailure::Unknown)),
                };
                (identity, result)
            })
            .collect()
    })
    .await?;

    Ok(results
        .into_iter()
        .map(|(identity, result)| match result {
            Ok((current, admitted)) => {
                thumbs.admit([(current.clone(), admitted)]);
                trash.remove(&identity);
                RestoreOutcome::Restored { identity: current }
            }
            Err(outcome) => outcome,
        })
        .collect())
}

/// Restores the file moved as `identity`, and returns the identity it is admitted as now and what was recorded.
fn restore_one<H: Restorable>(identity: &str, handle: &H) -> Result<(String, Admitted), RestoreOutcome> {
    let path = match handle.restore() {
        Ok(path) => path,
        Err(FsError::Io(err)) if err.kind() == ErrorKind::AlreadyExists => {
            return Err(RestoreOutcome::failed(RestoreFailure::Occupied));
        }
        // Not in the Trash, but the same file is back where it was: the user put it back by hand.
        Err(FsError::Io(err)) if err.kind() == ErrorKind::NotFound => {
            let original = handle.original_path();
            if current_identity(original).as_deref() != Some(identity) {
                return Err(RestoreOutcome::failed(RestoreFailure::Gone));
            }
            original.to_path_buf()
        }
        Err(FsError::Restore { message, .. }) => {
            return Err(RestoreOutcome::Failed { reason: RestoreFailure::Restore, message });
        }
        Err(err) => return Err(RestoreOutcome::Failed { reason: RestoreFailure::Restore, message: err.to_string() }),
    };

    // On disk again, but the window can't show a file that's no longer media it can open.
    admit_one(&path)
        .map(|(identity, admitted, _)| (identity, admitted))
        .ok_or_else(|| RestoreOutcome::Failed {
            reason: RestoreFailure::Restore,
            message: "it was restored, but can no longer be opened".to_owned(),
        })
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::thumbs::tests::{fixture, set_modified, state};

    fn block_on<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn trash(state: &ThumbState, identities: Vec<String>) -> Vec<TrashOutcome> {
        block_on(super::trash(state, &TrashState::default(), identities)).unwrap()
    }

    fn restore(state: &ThumbState, trash: &TrashState<FakeTrashed>, identities: Vec<String>) -> Vec<RestoreOutcome> {
        block_on(super::restore(state, trash, identities)).unwrap()
    }

    /// What a [`FakeTrashed`] answers when asked to restore.
    #[derive(Debug, Clone, Copy)]
    enum FakeResult {
        /// Restored: the test has already put the file at the original path.
        Restored,
        AlreadyExists,
        NotFound,
    }

    /// A handle that restores nothing and answers with a chosen result, since a real `Trashed` needs a real Trash.
    #[derive(Debug, Clone)]
    struct FakeTrashed {
        original: std::path::PathBuf,
        result: FakeResult,
    }

    impl Restorable for FakeTrashed {
        fn original_path(&self) -> &Path {
            &self.original
        }

        fn restore(&self) -> rust_sak::fs::Result<PathBuf> {
            match self.result {
                FakeResult::Restored => Ok(self.original.clone()),
                FakeResult::AlreadyExists => Err(std::io::Error::from(ErrorKind::AlreadyExists).into()),
                FakeResult::NotFound => Err(std::io::Error::from(ErrorKind::NotFound).into()),
            }
        }
    }

    /// A trash state holding one fake handle for `original`, as `identity`.
    fn trash_state(identity: &str, original: &Path, result: FakeResult) -> TrashState<FakeTrashed> {
        let trash = TrashState::default();
        trash.insert(identity.to_owned(), FakeTrashed { original: original.to_path_buf(), result });
        trash
    }

    /// A copy of a fixture image in a fresh temp directory, which the returned handle removes.
    fn temp_image() -> (rust_sak::fs::TempDir, PathBuf) {
        let dir = mk_temp_dir("mediasim-restore-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        (dir, path)
    }

    /// Admits `paths` into `state` and returns their identities.
    fn admit(state: &ThumbState, paths: Vec<std::path::PathBuf>) -> Vec<String> {
        let identities = block_on(crate::thumbs::commands::admit(state, paths)).unwrap();
        identities.into_iter().map(Option::unwrap).collect()
    }

    #[test]
    fn an_unknown_identity_is_unknown() {
        let outcomes = trash(&state(), vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [TrashOutcome::failed(TrashFailure::Unknown)]);
    }

    #[test]
    fn a_file_rewritten_after_admission_is_changed_and_stays_on_disk() {
        let state = state();
        let dir = mk_temp_dir("mediasim-trash-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        let identities = admit(&state, vec![path.clone()]);

        std::fs::write(&path, b"rewritten").unwrap();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_001));

        assert_eq!(trash(&state, identities), [TrashOutcome::failed(TrashFailure::Changed)]);
        assert!(path.exists());
    }

    #[test]
    fn a_file_removed_after_admission_is_missing() {
        let state = state();
        let dir = mk_temp_dir("mediasim-trash-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        let identities = admit(&state, vec![path.clone()]);

        std::fs::remove_file(&path).unwrap();

        assert_eq!(trash(&state, identities), [TrashOutcome::failed(TrashFailure::Missing)]);
    }

    #[test]
    fn mixed_inputs_keep_their_order() {
        let state = state();
        let dir = mk_temp_dir("mediasim-trash-").unwrap();
        let removed = dir.path().join("removed.png");
        std::fs::copy(fixture("test1.png"), &removed).unwrap();
        let mut identities = admit(&state, vec![removed.clone()]);
        std::fs::remove_file(&removed).unwrap();
        identities.insert(0, "0123456789abcdef".into());

        assert_eq!(
            trash(&state, identities),
            [TrashOutcome::failed(TrashFailure::Unknown), TrashOutcome::failed(TrashFailure::Missing)]
        );
    }

    #[test]
    fn outcomes_serialize_as_tagged_objects() {
        assert_eq!(serde_json::to_value(TrashOutcome::Trashed).unwrap(), serde_json::json!({ "status": "trashed" }));
        assert_eq!(
            serde_json::to_value(TrashOutcome::failed(TrashFailure::Changed)).unwrap(),
            serde_json::json!({
                "status": "failed",
                "reason": "changed",
                "message": "it has changed since it was opened",
            })
        );
    }

    #[test]
    fn restoring_an_identity_with_no_handle_is_unknown() {
        let outcomes = restore(&state(), &TrashState::default(), vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [RestoreOutcome::failed(RestoreFailure::Unknown)]);
    }

    #[test]
    fn a_restored_file_is_admitted_under_its_current_identity_and_its_handle_dropped() {
        let state = state();
        let (_dir, path) = temp_image();
        let trash = trash_state("0123456789abcdef", &path, FakeResult::Restored);

        let outcomes = restore(&state, &trash, vec!["0123456789abcdef".into()]);

        let identity = current_identity(&path).unwrap();
        assert_eq!(outcomes, [RestoreOutcome::Restored { identity: identity.clone() }]);
        assert!(state.lookup(&identity).is_some());
        assert!(trash.get("0123456789abcdef").is_none());
    }

    #[test]
    fn a_file_put_back_by_hand_unchanged_counts_as_restored() {
        let state = state();
        let (_dir, path) = temp_image();
        let identity = current_identity(&path).unwrap();
        let trash = trash_state(&identity, &path, FakeResult::NotFound);

        let outcomes = restore(&state, &trash, vec![identity.clone()]);

        assert_eq!(outcomes, [RestoreOutcome::Restored { identity: identity.clone() }]);
        assert!(trash.get(&identity).is_none());
    }

    #[test]
    fn a_file_no_longer_in_the_trash_is_gone_and_keeps_its_handle() {
        let dir = mk_temp_dir("mediasim-restore-").unwrap();
        let path = dir.path().join("a.png");
        let trash = trash_state("0123456789abcdef", &path, FakeResult::NotFound);

        let outcomes = restore(&state(), &trash, vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [RestoreOutcome::failed(RestoreFailure::Gone)]);
        assert!(trash.get("0123456789abcdef").is_some());
    }

    #[test]
    fn a_taken_path_is_occupied_and_keeps_its_handle() {
        let (_dir, path) = temp_image();
        let trash = trash_state("0123456789abcdef", &path, FakeResult::AlreadyExists);

        let outcomes = restore(&state(), &trash, vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [RestoreOutcome::failed(RestoreFailure::Occupied)]);
        assert!(trash.get("0123456789abcdef").is_some());
    }

    #[test]
    fn restores_keep_their_order() {
        let (_dir, path) = temp_image();
        let trash = trash_state("0123456789abcdef", &path, FakeResult::AlreadyExists);

        let outcomes = restore(&state(), &trash, vec!["fedcba9876543210".into(), "0123456789abcdef".into()]);

        assert_eq!(
            outcomes,
            [
                RestoreOutcome::failed(RestoreFailure::Unknown),
                RestoreOutcome::failed(RestoreFailure::Occupied)
            ]
        );
    }

    #[test]
    fn restore_outcomes_serialize_as_tagged_objects() {
        assert_eq!(
            serde_json::to_value(RestoreOutcome::Restored { identity: "0123456789abcdef".into() }).unwrap(),
            serde_json::json!({ "status": "restored", "identity": "0123456789abcdef" })
        );
        assert_eq!(
            serde_json::to_value(RestoreOutcome::failed(RestoreFailure::Occupied)).unwrap(),
            serde_json::json!({
                "status": "failed",
                "reason": "occupied",
                "message": "a file with its name is already in its folder",
            })
        );
    }
}
