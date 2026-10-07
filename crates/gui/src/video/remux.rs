//! One remux session: an admitted video's main streams, copied unchanged into fragmented MP4 and handed over one
//! segment at a time, so the window's Media Source Extensions player can play a container it can't open itself.
//!
//! The window pulls: each [`Remux::next`] reads only as far as the segment it returns needs, at most one GOP plus one
//! packet, so a session holds one segment's worth of output however long the file is.

use std::io::Write;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use media::prelude::{MediaReader, MediaWriter, Packet, StreamKind};

/// Where the writer's output collects until [`Remux::next`] takes it. Shared, because the writer owns its copy.
#[derive(Clone, Default)]
struct Sink(Arc<Mutex<Vec<u8>>>);

impl Sink {
    /// Everything written since the last take.
    fn take(&self) -> Vec<u8> {
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

/// What the next [`Remux::next`] returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// The init segment.
    Init,
    /// The next fragment.
    Streaming,
    /// Nothing: the last fragment has been returned.
    Done,
}

/// A session's state machine over a [`MediaReader`] and a fragmented-MP4 [`MediaWriter`].
pub(crate) struct Remux {
    reader: MediaReader,
    writer: MediaWriter,
    sink: Sink,
    /// The input index of the main video stream, and its output index.
    video: (usize, usize),
    /// The input index of the main audio stream and its output index, when audio is carried.
    audio: Option<(usize, usize)>,
    /// The video keyframe that begins the next fragment, read but not yet written.
    held: Option<Packet>,
    phase: Phase,
}

impl Remux {
    /// Opens `path` for a session starting at `at`, carrying the main video stream and, if `audio` is set and the file
    /// has one, the main audio stream.
    ///
    /// Returns the session and the time, in seconds, it actually starts from: the last video keyframe at or before
    /// `at`, or 0 when `at` is 0 or comes before the first keyframe.
    ///
    /// The muxer re-bases the output to begin at 0 whatever `at` is, so a player places a session's media at the start
    /// time itself (the window sets its `SourceBuffer`'s `timestampOffset` to it).
    ///
    /// # Errors
    ///
    /// Any error from `media-rs`: the file can't be opened or read, has no video stream, or can't be muxed into MP4.
    pub(crate) fn open(path: &str, at: Duration, audio: bool) -> media::Result<(Self, f64)> {
        let mut reader = MediaReader::open(path)?;
        let video = reader.best_stream(StreamKind::Video)?;
        // The same choice as `probe_video`, so both mean the same stream by "main".
        let audio = if audio { reader.best_stream(StreamKind::Audio).ok() } else { None };

        if !at.is_zero() {
            reader.seek(video, at)?;
        }

        // A fragment begins on a keyframe, so everything before the first one is dropped, audio included.
        let mut held = None;
        while let Some(packet) = reader.packets().next().transpose()? {
            if packet.stream_index() == video && packet.is_keyframe() {
                held = Some(packet);
                break;
            }
        }

        let time_base = reader.stream_time_base(video)?;
        let keyframe = held.as_ref().map_or(0.0, |packet| {
            let ts = if packet.pts() == i64::MIN { packet.dts() } else { packet.pts() };
            #[allow(clippy::cast_precision_loss, reason = "a timestamp is far below 2^52 ticks")]
            let seconds = ts as f64 * time_base.as_f64();
            seconds
        });
        // A seek before the first keyframe lands on it, after the time asked; that is still the start of the file.
        let start = if at.is_zero() || keyframe > at.as_secs_f64() { 0.0 } else { keyframe };

        let sink = Sink::default();
        let mut writer = MediaWriter::builder()
            .writer(sink.clone())
            .fragmented_mp4()
            .option("movflags", "negative_cts_offsets")
            .build()?;
        let video = (video, writer.add_stream_copy(&reader, video)?);
        let audio = match audio {
            Some(index) => Some((index, writer.add_stream_copy(&reader, index)?)),
            None => None,
        };

        let remux = Self { reader, writer, sink, video, audio, held, phase: Phase::Init };
        Ok((remux, start))
    }

    /// The next segment: the init segment first, then one fragment per call, each beginning on a video keyframe, then
    /// an empty segment on every call after the last fragment.
    ///
    /// # Errors
    ///
    /// Any error from `media-rs` reading the file or muxing it. The session is unusable afterwards.
    pub(crate) fn next(&mut self) -> media::Result<Vec<u8>> {
        match self.phase {
            Phase::Init => {
                self.writer.write_header()?;
                self.writer.flush()?;
                self.phase = Phase::Streaming;
            }
            Phase::Streaming => self.fragment()?,
            Phase::Done => {}
        }

        Ok(self.sink.take())
    }

