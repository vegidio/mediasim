//! The Tauri commands that move admitted files to the platform's Trash, put them back, or delete them outright.
//!
//! The window names files by the identity [`admission`](crate::admission) gave it, never by path, so it can only send
//! to the Trash or delete a file that is in the registry. Each file is checked again just before it moves: one
//! rewritten, replaced or removed since it was admitted is left alone and reported, so a file that changed since the
//! window was shown it is never removed. A file must also be one the user chose, or inside a folder they chose, as
//! [`roots`](crate::roots) records: admission takes any media file the window names, so a file it admitted that
//! resolves outside every chosen root is refused here. Restoring needs no such check, since it only puts back a file
//! this run moved.
//!
//! Each move's [`Trashed`] handle is kept in [`TrashState`] under the identity it was moved as, for the rest of the
//! run. [`restore_media`] takes identities too, so the window can only restore a file this run moved, and only to
//! where it was.

use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use rust_sak::fs::{FsError, Trashed};
use serde::Serialize;
use tauri::State;
use tauri::async_runtime::spawn_blocking;

use crate::TaskError;
use crate::admission::{Admissions, Admitted, Mismatch, admit_one, check_admitted, current_identity};
use crate::roots::{AllowedRoots, ChosenRoots};

/// Why a file was not moved to the Trash or deleted. The window reads a move's failures as `unknown`, `changed`,
/// `missing`, `unchosen` or `trash`, and a deletion's as the same with `delete` in place of `trash`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RemoveFailure {
    /// The identity was never admitted.
    Unknown,
    /// The file is no longer the one admitted: its size, modification time or canonical path differs.
    Changed,
    /// The file no longer exists.
    Missing,
    /// The file is neither one the user chose nor inside a folder they chose.
    Unchosen,
    /// The platform refused the move.
    Trash,
    /// The platform refused the deletion.
    Delete,
}

impl RemoveFailure {
    /// The reason in words, to follow the file's name.
    fn message(self) -> &'static str {
        match self {
            Self::Unknown => "it wasn't opened in this window",
            Self::Changed => "it has changed since it was opened",
            Self::Missing => "it no longer exists",
            Self::Unchosen => "it isn't in a file or folder you chose",
            Self::Trash => "the Trash refused it",
            Self::Delete => "it could not be deleted",
        }
    }
}

impl From<Mismatch> for RemoveFailure {
    fn from(mismatch: Mismatch) -> Self {
        match mismatch {
            Mismatch::Changed => Self::Changed,
            Mismatch::Missing => Self::Missing,
        }
    }
}

/// Why one file was left where it was, shared by every outcome's `failed` status, whose object carries both fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Failure<R> {
    /// Why.
    pub reason: R,
    /// The reason in words, to follow the file's name.
    pub message: String,
}

impl Failure<RemoveFailure> {
    fn of(reason: RemoveFailure) -> Self {
        Self { reason, message: reason.message().to_owned() }
    }
}

/// What happened to one file, as the window sees it: an object tagged by `status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum TrashOutcome {
    /// The file is in the Trash.
    Trashed,
    /// The file was left where it was.
    Failed(Failure<RemoveFailure>),
}

