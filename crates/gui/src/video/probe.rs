//! What an admitted video holds, read from its header: what the window needs to decide how to play it.

use media::prelude::{MediaReader, StreamKind, probe};
use mediasim::MediaType;
use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Manager};

use super::VideoError;
use crate::admission::{Admissions, Admitted, locate};
use crate::scheme::Refusal;

/// A video's container, duration and main streams.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbe {
    /// The demuxer's name for the container, such as `matroska,webm`.
    format: String,
    /// In seconds.
    duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    video: Option<StreamProbe>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio: Option<StreamProbe>,
}

/// One main stream's codec, and whether the application can decode it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamProbe {
    /// `FFmpeg`'s name for the codec, such as `h264`.
    codec: String,
    /// The RFC 6381 codec string, such as `avc1.640028`, when `FFmpeg` has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    codec_string: Option<String>,
    /// Whether `FFmpeg` can decode the stream, and so a session can encode it.
    decodable: bool,
    /// In hertz, for an audio stream.
    #[serde(skip_serializing_if = "Option::is_none")]
    sample_rate: Option<u32>,
}

/// The admitted video behind `identity`, refused as not found when it is an image. Shared with the sessions and the
/// `video` scheme.
pub(crate) fn locate_video(registry: &Admissions, identity: &str) -> Result<Admitted, Refusal> {
    let admitted = locate(registry, identity)?;
    if MediaType::from_path(&admitted.path) != Some(MediaType::Video) {
        return Err(Refusal::NotFound);
    }

    Ok(admitted)
}

/// What the video behind `identity` holds. The main stream of each kind is the one a session carries.
fn read(registry: &Admissions, identity: &str) -> Result<VideoProbe, VideoError> {
    let admitted = locate_video(registry, identity)?;
    // Admission refuses a video whose path isn't Unicode.
    let path = admitted.path.to_str().ok_or(VideoError::Gone)?;

    let info = probe(path)?;
    let mut reader = MediaReader::open(path)?;
    let mut stream = |kind| {
        let index = reader.best_stream(kind).ok()?;
        let stream = info.streams().get(index)?;
        // Opening a decoder takes milliseconds, and tells the window before it plays whether the stream can be encoded.
        let decodable = reader.stream(index).decoder().is_ok();
        Some(StreamProbe {
            codec: stream.codec_name.clone(),
            codec_string: stream.codec_string.clone(),
            decodable,
            // media-rs reports 0 for a stream without one, such as a video stream.
            sample_rate: (stream.sample_rate > 0).then_some(stream.sample_rate),
        })
    };

    Ok(VideoProbe {
        format: info.format_name().to_owned(),
        duration: info.duration().as_secs_f64(),
        video: stream(StreamKind::Video),
        audio: stream(StreamKind::Audio),
    })
}

/// What an admitted video holds: its container, duration, and the codecs of its main video and audio streams.
///
/// # Errors
///
/// `notfound` for an identity never admitted or naming an image, `gone` for a file removed or changed since, and
/// `unreadable` for one that can't be read as a video.
#[tauri::command]
pub async fn probe_video(app: AppHandle, identity: String) -> Result<VideoProbe, VideoError> {
    spawn_blocking(move || read(&app.state::<Admissions>(), &identity)).await?
}

#[cfg(test)]
mod tests {
    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::admission::tests::fixture;
    use crate::video::fixtures::{admit, mkv, mkv_undecodable, mkv_video_only};

    fn stream(codec: &str, codec_string: &str) -> StreamProbe {
        StreamProbe {
            codec: codec.to_owned(),
            codec_string: Some(codec_string.to_owned()),
            decodable: true,
            sample_rate: None,
        }
    }

    fn audio(codec: &str, codec_string: &str, sample_rate: u32) -> StreamProbe {
        StreamProbe { sample_rate: Some(sample_rate), ..stream(codec, codec_string) }
    }

    #[test]
    fn an_mp4_reports_its_container_and_codec() {
        let state = Admissions::default();
        let identity = admit(&state, &fixture("test3.mp4"));

        let probe = read(&state, &identity).unwrap();

        assert!(probe.format.starts_with("mov,mp4,"), "{}", probe.format);
        let video = probe.video.unwrap();
        assert_eq!(video.codec, "h264");
        assert!(video.decodable);
        assert!(video.codec_string.unwrap().starts_with("avc1."));
        assert!((probe.duration - 10.3).abs() < 0.1, "{}", probe.duration);
    }

