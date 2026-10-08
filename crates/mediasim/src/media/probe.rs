//! Media probing: a file's metadata read from its header, without decoding any frames.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use super::{FileInfo, Media, MediaType};
use crate::MediaError;

/// A media file's metadata, read by [`Media::probe`] without decoding any frames.
///
/// The fields it shares with [`Media`] report what loading the same file would. A `MediaInfo` has no frames, so it
/// cannot be compared; load the file for that.
///
/// With the `serde` feature it serializes like a [`Media`], followed by `format`, `colorProfile`, `bitDepth` and
/// `frameRate`.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct MediaInfo {
    /// The file that was probed.
    #[cfg_attr(feature = "serde", serde(serialize_with = "super::ser::path"))]
    pub path: PathBuf,
    /// Whether this is an image or a video.
    #[cfg_attr(feature = "serde", serde(rename = "type"))]
    pub media_type: MediaType,
    /// Width in pixels (for a video, of its first video stream).
    pub width: u32,
    /// Height in pixels (for a video, of its first video stream).
    pub height: u32,
    /// The file size, in bytes.
    pub size: u64,
    /// The playback duration; `None` for images.
    #[cfg_attr(feature = "serde", serde(serialize_with = "super::ser::seconds"))]
    pub duration: Option<Duration>,
    /// When the file was created, if the platform and filesystem record it.
    #[cfg_attr(feature = "serde", serde(serialize_with = "super::ser::timestamp"))]
    pub created: Option<SystemTime>,
    /// When the file was last modified, if the platform and filesystem record it.
    #[cfg_attr(feature = "serde", serde(serialize_with = "super::ser::timestamp"))]
    pub modified: Option<SystemTime>,
    /// The image format's name (`BMP`, `GIF`, `JPEG`, `PNG`, `TIFF`, `AVIF`, `HEIF` or `WebP`), sniffed from the
    /// file's magic bytes as loading sniffs it; `None` for videos.
    pub format: Option<&'static str>,
    /// The name of the image's color profile, such as `Display P3`, when the file declares one; `None` for videos.
    #[cfg_attr(feature = "serde", serde(rename = "colorProfile"))]
    pub color_profile: Option<String>,
    /// Bits per colour channel of an image; `None` for videos.
    #[cfg_attr(feature = "serde", serde(rename = "bitDepth"))]
    pub bit_depth: Option<u8>,
    /// The average frame rate of the first video stream, in frames per second, when the container declares one;
    /// `None` for images.
    #[cfg_attr(feature = "serde", serde(rename = "frameRate"))]
    pub frame_rate: Option<f64>,
}

/// What the header says about a file's contents.
struct Header {
    width: u32,
    height: u32,
    duration: Option<Duration>,
    format: Option<&'static str>,
    color_profile: Option<String>,
    bit_depth: Option<u8>,
    frame_rate: Option<f64>,
}

impl Media {
    /// Reads the metadata of one image or video file from its header, without decoding any frames, so it costs
    /// about as much as opening the file however long a video plays.
    ///
    /// The path, type, size, timestamps, width, height and duration are what [`from_file`](Self::from_file) reports
    /// for the same file. A file whose header is readable but whose frames are corrupt probes successfully, though it
    /// fails to load.
    ///
    /// # Errors
    ///
    /// - [`MediaError::Unsupported`] if the extension is neither a supported image nor video, or a video's path is not
    ///   valid UTF-8.
    /// - [`MediaError::Io`] if the file's metadata cannot be read (for example, it does not exist).
    /// - [`MediaError::Image`] or [`MediaError::Video`] if the file's header cannot be parsed, or a video has no video
    ///   stream.
    pub fn probe(path: impl AsRef<Path>) -> Result<MediaInfo, MediaError> {
        let path = path.as_ref();
        let media_type = MediaType::from_path(path).ok_or_else(|| MediaError::Unsupported { path: path.into() })?;
        let info = FileInfo::read(path)?;
        let header = match media_type {
            MediaType::Image => image(path)?,
            MediaType::Video => video(path)?,
        };

        Ok(MediaInfo {
            path: path.to_path_buf(),
            media_type,
            width: header.width,
            height: header.height,
            size: info.size,
            duration: header.duration,
            created: info.created,
            modified: info.modified,
            format: header.format,
            color_profile: header.color_profile,
            bit_depth: header.bit_depth,
            frame_rate: header.frame_rate,
        })
    }
}

