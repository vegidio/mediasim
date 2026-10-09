//! Videos for the probe and session tests, generated in a temp dir rather than kept in the repository.
//!
//! `fixtures/test3.mkv` is 338×640 AV1 at 25 fps with no audio (20.3 s, a keyframe every 6.44 s), and
//! `fixtures/test4.mkv` is AV1 with mono AAC. The first 10.3 s of the first, encoded again as H.264 with a keyframe
//! every 2 s, is [`mp4`]; a video with H.264 and AAC is made by copying that file's video and the second's audio into
//! one Matroska file; other sizes and keyframe spacings by encoding the first again; a video that can't be decoded by
//! renaming that file's video codec; and a rotated one by writing a display matrix into its MP4.

use std::path::{Path, PathBuf};

use media::codec::VideoEncoder;
use media::prelude::{
    Frame, Framerate, H264Preset, MediaReader, MediaWriter, Packet, StreamKind, VideoCodec, VideoFilter,
    VideoFilterChain,
};

use crate::admission::tests::fixture;
use crate::admission::{Admissions, admit_one};

/// Admits `path` into `registry` and returns its identity.
pub(crate) fn admit(registry: &Admissions, path: &Path) -> String {
    let (identity, entry, _) = admit_one(path).unwrap();
    registry.admit([(identity.clone(), entry)]);
    identity
}

/// How long [`mp4`], and so every video built from it, lasts.
const SECONDS: f64 = 10.3;

/// `source.mp4` in `dir`: the first 10.3 s of `test3.mkv`'s video as H.264, with a keyframe every 2 s.
pub(crate) fn mp4(dir: &Path) -> PathBuf {
    reencoded(dir, "source.mp4", (338, 640), 50, SECONDS)
}

/// Copies, into the file at `path`, the main video stream of [`mp4`] and `audio` copies of the first 10.3 s of the
/// main audio stream of `test4.mkv`, in that order, so the sound ends with the video.
fn build(path: &Path, audio: usize) {
    let open = |path: &Path| MediaReader::open(path.to_str().unwrap()).unwrap();
    let mut video = open(&mp4(path.parent().unwrap()));
    let sound = open(&fixture("test4.mkv"));
    let video_index = video.best_stream(StreamKind::Video).unwrap();
    let sound_index = sound.best_stream(StreamKind::Audio).unwrap();

    let mut writer = MediaWriter::create(path.to_str().unwrap()).unwrap();
    let video_out = writer.add_stream_copy(&video, video_index).unwrap();
    let sound_out: Vec<_> = (0..audio).map(|_| writer.add_stream_copy(&sound, sound_index).unwrap()).collect();
    writer.write_header().unwrap();

    // The muxer interleaves by timestamp, so each input can be written whole, one after the other.
    copy(&mut video, video_index, video_out, f64::INFINITY, &mut writer);
    for output in sound_out {
        copy(&mut open(&fixture("test4.mkv")), sound_index, output, SECONDS, &mut writer);
    }
    writer.write_trailer().unwrap();
}

/// Writes every packet of `reader`'s stream `input` before `until` seconds to `writer`'s stream `output`.
fn copy(reader: &mut MediaReader, input: usize, output: usize, until: f64, writer: &mut MediaWriter) {
    let time_base = reader.stream_time_base(input).unwrap().as_f64();
    for packet in reader.packets() {
        let mut packet = packet.unwrap();
        #[expect(clippy::cast_precision_loss, reason = "a test timestamp, small")]
        if packet.stream_index() == input && (packet.pts() as f64 * time_base) < until {
            packet.set_stream_index(output);
            writer.write_packet(&mut packet).unwrap();
        }
    }
}

/// `clip.mkv` in `dir`: H.264 video and AAC audio.
pub(crate) fn mkv(dir: &Path) -> PathBuf {
    let path = dir.join("clip.mkv");
    build(&path, 1);
    path
}

/// `extra.mkv` in `dir`: H.264 video and two AAC audio streams, the second of which is never the main one.
pub(crate) fn mkv_two_audio(dir: &Path) -> PathBuf {
    let path = dir.join("extra.mkv");
    build(&path, 2);
    path
}

/// `silent.mkv` in `dir`: H.264 video only.
pub(crate) fn mkv_video_only(dir: &Path) -> PathBuf {
    let path = dir.join("silent.mkv");
    build(&path, 0);
    path
}

