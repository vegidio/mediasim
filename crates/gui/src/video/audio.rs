//! A session's sound: the main audio stream, read by a reader of its own and handed over a segment's worth at a time,
//! either copied unchanged or encoded to AAC by one encoder that runs through the whole session.
//!
//! It has its own reader because the video's may not be read at all, when its segments come from the cache, or may
//! seek, when one doesn't. The sound is never cut per segment: AAC primes its encoder with about 1024 samples, which
//! at every 2-second boundary would be heard as a click.
//!
//! Every timestamp is on the file's own clock, the same as the video's, so the two line up when the muxer re-bases
//! them to the session's start.

use std::collections::VecDeque;
use std::time::Duration;

use media::codec::AudioEncoder;
use media::prelude::{
    AudioCodec, AudioFilter, AudioFilterChain, Bitrate, Channels, Decoder, Frame, MediaReader, MediaWriter, Packet,
    Rational, SampleRate, StreamKind,
};

use super::packets::{packet_ts, seconds};

/// The samples `FFmpeg`'s AAC encoder puts before the first one it was given: its `initial_padding`.
const AAC_PRIMING: i64 = 1024;

/// The encoded sound's bit rate.
const STEREO_BITRATE: Bitrate = Bitrate::kbps(160);
const MONO_BITRATE: Bitrate = Bitrate::kbps(96);

/// A session's sound, copied or encoded.
pub(crate) enum AudioSource {
    Copy(CopiedAudio),
    Encode(EncodedAudio),
}

impl AudioSource {
    /// The main audio stream of `path`, copied from `start` seconds on, or `None` when the file has no audio.
    ///
    /// # Errors
    ///
    /// The file can't be read.
    pub(crate) fn copy(path: &str, start: f64) -> media::Result<Option<Self>> {
        let Some((reader, index)) = open(path, start)? else { return Ok(None) };
        let time_base = reader.stream_time_base(index)?;

        Ok(Some(Self::Copy(CopiedAudio { reader, index, time_base, start, held: None, at_end: false })))
    }

    /// The main audio stream of `path`, encoded to AAC from `start` seconds on, or `None` when the file has no audio.
    ///
    /// # Errors
    ///
    /// The file can't be read, or its audio can't be decoded.
    pub(crate) fn encode(path: &str, start: f64) -> media::Result<Option<Self>> {
        let Some((mut reader, index)) = open(path, start)? else { return Ok(None) };
        let time_base = reader.stream_time_base(index)?;
        let decoder = reader.stream(index).decoder()?;

        let (rate, rate_hz) = match decoder.sample_rate() {
            44_100 => (SampleRate::Hz44100, 44_100),
            _ => (SampleRate::Hz48000, 48_000),
        };
        let (channels, layout, bitrate) = match decoder.channels() {
            Channels::Mono => (Channels::Mono, "mono", MONO_BITRATE),
            _ => (Channels::Stereo, "stereo", STEREO_BITRATE),
        };
        let encoder = AudioEncoder::builder()
            .codec(AudioCodec::Aac)
            .sample_rate(rate)
            .channels(channels)
            .bitrate(bitrate)
            .build()?;

        // The encoder's first packet is its priming, and the muxer places it at the session's start. So the sound fed
        // to it begins that much later, and plays in step with the picture from then on.
        #[expect(clippy::cast_precision_loss, reason = "1024 is exact")]
        let priming = AAC_PRIMING as f64 / f64::from(rate_hz);
        let trim = AudioFilter::new(
            &decoder,
            time_base,
            // Then into the encoder's own format, so every frame it gets is the same shape. A decoder may describe its
            // frames' channels differently from one frame to the next (WMA's unspecified stereo does), and the encoder's
            // resampler, set up from the first frame, refuses any frame that differs from it.
            &AudioFilterChain::raw(format!(
                "atrim=start={:.6},aresample={rate_hz},aformat=sample_fmts=fltp:sample_rates={rate_hz}:channel_layouts={layout}",
                start + priming
            )),
        )?;

        #[expect(clippy::cast_possible_truncation, reason = "a timestamp, far below 2^63")]
        let base = (start * f64::from(rate_hz)).round() as i64 + AAC_PRIMING;
        Ok(Some(Self::Encode(EncodedAudio {
            reader,
            index,
            decoder,
            trim,
            encoder,
            rate: i64::from(rate_hz),
            base,
            encoded: VecDeque::new(),
            at_end: false,
        })))
    }

