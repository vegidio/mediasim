//! The error types for loading and comparing media.

use std::path::{Path, PathBuf};

use crate::MediaType;

/// An error raised while loading a media file or scanning a directory.
///
/// Every variant carries the path it concerns: [`Media::from_files`](crate::Media::from_files) yields results in
/// completion order, so the path is the only way to tell which input an error belongs to.
#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    /// The file or directory could not be read.
    #[error("failed to read {}: {source}", path.display())]
    Io {
        /// The file or directory that failed.
        path: PathBuf,
        /// The underlying I/O error.
        source: std::io::Error,
    },

    /// The image could not be decoded.
    #[error("failed to load image {}: {source}", path.display())]
    Image {
        /// The image that failed.
        path: PathBuf,
        /// The underlying decode error.
        source: rust_sak::image::ImageError,
    },

    /// The video could not be probed or decoded.
    #[error("failed to load video {}: {source}", path.display())]
    Video {
        /// The video that failed.
        path: PathBuf,
        /// The underlying `media-rs` error.
        source: media::Error,
    },

    /// The video was opened but yielded no frames.
    #[error("video {} yielded no frames", path.display())]
    NoFrames {
        /// The video that yielded nothing.
        path: PathBuf,
    },

    /// The file is not a supported image or video.
    #[error("unsupported file {}", path.display())]
    Unsupported {
        /// The file that was rejected.
        path: PathBuf,
    },

    /// The load was stopped by its [`CancelToken`](crate::CancelToken) before it finished.
    #[error("loading {} was cancelled", path.display())]
    Cancelled {
        /// The file whose load was stopped.
        path: PathBuf,
    },
}

impl MediaError {
    /// The file or directory this error concerns.
    #[must_use]
    pub fn path(&self) -> &Path {
        match self {
            Self::Io { path, .. }
            | Self::Image { path, .. }
            | Self::Video { path, .. }
            | Self::NoFrames { path }
            | Self::Unsupported { path }
            | Self::Cancelled { path } => path,
        }
    }

    pub(crate) fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io { path: path.into(), source }
    }

    pub(crate) fn image(path: impl Into<PathBuf>, source: rust_sak::image::ImageError) -> Self {
        Self::Image { path: path.into(), source }
    }

    pub(crate) fn video(path: impl Into<PathBuf>, source: media::Error) -> Self {
        Self::Video { path: path.into(), source }
    }

    /// Maps a `rust-sak` filesystem error to [`MediaError::Io`]. `list_path` only fails with
    /// [`FsError::Io`](rust_sak::fs::FsError::Io); any other variant is wrapped so it is not lost.
    pub(crate) fn fs(path: impl Into<PathBuf>, source: rust_sak::fs::FsError) -> Self {
        let source = match source {
            rust_sak::fs::FsError::Io(err) => err,
            other => std::io::Error::other(other),
        };
        Self::io(path, source)
    }
}

/// An error raised while comparing two loaded media files.
///
/// Kept apart from [`MediaError`] because a comparison involves two files and no I/O.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum CompareError {
    /// An image was compared with a video.
    #[error("cannot compare {left_type} {} with {right_type} {}", left.display(), right.display())]
    MediaTypeMismatch {
        /// The media the comparison was called on.
        left: PathBuf,
        /// The type of `left`.
        left_type: MediaType,
        /// The media it was compared with.
        right: PathBuf,
        /// The type of `right`.
        right_type: MediaType,
    },
}

#[cfg(test)]
mod tests {
    use std::error::Error;

    use super::*;

    fn image_error() -> rust_sak::image::ImageError {
        rust_sak::image::decode_file("definitely-not-a-real-file.png").unwrap_err()
    }

    #[test]
    fn every_variant_names_the_path() {
        let errors = [
            MediaError::io("a.png", std::io::Error::other("boom")),
            MediaError::image("a.png", image_error()),
            MediaError::video("a.png", media::Error::NoVideoStream),
            MediaError::NoFrames { path: "a.png".into() },
            MediaError::Unsupported { path: "a.png".into() },
            MediaError::Cancelled { path: "a.png".into() },
        ];

        for err in &errors {
            assert!(err.to_string().contains("a.png"), "{err} does not name the path");
            assert_eq!(err.path(), Path::new("a.png"));
        }
    }

    #[test]
    fn source_is_set_where_one_exists() {
        assert!(MediaError::io("a", std::io::Error::other("boom")).source().is_some());
        assert!(MediaError::image("a", image_error()).source().is_some());
        assert!(MediaError::video("a", media::Error::NoVideoStream).source().is_some());
        assert!(MediaError::NoFrames { path: "a".into() }.source().is_none());
        assert!(MediaError::Unsupported { path: "a".into() }.source().is_none());
        assert!(MediaError::Cancelled { path: "a".into() }.source().is_none());
    }

    #[test]
    fn fs_error_becomes_io_with_the_original_error() {
        let fs_err = rust_sak::fs::FsError::Io(std::io::Error::from(std::io::ErrorKind::NotFound));

        let err = MediaError::fs("dir", fs_err);

        let MediaError::Io { path, source } = err else { panic!("expected Io") };
        assert_eq!(path, Path::new("dir"));
        assert_eq!(source.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn type_mismatch_names_both_paths_and_types() {
        let err = CompareError::MediaTypeMismatch {
            left: "a.png".into(),
            left_type: MediaType::Image,
            right: "b.mp4".into(),
            right_type: MediaType::Video,
        };

        assert_eq!(err.to_string(), "cannot compare image a.png with video b.mp4");
    }
}
