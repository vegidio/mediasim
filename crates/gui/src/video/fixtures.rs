//! Videos for the probe and remux tests, generated in a temp dir rather than kept in the repository.
//!
//! `fixtures/test3.mp4` is H.264 with no audio (10.3 s, a keyframe every 2 s), and `fixtures/test4.mp4` is AV1 with
//! AAC. A video with H.264 and AAC is made by copying the first's video and the second's audio into one Matroska file.

use std::path::{Path, PathBuf};

use media::prelude::{MediaReader, MediaWriter, StreamKind};

use crate::thumbs::tests::fixture;
use crate::thumbs::{ThumbState, admit_one};

/// Admits `path` into `state` and returns its identity.
pub(crate) fn admit(state: &ThumbState, path: &Path) -> String {
    let (identity, entry, _) = admit_one(path).unwrap();
    state.admit([(identity.clone(), entry)]);
    identity
}

/// Copies, into the file at `path`, the main video stream of `test3.mp4` and `audio` copies of the main audio stream of
/// `test4.mp4`, in that order.
fn build(path: &Path, audio: usize) {
    let open = |name| MediaReader::open(fixture(name).to_str().unwrap()).unwrap();
    let mut video = open("test3.mp4");
    let sound = open("test4.mp4");
    let video_index = video.best_stream(StreamKind::Video).unwrap();
    let sound_index = sound.best_stream(StreamKind::Audio).unwrap();

    let mut writer = MediaWriter::create(path.to_str().unwrap()).unwrap();
    let video_out = writer.add_stream_copy(&video, video_index).unwrap();
    let sound_out: Vec<_> = (0..audio).map(|_| writer.add_stream_copy(&sound, sound_index).unwrap()).collect();
    writer.write_header().unwrap();

    // The muxer interleaves by timestamp, so each input can be written whole, one after the other.
    copy(&mut video, video_index, video_out, &mut writer);
    for output in sound_out {
        copy(&mut open("test4.mp4"), sound_index, output, &mut writer);
    }
    writer.write_trailer().unwrap();
}

/// Writes every packet of `reader`'s stream `input` to `writer`'s stream `output`.
fn copy(reader: &mut MediaReader, input: usize, output: usize, writer: &mut MediaWriter) {
    for packet in reader.packets() {
        let mut packet = packet.unwrap();
        if packet.stream_index() == input {
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
