//! Classifies a path as an image or a video from its extension, and lists the formats that classify.

use std::fmt;
use std::path::Path;

use super::MediaType;

/// Video file extensions recognised by this crate, lowercase.
static VIDEO_EXTENSIONS: [&str; 7] = ["avi", "m4v", "mp4", "mkv", "mov", "webm", "wmv"];

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

/// A media format this crate loads: its [`MediaType`] and every lowercase file extension that selects it, the
/// canonical one first.
///
/// With the `serde` feature it serializes as `{ "type": "image", "extensions": ["jpg", "jpeg"] }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct MediaFormat {
    /// Whether files of this format load as images or videos.
    #[cfg_attr(feature = "serde", serde(rename = "type"))]
    pub media_type: MediaType,
    /// The lowercase extensions, without a leading dot, that select this format; the first is the canonical one.
    pub extensions: &'static [&'static str],
}

impl MediaFormat {
    /// Every format this crate loads: the image formats in [`rust_sak::image::ImageFormat::ALL`] order, then one
    /// video format per video extension.
    ///
    /// The listing reads the same tables as [`MediaType::from_path`], so an extension is listed exactly when it
    /// classifies, and as the type it classifies as.
    pub fn all() -> impl Iterator<Item = MediaFormat> {
        let images = rust_sak::image::ImageFormat::ALL
            .into_iter()
            .map(|format| MediaFormat { media_type: MediaType::Image, extensions: format.extensions() });
        let videos = VIDEO_EXTENSIONS
            .iter()
            .map(|ext| MediaFormat { media_type: MediaType::Video, extensions: std::slice::from_ref(ext) });
        images.chain(videos)
    }
}

impl fmt::Display for MediaType {
    /// Writes the lowercase name of the type: `image` or `video`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Image => "image",
            Self::Video => "video",
        })
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

    #[test]
    fn every_listed_extension_in_either_case_classifies_as_its_type() {
        for format in MediaFormat::all() {
            for ext in format.extensions {
                let lower = format!("file.{ext}");
                let upper = format!("file.{}", ext.to_ascii_uppercase());
                assert_eq!(MediaType::from_path(&lower), Some(format.media_type), "{lower}");
                assert_eq!(MediaType::from_path(&upper), Some(format.media_type), "{upper}");
            }
        }
    }

    #[test]
    fn no_extension_is_listed_twice() {
        let mut seen = std::collections::HashSet::new();
        for format in MediaFormat::all() {
            for ext in format.extensions {
                assert!(seen.insert(*ext), "{ext} is listed twice");
            }
        }
    }

    #[test]
    fn image_formats_are_listed_first_with_their_aliases() {
        let images: Vec<_> =
            MediaFormat::all().filter(|f| f.media_type == MediaType::Image).map(|f| f.extensions).collect();
        assert_eq!(
            images,
            [
                &["bmp"][..],
                &["gif"],
                &["jpg", "jpeg"],
                &["png"],
                &["tiff", "tif"],
                &["avif"],
                &["heif", "heic"],
                &["webp"],
            ]
        );
        assert!(MediaFormat::all().take(images.len()).all(|f| f.media_type == MediaType::Image));
    }

    #[test]
    fn video_formats_are_one_per_video_extension() {
        let videos: Vec<_> = MediaFormat::all().filter(|f| f.media_type == MediaType::Video).collect();
        assert_eq!(videos.len(), VIDEO_EXTENSIONS.len());
        for (format, ext) in videos.iter().zip(VIDEO_EXTENSIONS) {
            assert_eq!(format.extensions, [ext]);
        }
    }

    #[cfg(feature = "serde")]
    #[test]
    fn serializes_as_type_and_extensions() {
        let jpeg = MediaFormat::all().find(|f| f.extensions[0] == "jpg").unwrap();
        assert_eq!(
            serde_json::to_value(jpeg).unwrap(),
            serde_json::json!({ "type": "image", "extensions": ["jpg", "jpeg"] })
        );
    }

    #[test]
    fn displays_as_lowercase_name() {
        assert_eq!(MediaType::Image.to_string(), "image");
        assert_eq!(MediaType::Video.to_string(), "video");
    }
}
