//! Video loader: one [`Icon`] per second of playback, sampled by `media-rs`.

use std::cell::RefCell;
use std::path::Path;
use std::rc::Rc;

use image::{ImageBuffer, Rgb};
use media::{FrameExtractor, Interval, Resolution};

use super::{Decoded, check};
use crate::core::RESIZED_IMG_SIZE;
use crate::{CancelToken, Icon, MediaError};

/// Probes the video at `path` for its metadata, then turns one frame per second into an [`Icon`].
///
/// Each sampled frame is scaled by `media-rs` straight to the square the icon pipeline resizes every image to, so no
/// full-resolution RGB frame is ever converted or copied, and the pipeline's own resize leaves it as it is. Frames are
/// converted as they are decoded, so only one is held at a time. Once `cancel` is
/// cancelled, the next sampled frame stops the extraction.
pub(super) fn load(path: &Path, cancel: Option<&CancelToken>) -> Result<Decoded, MediaError> {
    load_observed(path, cancel, || {})
}

/// Loads as [`load`] does, calling `observe` as each sampled frame arrives, before the token is checked, so tests can
/// count the frames and cancel at a given one.
fn load_observed(
    path: &Path,
    cancel: Option<&CancelToken>,
    mut observe: impl FnMut() + 'static,
) -> Result<Decoded, MediaError> {
    // `media-rs` takes `&str` paths, so a non-UTF-8 path cannot be opened.
    let Some(input) = path.to_str() else {
        return Err(MediaError::Unsupported { path: path.into() });
    };

    check(path, cancel)?;
    let info = media::probe(input).map_err(|e| MediaError::video(path, e))?;
    let stream = info.video().ok_or_else(|| MediaError::video(path, media::Error::NoVideoStream))?;
    let (width, height) = (stream.width, stream.height);

    // The callback must be `'static`, so it shares the output through an `Rc` instead of borrowing a local.
    let frames = Rc::new(RefCell::new(Vec::new()));
    let sink = Rc::clone(&frames);
    let token = cancel.cloned();

    let extracted = FrameExtractor::builder()
        .input(input)
        .interval(Interval::EverySeconds(1.0))
        .resolution(Resolution::Fixed(ICON_INPUT, ICON_INPUT))
        .to_callback(move |frame| {
            observe();
            // The error only ends the extraction; it is reported as `Cancelled` below, never as itself.
            if token.as_ref().is_some_and(CancelToken::is_cancelled) {
                return Err(media::Error::ImageEncode("cancelled".to_owned()));
            }
            let (w, h) = frame.dimensions();
            let img = ImageBuffer::<Rgb<u8>, _>::from_raw(w, h, frame.to_rgb_bytes())
                .ok_or_else(|| media::Error::ImageEncode("RGB buffer does not match frame dimensions".to_owned()))?;
            sink.borrow_mut().push(Icon::from_image(&img));
            Ok(())
        })
        .build()
        .and_then(FrameExtractor::run);

    // Whatever `media-rs` reported, a cancelled token means the load was stopped on purpose.
    check(path, cancel)?;
    extracted.map_err(|e| MediaError::video(path, e))?;

    let frames = require_frames(path, frames.take())?;

    Ok(Decoded { width, height, duration: Some(info.duration()), frames })
}

/// The side of the square each sampled frame is scaled to: the size [`Icon::from_image`] resizes every image to.
#[allow(clippy::cast_possible_truncation, reason = "the resize target is a few hundred pixels")]
const ICON_INPUT: u32 = RESIZED_IMG_SIZE as u32;

/// Rejects an extraction that finished without error but sampled nothing, since there is nothing to compare.
fn require_frames(path: &Path, frames: Vec<Icon>) -> Result<Vec<Icon>, MediaError> {
    if frames.is_empty() { Err(MediaError::NoFrames { path: path.into() }) } else { Ok(frames) }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};

    use super::*;
    use crate::media::tests::fixture;

    /// A frame counter shared with an `observe` callback.
    fn counter() -> (Arc<AtomicUsize>, Arc<AtomicUsize>) {
        let count = Arc::new(AtomicUsize::new(0));
        (Arc::clone(&count), count)
    }

    #[test]
    fn pre_cancelled_runs_no_callback() {
        let path = fixture("test3.mp4");
        let token = CancelToken::new();
        token.cancel();
        let (count, seen) = counter();

        let err = load_observed(&path, Some(&token), move || {
            seen.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap_err();

        assert!(matches!(err, MediaError::Cancelled { .. }), "{err}");
        assert_eq!(err.path(), path);
        assert_eq!(count.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn cancel_mid_load_stops_within_a_frame_or_two() {
        const CANCEL_AT: usize = 3;
        let path = fixture("test3.mp4");
        let token = CancelToken::new();
        let (count, seen) = counter();
        let canceller = token.clone();

        let err = load_observed(&path, Some(&token), move || {
            if seen.fetch_add(1, Ordering::SeqCst) + 1 == CANCEL_AT {
                canceller.cancel();
            }
        })
        .unwrap_err();

        assert!(matches!(err, MediaError::Cancelled { .. }), "{err}");
        let after = count.load(Ordering::SeqCst) - CANCEL_AT;
        assert!(after <= 2, "{after} callbacks ran after the cancel");
    }

    #[test]
    fn one_token_stops_two_concurrent_loads() {
        let (a, b) = (fixture("test3.mp4"), fixture("test4.mp4"));
        let token = CancelToken::new();
        // Both loads wait here at their first frame, so the token is cancelled while both are mid-extraction.
        let started = Arc::new(Barrier::new(3));

        let observer = |started: Arc<Barrier>| {
            let mut first = true;
            move || {
                if std::mem::take(&mut first) {
                    started.wait();
                }
            }
        };

        let (ra, rb) = std::thread::scope(|scope| {
            let ha = scope.spawn(|| load_observed(&a, Some(&token), observer(Arc::clone(&started))));
            let hb = scope.spawn(|| load_observed(&b, Some(&token), observer(Arc::clone(&started))));
            started.wait();
            token.cancel();
            (ha.join().unwrap(), hb.join().unwrap())
        });

        for (result, path) in [(ra, &a), (rb, &b)] {
            let err = result.unwrap_err();
            assert!(matches!(err, MediaError::Cancelled { .. }), "{err}");
            assert_eq!(err.path(), path);
        }
    }

    #[test]
    fn loads_one_frame_per_second_with_stream_metadata() {
        let decoded = load(&fixture("test3.mp4"), None).unwrap();

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
        let icon = Icon::from_image(&image::RgbImage::new(16, 16));

        assert_eq!(require_frames(Path::new("clip.mp4"), vec![icon.clone()]).unwrap(), [icon]);
    }

    #[test]
    fn missing_file_is_a_video_error() {
        let err = load(Path::new("definitely-not-a-real-file.mp4"), None).unwrap_err();
        assert!(matches!(err, MediaError::Video { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_path_is_unsupported() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let path = Path::new(OsStr::from_bytes(b"clip-\xff.mp4"));

        let err = load(path, None).unwrap_err();
        assert!(matches!(err, MediaError::Unsupported { .. }));
    }
}
