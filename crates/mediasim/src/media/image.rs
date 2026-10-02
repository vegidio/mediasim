//! Image loader: one decoded image becomes one [`Icon`].

use std::path::Path;

use super::Decoded;
use crate::{Icon, MediaError};

/// Decodes the image at `path` into a single frame.
pub(super) fn load(path: &Path) -> Result<Decoded, MediaError> {
    let img = rust_sak::image::decode_file(path).map_err(|e| MediaError::image(path, e))?;

    Ok(Decoded { width: img.width(), height: img.height(), duration: None, frames: vec![Icon::from_image(&img)] })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::tests::fixture;

    #[test]
    fn loads_one_frame_with_image_dimensions() {
        let decoded = load(&fixture("test1.png")).unwrap();

        assert_eq!((decoded.width, decoded.height), (1440, 3098));
        assert_eq!(decoded.duration, None);
        assert_eq!(decoded.frames.len(), 1);
    }

    #[test]
    fn missing_file_is_an_image_error() {
        let err = load(Path::new("definitely-not-a-real-file.png")).unwrap_err();
        assert!(matches!(err, MediaError::Image { .. }));
    }
}
