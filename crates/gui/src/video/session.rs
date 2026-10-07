//! One session: an admitted video's main streams as fragmented MP4, handed over one segment at a time, so the
//! window's Media Source Extensions player can play what it couldn't open itself.
//!
//! A session is one video source and one audio source:
//! - the video is copied unchanged and cut at its keyframes (a remux), or encoded to H.264 on the 2-second grid,
//!   through the [`Segments`] cache;
//! - the sound, when there is one to carry, is copied or encoded to AAC by its [`AudioSource`].
//!
//! The window pulls: each [`Session::next`] reads only as far as the segment it returns needs, so a session holds one
//! segment's worth of output however long the file is.

use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use media::codec::VideoEncoder;
use media::prelude::{MediaReader, MediaWriter, Packet, Rational, StreamKind};
use serde::Deserialize;

use super::audio::AudioSource;
use super::cache::Segments;
use super::encoder::{Candidate, init_segment};
use super::packets::{first_keyframe, packet_ts, seconds};
use super::transcode::{EncodeError, VideoEncode, segment_at, segment_start};

/// How a session carries the main video stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VideoMode {
    /// Copied unchanged.
    Copy,
    /// Encoded to H.264.
    Encode,
}

/// How a session carries the main audio stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioMode {
    /// Left out.
    None,
    /// Copied unchanged.
    Copy,
    /// Encoded to AAC.
    Encode,
}

/// Where the writer's output collects until [`Session::next`] takes it. Shared, because the writer owns its copy.
#[derive(Clone, Default)]
pub(super) struct Sink(Arc<Mutex<Vec<u8>>>);

impl Sink {
    /// Everything written since the last take.
    pub(super) fn take(&self) -> Vec<u8> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

impl Write for Sink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner).extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// What the next [`Session::next`] returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// The init segment.
    Init,
    /// The next segment.
    Streaming,
    /// Nothing: the last segment has been returned.
    Done,
}

/// The main video stream, copied: packets from the session's reader, cut before each keyframe.
struct CopiedVideo {
    reader: MediaReader,
    index: usize,
    time_base: Rational,
    /// The keyframe that begins the next segment, read but not yet written.
    held: Option<Packet>,
}

impl CopiedVideo {
    /// When `packet` is shown on the file's clock, in seconds.
    fn seconds(&self, packet: &Packet) -> f64 {
        seconds(packet_ts(packet), self.time_base)
    }

    /// The packets from the held keyframe up to the next one, which is held back in turn. Empty at the end.
    fn segment(&mut self) -> media::Result<Vec<Packet>> {
        let mut packets = Vec::new();
        packets.extend(self.held.take());
        while let Some(packet) = self.reader.packets().next().transpose()? {
            if packet.stream_index() != self.index {
                continue;
            }
            if !packets.is_empty() && packet.is_keyframe() {
                self.held = Some(packet);
                break;
            }
            packets.push(packet);
        }
        Ok(packets)
    }
}

/// The main video stream, encoded on the grid; see [`super::transcode`].
struct EncodedVideo {
    encode: VideoEncode,
    /// The hash of its init segment: with the video's identity and the segment, the cache's key.
    init: String,
    /// The next segment to hand over.
    next: u64,
}

enum VideoSource {
    Copy(CopiedVideo),
    // Boxed: an encoder side is ten times a copier's size, and a session has one source for its whole life anyway.
    Encode(Box<EncodedVideo>),
}

/// A session's state machine over its video and audio sources and a fragmented-MP4 [`MediaWriter`].
pub(crate) struct Session {
    /// The identity of the video the session reads.
    identity: String,
    video: VideoSource,
    /// The sound and its output stream, when the session carries one.
    audio: Option<(AudioSource, usize)>,
    writer: MediaWriter,
    sink: Sink,
    video_out: usize,
    phase: Phase,
}

/// A fragmented-MP4 writer into a fresh sink.
pub(super) fn writer() -> media::Result<(MediaWriter, Sink)> {
    let sink = Sink::default();
    // `negative_cts_offsets` starts a stream with B-frames at 0 rather than at its first composition offset.
    let writer = MediaWriter::builder()
        .writer(sink.clone())
        .fragmented_mp4()
        .option("movflags", "negative_cts_offsets")
        .build()?;
    Ok((writer, sink))
}