/// How many leading bytes [`ImageFormat::from_magic`](rust_sak::image::ImageFormat::from_magic) needs to tell every
/// supported format apart.
const MAGIC_LEN: u64 = 12;

fn image(path: &Path) -> Result<Header, MediaError> {
    let info = probe_image(path).map_err(|e| MediaError::image(path, e))?;

    Ok(Header {
        width: info.width,
        height: info.height,
        duration: None,
        format: Some(info.format.name()),
        color_profile: info.color_profile,
        bit_depth: Some(info.bit_depth),
        frame_rate: None,
    })
}

/// Probes the image at `path` in the format its magic bytes name, as loading decodes it, so a PNG named `.jpg` still
/// probes. When the extension agrees, which is almost always, only the header is read; otherwise the whole file is.
fn probe_image(path: &Path) -> rust_sak::image::Result<rust_sak::image::ImageInfo> {
    use rust_sak::image::ImageFormat;

    let mut magic = Vec::new();
    File::open(path)?.take(MAGIC_LEN).read_to_end(&mut magic)?;

    match ImageFormat::from_magic(&magic) {
        Some(format) if ImageFormat::from_path(path) == Some(format) => rust_sak::image::probe_file(path),
        _ => rust_sak::image::probe_bytes(&std::fs::read(path)?),
    }
}

fn video(path: &Path) -> Result<Header, MediaError> {
    // `media-rs` takes `&str` paths, so a non-UTF-8 path cannot be opened.
    let Some(input) = path.to_str() else {
        return Err(MediaError::Unsupported { path: path.into() });
    };

    let info = media::probe(input).map_err(|e| MediaError::video(path, e))?;
    let stream = info.video().ok_or_else(|| MediaError::video(path, media::Error::NoVideoStream))?;

    Ok(Header {
        width: stream.width,
        height: stream.height,
        duration: Some(info.duration()),
        format: None,
        color_profile: None,
        bit_depth: None,
        frame_rate: stream.frame_rate.map(media::types::Framerate::as_f64),
    })
}

#[cfg(test)]
mod tests {
    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::media::tests::{fixture, zero_media_data};

    #[test]
    fn probes_an_image() {
        let path = fixture("test1.png");

        let info = Media::probe(&path).unwrap();

        assert_eq!(info.path, path);
        assert_eq!(info.media_type, MediaType::Image);
        assert_eq!(info.format, Some("PNG"));
        assert_eq!(info.size, std::fs::metadata(&path).unwrap().len());
        assert_eq!((info.width, info.height), (1440, 3098));
        assert_eq!(info.duration, None);
        assert_eq!(info.color_profile, None);
        assert_eq!(info.bit_depth, Some(8));
        assert_eq!(info.frame_rate, None);
        assert!(info.modified.is_some());
    }

    #[test]
    fn the_format_follows_the_contents_not_the_extension() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("photo.jpg");
        std::fs::copy(fixture("test1.png"), &path).unwrap();

        let info = Media::probe(&path).unwrap();

