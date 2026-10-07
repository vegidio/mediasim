//! The main video stream encoded as H.264, one 2-second segment at a time, for a window that can't decode the
//! source's codec.
//!
//! Segments sit on a fixed grid counted from the stream's first frame, and each is encoded by a fresh encoder from its
//! own frames only, so a given segment of a given file comes out the same from any session. That is what lets
//! [`Segments`](super::cache::Segments) keep them for every session.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use media::codec::{VideoEncoder, VideoEncoderBuilder};
use media::prelude::{
    Bitrate, Decoder, Frame, Framerate, H264Profile, MediaReader, Packet, Rational, StreamKind, VideoCodec,
    VideoFilter, VideoFilterChain,
};

use super::encoder::Candidate;

/// The grid's step.
pub(crate) const SEGMENT: Duration = Duration::from_secs(2);

/// The largest picture encoded, by its longer and its shorter side: 1920×1080, or 1080×1920 for portrait.
const LONGER: f64 = 1920.0;
const SHORTER: f64 = 1080.0;

/// The bitrate's bounds. Within them it is the candidate's bits per pixel per frame: at `libx264`'s 0.1, about
/// 6 Mbit/s at 1080p30.
const MIN_BITRATE: f64 = 1_000_000.0;
const MAX_BITRATE: f64 = 8_000_000.0;

/// The frame rate assumed when the stream doesn't say.
const FALLBACK_FRAME_RATE: Framerate = Framerate::fps(30);

/// Why encoding a segment stopped.
#[derive(Debug, thiserror::Error)]
pub(crate) enum EncodeError {
    /// The session was closed while the segment was being encoded.
    #[error("the session was closed while encoding")]
    Cancelled,
    /// The encoder failed to open, to encode a frame, or to flush: the encoder's fault, not the file's.
    #[error(transparent)]
    Encoder(media::Error),
    #[error(transparent)]
    Media(#[from] media::Error),
}

/// Everything a segment's encoder is built from. Every segment of a session gets an encoder from the same settings,
/// so their packets fit under one init segment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct EncoderSettings {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) frame_rate: Framerate,
    /// The source stream's, so every frame keeps its source time.
    pub(crate) time_base: Rational,
    pub(crate) candidate: Candidate,
    pub(crate) bitrate: Bitrate,
    /// Above a segment's frame count, so a segment has one keyframe, its first frame.
    pub(crate) gop: u32,
}

impl EncoderSettings {
    pub(crate) fn new(
        candidate: Candidate,
        (width, height): (u32, u32),
        frame_rate: Framerate,
        time_base: Rational,
    ) -> Self {
        let pixels_per_second = f64::from(width) * f64::from(height) * frame_rate.as_f64();
        #[expect(clippy::cast_possible_truncation, reason = "clamped to 8 Mbit/s")]
        let bitrate =
            Bitrate::bps((pixels_per_second * candidate.bits_per_pixel).clamp(MIN_BITRATE, MAX_BITRATE) as i64);
        // Four times a segment's frames leaves room for a stream whose average rate understates its bursts.
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a frame count, far below 2^32"
        )]
        let gop = (frame_rate.as_f64() * SEGMENT.as_secs_f64() * 4.0).ceil() as u32 + 1;

        Self { width, height, frame_rate, time_base, candidate, bitrate, gop }
    }

    /// A fresh encoder: H.264 High, 8-bit 4:2:0, with no B-frames, so every packet's `dts` is its `pts` and
    /// timestamps run on from one encoder to the next, and with the candidate's options, which keep it from placing
    /// keyframes of its own, so the only one is the first frame.
    pub(crate) fn encoder(&self) -> media::Result<VideoEncoder> {
        self.builder().build()
    }

    /// What [`encoder`](Self::encoder) builds, not yet opened.
    pub(crate) fn builder(&self) -> VideoEncoderBuilder {
        let candidate = &self.candidate;
        let mut builder = VideoEncoder::builder()
            .codec(VideoCodec::H264)
            .encoder(candidate.name)
            .resolution(self.width, self.height)
            .pixel_format(candidate.pixel_format)
            .framerate(self.frame_rate)
            .time_base(self.time_base)
            .bitrate(self.bitrate)
            .profile(H264Profile::High)
            .gop_size(self.gop)
            .option("bf", "0");
        if let Some(preset) = candidate.preset {
            builder = builder.preset(preset);
        }
        for (key, value) in candidate.options {
            builder = builder.option(key, value);
        }
        builder
    }
}