impl Session {
    /// Opens `path`, the video behind `identity`, for a session starting at `at`, carrying its main video stream as
    /// `video` says, encoded by the candidate `choose` gives when it is encoded, and its main audio stream, when it has
    /// one, as `audio` says. `choose` is only called for an encoded video, so a copy never waits for the encoder test.
    ///
    /// Returns the session and the time, in seconds, it actually starts from:
    /// - copying the video, the last keyframe at or before `at`, or 0 when `at` is 0 or comes before the first
    ///   keyframe;
    /// - encoding it, the last grid boundary at or before `at`.
    ///
    /// The muxer re-bases the output to begin at 0 whatever `at` is, so a player places a session's media at the start
    /// time itself (the window sets its `SourceBuffer`'s `timestampOffset` to it).
    ///
    /// # Errors
    ///
    /// Any error from `media-rs`: the file can't be opened or read, has no video stream, can't be decoded when it is to
    /// be encoded, or can't be muxed into MP4.
    pub(crate) fn open(
        path: &str,
        identity: &str,
        at: Duration,
        video: VideoMode,
        choose: impl FnOnce() -> Candidate,
        audio: AudioMode,
    ) -> media::Result<(Self, f64)> {
        let (mut writer, sink) = writer()?;
        let (video, video_out, start, from) = match video {
            VideoMode::Copy => {
                let (video, start, from) = open_copy(path, at)?;
                let video_out = writer.add_stream_copy(&video.reader, video.index)?;
                (VideoSource::Copy(video), video_out, start, from)
            }
            VideoMode::Encode => {
                let encode = VideoEncode::open(path, choose())?;
                let segment = segment_at(at);
                let from = encode.boundary(segment);
                // One encoder gives both the init segment the cache is keyed by and the session's own.
                let encoder = encode.settings().encoder()?;
                let init = init_hash(&encoder)?;
                let video_out = writer.add_stream_from_encoder(&encoder)?;
                let video = EncodedVideo { encode, init, next: segment };
                (VideoSource::Encode(Box::new(video)), video_out, segment_start(segment), from)
            }
        };

        // The sound starts where the picture does, on the file's clock.
        let audio = match audio {
            AudioMode::None => None,
            AudioMode::Copy => AudioSource::copy(path, from)?,
            AudioMode::Encode => AudioSource::encode(path, from)?,
        };
        let audio = match audio {
            Some(audio) => {
                let output = audio.add_to(&mut writer)?;
                Some((audio, output))
            }
            None => None,
        };

        let session = Self { identity: identity.to_owned(), video, audio, writer, sink, video_out, phase: Phase::Init };
        Ok((session, start))
    }

    /// The identity of the video the session reads.
    pub(crate) fn identity(&self) -> &str {
        &self.identity
    }

    /// The encoder of an encoded video, or `None` when the video is copied.
    pub(crate) fn encoder(&self) -> Option<Candidate> {
        match &self.video {
            VideoSource::Copy(_) => None,
            VideoSource::Encode(encoded) => Some(encoded.encode.settings().candidate),
        }
    }

    /// The next segment: the init segment first, then one segment's fragments per call, each beginning on a video
    /// keyframe, then an empty segment on every call after the last.
    ///
    /// An encoded segment comes from `segments` when it has it, and is kept there when it is encoded.
    ///
    /// # Errors
    ///
    /// [`EncodeError::Cancelled`] when `cancel` is set while a segment is being encoded; any error from `media-rs`
    /// reading the file, encoding or muxing it. The session is unusable afterwards.
    pub(crate) fn next(&mut self, segments: &Segments, cancel: &AtomicBool) -> Result<Vec<u8>, EncodeError> {
        match self.phase {
            Phase::Init => {
                self.writer.write_header()?;
                self.writer.flush()?;
                self.phase = Phase::Streaming;
            }
            Phase::Streaming => self.segment(segments, cancel)?,
            Phase::Done => {}
        }

        Ok(self.sink.take())
    }

