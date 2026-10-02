//! Video loader: one [`Icon`] per second of playback, sampled by `media-rs`.

use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;

use image::{DynamicImage, RgbImage};
use media::{FrameExtractor, Interval};

use super::Decoded;
use crate::{Icon, MediaError};

/// Probes the video at `path` for its metadata, then turns one frame per second into an [`Icon`].
///
/// Frames are converted as they are decoded, so only one full-resolution frame is held at a time.
pub(super) fn load(path: &Path) -> Result<Decoded, MediaError> {
    // `media-rs` takes `&str` paths, so a non-UTF-8 path cannot be opened.
    let Some(input) = path.to_str() else {
        return Err(MediaError::Unsupported { path: path.into() });
    };

    let info = media::probe(input).map_err(|e| MediaError::video(path, e))?;
    let stream = info.video().ok_or_else(|| MediaError::video(path, media::Error::NoVideoStream))?;
    let (width, height) = (stream.width, stream.height);

    // The callback must be `'static`, so it shares the output through an `Rc` instead of borrowing a local.
    let frames = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&frames);

    FrameExtractor::builder()
        .input(input)
        .interval(Interval::EverySeconds(1.0))
        .to_callback(move |frame| {
            let (w, h) = frame.dimensions();
            let img = RgbImage::from_raw(w, h, frame.to_rgb_bytes().to_vec())
                .ok_or_else(|| media::Error::ImageEncode("RGB buffer does not match frame dimensions".to_owned()))?;
            sink.borrow_mut().push(Icon::from_image(&DynamicImage::ImageRgb8(img)));
            Ok(())
        })
        .build()
        .and_then(FrameExtractor::run)
        .map_err(|e| MediaError::video(path, e))?;

    let frames = require_frames(path, frames.take())?;

    Ok(Decoded { width, height, duration: Some(info.duration()), frames })
}

/// Rejects an extraction that finished without error but sampled nothing, since there is nothing to compare.
fn require_frames(path: &Path, frames: Vec<Icon>) -> Result<Vec<Icon>, MediaError> {
    if frames.is_empty() { Err(MediaError::NoFrames { path: path.into() }) } else { Ok(frames) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::tests::fixture;

    #[test]
    fn loads_one_frame_per_second_with_stream_metadata() {
        let decoded = load(&fixture("test3.mp4")).unwrap();

        let duration = decoded.duration.expect("video has a duration");
        assert!(duration.as_secs_f64() > 0.0);
        assert_eq!((decoded.width, decoded.height), (1080, 1920));

        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let expected = duration.as_secs_f64().ceil() as usize;
        assert!(
            decoded.frames.len().abs_diff(expected) <= 1,
            "{} frames for a {duration:?} video",
            decoded.frames.len()
        );
    }

    #[test]
    fn no_frames_is_an_error_naming_the_path() {
        let err = require_frames(Path::new("clip.mp4"), Vec::new()).unwrap_err();

        assert!(matches!(err, MediaError::NoFrames { .. }));
        assert_eq!(err.path(), Path::new("clip.mp4"));
    }

    #[test]
    fn frames_pass_through() {
        let icon = Icon::from_image(&DynamicImage::ImageRgb8(RgbImage::new(16, 16)));

        assert_eq!(require_frames(Path::new("clip.mp4"), vec![icon.clone()]).unwrap(), [icon]);
    }

    #[test]
    fn missing_file_is_a_video_error() {
        let err = load(Path::new("definitely-not-a-real-file.mp4")).unwrap_err();
        assert!(matches!(err, MediaError::Video { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_path_is_unsupported() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let path = Path::new(OsStr::from_bytes(b"clip-\xff.mp4"));

        let err = load(path).unwrap_err();
        assert!(matches!(err, MediaError::Unsupported { .. }));
    }
}
