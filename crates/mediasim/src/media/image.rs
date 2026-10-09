//! Image loader: one decoded image becomes one [`Icon`].

use std::fs::File;
use std::io::{BufReader, Read, Seek};
use std::path::Path;

use image::DynamicImage;
use rust_sak::image::{ImageError, ImageFormat};

use super::{Decoded, check};
use crate::{CancelToken, Icon, MediaError};

/// The longest signature [`ImageFormat::from_magic`] looks at.
const MAGIC_LEN: u64 = 12;

/// Decodes the image at `path` into a single frame.
///
/// The format is sniffed from the file's magic bytes, not its extension, so a PNG named `.jpg` still loads.
///
/// A decode can't be interrupted, so `cancel` is checked before it starts and as soon as it returns.
pub(super) fn load(path: &Path, cancel: Option<&CancelToken>) -> Result<Decoded, MediaError> {
    check(path, cancel)?;
    let decoded = decode(path);
    check(path, cancel)?;
    let img = decoded.map_err(|e| MediaError::image(path, e))?;

    Ok(Decoded { width: img.width(), height: img.height(), duration: None, frames: vec![Icon::from_image(&img)] })
}

/// Decodes the image at `path` as [`rust_sak::image::decode_bytes`] decodes its contents, with the same format
/// detection, codecs and limits.
///
/// The formats the `image` crate decodes are streamed from the file, so the encoded file is never held in memory next
/// to the decoded image; `decode_bytes` hands them to the same decoder. AVIF, HEIF and WebP go to `rust-sak`'s own
/// codecs, which only decode from memory, so those files are read whole as before.
fn decode(path: &Path) -> Result<DynamicImage, ImageError> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut magic = Vec::new();
    (&mut reader).take(MAGIC_LEN).read_to_end(&mut magic)?;
    reader.rewind()?;

    if let Some(format) = ImageFormat::from_magic(&magic).and_then(streamed) {
        Ok(image::ImageReader::with_format(reader, format).decode()?)
    } else {
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes)?;
        rust_sak::image::decode_bytes(&bytes)
    }
}

/// The `image` crate format that `rust-sak` decodes `format` with, or `None` for the formats it routes to codecs of
/// its own.
fn streamed(format: ImageFormat) -> Option<image::ImageFormat> {
    match format {
        ImageFormat::Bmp => Some(image::ImageFormat::Bmp),
        ImageFormat::Gif => Some(image::ImageFormat::Gif),
        ImageFormat::Jpeg => Some(image::ImageFormat::Jpeg),
        ImageFormat::Png => Some(image::ImageFormat::Png),
        ImageFormat::Tiff => Some(image::ImageFormat::Tiff),
        ImageFormat::Avif | ImageFormat::Heif | ImageFormat::WebP => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::tests::fixture;

    #[test]
    fn loads_one_frame_with_image_dimensions() {
        let decoded = load(&fixture("test1.avif"), None).unwrap();

        assert_eq!((decoded.width, decoded.height), (427, 640));
        assert_eq!(decoded.duration, None);
        assert_eq!(decoded.frames.len(), 1);
    }

    #[test]
    fn loads_an_image_whose_extension_names_another_format() {
        let dir = rust_sak::fs::mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("photo.jpg");
        std::fs::copy(fixture("test1.avif"), &path).unwrap();

        let decoded = load(&path, None).unwrap();

        assert_eq!((decoded.width, decoded.height), (427, 640));
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

    /// What decoding the whole file in memory gives, as images were loaded before they were streamed.
    fn decoded_in_memory(path: &Path) -> Result<DynamicImage, ImageError> {
        rust_sak::image::decode_bytes(&std::fs::read(path)?)
    }

    #[test]
    fn streaming_decodes_the_same_pixels_as_decoding_in_memory() {
        let dir = rust_sak::fs::mk_temp_dir("mediasim").unwrap();
        let png = fixture("test1.avif");
        let source = rust_sak::image::decode_file(&png).unwrap();
        let mut paths = vec![png];
        for (name, format) in [("a.jpg", image::ImageFormat::Jpeg), ("a.bmp", image::ImageFormat::Bmp)] {
            let path = dir.path().join(name);
            source.thumbnail(300, 300).to_rgb8().save_with_format(&path, format).unwrap();
            paths.push(path);
        }

        for path in paths {
            let streamed = decode(&path).unwrap();
            assert_eq!(streamed, decoded_in_memory(&path).unwrap(), "{}", path.display());
            assert_eq!(load(&path, None).unwrap().frames, [Icon::from_image(&streamed)], "{}", path.display());
        }
    }

    #[test]
    fn a_truncated_image_is_an_image_error() {
        let dir = rust_sak::fs::mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("cut.png");
        let bytes = std::fs::read(fixture("test1.avif")).unwrap();
        std::fs::write(&path, &bytes[..bytes.len() / 2]).unwrap();

        assert!(decoded_in_memory(&path).is_err());
        assert!(matches!(load(&path, None).unwrap_err(), MediaError::Image { .. }));
    }

    #[test]
    fn files_of_no_known_format_are_unrecognized() {
        let dir = rust_sak::fs::mk_temp_dir("mediasim").unwrap();
        for (name, bytes) in [("empty.png", &b""[..]), ("short.png", b"\x89P"), ("text.png", b"not an image at all")] {
            let path = dir.path().join(name);
            std::fs::write(&path, bytes).unwrap();

            assert!(matches!(decode(&path), Err(ImageError::UnrecognizedFormat)), "{name}");
        }
    }
}