    /// Writes the next segment's video, then the sound up to where the segment after it begins, and closes the
    /// fragment. At the end of the video, writes the rest of the sound and the trailer.
    fn segment(&mut self, segments: &Segments, cancel: &AtomicBool) -> Result<(), EncodeError> {
        let (packets, until) = match &mut self.video {
            VideoSource::Copy(copy) => {
                let packets = copy.segment()?;
                let until = copy.held.as_ref().map(|next| copy.seconds(next));
                (packets, until)
            }
            VideoSource::Encode(encoded) => {
                let EncodedVideo { encode, init, next } = &mut **encoded;
                let packets =
                    segments.get_or_encode(&self.identity, init, *next, cancel, || encode.encode(*next, cancel))?;
                *next += 1;
                (packets, Some(encode.boundary(*next)))
            }
        };

        if packets.is_empty() {
            self.write_audio(f64::INFINITY)?;
            self.writer.write_trailer()?;
            self.phase = Phase::Done;
            return Ok(());
        }

        for mut packet in packets {
            packet.set_stream_index(self.video_out);
            self.writer.write_packet(&mut packet)?;
        }
        self.write_audio(until.unwrap_or(f64::INFINITY))?;
        Ok(self.writer.flush()?)
    }

    /// Writes the sound that starts before `until` seconds and hasn't been written yet.
    fn write_audio(&mut self, until: f64) -> media::Result<()> {
        let Some((audio, output)) = &mut self.audio else { return Ok(()) };
        for mut packet in audio.until(until)? {
            packet.set_stream_index(*output);
            self.writer.write_packet(&mut packet)?;
        }
        Ok(())
    }
}

/// The video stream of `path` copied from the last keyframe at or before `at`: the source, the start time to report,
/// and that keyframe's time on the file's clock.
fn open_copy(path: &str, at: Duration) -> media::Result<(CopiedVideo, f64, f64)> {
    let mut reader = MediaReader::open(path)?;
    let index = reader.best_stream(StreamKind::Video)?;
    let time_base = reader.stream_time_base(index)?;
    if !at.is_zero() {
        reader.seek(index, at)?;
    }

    // A segment begins on a keyframe, so everything before the first one is dropped.
    let held = first_keyframe(&mut reader, index)?;
    let video = CopiedVideo { reader, index, time_base, held };
    let keyframe = video.held.as_ref().map_or(0.0, |packet| video.seconds(packet));
    // A seek before the first keyframe lands on it, after the time asked; that is still the start of the file.
    let start = if at.is_zero() || keyframe > at.as_secs_f64() { 0.0 } else { keyframe };

    Ok((video, start, keyframe))
}