/// The size a picture of `width`×`height` pixels is encoded at: its displayed shape, with pixels made square by `sar`
/// and turned upright by `rotation`, shrunk to fit [`LONGER`]×[`SHORTER`] but never enlarged, and rounded to even
/// sides, which 4:2:0 needs.
pub(crate) fn shape(width: u32, height: u32, sar: Rational, rotation: Option<i32>) -> (u32, u32) {
    let sar = if sar.num > 0 && sar.den > 0 { sar.as_f64() } else { 1.0 };
    let (mut shown_width, mut shown_height) = (f64::from(width) * sar, f64::from(height));
    if matches!(rotation, Some(90 | 270)) {
        std::mem::swap(&mut shown_width, &mut shown_height);
    }

    let (longer, shorter) = (shown_width.max(shown_height), shown_width.min(shown_height));
    let scale = (LONGER / longer).min(SHORTER / shorter).min(1.0);
    #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "at most 1920, and positive")]
    let even = |side: f64| ((side * scale / 2.0).round() as u32 * 2).max(2);

    (even(shown_width), even(shown_height))
}

/// The filters that turn a decoded frame into what the encoder takes: upright, at `width`×`height`, in 8-bit 4:2:0 as
/// `format` lays it out (`yuv420p` or `nv12`).
pub(crate) fn chain(rotation: Option<i32>, (width, height): (u32, u32), format: &str) -> VideoFilterChain {
    let turn = match rotation {
        Some(90) => "transpose=clock,",
        Some(180) => "hflip,vflip,",
        Some(270) => "transpose=cclock,",
        _ => "",
    };

    VideoFilterChain::raw(format!("{turn}scale={width}:{height},format={format}"))
}

/// The segment a session opened at `at` starts with: the last grid boundary at or before it.
pub(crate) fn segment_at(at: Duration) -> u64 {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a duration's segment count, positive"
    )]
    let segment = (at.as_secs_f64() / SEGMENT.as_secs_f64()).floor() as u64;
    segment
}

/// Where segment `segment` starts, in seconds.
pub(crate) fn segment_start(segment: u64) -> f64 {
    #[expect(clippy::cast_precision_loss, reason = "a segment count, far below 2^52")]
    let start = segment as f64 * SEGMENT.as_secs_f64();
    start
}

/// A session's encoder side: its own reader and decoder on the main video stream, and the frames that make each
/// segment.
pub(crate) struct VideoEncode {
    reader: MediaReader,
    index: usize,
    decoder: Decoder,
    filter: VideoFilter,
    settings: EncoderSettings,
    /// The grid's origin, the stream's first timestamp, and its step, in the stream's ticks.
    origin: i64,
    step: i64,
    /// The segment the decoder is positioned at: the next one after the last it encoded.
    positioned: Option<u64>,
    /// Frames decoded but not yet encoded: the first of the next segment, and the rest of the packet it came from.
    decoded: VecDeque<Frame>,
    /// One frame's duration in ticks, for a frame that comes without a timestamp.
    frame_ticks: i64,
    last_pts: i64,
    at_end: bool,
}