    /// Writes packets of the carried streams up to the next video keyframe, which is held back for the fragment after,
    /// then closes the fragment. At end of input, writes the trailer, which closes the last one.
    fn fragment(&mut self) -> media::Result<()> {
        let mut written = false;

        loop {
            let packet = match self.held.take() {
                Some(packet) => Some(packet),
                None => self.reader.packets().next().transpose()?,
            };
            let Some(mut packet) = packet else {
                self.writer.write_trailer()?;
                self.phase = Phase::Done;
                return Ok(());
            };

            let index = packet.stream_index();
            let output = if index == self.video.0 {
                self.video.1
            } else if let Some((_, output)) = self.audio.filter(|(input, _)| *input == index) {
                output
            } else {
                continue;
            };

            if written && index == self.video.0 && packet.is_keyframe() {
                self.held = Some(packet);
                return self.writer.flush();
            }

            packet.set_stream_index(output);
            self.writer.write_packet(&mut packet)?;
            written = true;
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::path::{Path, PathBuf};

    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::video::fixtures::{mkv, mkv_two_audio, mkv_video_only};

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

    fn open(path: &Path, at: f64, audio: bool) -> (Remux, f64) {
        Remux::open(path.to_str().unwrap(), Duration::from_secs_f64(at), audio).unwrap()
    }

    /// Every segment of a session, up to and not including the first empty one.
    fn drain(remux: &mut Remux) -> Vec<Vec<u8>> {
        std::iter::from_fn(|| Some(remux.next().unwrap()))
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

    #[test]
    fn an_init_segment_then_fragments_then_empty_segments() {
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let (mut remux, start) = open(&mkv(dir.path()), 0.0, true);

        assert!(start.abs() < f64::EPSILON, "{start}");
        let segments = drain(&mut remux);
        assert_eq!(boxes(&segments[0]), ["ftyp", "moov"]);
        assert!(segments.len() > 2);
        for fragment in &segments[1..] {
            assert_eq!(boxes(fragment), ["moof", "mdat"]);
        }
        assert!(remux.next().unwrap().is_empty());
        assert!(remux.next().unwrap().is_empty());
    }

    #[test]
    fn each_fragment_begins_on_a_keyframe() {
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let (mut remux, _) = open(&mkv(dir.path()), 0.0, true);
        let segments = drain(&mut remux);

        for (n, fragment) in segments[1..].iter().enumerate() {
            let mut reader = reopen(dir.path(), &format!("fragment{n}.mp4"), &[&segments[0], fragment]);
            let video = reader.best_stream(StreamKind::Video).unwrap();
            let first = reader.packets().map(Result::unwrap).find(|packet| packet.stream_index() == video).unwrap();
            assert!(first.is_keyframe(), "fragment {n} begins on a non-key frame");
        }
    }

    #[test]
    fn the_segments_together_are_the_whole_video() {
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let path = mkv(dir.path());
        let (source_counts, source_span) = census(&mut MediaReader::open(path.to_str().unwrap()).unwrap());
        let (mut remux, _) = open(&path, 0.0, true);
        let segments = drain(&mut remux);

        let segments: Vec<&[u8]> = segments.iter().map(Vec::as_slice).collect();
        let (counts, span) = census(&mut reopen(dir.path(), "whole.mp4", &segments));

        assert_eq!(counts, source_counts);
        assert!((span - source_span).abs() < 0.001, "lasts {span} s, the source {source_span} s");
    }

    #[test]
    fn without_audio_there_is_one_track() {
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let (mut remux, _) = open(&mkv(dir.path()), 0.0, false);
        let segments = drain(&mut remux);

        let reader = reopen(dir.path(), "silent.mp4", &[&segments[0], &segments[1]]);
        assert_eq!(reader.stream_count(), 1);
        assert_eq!(reader.stream_kind(0).unwrap(), StreamKind::Video);
    }

    #[test]
    fn a_video_with_no_audio_is_carried_whether_or_not_audio_is_asked_for() {
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let (mut remux, _) = open(&mkv_video_only(dir.path()), 0.0, true);
        let segments = drain(&mut remux);

        assert_eq!(reopen(dir.path(), "silent.mp4", &[&segments[0], &segments[1]]).stream_count(), 1);
    }

    #[test]
    fn other_streams_are_left_out() {
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let path = mkv_two_audio(dir.path());
        assert_eq!(MediaReader::open(path.to_str().unwrap()).unwrap().stream_count(), 3);

        let (mut remux, _) = open(&path, 0.0, true);
        let segments = drain(&mut remux);

        let reader = reopen(dir.path(), "two.mp4", &[&segments[0], &segments[1]]);
        assert_eq!(reader.stream_count(), 2);
    }

    #[test]
    fn a_session_starts_at_the_keyframe_at_or_before_the_time_asked() {
        // `test3.mp4`, and so the generated file, has a keyframe every 2 s.
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let path = mkv(dir.path());

        for (at, start) in [(0.0, 0.0), (0.5, 0.0), (2.0, 2.0), (3.0, 2.0), (5.9, 4.0), (8.0, 8.0)] {
            let (_, actual) = open(&path, at, true);
            assert!((actual - start).abs() < 0.001, "opened at {at}, started at {actual}, not {start}");
        }
    }

    #[test]
    fn a_later_session_is_rebased_to_zero_and_its_start_is_the_offset() {
        // The muxer starts every session's output at 0 (see "Spike results" in the design), so the window places it
        // at `start` with `timestampOffset`.
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let (mut remux, start) = open(&mkv(dir.path()), 5.0, true);

        assert!((start - 4.0).abs() < 0.001, "{start}");
        let _init = remux.next().unwrap();
        let first = remux.next().unwrap();
        let times = decode_times(&first);
        assert_eq!(times, [0, 0], "one tfdt per track, both at 0");
    }

    #[test]
    fn a_session_reads_only_as_far_as_it_is_asked() {
        let dir = mk_temp_dir("mediasim-remux-").unwrap();
        let (mut remux, _) = open(&mkv(dir.path()), 0.0, true);

        for _ in 0..3 {
            assert!(!remux.next().unwrap().is_empty());
        }

        assert_eq!(remux.phase, Phase::Streaming, "the reader reached the end of the input");
    }
}
