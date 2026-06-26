//! Media item: a named image (or multi-frame animation/video) whose frames are stored as [`Icon`]
//! signatures for similarity comparison.

use std::path::Path;

use image::DynamicImage;

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
}
