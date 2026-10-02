//! Classifies a path as an image or a video from its extension.

use std::path::Path;

use super::MediaType;

/// Video file extensions recognised by this crate, lowercase.
const VIDEO_EXTENSIONS: [&str; 7] = ["avi", "m4v", "mp4", "mkv", "mov", "webm", "wmv"];

impl MediaType {
    /// Classifies `path` by its extension, case-insensitively.
    ///
    /// A path is a [`Video`](Self::Video) when its extension is one of `avi`, `m4v`, `mp4`, `mkv`, `mov`, `webm` or
    /// `wmv`, and an [`Image`](Self::Image) when [`rust_sak::image::ImageFormat`] recognises it. Anything else
    /// returns `None`. The file's contents are never read.
    pub fn from_path(path: impl AsRef<Path>) -> Option<Self> {
        let path = path.as_ref();
        let ext = path.extension()?.to_str()?;

        if VIDEO_EXTENSIONS.iter().any(|v| v.eq_ignore_ascii_case(ext)) {
            Some(Self::Video)
        } else if rust_sak::image::ImageFormat::from_path(path).is_some() {
            Some(Self::Image)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_video_extension_in_either_case_is_a_video() {
        for ext in VIDEO_EXTENSIONS {
            let lower = format!("clip.{ext}");
            let upper = format!("clip.{}", ext.to_ascii_uppercase());
            assert_eq!(MediaType::from_path(&lower), Some(MediaType::Video), "{lower}");
            assert_eq!(MediaType::from_path(&upper), Some(MediaType::Video), "{upper}");
        }
    }

    #[test]
    fn image_extension_in_either_case_is_an_image() {
        assert_eq!(MediaType::from_path("photo.png"), Some(MediaType::Image));
        assert_eq!(MediaType::from_path("photo.JPG"), Some(MediaType::Image));
    }

    #[test]
    fn unknown_or_missing_extension_is_unsupported() {
        assert_eq!(MediaType::from_path("notes.txt"), None);
        assert_eq!(MediaType::from_path("README"), None);
    }
}