impl TrashOutcome {
    fn failed(reason: RemoveFailure) -> Self {
        Self::Failed(Failure::of(reason))
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

/// Runs `act` on the blocking pool for each of `identities`, in order, with what `lookup` found for it, then `apply`s
/// each result back here. `lookup` runs first, so the blocking task holds what it found rather than the state.
async fn per_identity<T, R, O>(
    identities: Vec<String>,
    lookup: impl Fn(&str) -> Option<T>,
    act: impl Fn(&str, Option<T>) -> R + Send + 'static,
    mut apply: impl FnMut(String, R) -> O,
) -> Result<Vec<O>, TaskError>
where
    T: Send + 'static,
    R: Send + 'static,
{
    let found: Vec<_> = identities.iter().map(|identity| lookup(identity)).collect();

    let results: Vec<_> = spawn_blocking(move || {
        identities
            .into_iter()
            .zip(found)
            .map(|(identity, found)| {
                let result = act(&identity, found);
                (identity, result)
            })
            .collect()
    })
    .await?;

    Ok(results.into_iter().map(|(identity, result)| apply(identity, result)).collect())
}

/// Moves the admitted files named by `identities` to the platform's Trash and returns, in the same order, what
/// happened to each. A file that fails never stops the next one.
///
/// # Errors
///
/// If the blocking task fails to finish.
#[tauri::command]
pub async fn trash_media(
    registry: State<'_, Admissions>,
    roots: State<'_, AllowedRoots>,
    trash: State<'_, TrashState>,
    identities: Vec<String>,
) -> Result<Vec<TrashOutcome>, TaskError> {
    self::trash(&registry, &roots, &trash, identities).await
}

async fn trash(
    registry: &Admissions,
    roots: &AllowedRoots,
    trash: &TrashState,
    identities: Vec<String>,
) -> Result<Vec<TrashOutcome>, TaskError> {
    let chosen = roots.snapshot();
    per_identity(
        identities,
        |identity| registry.lookup(identity),
        move |identity, admitted| match admitted {
            Some(admitted) => trash_one(identity, &admitted.path, &chosen),
            None => Err(TrashOutcome::failed(RemoveFailure::Unknown)),
        },
        |identity, result| match result {
            Ok(handle) => {
                // A newer move of the same identity replaces the older handle, whose item it would have found anyway.
                trash.insert(identity, handle);
                TrashOutcome::Trashed
            }
            Err(outcome) => outcome,
        },
    )
    .await
}

/// Moves the file at `path` to the Trash if it is still the one admitted as `identity` and is `chosen`, and returns
/// its handle.
fn trash_one(identity: &str, path: &Path, chosen: &ChosenRoots) -> Result<Trashed, TrashOutcome> {
    check_removable(identity, path, chosen).map_err(TrashOutcome::failed)?;

    rust_sak::fs::move_to_trash(path).map_err(|err| match err {
        // Removed between the check and the move.
        FsError::Io(err) if err.kind() == ErrorKind::NotFound => TrashOutcome::failed(RemoveFailure::Missing),
        FsError::Trash { message, .. } => TrashOutcome::Failed(Failure { reason: RemoveFailure::Trash, message }),
        err => TrashOutcome::Failed(Failure { reason: RemoveFailure::Trash, message: err.to_string() }),
    })
}

/// What happened to one file, as the window sees it: an object tagged by `status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum DeleteOutcome {
    /// The file is no longer on disk.
    Deleted,
    /// The file was left where it was.
    Failed(Failure<RemoveFailure>),
}

impl DeleteOutcome {
    fn failed(reason: RemoveFailure) -> Self {
        Self::Failed(Failure::of(reason))
    }
}

/// Deletes the admitted files named by `identities` from disk, without the Trash, and returns, in the same order,
/// what happened to each. A file that fails never stops the next one. Nothing is recorded, so nothing can be undone.
///
/// # Errors
///
/// If the blocking task fails to finish.
#[tauri::command]
pub async fn delete_media(
    registry: State<'_, Admissions>,
    roots: State<'_, AllowedRoots>,
    identities: Vec<String>,
) -> Result<Vec<DeleteOutcome>, TaskError> {
    delete(&registry, &roots, identities).await
}

async fn delete(
    registry: &Admissions,
    roots: &AllowedRoots,
    identities: Vec<String>,
) -> Result<Vec<DeleteOutcome>, TaskError> {
    let chosen = roots.snapshot();
    per_identity(
        identities,
        |identity| registry.lookup(identity),
        move |identity, admitted| match admitted {
            Some(admitted) => delete_one(identity, &admitted.path, &chosen),
            None => DeleteOutcome::failed(RemoveFailure::Unknown),
        },
        |_, outcome| outcome,
    )
    .await
}

/// Deletes the file at `path` if it is still the one admitted as `identity` and is `chosen`.
fn delete_one(identity: &str, path: &Path, chosen: &ChosenRoots) -> DeleteOutcome {
    if let Err(reason) = check_removable(identity, path, chosen) {
        return DeleteOutcome::failed(reason);
    }

    match std::fs::remove_file(path) {
        Ok(()) => DeleteOutcome::Deleted,
        // Removed between the check and the deletion.
        Err(err) if err.kind() == ErrorKind::NotFound => DeleteOutcome::failed(RemoveFailure::Missing),
        Err(err) => DeleteOutcome::Failed(Failure { reason: RemoveFailure::Delete, message: err.to_string() }),
    }
}

/// Checks that the file at `path` is still the one admitted as `identity`, then that it is `chosen`, just before it
/// is moved or deleted.
fn check_removable(identity: &str, path: &Path, chosen: &ChosenRoots) -> Result<(), RemoveFailure> {
    check_admitted(identity, path)?;

    if chosen.contains(path) { Ok(()) } else { Err(RemoveFailure::Unchosen) }
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
    Failed(Failure<RestoreFailure>),
}

impl RestoreOutcome {
    fn failed(reason: RestoreFailure) -> Self {
        let message = match reason {
            RestoreFailure::Unknown => "it wasn't moved to the Trash from this window",
            RestoreFailure::Occupied => "a file with its name is already in its folder",
            RestoreFailure::Gone => "it is no longer in the Trash",
            RestoreFailure::Restore => "the Trash refused it",
        };
        Self::Failed(Failure { reason, message: message.to_owned() })
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
    registry: State<'_, Admissions>,
    trash: State<'_, TrashState>,
    identities: Vec<String>,
) -> Result<Vec<RestoreOutcome>, TaskError> {
    restore(&registry, &trash, identities).await
}

async fn restore<H: Restorable>(
    registry: &Admissions,
    trash: &TrashState<H>,
    identities: Vec<String>,
) -> Result<Vec<RestoreOutcome>, TaskError> {
    per_identity(
        identities,
        |identity| trash.get(identity),
        |identity, handle| match handle {
            Some(handle) => restore_one(identity, &handle),
            None => Err(RestoreOutcome::failed(RestoreFailure::Unknown)),
        },
        |identity, result| match result {
            Ok((current, admitted)) => {
                registry.admit([(current.clone(), admitted)]);
                trash.remove(&identity);
                RestoreOutcome::Restored { identity: current }
            }
            Err(outcome) => outcome,
        },
    )
    .await
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
            return Err(RestoreOutcome::Failed(Failure { reason: RestoreFailure::Restore, message }));
        }
        Err(err) => {
            return Err(RestoreOutcome::Failed(Failure { reason: RestoreFailure::Restore, message: err.to_string() }));
        }
    };