    /// Adds the stream this sound is written as to `writer`, and returns its index there.
    ///
    /// # Errors
    ///
    /// Any error from `media-rs` adding the stream.
    pub(crate) fn add_to(&self, writer: &mut MediaWriter) -> media::Result<usize> {
        match self {
            Self::Copy(audio) => writer.add_stream_copy(&audio.reader, audio.index),
            Self::Encode(audio) => writer.add_stream_from_encoder(&audio.encoder),
        }
    }

    /// The packets that start before `until` seconds and haven't been handed over yet, in order. Each call carries
    /// on where the last stopped.
    ///
    /// # Errors
    ///
    /// Any error from `media-rs` reading, decoding or encoding the sound.
    pub(crate) fn until(&mut self, until: f64) -> media::Result<Vec<Packet>> {
        match self {
            Self::Copy(audio) => audio.until(until),
            Self::Encode(audio) => audio.until(until),
        }
    }
}

/// Opens `path` on its main audio stream, at the packet at or before `start` seconds. `None` when it has no audio.
fn open(path: &str, start: f64) -> media::Result<Option<(MediaReader, usize)>> {
    let mut reader = MediaReader::open(path)?;
    // The same choice as `probe_video`, so both mean the same stream by "main".
    let Ok(index) = reader.best_stream(StreamKind::Audio) else { return Ok(None) };
    if start > 0.0 {
        reader.seek(index, Duration::try_from_secs_f64(start).unwrap_or_default())?;
    }

    Ok(Some((reader, index)))
}

/// The main audio stream's own packets.
pub(crate) struct CopiedAudio {
    reader: MediaReader,
    index: usize,
    time_base: Rational,
    /// Packets that end at or before this, in seconds, belong before the session and are skipped.
    start: f64,
    /// A packet read past the last `until`, kept for the next call.
    held: Option<Packet>,
    at_end: bool,
}

impl CopiedAudio {
    fn until(&mut self, until: f64) -> media::Result<Vec<Packet>> {
        let mut packets = Vec::new();
        loop {
            let packet = match self.held.take() {
                Some(packet) => packet,
                None if self.at_end => return Ok(packets),
                None => match self.reader.packets().next().transpose()? {
                    Some(packet) if packet.stream_index() == self.index => packet,
                    Some(_) => continue,
                    None => {
                        self.at_end = true;
                        return Ok(packets);
                    }
                },
            };

            let ts = packet_ts(&packet);
            let (begins, ends) = (seconds(ts, self.time_base), seconds(ts + packet.duration(), self.time_base));
            // The packet holding the start is kept when most of it is after the start, so the sound lands within
            // half a packet of the picture.
            if f64::midpoint(begins, ends) < self.start {
                continue;
            }
            if begins >= until {
                self.held = Some(packet);
                return Ok(packets);
            }
            packets.push(packet);
        }
    }
}

/// The main audio stream, decoded, cut at the session's start, and encoded to AAC by one encoder.
pub(crate) struct EncodedAudio {
    reader: MediaReader,
    index: usize,
    decoder: Decoder,
    /// Drops what comes before the first sample to encode, to the sample.
    trim: AudioFilter,
    encoder: AudioEncoder,
    /// Samples per second, which is the encoder's time base.
    rate: i64,
    /// Where the encoder's sample 0 sits on the file's clock, in samples: the session's start plus the priming.
    base: i64,
    /// Encoded packets not handed over yet, already on the file's clock.
    encoded: VecDeque<Packet>,
    at_end: bool,
}