/// `undecodable.mkv` in `dir`: [`mkv`]'s file with its video's codec ID renamed to one `FFmpeg` doesn't know, so it
/// opens and probes as a video, but no decoder exists for its video stream. Its sound is untouched.
pub(crate) fn mkv_undecodable(dir: &Path) -> PathBuf {
    const KNOWN: &[u8] = b"V_MPEG4/ISO/AVC";
    const UNKNOWN: &[u8] = b"V_MPEG4/ISO/XYZ";

    let mut bytes = std::fs::read(mkv(dir)).unwrap();
    let at = bytes.windows(KNOWN.len()).position(|window| window == KNOWN).expect("no H.264 codec ID");
    bytes[at..at + KNOWN.len()].copy_from_slice(UNKNOWN);

    let path = dir.join("undecodable.mkv");
    std::fs::write(&path, bytes).unwrap();
    path
}

/// `name` in `dir`: the first `seconds` of `test3.mkv`'s video, scaled to `width`×`height` and encoded again as H.264
/// with a keyframe every `gop` frames, so its keyframes needn't fall on the 2-second grid.
pub(crate) fn reencoded(dir: &Path, name: &str, (width, height): (u32, u32), gop: u32, seconds: f64) -> PathBuf {
    let mut reader = MediaReader::open(fixture("test3.mkv").to_str().unwrap()).unwrap();
    let index = reader.best_stream(StreamKind::Video).unwrap();
    let time_base = reader.stream_time_base(index).unwrap();
    let frame_rate = Framerate(reader.stream_avg_frame_rate(index).unwrap());
    let mut decoder = reader.stream(index).decoder().unwrap();
    let chain = VideoFilterChain::raw(format!("scale={width}:{height},format=yuv420p"));
    let mut filter = VideoFilter::new(&decoder, time_base, &chain).unwrap();
    let mut encoder = VideoEncoder::builder()
        .codec(VideoCodec::H264)
        .resolution(width, height)
        .framerate(frame_rate)
        .time_base(time_base)
        .preset(H264Preset::Ultrafast)
        .gop_size(gop)
        .option("sc_threshold", "0")
        .build()
        .unwrap();

    let path = dir.join(name);
    let mut writer = MediaWriter::create(path.to_str().unwrap()).unwrap();
    let output = writer.add_stream_from_encoder(&encoder).unwrap();
    writer.write_header().unwrap();
    let write = |packets: Vec<Packet>, writer: &mut MediaWriter| {
        for mut packet in packets {
            packet.set_stream_index(output);
            writer.write_packet(&mut packet).unwrap();
        }
    };

    #[expect(clippy::cast_possible_truncation, reason = "a test timestamp, small")]
    let end = (seconds / time_base.as_f64()).round() as i64;
    'read: for packet in reader.packets() {
        let packet = packet.unwrap();
        if packet.stream_index() != index {
            continue;
        }
        let frames: Vec<Frame> = decoder.decode(&packet).unwrap().map(Result::unwrap).collect();
        for mut frame in frames {
            let pts = frame.best_effort_timestamp().unwrap();
            if pts >= end {
                break 'read;
            }
            frame.set_pts(pts);
            for scaled in filter.filter(frame).unwrap() {
                let packets = encoder.encode(&scaled).unwrap().map(Result::unwrap).collect();
                write(packets, &mut writer);
            }
        }
    }
    let packets = encoder.flush().unwrap().map(Result::unwrap).collect();
    write(packets, &mut writer);
    writer.write_trailer().unwrap();
    path
}

/// `rotated.mp4` in `dir`: 2 s of `test3.mkv` at 640×360, stored with a display matrix that turns it `clockwise`
/// degrees, the way a phone stores a portrait recording.
pub(crate) fn rotated(dir: &Path, clockwise: f64) -> PathBuf {
    let path = reencoded(dir, "rotated.mp4", (640, 360), 60, 2.0);

    // `av_display_rotation_set`'s matrix: a, b and c, d in 16.16 fixed point, and w in 2.30.
    let radians = -clockwise.to_radians();
    #[expect(clippy::cast_possible_truncation, reason = "at most 2^16")]
    let fixed = |value: f64| (value * 65_536.0).round() as i32;
    let (cos, sin) = (fixed(radians.cos()), fixed(radians.sin()));
    let matrix = [cos, -sin, 0, sin, cos, 0, 0, 0, 1 << 30];

    let mut bytes = std::fs::read(&path).unwrap();
    let at = bytes.windows(4).position(|tag| tag == b"tkhd").expect("no tkhd box");
    // After the tag: version and flags, then times, ids and duration (20 or 32 bytes), then 16 bytes of reserved,
    // layer, group and volume fields, then the matrix.
    let start = at + 4 + 4 + if bytes[at + 4] == 1 { 32 } else { 20 } + 16;
    for (i, value) in matrix.iter().enumerate() {
        bytes[start + i * 4..start + i * 4 + 4].copy_from_slice(&value.to_be_bytes());
    }
    std::fs::write(&path, bytes).unwrap();
    path
}
