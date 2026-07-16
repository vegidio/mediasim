//! Media item: a named image (or multi-frame animation/video) whose frames are stored as [`Icon`]
//! signatures for similarity comparison.

use std::path::{Path, PathBuf};
use std::sync::mpsc;

use image::DynamicImage;
use rayon::prelude::*;

use crate::core::Icon;
use crate::IconError;

/// A named media item with its frames converted to [`Icon`] signatures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Media {
    /// The media's name.
    pub name: String,
    /// Width of the first frame, in pixels (`0` if there are no frames).
    pub width: u32,
    /// Height of the first frame, in pixels (`0` if there are no frames).
    pub height: u32,
    /// The frames as icon signatures.
    pub(crate) frames: Vec<Icon>,
}

impl Media {
    /// Builds a [`Media`] from a name and a slice of decoded images.
    ///
    /// `width`/`height` are taken from the first image; each image is converted into an [`Icon`].
    /// An empty slice yields `0×0` dimensions and no frames.
    #[must_use]
    pub fn from_images(name: impl Into<String>, images: &[DynamicImage]) -> Self {
        let (width, height) = images.first().map_or((0, 0), |img| (img.width(), img.height()));
        let frames = images.iter().map(Icon::from_image).collect();

        Self {
            name: name.into(),
            width,
            height,
            frames,
        }
    }

    /// Opens and decodes an image file, returning a single-frame [`Media`] named after the file path.
    ///
    /// # Errors
    ///
    /// Returns an [`IconError`] if the file cannot be read or decoded.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, IconError> {
        let name = path.as_ref().to_string_lossy().into_owned();
        let img = rust_sak::image::decode_file(path.as_ref())?;

        Ok(Self::from_images(name, &[img]))
    }

    /// Builds a [`Media`] for each path, decoding files in parallel across the available CPU cores.
    ///
    /// Files are processed on Rayon's global thread pool (sized to the number of logical CPUs), so
    /// at most that many files are decoded at once. Each result is yielded by the returned iterator
    /// as soon as its [`Media`] is ready, in completion order (not input order) — letting the
    /// caller work with finished items while the rest are still processing.
    ///
    /// Each item is the per-file [`Result`]: a failure to read or decode one file does not stop the
    /// others.
    pub fn from_files<P>(paths: Vec<P>) -> impl Iterator<Item = Result<Self, IconError>>
    where
        P: AsRef<Path> + Send + 'static,
    {
        let (tx, rx) = mpsc::channel();

        // Drive the work on the Rayon pool without blocking the caller, so it can consume `rx` as
        // results stream in.
        rayon::spawn(move || {
            paths.into_par_iter().for_each_with(tx, |tx, path| {
                // Receiver dropped early (caller stopped iterating) -> send fails; just stop.
                let _ = tx.send(Self::from_file(path));
            });
        });

        rx.into_iter()
    }

    /// Builds a [`Media`] for every supported image file found in `dir`, decoding them in
    /// parallel via [`from_files`](Self::from_files).
    ///
    /// When `recursive` is `true`, subdirectories are walked as well; otherwise only the direct
    /// entries of `dir` are considered. A file is treated as an image when its extension maps to a
    /// supported format (via [`rust_sak::image::ImageFormat::from_path`]). Entries that cannot be
    /// read (I/O errors while listing directories) are silently skipped.
    ///
    /// Results stream in completion order, exactly as [`from_files`](Self::from_files) documents; a
    /// failure to decode one file does not stop the others.
    pub fn from_dir(dir: impl AsRef<Path>, recursive: bool) -> impl Iterator<Item = Result<Self, IconError>> {
        let paths = collect_image_paths(dir.as_ref(), recursive);
        Self::from_files(paths)
    }
}

/// Collects paths of supported image files under `dir`. Unreadable directories/entries are skipped.
/// Only descends into subdirectories when `recursive` is `true`.
fn collect_image_paths(dir: &Path, recursive: bool) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut stack = vec![dir.to_path_buf()];

    while let Some(current) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&current) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if recursive {
                    stack.push(path);
                }
            } else if rust_sak::image::ImageFormat::from_path(&path).is_some() {
                paths.push(path);
            }
        }
    }

    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_media_from_images() {
        let images = vec![DynamicImage::new_rgba8(64, 48), DynamicImage::new_rgba8(64, 48)];

        let media = Media::from_images("clip", &images);

        assert_eq!(media.name, "clip");
        assert_eq!(media.width, 64);
        assert_eq!(media.height, 48);
        assert_eq!(media.frames.len(), 2);
    }

    #[test]
    fn empty_images_yield_zero_dimensions() {
        let media = Media::from_images("empty", &[]);

        assert_eq!(media.width, 0);
        assert_eq!(media.height, 0);
        assert!(media.frames.is_empty());
    }

    #[test]
    fn from_file_missing_file_errors() {
        let err = Media::from_file("definitely-not-a-real-file.jpg").unwrap_err();
        assert!(err.to_string().starts_with("failed to load image"));
    }

    #[test]
    fn from_files_streams_ok_and_err_per_path() {
        // Write a real image to a temp file so one path decodes successfully...
        let path = std::env::temp_dir().join("mediasim_from_files_test.png");
        DynamicImage::new_rgb8(8, 8).save(&path).expect("write temp image");

        // ...alongside a missing path that must fail independently.
        let paths = vec![path.clone(), std::path::PathBuf::from("definitely-not-a-real-file.jpg")];

        let results: Vec<_> = Media::from_files(paths).collect();

        let _ = std::fs::remove_file(&path);

        assert_eq!(results.len(), 2, "one result per input path");
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|r| r.is_err()).count(), 1);
    }

    /// Creates a temp directory tree with a top-level image + a non-image file, and a nested
    /// subdirectory holding another image. Returns the root directory to walk.
    fn make_image_tree(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("mediasim_from_dir_{tag}"));
        let sub = root.join("nested");
        std::fs::create_dir_all(&sub).expect("create temp tree");

        DynamicImage::new_rgb8(8, 8).save(root.join("top.png")).expect("write top image");
        std::fs::write(root.join("notes.txt"), b"not an image").expect("write text file");
        DynamicImage::new_rgb8(8, 8).save(sub.join("deep.png")).expect("write nested image");

        root
    }

    #[test]
    fn from_dir_non_recursive_lists_only_top_level_images() {
        let root = make_image_tree("flat");

        let results: Vec<_> = Media::from_dir(&root, false).collect();

        let _ = std::fs::remove_dir_all(&root);

        // Only `top.png` — the `.txt` is not an image and the nested image is not walked.
        assert_eq!(results.len(), 1);
        assert!(results.iter().all(std::result::Result::is_ok));
    }

    #[test]
    fn from_dir_recursive_includes_nested_images() {
        let root = make_image_tree("recursive");

        let results: Vec<_> = Media::from_dir(&root, true).collect();

        let _ = std::fs::remove_dir_all(&root);

        // `top.png` + `nested/deep.png`; the `.txt` is still excluded.
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(std::result::Result::is_ok));
    }

    #[test]
    fn from_dir_missing_directory_yields_no_results() {
        let results: Vec<_> = Media::from_dir("definitely-not-a-real-dir", true).collect();
        assert!(results.is_empty());
    }
}