        assert_eq!(info.format, Some("PNG"));
        assert_eq!((info.width, info.height), (1440, 3098));
    }

    #[test]
    fn an_unsupported_extension_is_unsupported() {
        let err = Media::probe("notes.txt").unwrap_err();

        assert!(matches!(err, MediaError::Unsupported { .. }));
        assert_eq!(err.path(), Path::new("notes.txt"));
    }

    #[test]
    fn a_missing_file_is_an_io_error() {
        let err = Media::probe("definitely-not-a-real-file.jpg").unwrap_err();

        assert!(matches!(err, MediaError::Io { .. }));
        assert_eq!(err.path(), Path::new("definitely-not-a-real-file.jpg"));
    }

    #[test]
    fn a_text_file_named_as_an_image_is_an_image_error() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("photo.jpg");
        std::fs::write(&path, b"just some text").unwrap();

        let err = Media::probe(&path).unwrap_err();

        assert!(matches!(err, MediaError::Image { .. }), "{err}");
        assert_eq!(err.path(), path);
    }

    #[test]
    fn probes_a_video() {
        let path = fixture("test3.mp4");

        let info = Media::probe(&path).unwrap();

        assert_eq!(info.path, path);
        assert_eq!(info.media_type, MediaType::Video);
        assert_eq!(info.size, std::fs::metadata(&path).unwrap().len());
        assert_eq!((info.width, info.height), (1080, 1920));
        assert!(info.duration.is_some_and(|d| d > Duration::ZERO));
        // `ffprobe -show_entries stream=avg_frame_rate` gives 30/1.
        assert_eq!(info.frame_rate, Some(30.0));
        assert_eq!(info.format, None);
        assert_eq!(info.color_profile, None);
        assert_eq!(info.bit_depth, None);
    }

    #[test]
    fn probe_agrees_with_loading() {
        let paths = Media::list_dir(fixture(""), &crate::LoadOptions::new()).unwrap();
        assert!(paths.len() >= 4, "the fixtures are missing");

        for path in paths {
            let info = Media::probe(&path).unwrap();
            let media = Media::from_file(&path).unwrap();

            assert_eq!(
                (&info.path, info.media_type, info.size, info.created, info.modified),
                (&media.path, media.media_type, media.size, media.created, media.modified),
                "{}",
                path.display()
            );
            assert_eq!(
                (info.width, info.height, info.duration),
                (media.width, media.height, media.duration),
                "{}",
                path.display()
            );
        }
    }

    /// Every packet is unreadable, so a successful probe shows that probing decodes no frame, which is what makes it
    /// cost the same however long the video plays.
    #[test]
    fn a_video_with_corrupt_frames_still_probes() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("corrupt.mp4");
        zero_media_data(&fixture("test3.mp4"), &path);

        let info = Media::probe(&path).unwrap();

        assert_eq!((info.width, info.height), (1080, 1920));
        assert!(Media::from_file(&path).is_err());
    }

    #[cfg(feature = "serde")]
    mod serialize {
        use super::*;

        fn info(path: &str, media_type: MediaType) -> MediaInfo {
            MediaInfo {
                path: path.into(),
                media_type,
                width: 1,
                height: 1,
                size: 0,
                duration: None,
                created: None,
                modified: None,
                format: None,
                color_profile: None,
                bit_depth: None,
                frame_rate: None,
            }
        }

        #[test]
        fn an_image_has_the_fields_in_order() {
            let info = MediaInfo {
                width: 640,
                height: 480,
                size: 12345,
                modified: Some("2026-10-04T12:34:56Z".parse::<jiff::Timestamp>().unwrap().into()),
                format: Some("PNG"),
                bit_depth: Some(8),
                ..info("a.png", MediaType::Image)
            };

            assert_eq!(
                serde_json::to_string(&info).unwrap(),
                r#"{"path":"a.png","type":"image","width":640,"height":480,"size":12345,"duration":null,"created":null,"modified":"2026-10-04T12:34:56Z","format":"PNG","colorProfile":null,"bitDepth":8,"frameRate":null}"#
            );
        }

        #[test]
        fn a_video_has_a_frame_rate_and_no_format() {
            let info = MediaInfo {
                duration: Some(Duration::from_millis(12_480)),
                frame_rate: Some(25.0),
                ..info("a.mp4", MediaType::Video)
            };

            let value = serde_json::to_value(&info).unwrap();

            assert_eq!(value["duration"].to_string(), "12.48");
            assert_eq!(value["frameRate"].to_string(), "25.0");
            assert!(value["format"].is_null());
            assert!(value["colorProfile"].is_null());
            assert!(value["bitDepth"].is_null());
        }
    }
}
