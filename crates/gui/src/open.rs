//! The Tauri commands that open an admitted file in the system's default application, or show it in the system file
//! manager.
//!
//! Like [`trash`](crate::trash), the window names files by the identity [`admission`](crate::admission) gave it,
//! never by path, so it can only open a file that is in the registry, and only while the file on disk is still the
//! one admitted: same size, modification time and canonical path. Unlike moving to the Trash or deleting, which also
//! require a file the user chose ([`roots`](crate::roots)), nothing here checks that: admission takes any media file
//! the window names, and opening or revealing one destroys nothing. The opener plugin's free functions are called
//! from here; the plugin itself and its JS API are not registered, so the webview has no way to open a path it hasn't
//! admitted.

use std::path::Path;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use tauri::State;
use tauri::async_runtime::spawn_blocking;

use crate::admission::{Admissions, Mismatch, check_admitted};

/// Why a file was not opened or shown. Crosses to the window as `{ kind, message }`.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum OpenError {
    /// The identity was never admitted.
    #[error("it wasn't opened in this window")]
    Unknown,
    /// The file no longer exists.
    #[error("it no longer exists")]
    Missing,
    /// The file is no longer the one admitted: its size, modification time or canonical path differs.
    #[error("it has changed since it was opened")]
    Changed,
    /// The operating system refused to open or show it.
    #[error("{0}")]
    Failed(String),
    /// The blocking task panicked or was cancelled by the runtime, as [`task_message`](crate::task_message) says.
    #[error("{0}")]
    Task(String),
}

impl OpenError {
    fn kind(&self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Missing => "missing",
            Self::Changed => "changed",
            Self::Failed(_) => "failed",
            Self::Task(_) => "task",
        }
    }
}

impl Serialize for OpenError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("OpenError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl From<Mismatch> for OpenError {
    fn from(mismatch: Mismatch) -> Self {
        match mismatch {
            Mismatch::Changed => Self::Changed,
            Mismatch::Missing => Self::Missing,
        }
    }
}

/// Opens the admitted file named by `identity` in the application the operating system uses by default for its type.
///
/// # Errors
///
/// If the identity was never admitted, the file is gone or has changed, the operating system refuses, or the blocking
/// task fails to finish.
#[tauri::command]
pub async fn open_media(registry: State<'_, Admissions>, identity: String) -> Result<(), OpenError> {
    act(&registry, &identity, |path| tauri_plugin_opener::open_path(path, None::<&str>)).await
}

/// Opens the folder of the admitted file named by `identity` in the system file manager, with the file selected where
/// the file manager supports it.
///
/// # Errors
///
/// As [`open_media`].
#[tauri::command]
pub async fn reveal_media(registry: State<'_, Admissions>, identity: String) -> Result<(), OpenError> {
    act(&registry, &identity, |path| tauri_plugin_opener::reveal_item_in_dir(path)).await
}

/// Runs `opener` on the blocking pool with the path admitted as `identity`, once it is checked to still be that file.
async fn act<F>(registry: &Admissions, identity: &str, opener: F) -> Result<(), OpenError>
where
    F: FnOnce(&Path) -> Result<(), tauri_plugin_opener::Error> + Send + 'static,
{
    let admitted = registry.lookup(identity).ok_or(OpenError::Unknown)?;
    let identity = identity.to_owned();

    spawn_blocking(move || {
        check_admitted(&identity, &admitted.path)?;
        opener(&admitted.path).map_err(|err| OpenError::Failed(err.to_string()))
    })
    .await
    .map_err(|err| OpenError::Task(crate::task_message(&err)))?
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::mpsc;

    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::admission::tests::fixture;

    fn block_on<F: Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    /// A copy of a fixture image in a fresh temp directory, which the returned handle removes.
    fn temp_image() -> (rust_sak::fs::TempDir, PathBuf) {
        let dir = mk_temp_dir("mediasim-open-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        (dir, path)
    }

    /// Admits `path` into `state` and returns its identity.
    fn admit(state: &Admissions, path: PathBuf) -> String {
        let identities = block_on(crate::thumbs::commands::admit(state, vec![path])).unwrap();
        identities.into_iter().next().flatten().unwrap()
    }

    /// Runs [`act`] with an opener that only records the path it was given, so no test reaches the OS.
    fn act(state: &Admissions, identity: &str) -> (Result<(), OpenError>, Option<PathBuf>) {
        let (tx, rx) = mpsc::channel();
        let result = block_on(super::act(state, identity, move |path| {
            tx.send(path.to_path_buf()).unwrap();
            Ok(())
        }));
        (result, rx.try_recv().ok())
    }

    #[test]
    fn an_admitted_unchanged_file_reaches_the_opener() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let identity = admit(&state, path.clone());

        assert_eq!(act(&state, &identity), (Ok(()), Some(path)));
    }

    #[test]
    fn an_unknown_identity_is_unknown() {
        assert_eq!(act(&Admissions::default(), "0123456789abcdef"), (Err(OpenError::Unknown), None));
    }

    #[test]
    fn a_deleted_file_is_missing() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let identity = admit(&state, path.clone());
        std::fs::remove_file(&path).unwrap();

        assert_eq!(act(&state, &identity), (Err(OpenError::Missing), None));
    }

    #[test]
    fn a_rewritten_file_is_changed() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let identity = admit(&state, path.clone());
        std::fs::write(&path, b"rewritten").unwrap();

        assert_eq!(act(&state, &identity), (Err(OpenError::Changed), None));
    }

    #[test]
    fn an_opener_failure_is_failed() {
        let state = Admissions::default();
        let (_dir, path) = temp_image();
        let identity = admit(&state, path);

        let result = block_on(super::act(&state, &identity, |_| Err(std::io::Error::other("no application").into())));

        assert_eq!(result, Err(OpenError::Failed("no application".into())));
    }

    #[test]
    fn errors_serialize_with_a_kind_and_a_message() {
        assert_eq!(
            serde_json::to_value(OpenError::Missing).unwrap(),
            serde_json::json!({ "kind": "missing", "message": "it no longer exists" })
        );
        assert_eq!(
            serde_json::to_value(OpenError::Failed("boom".into())).unwrap(),
            serde_json::json!({ "kind": "failed", "message": "boom" })
        );
    }
}
