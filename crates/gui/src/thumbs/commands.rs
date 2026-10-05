//! The Tauri command that admits files for thumbnails.

use std::path::PathBuf;

use serde::{Serialize, Serializer};
use tauri::State;
use tauri::async_runtime::spawn_blocking;

use super::{ThumbState, admit_one};

/// Admitting failed for a reason other than a path, which only ever gets no identity.
#[derive(Debug, thiserror::Error)]
pub enum ThumbError {
    /// The blocking admission task panicked or was cancelled.
    #[error("the admission task did not finish: {0}")]
    Task(#[from] tauri::Error),
}

impl Serialize for ThumbError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

/// Admits files for thumbnails and returns, in the same order, an identity for each one, or `None` for a path that is
/// missing, is a folder or is not a supported media type, or a video whose path isn't Unicode. Admitting a file again
/// returns the same identity.
///
/// # Errors
///
/// If the blocking admission task fails to finish.
#[tauri::command]
pub async fn admit_media(state: State<'_, ThumbState>, paths: Vec<PathBuf>) -> Result<Vec<Option<String>>, ThumbError> {
    admit(&state, paths).await
}

async fn admit(state: &ThumbState, paths: Vec<PathBuf>) -> Result<Vec<Option<String>>, ThumbError> {
    // Stats run off the lock and off the async runtime; the registry is locked only to record the results.
    let admitted: Vec<_> = spawn_blocking(move || paths.iter().map(|path| admit_one(path)).collect()).await?;

    let identities = admitted.iter().map(|entry| entry.as_ref().map(|(identity, _)| identity.clone())).collect();
    state.admit(admitted.into_iter().flatten());

    Ok(identities)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::thumbs::tests::{fixture, state};

    #[test]
    fn a_mixed_list_returns_identities_and_nothing_in_input_order() {
        let state = state();
        let paths = vec![fixture("test1.png"), fixture("missing.jpg"), fixture("test3.mp4"), "notes.txt".into()];

        let identities = tauri::async_runtime::block_on(admit(&state, paths)).unwrap();

        assert_eq!(identities.len(), 4);
        assert!(identities[0].is_some());
        assert_eq!(identities[1], None);
        assert!(identities[2].is_some());
        assert_eq!(identities[3], None);
        assert_ne!(identities[0], identities[2]);
        for identity in identities.iter().flatten() {
            assert!(state.lookup(identity).is_some(), "{identity} was returned but not admitted");
        }
    }

    #[test]
    fn admitting_again_returns_the_same_identity() {
        let state = state();

        let first = tauri::async_runtime::block_on(admit(&state, vec![fixture("test1.png")])).unwrap();
        let second = tauri::async_runtime::block_on(admit(&state, vec![fixture("test1.png")])).unwrap();

        assert_eq!(first, second);
    }
}
