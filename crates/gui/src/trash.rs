//! The Tauri command that moves admitted files to the platform's Trash.
//!
//! The window names files by the identity [`thumbs`](crate::thumbs) gave it, never by path, so it can only send to the
//! Trash a file it was shown. Each file is checked again just before it moves: one rewritten, replaced or removed
//! since it was admitted is left alone and reported, so the user never trashes something they didn't see.

use std::io::ErrorKind;

use rust_sak::fs::FsError;
use serde::{Serialize, Serializer};
use tauri::State;
use tauri::async_runtime::spawn_blocking;

use crate::thumbs::{ThumbState, current_identity};

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

/// Moves the admitted files named by `identities` to the platform's Trash and returns, in the same order, what
/// happened to each. A file that fails never stops the next one.
///
/// # Errors
///
/// If the blocking task fails to finish.
#[tauri::command]
pub async fn trash_media(
    state: State<'_, ThumbState>,
    identities: Vec<String>,
) -> Result<Vec<TrashOutcome>, TrashError> {
    trash(&state, identities).await
}

async fn trash(state: &ThumbState, identities: Vec<String>) -> Result<Vec<TrashOutcome>, TrashError> {
    // Looked up here, so the blocking task holds paths rather than the state.
    let admitted: Vec<_> = identities.iter().map(|identity| state.lookup(identity)).collect();

    let outcomes = spawn_blocking(move || {
        identities
            .iter()
            .zip(admitted)
            .map(|(identity, admitted)| match admitted {
                Some(admitted) => trash_one(identity, &admitted.path),
                None => TrashOutcome::failed(TrashFailure::Unknown),
            })
            .collect()
    });

    Ok(outcomes.await?)
}

/// Moves the file at `path` to the Trash if it is still the one admitted as `identity`.
fn trash_one(identity: &str, path: &std::path::Path) -> TrashOutcome {
    match current_identity(path) {
        Some(current) if current == identity => {}
        // A path that is now a folder, or unreadable, is not the file that was admitted either.
        _ if path.try_exists().is_ok_and(|exists| !exists) => return TrashOutcome::failed(TrashFailure::Missing),
        _ => return TrashOutcome::failed(TrashFailure::Changed),
    }

    match rust_sak::fs::move_to_trash(path) {
        Ok(()) => TrashOutcome::Trashed,
        // Removed between the check and the move.
        Err(FsError::Io(err)) if err.kind() == ErrorKind::NotFound => TrashOutcome::failed(TrashFailure::Missing),
        Err(FsError::Trash { message, .. }) => TrashOutcome::Failed { reason: TrashFailure::Trash, message },
        Err(err) => TrashOutcome::Failed { reason: TrashFailure::Trash, message: err.to_string() },
    }
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
        block_on(super::trash(state, identities)).unwrap()
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
}