    #[test]
    fn an_mp4_with_audio_reports_it() {
        let state = Admissions::default();
        let identity = admit(&state, &fixture("test4.mp4"));

        let probe = read(&state, &identity).unwrap();

        assert_eq!(probe.video.unwrap().codec, "av1");
        assert_eq!(probe.audio.unwrap(), audio("aac", "mp4a.40.2", 44_100));
    }

    #[test]
    fn only_the_audio_stream_reports_a_sample_rate() {
        let state = Admissions::default();
        let identity = admit(&state, &fixture("test4.mp4"));

        let json = serde_json::to_value(read(&state, &identity).unwrap()).unwrap();

        assert_eq!(json["audio"]["sampleRate"], 44_100);
        assert!(json["video"].get("sampleRate").is_none());
    }

    #[test]
    fn an_mkv_reports_matroska_and_the_same_codec_strings() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-probe-").unwrap();
        let mp4 = read(&state, &admit(&state, &fixture("test3.mp4"))).unwrap();
        let identity = admit(&state, &mkv(dir.path()));

        let probe = read(&state, &identity).unwrap();

        assert_eq!(probe.format, "matroska,webm");
        assert_eq!(probe.video, mp4.video);
        assert_eq!(probe.audio.unwrap(), audio("aac", "mp4a.40.2", 44_100));
    }

    #[test]
    fn a_video_only_file_has_no_audio() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-probe-").unwrap();
        let identity = admit(&state, &mkv_video_only(dir.path()));

        let probe = read(&state, &identity).unwrap();

        assert!(probe.video.is_some());
        assert_eq!(probe.audio, None);
    }

    #[test]
    fn a_stream_that_cant_be_decoded_is_reported_not_refused() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-probe-").unwrap();
        let identity = admit(&state, &mkv_undecodable(dir.path()));

        let probe = read(&state, &identity).unwrap();

        assert!(!probe.video.unwrap().decodable);
        assert_eq!(probe.audio.unwrap(), audio("aac", "mp4a.40.2", 44_100));
    }

    #[test]
    fn the_answer_is_camel_case_and_leaves_out_what_is_absent() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-probe-").unwrap();
        let identity = admit(&state, &mkv_video_only(dir.path()));

        let json = serde_json::to_value(read(&state, &identity).unwrap()).unwrap();

        assert!(json["video"]["codecString"].is_string());
        assert_eq!(json["video"]["decodable"], true);
        assert!(json.get("audio").is_none());
    }

    #[test]
    fn a_missing_codec_string_is_left_out_not_empty() {
        let probe = StreamProbe { codec: "wmv3".to_owned(), codec_string: None, decodable: true, sample_rate: None };

        let json = serde_json::to_value(probe).unwrap();

        assert_eq!(json, serde_json::json!({ "codec": "wmv3", "decodable": true }));
    }

    #[test]
    fn an_image_and_an_unknown_identity_are_not_found() {
        let state = Admissions::default();
        let image = admit(&state, &fixture("test1.png"));

        assert_eq!(read(&state, &image), Err(VideoError::NotFound));
        assert_eq!(read(&state, "0123456789abcdef"), Err(VideoError::NotFound));
    }

    #[test]
    fn a_removed_file_is_gone() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-probe-").unwrap();
        let path = mkv(dir.path());
        let identity = admit(&state, &path);

        std::fs::remove_file(&path).unwrap();

        assert_eq!(read(&state, &identity), Err(VideoError::Gone));
    }

    #[test]
    fn a_file_that_is_not_a_video_inside_is_unreadable() {
        let state = Admissions::default();
        let dir = mk_temp_dir("mediasim-probe-").unwrap();
        let path = dir.path().join("fake.mkv");
        std::fs::write(&path, b"not a video").unwrap();
        let identity = admit(&state, &path);

        assert!(matches!(read(&state, &identity), Err(VideoError::Unreadable { .. })));
    }
}