impl EncodedAudio {
    fn until(&mut self, until: f64) -> media::Result<Vec<Packet>> {
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_precision_loss,
            reason = "a sample rate and a timestamp"
        )]
        let until = (until * self.rate as f64).ceil() as i64;
        let mut packets = Vec::new();
        loop {
            while let Some(packet) = self.encoded.pop_front() {
                if packet.pts() >= until {
                    self.encoded.push_front(packet);
                    return Ok(packets);
                }
                packets.push(packet);
            }
            if self.at_end {
                return Ok(packets);
            }
            self.encode_more()?;
        }
    }

    /// Encodes the next packet of the stream, or flushes everything at its end.
    fn encode_more(&mut self) -> media::Result<()> {
        let mut encoded = Vec::new();
        // A decoded frame, timed by its best-effort timestamp, trimmed, and what is kept of it encoded.
        let mut encode = |frame: media::Result<Frame>| -> media::Result<()> {
            let mut frame = frame?;
            if let Some(pts) = frame.best_effort_timestamp() {
                frame.set_pts(pts);
            }
            for kept in self.trim.filter(frame)? {
                encoded.extend(self.encoder.encode(&kept)?);
            }
            Ok(())
        };

        match self.reader.packets().next().transpose()? {
            Some(packet) if packet.stream_index() == self.index => {
                for frame in self.decoder.decode(&packet)? {
                    encode(frame)?;
                }
            }
            Some(_) => return Ok(()),
            None => {
                self.at_end = true;
                for frame in self.decoder.flush()? {
                    encode(frame)?;
                }
                for kept in self.trim.flush()? {
                    encoded.extend(self.encoder.encode(&kept)?);
                }
                encoded.extend(self.encoder.flush()?);
            }
        }

        for mut packet in encoded {
            // The encoder counts from 0, its first packet being the priming at -1024: moved onto the file's clock, that
            // packet starts at the session's start.
            packet.offset_timestamps(-self.base);
            self.encoded.push_back(packet);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use media::prelude::SampleBuffer;
    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::admission::tests::fixture;

    /// `test4.mkv`: AV1 with 19.3 s of mono AAC at 44.1 kHz, timed in milliseconds as Matroska is.
    fn source() -> String {
        fixture("test4.mkv").to_str().unwrap().to_owned()
    }

    fn rate() -> f64 {
        44_100.0
    }

    /// Every sample of the main audio stream of `path`, mixed to mono, from its first packet on.
    fn mono(path: &str) -> Vec<f32> {
        let mut reader = MediaReader::open(path).unwrap();
        let index = reader.best_stream(StreamKind::Audio).unwrap();
        let mut decoder = reader.stream(index).decoder().unwrap();
        let mut samples = Vec::new();
        let mut take = |mut frame: Frame| {
            let SampleBuffer::Fltp(planes) = frame.samples_mut() else { panic!("not planar float") };
            #[expect(clippy::cast_precision_loss, reason = "two channels")]
            let channels = planes.len() as f32;
            samples.extend((0..planes[0].len()).map(|i| planes.iter().map(|plane| plane[i]).sum::<f32>() / channels));
        };
        for packet in reader.packets() {
            let packet = packet.unwrap();
            if packet.stream_index() == index {
                decoder.decode(&packet).unwrap().map(Result::unwrap).for_each(&mut take);
            }
        }
        decoder.flush().unwrap().map(Result::unwrap).for_each(&mut take);
        samples
    }

    /// `audio`'s packets until the end, written alone into fragmented MP4 at `path`, as a session writes them.
    fn write(audio: &mut AudioSource, path: &Path) {
        let mut writer = MediaWriter::builder().path(path.to_str().unwrap()).fragmented_mp4().build().unwrap();
        let stream = audio.add_to(&mut writer).unwrap();
        writer.write_header().unwrap();
        for mut packet in audio.until(f64::MAX).unwrap() {
            packet.set_stream_index(stream);
            writer.write_packet(&mut packet).unwrap();
        }
        writer.write_trailer().unwrap();
    }

    /// How many samples later than in `source` the sound of `session` plays, when `session`'s first sample is placed
    /// at `start` seconds of `source`: the lag between them that correlates best, within 50 ms.
    fn lag(session: &[f32], source: &[f32], start: f64) -> i64 {
        #[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a sample index")]
        let start = (start * rate()).round() as usize;
        let (window, from, reach) = (4_410, 22_050, 2_205_i64);
        (-reach..=reach)
            .max_by(|a, b| {
                let score = |lag: i64| -> f32 {
                    (0..window)
                        .map(|i| {
                            let at = start + from + i;
                            let at = usize::try_from(i64::try_from(at).unwrap() - lag).unwrap();
                            session[from + i] * source[at]
                        })
                        .sum()
                };
                score(*a).total_cmp(&score(*b))
            })
            .unwrap()
    }

    #[test]
    fn the_whole_sound_encoded_lasts_as_long_as_the_source() {
        let mut reader = MediaReader::open(source()).unwrap();
        let index = reader.best_stream(StreamKind::Audio).unwrap();
        let time_base = reader.stream_time_base(index).unwrap().as_f64();
        let packets: Vec<Packet> = reader.packets().map(Result::unwrap).filter(|p| p.stream_index() == index).collect();
        // From the first packet's start to the last one's end rather than the sum of their durations: each of those is
        // rounded to a whole millisecond, which over the whole sound adds up to far more than a packet.
        let (first, last) = (&packets[0], packets.last().unwrap());
        #[expect(clippy::cast_possible_truncation, clippy::cast_precision_loss, reason = "a small timestamp")]
        let source_samples = ((last.pts() + last.duration() - first.pts()) as f64 * time_base * rate()).round() as i64;
        let mut audio = AudioSource::encode(&source(), 0.0).unwrap().unwrap();

        let packets = audio.until(f64::MAX).unwrap();

        let encoded: i64 = packets.iter().map(Packet::duration).sum();
        assert!((encoded - source_samples).abs() <= AAC_PRIMING, "{encoded} samples encoded of {source_samples}");
        assert!(audio.until(f64::MAX).unwrap().is_empty());
    }

    #[test]
    fn from_a_later_start_the_first_packet_is_at_the_start() {
        let mut audio = AudioSource::encode(&source(), 4.0).unwrap().unwrap();

        let packets = audio.until(6.0).unwrap();

        #[expect(clippy::cast_precision_loss, reason = "a small timestamp")]
        let first = packets[0].pts() as f64 / rate();
        assert!((first - 4.0).abs() < 0.025, "the first packet is at {first} s");
        #[expect(clippy::cast_precision_loss, reason = "a small timestamp")]
        let last = packets.last().unwrap().pts() as f64 / rate();
        assert!(last < 6.0 && last > 5.9, "the last packet is at {last} s");
    }

    #[test]
    fn from_a_later_start_the_sound_plays_in_step_with_the_source() {
        // The spike's rule, measured the way the spike measured it: a player that plays the AAC priming hears the
        // session's sound exactly where the source has it.
        let dir = mk_temp_dir("mediasim-audio-").unwrap();
        let path = dir.path().join("session.mp4");
        let mut audio = AudioSource::encode(&source(), 4.0).unwrap().unwrap();
        write(&mut audio, &path);

        let lag = lag(&mono(path.to_str().unwrap()), &mono(&source()), 4.0);

        assert!(lag.abs() <= 2, "the sound plays {lag} samples late");
    }

    #[test]
    fn copying_yields_the_source_packets_up_to_the_time_asked_and_no_further() {
        let mut reader = MediaReader::open(source()).unwrap();
        let index = reader.best_stream(StreamKind::Audio).unwrap();
        let time_base = reader.stream_time_base(index).unwrap().as_f64();
        let source: Vec<(i64, Vec<u8>)> = reader
            .packets()
            .map(Result::unwrap)
            .filter(|packet| packet.stream_index() == index)
            .map(|packet| (packet.pts(), packet.data().to_vec()))
            .collect();
        #[expect(clippy::cast_possible_truncation, reason = "a small timestamp")]
        let until = (5.0 / time_base).round() as i64;
        let mut audio = AudioSource::copy(&super::tests::source(), 0.0).unwrap().unwrap();

        let first: Vec<(i64, Vec<u8>)> =
            audio.until(5.0).unwrap().iter().map(|packet| (packet.pts(), packet.data().to_vec())).collect();
        let rest = audio.until(f64::MAX).unwrap();

        // The source opens with its encoder's priming, a packet of 1024 samples placed before 0, at -23 ms. Copied, it
        // would be placed at the session's start and play the sound a packet late, so it is left out like anything
        // else mostly before the start.
        assert_eq!(source[0].0, -23);
        let expected: Vec<_> = source[1..].iter().filter(|(pts, _)| *pts < until).cloned().collect();
        assert_eq!(first, expected);
        assert_eq!(1 + first.len() + rest.len(), source.len());
        assert_eq!(rest[0].pts(), source[1 + first.len()].0);
    }

    #[test]
    fn a_video_without_sound_has_no_audio_source() {
        let path = fixture("test3.mkv");

        assert!(AudioSource::copy(path.to_str().unwrap(), 0.0).unwrap().is_none());
        assert!(AudioSource::encode(path.to_str().unwrap(), 0.0).unwrap().is_none());
    }
}