impl VideoEncode {
    /// Opens the main video stream of `path`, to be encoded by `candidate`.
    ///
    /// # Errors
    ///
    /// The file can't be read, has no video stream, or `FFmpeg` can't decode it.
    pub(crate) fn open(path: &str, candidate: Candidate) -> media::Result<Self> {
        let mut reader = MediaReader::open(path)?;
        let index = reader.best_stream(StreamKind::Video)?;
        let time_base = reader.stream_time_base(index)?;
        let average = reader.stream_avg_frame_rate(index)?;
        let frame_rate = if average.num > 0 && average.den > 0 { Framerate(average) } else { FALLBACK_FRAME_RATE };
        let rotation = reader.stream_rotation(index)?;
        let decoder = reader.stream(index).decoder()?;

        let size = shape(decoder.width(), decoder.height(), decoder.sample_aspect_ratio(), rotation);
        let filter = VideoFilter::new(&decoder, time_base, &chain(rotation, size, candidate.format()))?;
        let settings =
            EncoderSettings::new(candidate, (filter.output_width(), filter.output_height()), frame_rate, time_base);
        let origin = first_timestamp(&mut reader, index)?;

        let ticks = |seconds: f64| {
            #[expect(clippy::cast_possible_truncation, reason = "a timestamp, far below 2^63")]
            let ticks = (seconds / time_base.as_f64()).round() as i64;
            ticks.max(1)
        };

        Ok(Self {
            reader,
            index,
            decoder,
            filter,
            settings,
            origin,
            step: ticks(SEGMENT.as_secs_f64()),
            positioned: None,
            decoded: VecDeque::new(),
            frame_ticks: ticks(1.0 / frame_rate.as_f64()),
            last_pts: origin,
            at_end: false,
        })
    }

    pub(crate) fn settings(&self) -> &EncoderSettings {
        &self.settings
    }

    /// Where segment `segment` starts on the file's own clock, in seconds: the grid's origin plus its offset.
    pub(crate) fn boundary(&self, segment: u64) -> f64 {
        #[expect(clippy::cast_precision_loss, reason = "a timestamp, far below 2^52 ticks")]
        let origin = self.origin as f64 * self.settings.time_base.as_f64();
        origin + segment_start(segment)
    }

    /// Segment `segment`, encoded by a fresh encoder: the frames shown from its grid boundary up to the next, at their
    /// source times. Empty past the end of the video.
    ///
    /// The decoder carries on when it is already there, which is when the previous segment was the last this
    /// encoded; otherwise it seeks to the keyframe at or before the boundary and decodes forward. Either way the
    /// segment is the same.
    ///
    /// # Errors
    ///
    /// [`EncodeError::Cancelled`] when `cancel` is set, which is checked before each frame; [`EncodeError::Encoder`]
    /// when the encoder fails to open, encode or flush; [`EncodeError::Media`] when reading, decoding or filtering the
    /// file fails. A partly encoded segment is dropped either way.
    pub(crate) fn encode(&mut self, segment: u64, cancel: &AtomicBool) -> Result<Vec<Packet>, EncodeError> {
        let step = i64::try_from(segment).map_or(i64::MAX, |segment| segment.saturating_mul(self.step));
        let (from, until) =
            (self.origin.saturating_add(step), self.origin.saturating_add(step).saturating_add(self.step));
        if self.positioned != Some(segment) {
            self.seek(from)?;
        }
        // Until this segment is done, the decoder is somewhere inside it.
        self.positioned = None;

        #[cfg(test)]
        if self.settings.candidate.fails_from.is_some_and(|from| segment >= from) {
            return Err(EncodeError::Encoder(media::Error::Bug("a test encoder failing as asked")));
        }
        let mut encoder = self.settings.encoder().map_err(EncodeError::Encoder)?;
        let mut packets = Vec::new();
        let mut any = false;
        while let Some(mut frame) = self.next_frame()? {
            if cancel.load(Ordering::Relaxed) {
                return Err(EncodeError::Cancelled);
            }
            let pts = frame.best_effort_timestamp().or(frame.pts()).unwrap_or(self.last_pts + self.frame_ticks);
            if pts < from {
                continue;
            }
            if pts >= until {
                // The next segment's first frame.
                self.decoded.push_front(frame);
                break;
            }

            self.last_pts = pts;
            frame.set_pts(pts);
            for shaped in self.filter.filter(frame)? {
                for packet in encoder.encode(&shaped).map_err(EncodeError::Encoder)? {
                    packets.push(packet.map_err(EncodeError::Encoder)?);
                }
                any = true;
            }
        }
        if any {
            for packet in encoder.flush().map_err(EncodeError::Encoder)? {
                packets.push(packet.map_err(EncodeError::Encoder)?);
            }
        }

        self.positioned = Some(segment + 1);
        Ok(packets)
    }