/// The hash the cache keys a session's encoded segments by: of the init segment `encoder` gives a video-only file. It
/// covers the encoder, its settings, the picture's shape and the encoder's build, but not the sound, which doesn't
/// change the video's packets, so sessions that carry the sound differently share segments.
fn init_hash(encoder: &VideoEncoder) -> media::Result<String> {
    Ok(rust_sak::crypto::xxh3_bytes(&init_segment(encoder)?))
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::{Path, PathBuf};

    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::thumbs::tests::fixture;
    use crate::video::encoder::LIBX264;
    use crate::video::fixtures::{mkv, mkv_two_audio, mkv_video_only, rotated};

    /// The top-level MP4 boxes in `bytes`, by name.
    pub(crate) fn boxes(bytes: &[u8]) -> Vec<String> {
        let mut names = Vec::new();
        let mut at = 0;
        while at + 8 <= bytes.len() {
            let size = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
            names.push(String::from_utf8_lossy(&bytes[at + 4..at + 8]).into_owned());
            assert!(size >= 8, "a box of {size} bytes");
            at += size;
        }
        assert_eq!(at, bytes.len(), "the segment ends inside a box");
        names
    }

    /// Every `tfdt` base decode time in `fragment`, in track order.
    fn decode_times(fragment: &[u8]) -> Vec<u64> {
        fragment
            .windows(4)
            .enumerate()
            .filter(|(_, tag)| *tag == b"tfdt")
            .map(|(at, _)| {
                let body = &fragment[at + 4..];
                if body[0] == 1 {
                    u64::from_be_bytes(body[4..12].try_into().unwrap())
                } else {
                    u64::from(u32::from_be_bytes(body[4..8].try_into().unwrap()))
                }
            })
            .collect()
    }

    const ID: &str = "0123456789abcdef";

    fn open_as(path: &Path, at: f64, video: VideoMode, audio: AudioMode) -> (Session, f64) {
        Session::open(path.to_str().unwrap(), ID, Duration::from_secs_f64(at), video, || LIBX264, audio).unwrap()
    }

    /// A slice 4 remux: the video copied, with or without its sound copied.
    fn open(path: &Path, at: f64, audio: bool) -> (Session, f64) {
        open_as(path, at, VideoMode::Copy, if audio { AudioMode::Copy } else { AudioMode::None })
    }

    fn next(session: &mut Session, segments: &Segments) -> Vec<u8> {
        session.next(segments, &AtomicBool::new(false)).unwrap()
    }

    /// Every segment of a session, up to and not including the first empty one.
    fn drain(session: &mut Session, segments: &Segments) -> Vec<Vec<u8>> {
        std::iter::from_fn(|| Some(next(session, segments)))
            .take_while(|segment| !segment.is_empty())
            .collect()
    }

    /// `segments` written one after the other to `name` in `dir`, opened again.
    fn reopen(dir: &Path, name: &str, segments: &[&[u8]]) -> MediaReader {
        let path: PathBuf = dir.join(name);
        std::fs::write(&path, segments.concat()).unwrap();
        MediaReader::open(path.to_str().unwrap()).unwrap()
    }

    /// The packet count of each stream of `reader`, and how long its video lasts, in seconds, from its first frame to
    /// its last.
    fn census(reader: &mut MediaReader) -> (Vec<usize>, f64) {
        let video = reader.best_stream(StreamKind::Video).unwrap();
        let time_base = reader.stream_time_base(video).unwrap().as_f64();
        let mut counts = vec![0; reader.stream_count()];
        let (mut first, mut end) = (f64::INFINITY, f64::NEG_INFINITY);
        for packet in reader.packets() {
            let packet = packet.unwrap();
            counts[packet.stream_index()] += 1;
            if packet.stream_index() == video {
                #[allow(clippy::cast_precision_loss, reason = "test timestamps are small")]
                let time = packet.pts() as f64 * time_base;
                first = first.min(time);
                end = end.max(time);
            }
        }
        (counts, end - first)
    }

    /// Each fragment after the init segment, in turn, whose first video packet must be a keyframe.
    fn assert_fragments_begin_on_keyframes(dir: &Path, segments: &[Vec<u8>]) {
        for (n, fragment) in segments[1..].iter().enumerate() {
            let mut reader = reopen(dir, &format!("fragment{n}.mp4"), &[&segments[0], fragment]);
            let video = reader.best_stream(StreamKind::Video).unwrap();
            let first = reader.packets().map(Result::unwrap).find(|packet| packet.stream_index() == video).unwrap();
            assert!(first.is_keyframe(), "fragment {n} begins on a non-key frame");
        }
    }

    // --- the copy-and-copy case: slice 4's remux ----------------------------------------------------------------

    #[test]
    fn an_init_segment_then_fragments_then_empty_segments() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let segments = Segments::default();
        let (mut session, start) = open(&mkv(dir.path()), 0.0, true);

        assert!(start.abs() < f64::EPSILON, "{start}");
        let parts = drain(&mut session, &segments);
        assert_eq!(boxes(&parts[0]), ["ftyp", "moov"]);
        assert!(parts.len() > 2);
        for fragment in &parts[1..] {
            assert_eq!(boxes(fragment), ["moof", "mdat"]);
        }
        assert!(next(&mut session, &segments).is_empty());
        assert!(next(&mut session, &segments).is_empty());
    }

    #[test]
    fn each_fragment_begins_on_a_keyframe() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let (mut session, _) = open(&mkv(dir.path()), 0.0, true);
        let parts = drain(&mut session, &Segments::default());

        assert_fragments_begin_on_keyframes(dir.path(), &parts);
    }

    #[test]
    fn the_segments_together_are_the_whole_video() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let path = mkv(dir.path());
        let (source_counts, source_span) = census(&mut MediaReader::open(path.to_str().unwrap()).unwrap());
        let (mut session, _) = open(&path, 0.0, true);
        let parts = drain(&mut session, &Segments::default());

        let parts: Vec<&[u8]> = parts.iter().map(Vec::as_slice).collect();
        let (counts, span) = census(&mut reopen(dir.path(), "whole.mp4", &parts));

        // The source's AAC opens with its priming packet, which a session leaves out (see `audio`).
        assert_eq!(counts, [source_counts[0], source_counts[1] - 1]);
        assert!((span - source_span).abs() < 0.001, "lasts {span} s, the source {source_span} s");
    }

    #[test]
    fn without_audio_there_is_one_track() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let (mut session, _) = open(&mkv(dir.path()), 0.0, false);
        let parts = drain(&mut session, &Segments::default());

        let reader = reopen(dir.path(), "silent.mp4", &[&parts[0], &parts[1]]);
        assert_eq!(reader.stream_count(), 1);
        assert_eq!(reader.stream_kind(0).unwrap(), StreamKind::Video);
    }

    #[test]
    fn a_video_with_no_audio_is_carried_whether_or_not_audio_is_asked_for() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let (mut session, _) = open(&mkv_video_only(dir.path()), 0.0, true);
        let parts = drain(&mut session, &Segments::default());

        assert_eq!(reopen(dir.path(), "silent.mp4", &[&parts[0], &parts[1]]).stream_count(), 1);
    }

    #[test]
    fn other_streams_are_left_out() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let path = mkv_two_audio(dir.path());
        assert_eq!(MediaReader::open(path.to_str().unwrap()).unwrap().stream_count(), 3);

        let (mut session, _) = open(&path, 0.0, true);
        let parts = drain(&mut session, &Segments::default());

        let reader = reopen(dir.path(), "two.mp4", &[&parts[0], &parts[1]]);
        assert_eq!(reader.stream_count(), 2);
    }

    #[test]
    fn a_session_starts_at_the_keyframe_at_or_before_the_time_asked() {
        // `test3.mp4`, and so the generated file, has a keyframe every 2 s.
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let path = mkv(dir.path());

        for (at, start) in [(0.0, 0.0), (0.5, 0.0), (2.0, 2.0), (3.0, 2.0), (5.9, 4.0), (8.0, 8.0)] {
            let (_, actual) = open(&path, at, true);
            assert!((actual - start).abs() < 0.001, "opened at {at}, started at {actual}, not {start}");
        }
    }

    #[test]
    fn a_later_session_is_rebased_to_zero_and_its_start_is_the_offset() {
        // The muxer starts every session's output at 0 (see slice 4's "Spike results"), so the window places it at
        // `start` with `timestampOffset`.
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let segments = Segments::default();
        let (mut session, start) = open(&mkv(dir.path()), 5.0, true);

        assert!((start - 4.0).abs() < 0.001, "{start}");
        let _init = next(&mut session, &segments);
        let first = next(&mut session, &segments);
        let times = decode_times(&first);
        assert_eq!(times, [0, 0], "one tfdt per track, both at 0");
    }

    #[test]
    fn a_session_reads_only_as_far_as_it_is_asked() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let segments = Segments::default();
        let (mut session, _) = open(&mkv(dir.path()), 0.0, true);

        for _ in 0..3 {
            assert!(!next(&mut session, &segments).is_empty());
        }

        assert_eq!(session.phase, Phase::Streaming, "the reader reached the end of the input");
    }

    // --- encoded video ---------------------------------------------------------------------------------------

    /// The codec of each track of the init segment `init`.
    fn codecs(dir: &Path, init: &[u8], fragment: &[u8]) -> Vec<String> {
        let path = dir.join("codecs.mp4");
        std::fs::write(&path, [init, fragment].concat()).unwrap();
        let info = media::probe(path.to_str().unwrap()).unwrap();
        info.streams().iter().map(|stream| stream.codec_name.clone()).collect()
    }

    #[test]
    fn an_encoded_session_runs_from_open_to_end_with_every_frame() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let segments = Segments::default();
        let path = mkv(dir.path());
        let (source_counts, _) = census(&mut MediaReader::open(path.to_str().unwrap()).unwrap());
        let (mut session, start) = open_as(&path, 0.0, VideoMode::Encode, AudioMode::Encode);

        assert!(start.abs() < f64::EPSILON);
        let parts = drain(&mut session, &segments);

        assert_eq!(codecs(dir.path(), &parts[0], &parts[1]), ["h264", "aac"]);
        // 10.3 s: five whole segments and a short one.
        assert_eq!(parts.len(), 1 + 6);
        assert_fragments_begin_on_keyframes(dir.path(), &parts);
        let parts: Vec<&[u8]> = parts.iter().map(Vec::as_slice).collect();
        let (counts, _) = census(&mut reopen(dir.path(), "encoded.mp4", &parts));
        assert_eq!(counts[0], source_counts[0], "a frame was lost");
        // The six segments, and the empty one past the end, which is how the session finds the end.
        assert_eq!(segments.encodes(), 7);
    }

    #[test]
    fn an_encoded_session_opened_between_boundaries_starts_at_the_one_before() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();

        // Past the end of the 10.3 s video, too: the session then has an init segment and nothing more.
        for (at, start) in [(0.5, 0.0), (2.0, 2.0), (3.9, 2.0), (5.0, 4.0), (31.0, 30.0)] {
            let (_, actual) = open_as(&mkv(dir.path()), at, VideoMode::Encode, AudioMode::None);
            assert!((actual - start).abs() < f64::EPSILON, "opened at {at}, started at {actual}");
        }
    }

    /// The video packets of `init` followed by `fragment`, by their bytes.
    fn video_packets(dir: &Path, name: &str, init: &[u8], fragment: &[u8]) -> Vec<Vec<u8>> {
        let mut reader = reopen(dir, name, &[init, fragment]);
        let video = reader.best_stream(StreamKind::Video).unwrap();
        reader
            .packets()
            .map(Result::unwrap)
            .filter(|packet| packet.stream_index() == video)
            .map(|packet| packet.data().to_vec())
            .collect()
    }

    #[test]
    fn an_encoded_session_opened_mid_file_begins_with_the_frame_at_its_boundary() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let path = fixture("test3.mp4");
        let mut source = MediaReader::open(path.to_str().unwrap()).unwrap();
        let index = source.best_stream(StreamKind::Video).unwrap();
        let time_base = source.stream_time_base(index).unwrap().as_f64();
        #[allow(clippy::cast_precision_loss, reason = "test timestamps are small")]
        let in_window = source
            .packets()
            .map(Result::unwrap)
            .filter(|packet| packet.stream_index() == index)
            .filter(|packet| (2.0..4.0).contains(&(packet.pts() as f64 * time_base)))
            .count();
        // Separate caches, so the mid-file session encodes its segment itself rather than being served the other's.
        let (from_start, mid_file) = (Segments::default(), Segments::default());
        let (mut whole, _) = open_as(&path, 0.0, VideoMode::Encode, AudioMode::None);
        let whole: Vec<Vec<u8>> = (0..3).map(|_| next(&mut whole, &from_start)).collect();

        let (mut session, start) = open_as(&path, 3.0, VideoMode::Encode, AudioMode::None);
        let (init, first) = (next(&mut session, &mid_file), next(&mut session, &mid_file));

        assert!((start - 2.0).abs() < f64::EPSILON, "{start}");
        let packets = video_packets(dir.path(), "mid.mp4", &init, &first);
        // Every source frame shown from 2 s up to 4 s, and encoded the same as the segment at 2 s of a session from 0.
        assert_eq!(packets.len(), in_window);
        assert!(packets == video_packets(dir.path(), "whole.mp4", &whole[0], &whole[2]), "the frames differ");
    }

    #[test]
    fn a_rotated_video_is_encoded_upright_at_its_displayed_shape() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let path = rotated(dir.path(), 90.0);
        let source = MediaReader::open(path.to_str().unwrap()).unwrap();
        assert_eq!(source.stream_rotation(source.best_stream(StreamKind::Video).unwrap()).unwrap(), Some(90));
        let (mut session, _) = open_as(&path, 0.0, VideoMode::Encode, AudioMode::None);

        let (init, first) = (next(&mut session, &Segments::default()), next(&mut session, &Segments::default()));

        let mut reader = reopen(dir.path(), "upright.mp4", &[&init, &first]);
        let video = reader.best_stream(StreamKind::Video).unwrap();
        // Turned in the pixels, so no display matrix is left to turn it again.
        assert_eq!(reader.stream_rotation(video).unwrap(), None);
        let decoder = reader.stream(video).decoder().unwrap();
        assert_eq!((decoder.width(), decoder.height()), (360, 640));
    }

    #[test]
    fn copied_video_with_encoded_sound_keeps_the_source_video_packets() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let path = mkv(dir.path());
        let mut source = MediaReader::open(path.to_str().unwrap()).unwrap();
        let video = source.best_stream(StreamKind::Video).unwrap();
        let expected: Vec<Vec<u8>> = source
            .packets()
            .map(Result::unwrap)
            .filter(|packet| packet.stream_index() == video)
            .map(|packet| packet.data().to_vec())
            .collect();
        let (mut session, _) = open_as(&path, 0.0, VideoMode::Copy, AudioMode::Encode);

        let parts = drain(&mut session, &Segments::default());

        assert_eq!(codecs(dir.path(), &parts[0], &parts[1]), ["h264", "aac"]);
        let parts: Vec<&[u8]> = parts.iter().map(Vec::as_slice).collect();
        let mut reader = reopen(dir.path(), "copied.mp4", &parts);
        let out = reader.best_stream(StreamKind::Video).unwrap();
        let written: Vec<Vec<u8>> = reader
            .packets()
            .map(Result::unwrap)
            .filter(|packet| packet.stream_index() == out)
            .map(|packet| packet.data().to_vec())
            .collect();
        assert!(written == expected, "the video's packets changed");
    }

    #[test]
    fn an_encoded_session_encodes_only_what_is_asked_for() {
        let segments = Segments::default();
        let (mut session, _) = open_as(&fixture("test3.mp4"), 0.0, VideoMode::Encode, AudioMode::None);

        for _ in 0..3 {
            assert!(!next(&mut session, &segments).is_empty());
        }

        // The init segment, then segments 0 and 1.
        assert_eq!(segments.encodes(), 2);
    }

    #[test]
    fn a_reopened_session_is_served_from_the_cache() {
        let segments = Segments::default();
        let (mut first, _) = open_as(&fixture("test3.mp4"), 0.0, VideoMode::Encode, AudioMode::None);
        let earlier: Vec<Vec<u8>> = (0..4).map(|_| next(&mut first, &segments)).collect();
        assert_eq!(segments.encodes(), 3);

        let (mut reopened, start) = open_as(&fixture("test3.mp4"), 4.0, VideoMode::Encode, AudioMode::None);
        let init = next(&mut reopened, &segments);
        let segment = next(&mut reopened, &segments);

        assert!((start - 4.0).abs() < f64::EPSILON);
        assert_eq!(segments.encodes(), 3, "segment 2 was encoded again");
        assert_eq!(init, earlier[0]);
        assert_eq!(boxes(&segment), ["moof", "mdat"]);
    }

    #[test]
    fn a_video_that_cant_be_decoded_cant_be_encoded() {
        let dir = mk_temp_dir("mediasim-session-").unwrap();
        let path = dir.path().join("fake.mkv");
        std::fs::write(&path, b"not a video").unwrap();

        assert!(
            Session::open(path.to_str().unwrap(), ID, Duration::ZERO, VideoMode::Encode, || LIBX264, AudioMode::None)
                .is_err()
        );
    }
}
