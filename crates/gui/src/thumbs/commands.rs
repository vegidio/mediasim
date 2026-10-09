//! The Tauri commands that admit files, for thumbnails and everything else the window asks of them by identity.

use std::path::{Path, PathBuf};

use mediasim::MediaType;
use rayon::prelude::*;
use serde::Serialize;
use tauri::State;
use tauri::async_runtime::spawn_blocking;

use crate::TaskError;
use crate::admission::{Admissions, Admitted, admit_one};

/// Admits files for thumbnails and returns, in the same order, an identity for each one, or `None` for a path that is
/// missing, is a folder or is not a supported media type, or a video whose path isn't Unicode. Admitting a file again
/// returns the same identity.
///
/// # Errors
///
/// If the blocking admission task fails to finish.
#[tauri::command]
pub async fn admit_media(
    registry: State<'_, Admissions>,
    paths: Vec<PathBuf>,
) -> Result<Vec<Option<String>>, TaskError> {
    admit(&registry, paths).await
}

pub(crate) async fn admit(registry: &Admissions, paths: Vec<PathBuf>) -> Result<Vec<Option<String>>, TaskError> {
    let admitted = admit_all(registry, paths).await?;

    Ok(admitted.into_iter().map(|entry| entry.map(|(identity, ..)| identity)).collect())
}

/// A file admitted for thumbnails, with what a slot of the "Compare two files" card shows about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MediaFile {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) r#type: MediaType,
    /// In bytes.
    pub(crate) size: u64,
    pub(crate) identity: String,
}

/// Admits files for thumbnails, like [`admit_media`], and returns, in the same order, each one's path, name, media
/// type, size and identity, or `None` for a path [`admit_media`] gives no identity.
///
/// # Errors
///
/// If the blocking admission task fails to finish.
#[tauri::command]
pub async fn describe_media(
    registry: State<'_, Admissions>,
    paths: Vec<PathBuf>,
) -> Result<Vec<Option<MediaFile>>, TaskError> {
    describe(&registry, paths).await
}

pub(crate) async fn describe(registry: &Admissions, paths: Vec<PathBuf>) -> Result<Vec<Option<MediaFile>>, TaskError> {
    let admitted = admit_all(registry, paths).await?;

    Ok(admitted
        .into_iter()
        .map(|entry| {
            entry.map(|(identity, Admitted { path, size, .. }, media_type)| MediaFile {
                name: file_name(&path),
                path: path.to_string_lossy().into_owned(),
                r#type: media_type,
                size,
                identity,
            })
        })
        .collect())
}

/// Admits `paths` and returns what [`admit_one`] gave for each, in the same order.
async fn admit_all(
    registry: &Admissions,
    paths: Vec<PathBuf>,
) -> Result<Vec<Option<(String, Admitted, MediaType)>>, TaskError> {
    // Stats run in parallel, off the lock and off the async runtime; the registry is locked only to record the results.
    let admitted: Vec<_> = spawn_blocking(move || paths.par_iter().map(|path| admit_one(path)).collect()).await?;

    registry.admit(admitted.iter().flatten().map(|(identity, entry, _)| (identity.clone(), entry.clone())));

    Ok(admitted)
}

/// The last component of `path`, or the whole path when it has none.
pub(crate) fn file_name(path: &Path) -> String {
    path.file_name().unwrap_or(path.as_os_str()).to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::admission::tests::fixture;

    #[test]
    fn a_mixed_list_returns_identities_and_nothing_in_input_order() {
        let registry = Admissions::default();
        let paths = vec![fixture("test1.png"), fixture("missing.jpg"), fixture("test3.mp4"), "notes.txt".into()];

        let identities = tauri::async_runtime::block_on(admit(&registry, paths)).unwrap();

        assert_eq!(identities.len(), 4);
        assert!(identities[0].is_some());
        assert_eq!(identities[1], None);
        assert!(identities[2].is_some());
        assert_eq!(identities[3], None);
        assert_ne!(identities[0], identities[2]);
        for identity in identities.iter().flatten() {
            assert!(registry.lookup(identity).is_some(), "{identity} was returned but not admitted");
        }
    }

    #[test]
    fn describing_a_mixed_list_returns_files_and_nothing_in_input_order() {
        let dir = rust_sak::fs::mk_temp_dir("mediasim-thumbs-").unwrap();
        let notes = dir.path().join("notes.txt");
        std::fs::write(&notes, b"not media").unwrap();
        let registry = Admissions::default();
        let paths = vec![fixture("test1.png"), fixture("missing.jpg"), fixture("test3.mp4"), dir.path().into(), notes];

        let files = tauri::async_runtime::block_on(describe(&registry, paths)).unwrap();

        assert_eq!(files.len(), 5);
        assert_eq!(files[1], None);
        assert_eq!(files[3], None);
        assert_eq!(files[4], None);
        for (file, name, media_type) in
            [(&files[0], "test1.png", MediaType::Image), (&files[2], "test3.mp4", MediaType::Video)]
        {
            let file = file.as_ref().expect("a media file is described");
            let path = fixture(name);
            let identity = tauri::async_runtime::block_on(admit(&registry, vec![path.clone()])).unwrap();

            assert_eq!(file.path, path.to_string_lossy());
            assert_eq!(file.name, name);
            assert_eq!(file.r#type, media_type);
            assert_eq!(file.size, std::fs::metadata(&path).unwrap().len());
            assert_eq!(Some(&file.identity), identity[0].as_ref());
            assert!(registry.lookup(&file.identity).is_some(), "{name} was described but not admitted");
        }
    }

    #[test]
    fn a_media_file_serializes_with_a_lowercase_type() {
        let file = MediaFile {
            path: "/a/b.mov".into(),
            name: "b.mov".into(),
            r#type: MediaType::Video,
            size: 3,
            identity: "0123456789abcdef".into(),
        };

        assert_eq!(
            serde_json::to_value(&file).unwrap(),
            serde_json::json!({
                "path": "/a/b.mov", "name": "b.mov", "type": "video", "size": 3, "identity": "0123456789abcdef"
            })
        );
    }

    #[test]
    fn admitting_again_returns_the_same_identity() {
        let registry = Admissions::default();

        let first = tauri::async_runtime::block_on(admit(&registry, vec![fixture("test1.png")])).unwrap();
        let second = tauri::async_runtime::block_on(admit(&registry, vec![fixture("test1.png")])).unwrap();

        assert_eq!(first, second);
    }
}