    // On disk again, but the window can't show a file that's no longer media it can open.
    admit_one(&path).map(|(identity, admitted, _)| (identity, admitted)).ok_or_else(|| {
        RestoreOutcome::Failed(Failure {
            reason: RestoreFailure::Restore,
            message: "it was restored, but can no longer be opened".to_owned(),
        })
    })
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::admission::tests::{fixture, set_modified};

    fn block_on<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    /// Roots that allow every file the tests make, all of which are under the system temp directory.
    fn temp_chosen() -> AllowedRoots {
        let roots = AllowedRoots::default();
        roots.allow([std::env::temp_dir()]);
        roots
    }

    fn trash(state: &Admissions, identities: Vec<String>) -> Vec<TrashOutcome> {
        trash_within(state, &temp_chosen(), identities)
    }

    fn trash_within(state: &Admissions, roots: &AllowedRoots, identities: Vec<String>) -> Vec<TrashOutcome> {
        block_on(super::trash(state, roots, &TrashState::default(), identities)).unwrap()
    }

    fn restore(state: &Admissions, trash: &TrashState<FakeTrashed>, identities: Vec<String>) -> Vec<RestoreOutcome> {
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
    fn admit(state: &Admissions, paths: Vec<std::path::PathBuf>) -> Vec<String> {
        let identities = block_on(crate::thumbs::commands::admit(state, paths)).unwrap();
        identities.into_iter().map(Option::unwrap).collect()
    }

    #[test]
    fn an_unknown_identity_is_unknown() {
        let outcomes = trash(&Admissions::default(), vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [TrashOutcome::failed(RemoveFailure::Unknown)]);
    }

    #[test]
    fn a_file_rewritten_after_admission_is_changed_and_stays_on_disk() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-trash-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        let identities = admit(&state, vec![path.clone()]);

        std::fs::write(&path, b"rewritten").unwrap();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_001));

        assert_eq!(trash(&state, identities), [TrashOutcome::failed(RemoveFailure::Changed)]);
        assert!(path.exists());
    }

    #[test]
    fn a_file_removed_after_admission_is_missing() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-trash-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        let identities = admit(&state, vec![path.clone()]);

        std::fs::remove_file(&path).unwrap();

        assert_eq!(trash(&state, identities), [TrashOutcome::failed(RemoveFailure::Missing)]);
    }

    #[test]
    fn mixed_inputs_keep_their_order() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-trash-").unwrap();
        let removed = dir.path().join("removed.png");
        std::fs::copy(fixture("test1.png"), &removed).unwrap();
        let mut identities = admit(&state, vec![removed.clone()]);
        std::fs::remove_file(&removed).unwrap();
        identities.insert(0, "0123456789abcdef".into());

        assert_eq!(
            trash(&state, identities),
            [TrashOutcome::failed(RemoveFailure::Unknown), TrashOutcome::failed(RemoveFailure::Missing)]
        );
    }

    #[test]
    fn a_file_outside_every_chosen_root_is_unchosen_and_stays_on_disk() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let (_elsewhere, chosen) = temp_image();
        let roots = AllowedRoots::default();
        roots.allow([chosen.parent().unwrap()]);
        let identities = admit(&state, vec![path.clone()]);

        assert_eq!(trash_within(&state, &roots, identities), [TrashOutcome::failed(RemoveFailure::Unchosen)]);
        assert!(path.exists());
    }

    #[test]
    fn a_file_admitted_through_a_path_that_leaves_its_root_is_unchosen() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-trash-").unwrap();
        std::fs::create_dir(dir.path().join("chosen")).unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        let roots = AllowedRoots::default();
        roots.allow([dir.path().join("chosen")]);
        let identities = admit(&state, vec![dir.path().join("chosen/../a.png")]);

        assert_eq!(trash_within(&state, &roots, identities), [TrashOutcome::failed(RemoveFailure::Unchosen)]);
        assert!(path.exists());
    }

    #[test]
    fn a_file_changed_and_unchosen_is_reported_as_changed() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        let identities = admit(&state, vec![path.clone()]);
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_001));

        let outcomes = trash_within(&state, &AllowedRoots::default(), identities);

        assert_eq!(outcomes, [TrashOutcome::failed(RemoveFailure::Changed)]);
    }

    #[test]
    fn outcomes_serialize_as_tagged_objects() {
        assert_eq!(serde_json::to_value(TrashOutcome::Trashed).unwrap(), serde_json::json!({ "status": "trashed" }));
        assert_eq!(
            serde_json::to_value(TrashOutcome::failed(RemoveFailure::Changed)).unwrap(),
            serde_json::json!({
                "status": "failed",
                "reason": "changed",
                "message": "it has changed since it was opened",
            })
        );
    }

    fn delete(state: &Admissions, identities: Vec<String>) -> Vec<DeleteOutcome> {
        delete_within(state, &temp_chosen(), identities)
    }

    fn delete_within(state: &Admissions, roots: &AllowedRoots, identities: Vec<String>) -> Vec<DeleteOutcome> {
        block_on(super::delete(state, roots, identities)).unwrap()
    }

    #[test]
    fn deleting_an_unknown_identity_is_unknown() {
        let outcomes = delete(&Admissions::default(), vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [DeleteOutcome::failed(RemoveFailure::Unknown)]);
    }

    #[test]
    fn deleting_a_file_rewritten_after_admission_is_changed_and_leaves_it_on_disk() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        let identities = admit(&state, vec![path.clone()]);

        std::fs::write(&path, b"rewritten").unwrap();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_001));

        assert_eq!(delete(&state, identities), [DeleteOutcome::failed(RemoveFailure::Changed)]);
        assert!(path.exists());
    }

    #[test]
    fn deleting_a_file_removed_after_admission_is_missing() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let identities = admit(&state, vec![path.clone()]);

        std::fs::remove_file(&path).unwrap();

        assert_eq!(delete(&state, identities), [DeleteOutcome::failed(RemoveFailure::Missing)]);
    }

    #[test]
    fn deleting_a_file_outside_every_chosen_root_is_unchosen_and_leaves_it_on_disk() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let identities = admit(&state, vec![path.clone()]);

        let outcomes = delete_within(&state, &AllowedRoots::default(), identities);

        assert_eq!(outcomes, [DeleteOutcome::failed(RemoveFailure::Unchosen)]);
        assert!(path.exists());
    }

    #[test]
    fn a_file_inside_a_chosen_folder_or_chosen_itself_is_deleted() {
        let state = Admissions::default();
        let (folder, in_folder) = temp_image();
        let (_dir, picked) = temp_image();
        let roots = AllowedRoots::default();
        roots.allow([folder.path(), picked.as_path()]);
        let identities = admit(&state, vec![in_folder.clone(), picked.clone()]);

        assert_eq!(delete_within(&state, &roots, identities), [DeleteOutcome::Deleted, DeleteOutcome::Deleted]);
        assert!(!in_folder.exists() && !picked.exists());
    }

    #[test]
    fn an_unchosen_failure_serializes_as_one_word() {
        assert_eq!(
            serde_json::to_value(DeleteOutcome::failed(RemoveFailure::Unchosen)).unwrap(),
            serde_json::json!({
                "status": "failed",
                "reason": "unchosen",
                "message": "it isn't in a file or folder you chose",
            })
        );
    }

    #[test]
    fn an_admitted_file_is_deleted_from_disk() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let identities = admit(&state, vec![path.clone()]);

        assert_eq!(delete(&state, identities), [DeleteOutcome::Deleted]);
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_file_in_a_read_only_folder_is_refused_and_stays_on_disk() {
        use std::os::unix::fs::PermissionsExt;

        let state = Admissions::default();
        let (dir, path) = temp_image();
        let identities = admit(&state, vec![path.clone()]);
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();

        let outcomes = delete(&state, identities);
        // Writable again, so the temp dir can be cleaned up.
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(
            matches!(&outcomes[..], [DeleteOutcome::Failed(Failure { reason: RemoveFailure::Delete, message })] if !message.is_empty())
        );
        assert!(path.exists());
    }

    #[test]
    fn deletions_keep_their_order() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let mut identities = admit(&state, vec![path.clone()]);
        identities.insert(0, "0123456789abcdef".into());

        assert_eq!(
            delete(&state, identities),
            [DeleteOutcome::failed(RemoveFailure::Unknown), DeleteOutcome::Deleted]
        );
    }

    #[test]
    fn delete_outcomes_serialize_as_tagged_objects() {
        assert_eq!(
            serde_json::to_value(DeleteOutcome::Deleted).unwrap(),
            serde_json::json!({ "status": "deleted" })
        );
        assert_eq!(
            serde_json::to_value(DeleteOutcome::failed(RemoveFailure::Missing)).unwrap(),
            serde_json::json!({
                "status": "failed",
                "reason": "missing",
                "message": "it no longer exists",
            })
        );
    }

    #[test]
    fn restoring_an_identity_with_no_handle_is_unknown() {
        let outcomes = restore(&Admissions::default(), &TrashState::default(), vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [RestoreOutcome::failed(RestoreFailure::Unknown)]);
    }

    #[test]
    fn a_restored_file_is_admitted_under_its_current_identity_and_its_handle_dropped() {
        let state = Admissions::default();
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
        let state = Admissions::default();
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

        let outcomes = restore(&Admissions::default(), &trash, vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [RestoreOutcome::failed(RestoreFailure::Gone)]);
        assert!(trash.get("0123456789abcdef").is_some());
    }

    #[test]
    fn a_taken_path_is_occupied_and_keeps_its_handle() {
        let (_dir, path) = temp_image();
        let trash = trash_state("0123456789abcdef", &path, FakeResult::AlreadyExists);

        let outcomes = restore(&Admissions::default(), &trash, vec!["0123456789abcdef".into()]);

        assert_eq!(outcomes, [RestoreOutcome::failed(RestoreFailure::Occupied)]);
        assert!(trash.get("0123456789abcdef").is_some());
    }

    #[test]
    fn restores_keep_their_order() {
        let (_dir, path) = temp_image();
        let trash = trash_state("0123456789abcdef", &path, FakeResult::AlreadyExists);

        let outcomes =
            restore(&Admissions::default(), &trash, vec!["fedcba9876543210".into(), "0123456789abcdef".into()]);

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
