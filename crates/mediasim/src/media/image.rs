//! Image loader: one decoded image becomes one [`Icon`].

use std::path::Path;

use super::{Decoded, check};
use crate::{CancelToken, Icon, MediaError};

/// Decodes the image at `path` into a single frame.
///
/// A decode can't be interrupted, so `cancel` is checked before it starts and as soon as it returns.
pub(super) fn load(path: &Path, cancel: Option<&CancelToken>) -> Result<Decoded, MediaError> {
    check(path, cancel)?;
    let decoded = rust_sak::image::decode_file(path);
    check(path, cancel)?;
    let img = decoded.map_err(|e| MediaError::image(path, e))?;

    Ok(Decoded { width: img.width(), height: img.height(), duration: None, frames: vec![Icon::from_image(&img)] })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::tests::fixture;

    #[test]
    fn loads_one_frame_with_image_dimensions() {
        let decoded = load(&fixture("test1.png"), None).unwrap();

        assert_eq!((decoded.width, decoded.height), (1440, 3098));
        assert_eq!(decoded.duration, None);
        assert_eq!(decoded.frames.len(), 1);
    }

    #[test]
    fn missing_file_is_an_image_error() {
        let err = load(Path::new("definitely-not-a-real-file.png"), None).unwrap_err();
        assert!(matches!(err, MediaError::Image { .. }));
    }

    #[test]
    fn cancelled_token_wins_over_a_decode_error() {
        let token = CancelToken::new();
        token.cancel();

        let err = load(Path::new("definitely-not-a-real-file.png"), Some(&token)).unwrap_err();

        assert!(matches!(err, MediaError::Cancelled { .. }));
    }
}
