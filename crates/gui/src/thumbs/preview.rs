//! Renders the picture a thumbnail is made from: an image fitted inside a square bound, or a video's frame at 10% of
//! its duration, fitted the same way.

use std::cell::RefCell;
use std::num::NonZeroU32;
use std::path::Path;
use std::rc::Rc;
use std::time::Duration;

use image::{DynamicImage, RgbImage};
use media::{FrameExtractor, Interval, Resolution};
use mediasim::MediaType;

/// How far into a video its preview frame is taken, as a fraction of the duration.
const PREVIEW_POSITION: u32 = 10;

/// Why a preview could not be rendered. Every case is answered as gone, so the cases are kept apart only for tests
/// and for whoever reads them in a debugger.
#[derive(Debug, thiserror::Error)]
pub enum PreviewError {
    /// The extension is neither a supported image nor video, or a video's path is not valid Unicode.
    #[error("unsupported file")]
    Unsupported,
    /// The file's metadata could not be read; for example, it no longer exists.
    #[error("failed to read the file: {0}")]
    Io(#[from] std::io::Error),
    /// The image could not be decoded.
    #[error("failed to decode the image: {0}")]
    Image(#[from] rust_sak::image::ImageError),
    /// The video could not be probed or decoded.
    #[error("failed to decode the video: {0}")]
    Video(#[from] media::Error),
    /// The video was opened but gave no frame.
    #[error("the video gave no frame")]
    NoFrames,
}

/// A picture of `path` fitted inside `bound`: the image itself, or a video's frame at 10% of its duration.
///
/// The picture's longer edge equals `bound` and its aspect ratio is kept; a picture that already fits is returned at
/// its own size, never enlarged. An image keeps any transparency it has. A video whose duration is unknown or zero
/// gives its first frame. Pixels are used as stored: EXIF orientation and video rotation are not applied.
///
/// # Errors
///
/// The [`PreviewError`] for an unsupported, missing or undecodable file, or a video that gives no frame.
pub fn preview(path: &Path, bound: NonZeroU32) -> Result<DynamicImage, PreviewError> {
    let media_type = MediaType::from_path(path).ok_or(PreviewError::Unsupported)?;
    // Read first so a missing file fails as an I/O error rather than as whatever the decoder makes of it.
    std::fs::metadata(path)?;

    match media_type {
        MediaType::Image => image_preview(path, bound),
        MediaType::Video => video_preview(path, bound),
    }
}

fn image_preview(path: &Path, bound: NonZeroU32) -> Result<DynamicImage, PreviewError> {
    // Sniffed from the magic bytes rather than the extension, so a PNG named `.jpg` still decodes.
    let img = rust_sak::image::decode_bytes(&std::fs::read(path)?)?;

    Ok(rust_sak::image::fit(&img, bound).into_owned())
}

fn video_preview(path: &Path, bound: NonZeroU32) -> Result<DynamicImage, PreviewError> {
    let input = path.to_str().ok_or(PreviewError::Unsupported)?;
    let at = preview_time(media::probe(input)?.duration());

    let frame = Rc::new(RefCell::new(None));
    let sink = Rc::clone(&frame);

    FrameExtractor::builder()
        .input(input)
        .interval(Interval::Timestamps(vec![at]))
        .resolution(Resolution::Fit(bound.get()))
        .to_callback(move |extracted| {
            let mut slot = sink.borrow_mut();
            if slot.is_none() {
                let (w, h) = extracted.dimensions();
                let img = RgbImage::from_raw(w, h, extracted.to_rgb_bytes().to_vec()).ok_or_else(|| {
                    media::Error::ImageEncode("RGB buffer does not match frame dimensions".to_owned())
                })?;
                *slot = Some(DynamicImage::ImageRgb8(img));
            }
            Ok(())
        })
        .build()
        .and_then(FrameExtractor::run)?;

    frame.take().ok_or(PreviewError::NoFrames)
}

/// When a video of `duration` gives its preview frame: 10% in, which is 0 for an unknown or zero duration.
fn preview_time(duration: Duration) -> Duration {
    duration / PREVIEW_POSITION
}

#[cfg(test)]
mod tests {
    use image::{GenericImageView, Rgba, RgbaImage};
    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::admission::tests::fixture;

    fn bound(value: u32) -> NonZeroU32 {
        NonZeroU32::new(value).unwrap()
    }

    #[test]
    fn an_image_larger_than_the_bound_fits_by_its_longer_edge() {
        // test1.avif is 427×640: 427 * 400 / 640 = 266.9.
        let preview = preview(&fixture("test1.avif"), bound(400)).unwrap();

        assert_eq!(preview.dimensions(), (267, 400));
    }

    #[test]
    fn an_image_within_the_bound_is_never_enlarged() {
        let preview = preview(&fixture("test1.avif"), bound(4000)).unwrap();

        assert_eq!(preview.dimensions(), (427, 640));
    }

    #[test]
    fn an_image_keeps_its_alpha() {
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("transparent.png");
        let mut source = RgbaImage::from_pixel(800, 400, Rgba([0, 0, 255, 255]));
        for x in 400..800 {
            for y in 0..400 {
                source.put_pixel(x, y, Rgba([0, 0, 0, 0]));
            }
        }
        DynamicImage::ImageRgba8(source).save(&path).unwrap();

        let preview = preview(&path, bound(100)).unwrap();

        assert!(preview.color().has_alpha());
        assert_eq!(preview.dimensions(), (100, 50));
        assert_eq!(preview.get_pixel(10, 25).0[3], 255);
        assert_eq!(preview.get_pixel(90, 25).0[3], 0);
    }

    #[test]
    fn a_missing_file_is_an_io_error() {
        for name in ["definitely-not-a-real-file.png", "definitely-not-a-real-file.mp4"] {
            let err = preview(Path::new(name), bound(100)).unwrap_err();

            assert!(matches!(err, PreviewError::Io(_)), "{name}: {err}");
        }
    }

    #[test]
    fn an_unsupported_file_is_refused_without_reading_it() {
        let err = preview(Path::new("notes.txt"), bound(100)).unwrap_err();

        assert!(matches!(err, PreviewError::Unsupported));
    }

    #[test]
    fn a_corrupt_image_is_an_image_error() {
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("corrupt.png");
        std::fs::write(&path, b"not a png").unwrap();

        let err = preview(&path, bound(100)).unwrap_err();

        assert!(matches!(err, PreviewError::Image(_)), "{err}");
    }

    #[test]
    fn a_video_gives_a_frame_fitted_with_the_stream_aspect_ratio() {
        // test3.mkv's stream is 338×640: 338 * 320 / 640 = 169.
        let preview = preview(&fixture("test3.mkv"), bound(320)).unwrap();

        assert_eq!(preview.dimensions(), (169, 320));
        assert!(matches!(preview, DynamicImage::ImageRgb8(_)));
    }

    #[test]
    fn a_video_within_the_bound_is_never_enlarged() {
        let preview = preview(&fixture("test3.mkv"), bound(4000)).unwrap();

        assert_eq!(preview.dimensions(), (338, 640));
    }

    #[test]
    fn the_frame_is_taken_a_tenth_of_the_way_in() {
        assert_eq!(preview_time(Duration::from_secs(60)), Duration::from_secs(6));
        assert_eq!(preview_time(Duration::from_millis(12_480)), Duration::from_millis(1248));
        assert_eq!(preview_time(Duration::ZERO), Duration::ZERO);
    }
}