    /// Positions the reader at the keyframe at or before `ts`, and drops what the decoder held.
    fn seek(&mut self, ts: i64) -> media::Result<()> {
        #[expect(clippy::cast_precision_loss, reason = "a timestamp, far below 2^52 ticks")]
        let seconds = ts as f64 * self.settings.time_base.as_f64();
        self.reader.seek(self.index, Duration::try_from_secs_f64(seconds).unwrap_or_default())?;
        self.decoder.reset();
        self.decoded.clear();
        self.at_end = false;
        Ok(())
    }

    /// The next decoded frame of the stream, in presentation order, or `None` after the last.
    fn next_frame(&mut self) -> media::Result<Option<Frame>> {
        loop {
            if let Some(frame) = self.decoded.pop_front() {
                return Ok(Some(frame));
            }
            if self.at_end {
                return Ok(None);
            }

            match self.reader.packets().next().transpose()? {
                Some(packet) if packet.stream_index() == self.index => {
                    for frame in self.decoder.decode(&packet)? {
                        self.decoded.push_back(frame?);
                    }
                }
                Some(_) => {}
                None => {
                    self.at_end = true;
                    for frame in self.decoder.flush()? {
                        self.decoded.push_back(frame?);
                    }
                }
            }
        }
    }
}

/// The first timestamp of stream `index`, from its first keyframe: the grid's origin. Leaves the reader at the start.
fn first_timestamp(reader: &mut MediaReader, index: usize) -> media::Result<i64> {
    let mut first = None;
    while let Some(packet) = reader.packets().next().transpose()? {
        if packet.stream_index() == index && packet.is_keyframe() {
            first = Some(if packet.pts() == i64::MIN { packet.dts() } else { packet.pts() });
            break;
        }
    }
    reader.seek(index, Duration::ZERO)?;

    Ok(first.filter(|ts| *ts != i64::MIN).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::video::encoder::{Encoders, LIBX264};
    use crate::video::fixtures::reencoded;

    /// 10 s of `test3.mp4` at 540×960 with a keyframe every 1.5 s, so most of its keyframes fall inside a segment.
    fn off_grid(dir: &Path) -> String {
        reencoded(dir, "offgrid.mp4", (540, 960), 45, 10.0).to_str().unwrap().to_owned()
    }

    fn encode(session: &mut VideoEncode, segment: u64) -> Vec<Packet> {
        session.encode(segment, &AtomicBool::new(false)).unwrap()
    }

    #[test]
    fn a_large_picture_shrinks_to_fit_1080p_keeping_its_shape() {
        assert_eq!(shape(3840, 2160, Rational::ONE, None), (1920, 1080));
        assert_eq!(shape(3840, 1600, Rational::ONE, None), (1920, 800));
        assert_eq!(shape(2160, 3840, Rational::ONE, None), (1080, 1920));
    }

    #[test]
    fn a_picture_that_fits_is_never_enlarged() {
        assert_eq!(shape(1080, 1920, Rational::ONE, None), (1080, 1920));
        assert_eq!(shape(640, 480, Rational::ONE, None), (640, 480));
        assert_eq!(shape(1920, 1080, Rational::ONE, None), (1920, 1080));
    }

    #[test]
    fn sides_are_rounded_to_even() {
        assert_eq!(shape(641, 359, Rational::ONE, None), (642, 360));
        // 2001×1001 scales by 0.9595 to 1920×960.5.
        assert_eq!(shape(2001, 1001, Rational::ONE, None), (1920, 960));
    }

    #[test]
    fn a_quarter_turn_swaps_the_sides() {
        assert_eq!(shape(1920, 1080, Rational::ONE, Some(90)), (1080, 1920));
        assert_eq!(shape(1920, 1080, Rational::ONE, Some(270)), (1080, 1920));
        assert_eq!(shape(1920, 1080, Rational::ONE, Some(180)), (1920, 1080));
        assert_eq!(shape(3840, 2160, Rational::ONE, Some(90)), (1080, 1920));
    }

    #[test]
    fn an_anamorphic_picture_gets_square_pixels() {
        // 1440×1080 shown at 16:9, and NTSC widescreen DVD.
        assert_eq!(shape(1440, 1080, Rational::new(4, 3), None), (1920, 1080));
        assert_eq!(shape(720, 480, Rational::new(32, 27), None), (854, 480));
        // An unknown aspect ratio is square.
        assert_eq!(shape(640, 480, Rational::new(0, 1), None), (640, 480));
    }

    #[test]
    fn a_large_source_is_encoded_at_the_shape_that_fits() {
        let dir = mk_temp_dir("mediasim-transcode-").unwrap();

        for (name, source, encoded) in
            [("uhd.mp4", (3840, 2160), (1920, 1080)), ("wide.mp4", (3840, 1600), (1920, 800))]
        {
            let path = reencoded(dir.path(), name, source, 30, 0.2);
            let mut session = VideoEncode::open(path.to_str().unwrap(), LIBX264).unwrap();

            let settings = session.settings();
            assert_eq!((settings.width, settings.height), encoded, "{name}");
            // The encoder takes the filter's frames at that shape.
            assert!(!encode(&mut session, 0).is_empty(), "{name}");
        }
    }

    #[test]
    fn the_chain_turns_then_scales_then_converts() {
        assert_eq!(chain(None, (1920, 1080), "yuv420p").description(), "scale=1920:1080,format=yuv420p");
        assert_eq!(chain(Some(0), (1920, 1080), "yuv420p").description(), "scale=1920:1080,format=yuv420p");
        assert_eq!(
            chain(Some(90), (720, 1280), "yuv420p").description(),
            "transpose=clock,scale=720:1280,format=yuv420p"
        );
        assert_eq!(
            chain(Some(180), (1280, 720), "yuv420p").description(),
            "hflip,vflip,scale=1280:720,format=yuv420p"
        );
        assert_eq!(
            chain(Some(270), (720, 1280), "yuv420p").description(),
            "transpose=cclock,scale=720:1280,format=yuv420p"
        );
    }

    #[test]
    fn the_chain_converts_to_the_encoders_pixel_format() {
        assert_eq!(chain(None, (1920, 1080), "nv12").description(), "scale=1920:1080,format=nv12");
        assert_eq!(chain(Some(90), (720, 1280), "nv12").description(), "transpose=clock,scale=720:1280,format=nv12");
    }

    #[test]
    fn the_bitrate_follows_the_picture_within_bounds() {
        let at = |size, fps| EncoderSettings::new(LIBX264, size, Framerate::fps(fps), Rational::new(1, 90_000)).bitrate;

        assert_eq!(at((1920, 1080), 30), Bitrate::bps(6_220_800));
        assert_eq!(at((1920, 1080), 60), Bitrate::mbps(8));
        assert_eq!(at((320, 240), 24), Bitrate::mbps(1));
    }

    #[test]
    fn a_session_starts_at_the_boundary_at_or_before_the_time_asked() {
        for (at, segment, start) in [(0.0, 0, 0.0), (1.9, 0, 0.0), (2.0, 1, 2.0), (31.0, 15, 30.0)] {
            let segment_asked = segment_at(Duration::from_secs_f64(at));
            assert_eq!(segment_asked, segment, "at {at}");
            assert!((segment_start(segment_asked) - start).abs() < f64::EPSILON);
        }
    }

    fn assert_one_keyframe_per_segment(candidate: Candidate) {
        let dir = mk_temp_dir("mediasim-transcode-").unwrap();
        let mut session = VideoEncode::open(&off_grid(dir.path()), candidate).unwrap();

        for segment in 0..5 {
            let packets = encode(&mut session, segment);
            assert!(packets[0].is_keyframe(), "segment {segment} begins on a non-key frame");
            assert_eq!(packets.iter().filter(|packet| packet.is_keyframe()).count(), 1, "segment {segment}");
        }
    }

    #[test]
    fn each_segment_has_one_keyframe_its_first_packet() {
        assert_one_keyframe_per_segment(LIBX264);
    }

    #[test]
    fn each_segment_has_one_keyframe_its_first_packet_with_the_chosen_encoder() {
        assert_one_keyframe_per_segment(Encoders::default().current());
    }

    #[test]
    fn each_segment_holds_the_source_frames_of_its_window_at_their_source_times() {
        assert_segments_hold_their_windows(LIBX264);
    }

    #[test]
    fn each_segment_holds_the_source_frames_of_its_window_with_the_chosen_encoder() {
        assert_segments_hold_their_windows(Encoders::default().current());
    }

    fn assert_segments_hold_their_windows(candidate: Candidate) {
        let dir = mk_temp_dir("mediasim-transcode-").unwrap();
        let path = off_grid(dir.path());
        let mut reader = MediaReader::open(&path).unwrap();
        let mut source: Vec<i64> = reader.packets().map(|packet| packet.unwrap().pts()).collect();
        source.sort_unstable();
        let mut session = VideoEncode::open(&path, candidate).unwrap();
        let step = session.step;
        assert_eq!(session.settings().width, 540);

        let mut seen = 0;
        for segment in 0..5 {
            let window = segment * step..(segment + 1) * step;
            let expected: Vec<i64> = source.iter().copied().filter(|pts| window.contains(pts)).collect();
            let packets = encode(&mut session, u64::try_from(segment).unwrap());
            let times: Vec<i64> = packets.iter().map(Packet::pts).collect();
            assert_eq!(times, expected, "segment {segment}");
            assert!(packets.iter().all(|packet| packet.dts() == packet.pts()), "a B-frame in segment {segment}");
            seen += times.len();
        }
        assert_eq!(seen, source.len());
    }

    #[test]
    fn a_segment_is_the_same_whether_the_decoder_carried_on_or_sought() {
        let dir = mk_temp_dir("mediasim-transcode-").unwrap();
        let path = off_grid(dir.path());
        let mut carried = VideoEncode::open(&path, LIBX264).unwrap();
        encode(&mut carried, 0);
        encode(&mut carried, 1);
        let mut sought = VideoEncode::open(&path, LIBX264).unwrap();

        let (after, alone) = (encode(&mut carried, 2), encode(&mut sought, 2));

        assert_eq!(after.len(), alone.len());
        for (a, b) in after.iter().zip(&alone) {
            assert_eq!((a.data(), a.pts(), a.is_keyframe()), (b.data(), b.pts(), b.is_keyframe()));
        }
    }

    #[test]
    fn past_the_end_there_is_nothing() {
        let dir = mk_temp_dir("mediasim-transcode-").unwrap();
        let mut session = VideoEncode::open(&off_grid(dir.path()), LIBX264).unwrap();

        assert!(encode(&mut session, 5).is_empty());
        assert!(encode(&mut session, 40).is_empty());
        assert!(!encode(&mut session, 4).is_empty(), "the session can go back after the end");
    }

    #[test]
    fn a_set_cancel_flag_stops_before_the_next_frame() {
        let dir = mk_temp_dir("mediasim-transcode-").unwrap();
        let mut session = VideoEncode::open(&off_grid(dir.path()), LIBX264).unwrap();

        let result = session.encode(0, &AtomicBool::new(true));

        assert!(matches!(result, Err(EncodeError::Cancelled)));
        // Nothing was left half-done: the next request encodes the segment whole.
        assert_eq!(encode(&mut session, 0).len(), 60);
    }
}
