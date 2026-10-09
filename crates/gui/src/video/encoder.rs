//! Which H.264 encoder transcode sessions use: the first of the platform's hardware encoders that passes a test
//! encode, or `libx264`, which is always last.
//!
//! A candidate passes only if it keeps the rules a session's segments rely on: one keyframe, its first frame, despite a
//! scene cut; no reordered frames; and the same init segment from every fresh encoder, since a session writes one init
//! segment and then segments from many encoders. The test runs once, on the first [`Encoders::current`], which `setup`
//! calls on a thread at launch. A candidate that later fails a segment is dropped for the rest of the run with
//! [`Encoders::retire`].

use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};

use media::codec::VideoEncoder;
use media::prelude::{Framerate, H264Preset, MediaWriter, PixelFormat, Rational};

use super::session::writer;
use super::transcode::EncoderSettings;

/// One encoder to try, with what it needs to keep the segment rules. Every candidate also gets the grid's settings,
/// the High profile and `bf=0` (see [`EncoderSettings::encoder`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Candidate {
    /// The `FFmpeg` encoder's name.
    pub(crate) name: &'static str,
    /// What the filter chain converts frames to for it.
    pub(crate) pixel_format: PixelFormat,
    /// `media-rs`'s typed preset, for the one encoder that has it.
    pub(crate) preset: Option<H264Preset>,
    /// Its own options, by `FFmpeg`'s names.
    pub(crate) options: &'static [(&'static str, &'static str)],
    /// Bits per encoded pixel per frame, for the bitrate.
    pub(crate) bits_per_pixel: f64,
    /// For tests: the segment from which encoding fails, as a driver that fails mid-run would.
    #[cfg(test)]
    pub(crate) fails_from: Option<u64>,
}

impl Candidate {
    /// The pixel format's name, as the filter chain's `format` filter takes it.
    pub(crate) fn format(&self) -> &'static str {
        match self.pixel_format {
            PixelFormat::Nv12 => "nv12",
            _ => "yuv420p",
        }
    }

    /// `true` for [`LIBX264`], the last resort, which is never tested or retired.
    fn is_software(&self) -> bool {
        *self == LIBX264
    }
}

/// A hardware encoder: it takes `nv12`, and needs no typed preset.
const fn hardware(name: &'static str, options: &'static [(&'static str, &'static str)]) -> Candidate {
    Candidate {
        name,
        pixel_format: PixelFormat::Nv12,
        preset: None,
        options,
        // The spike measured VideoToolbox above 43 dB PSNR at 0.1, as `libx264` is.
        bits_per_pixel: 0.1,
        #[cfg(test)]
        fails_from: None,
    }
}

/// Apple's media engine. `allow_sw=0` keeps it to hardware, so a Mac without one falls through to `libx264`;
/// `realtime=1` stops it adding keyframes of its own when several sessions encode at once, which the spike found.
const VIDEOTOOLBOX: Candidate =
    hardware("h264_videotoolbox", &[("allow_sw", "0"), ("prio_speed", "1"), ("realtime", "1")]);
/// NVIDIA. Without look-ahead, there is no scene-cut keyframe.
const NVENC: Candidate = hardware("h264_nvenc", &[("preset", "p4"), ("no-scenecut", "1"), ("rc-lookahead", "0")]);
/// AMD.
const AMF: Candidate = hardware("h264_amf", &[("usage", "transcoding"), ("quality", "speed")]);
/// Intel Quick Sync.
const QSV: Candidate = hardware("h264_qsv", &[("preset", "veryfast"), ("adaptive_i", "0"), ("adaptive_b", "0")]);

/// The CPU encoder, in every build. The spike's preset from slice 5, and no scene-cut keyframes.
pub(crate) const LIBX264: Candidate = Candidate {
    name: "libx264",
    pixel_format: PixelFormat::Yuv420p,
    preset: Some(H264Preset::Veryfast),
    options: &[("sc_threshold", "0")],
    bits_per_pixel: 0.1,
    #[cfg(test)]
    fails_from: None,
};

/// The platform's hardware encoders, best first: a discrete GPU's before the integrated one. One missing from the
/// platform's `FFmpeg` build fails its test and is skipped.
const HARDWARE: &[Candidate] = if cfg!(target_os = "macos") { &[VIDEOTOOLBOX] } else { &[NVENC, AMF, QSV] };

/// The test clip's shape: above every hardware encoder's minimum size, and short enough to cost milliseconds.
const TEST_SIZE: (u32, u32) = (640, 360);
const TEST_FRAMES: u32 = 24;
/// Above the clip's length, so the only keyframe a candidate may place is the first.
const TEST_GOP: u32 = 121;

/// The init segment a video-only fragmented-MP4 file gets for `encoder`.
pub(crate) fn init_segment(encoder: &VideoEncoder) -> media::Result<Vec<u8>> {
    let (mut writer, sink): (MediaWriter, _) = writer()?;
    writer.add_stream_from_encoder(encoder)?;
    writer.write_header()?;
    writer.flush()?;
    Ok(sink.take())
}

/// Whether `candidate` keeps the segment rules on this machine, and if not, why.
fn check(candidate: Candidate) -> Result<(), String> {
    let mut settings = EncoderSettings::new(candidate, TEST_SIZE, Framerate::fps(30), Rational::new(1, 30));
    settings.gop = TEST_GOP;

    let packets = settings.builder().probe(TEST_FRAMES).map_err(|err| err.to_string())?;
    let keyframes: Vec<usize> = packets.iter().enumerate().filter(|(_, p)| p.is_keyframe()).map(|(n, _)| n).collect();
    if keyframes != [0] {
        return Err(format!("keyframes at frames {keyframes:?} of the test clip, not only the first"));
    }
    if packets.iter().any(|packet| packet.dts() != packet.pts()) {
        return Err("it reorders frames".to_owned());
    }

    let init = || settings.encoder().and_then(|encoder| init_segment(&encoder)).map_err(|err| err.to_string());
    if init()? != init()? {
        return Err("two encoders gave different init segments".to_owned());
    }
    Ok(())
}

/// The index of the first of `candidates` from `from` on that passes its [test](check), or of [`LIBX264`], which
/// passes untested. Says on stderr why each one before it wasn't used.
fn first_passing(candidates: &[Candidate], from: usize, #[cfg(test)] tests: &std::sync::atomic::AtomicUsize) -> usize {
    for (index, candidate) in candidates.iter().enumerate().skip(from) {
        if candidate.is_software() {
            return index;
        }
        #[cfg(test)]
        tests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        match check(*candidate) {
            Ok(()) => return index,
            Err(reason) => eprintln!("video encoder {}: not used: {reason}", candidate.name),
        }
    }
    // `Encoders` always ends its list with `libx264`, so this is only reached from past its end.
    candidates.len() - 1
}

/// The encoder transcode sessions use, as Tauri managed state.
pub struct Encoders {
    /// The candidates in order, ending with [`LIBX264`].
    candidates: Vec<Candidate>,
    /// The index of the one in use, set by the test on first use.
    current: OnceLock<Mutex<usize>>,
    /// How many candidates have been tested, for the tests.
    #[cfg(test)]
    tests: std::sync::atomic::AtomicUsize,
}

impl Default for Encoders {
    fn default() -> Self {
        Self::with(HARDWARE)
    }
}

impl Encoders {
    /// `hardware`, in order, then [`LIBX264`].
    pub(crate) fn with(hardware: &[Candidate]) -> Self {
        Self {
            candidates: hardware.iter().copied().chain([LIBX264]).collect(),
            current: OnceLock::new(),
            #[cfg(test)]
            tests: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    fn first_passing(&self, from: usize) -> usize {
        first_passing(
            &self.candidates,
            from,
            #[cfg(test)]
            &self.tests,
        )
    }

    /// The index in use, choosing it first if no one has; a caller that comes while it is being chosen waits.
    fn index(&self) -> MutexGuard<'_, usize> {
        // An index is only ever replaced whole, so a poisoned lock still holds a sound one.
        self.current
            .get_or_init(|| Mutex::new(self.first_passing(0)))
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// The encoder for a session opened now. The first call tests the candidates; one made while that runs waits for it.
    pub(crate) fn current(&self) -> Candidate {
        self.candidates[*self.index()]
    }

    /// Stops using `failed`, which failed while encoding a segment, for the rest of the run: later sessions get the next
    /// candidate that passes, tested now if it hasn't been. Does nothing for [`LIBX264`], or for an encoder already
    /// replaced.
    pub(crate) fn retire(&self, failed: &Candidate) {
        if failed.is_software() {
            return;
        }
        let mut index = self.index();
        if self.candidates[*index] == *failed {
            eprintln!("video encoder {}: failed while encoding, so no longer used", failed.name);
            *index = self.first_passing(*index + 1);
        }
    }

    /// How many candidates have been tested.
    #[cfg(test)]
    pub(crate) fn tests(&self) -> usize {
        self.tests.load(std::sync::atomic::Ordering::Relaxed)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::{Arc, Barrier};

    use super::*;

    /// A missing encoder.
    const MISSING: Candidate = hardware("no_such_encoder", &[]);
    /// `libx264` standing in for a hardware encoder that keeps the rules. Its level makes its init segment its own.
    pub(crate) const GOOD: Candidate = Candidate { options: &[("sc_threshold", "0"), ("level", "41")], ..LIBX264 };
    /// Another, with an init segment of its own again.
    const GOOD_TOO: Candidate = Candidate { options: &[("sc_threshold", "0"), ("level", "40")], ..LIBX264 };
    /// One that places a keyframe at a scene cut.
    const SCENE_CUTS: Candidate = Candidate { options: &[], ..LIBX264 };
    /// One that reorders frames.
    const B_FRAMES: Candidate = Candidate { options: &[("sc_threshold", "0"), ("bf", "3")], ..LIBX264 };
    /// One with an option it doesn't have.
    const UNKNOWN_OPTION: Candidate =
        Candidate { options: &[("sc_threshold", "0"), ("no_such_option", "1")], ..LIBX264 };

    #[test]
    fn the_stand_ins_pass_and_libx264_is_last_everywhere() {
        assert!(check(GOOD).is_ok());
        assert!(check(GOOD_TOO).is_ok());
        assert_eq!(Encoders::default().candidates.last(), Some(&LIBX264));
    }

    #[test]
    fn a_missing_encoder_is_skipped() {
        assert!(check(MISSING).unwrap_err().contains("no_such_encoder"));
        assert_eq!(Encoders::with(&[MISSING, GOOD]).current(), GOOD);
    }

    #[test]
    fn an_encoder_that_adds_a_keyframe_at_a_scene_cut_is_rejected() {
        assert!(check(SCENE_CUTS).unwrap_err().contains("keyframes at frames [0, 12]"));
    }

    #[test]
    fn an_encoder_that_reorders_frames_is_rejected() {
        assert_eq!(check(B_FRAMES).unwrap_err(), "it reorders frames");
    }

    #[test]
    fn an_encoder_without_one_of_its_options_is_rejected() {
        assert!(check(UNKNOWN_OPTION).unwrap_err().contains("no_such_option"));
    }

    #[test]
    fn with_no_hardware_encoder_that_works_libx264_is_chosen() {
        let encoders = Encoders::with(&[MISSING]);

        assert_eq!(encoders.current(), LIBX264);
        assert_eq!(encoders.tests(), 1, "libx264 itself is never tested");
    }

    #[test]
    fn the_first_that_passes_is_chosen_and_the_rest_are_not_tested() {
        let encoders = Encoders::with(&[SCENE_CUTS, B_FRAMES, GOOD, GOOD_TOO]);

        assert_eq!(encoders.current(), GOOD);
        assert_eq!(encoders.tests(), 3);
    }

    #[test]
    fn callers_while_the_test_runs_wait_for_it_and_it_runs_once() {
        let encoders = Arc::new(Encoders::with(&[SCENE_CUTS, B_FRAMES, GOOD]));
        let start = Arc::new(Barrier::new(4));

        let answers: Vec<Candidate> = (0..4)
            .map(|_| {
                let (encoders, start) = (Arc::clone(&encoders), Arc::clone(&start));
                std::thread::spawn(move || {
                    start.wait();
                    encoders.current()
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();

        assert_eq!(answers, [GOOD; 4]);
        assert_eq!(encoders.tests(), 3);
    }

    #[test]
    fn after_a_retire_the_next_that_passes_is_current_tested_then() {
        let encoders = Encoders::with(&[GOOD, SCENE_CUTS, GOOD_TOO]);
        assert_eq!(encoders.current(), GOOD);
        assert_eq!(encoders.tests(), 1);

        encoders.retire(&GOOD);

        assert_eq!(encoders.current(), GOOD_TOO);
        assert_eq!(encoders.tests(), 3);
        encoders.retire(&GOOD_TOO);
        assert_eq!(encoders.current(), LIBX264);
    }

    #[test]
    fn retiring_an_encoder_already_replaced_does_nothing() {
        let encoders = Encoders::with(&[GOOD, GOOD_TOO]);
        encoders.retire(&GOOD);

        encoders.retire(&GOOD);

        assert_eq!(encoders.current(), GOOD_TOO);
    }

    #[test]
    fn libx264_is_never_retired() {
        let encoders = Encoders::with(&[]);

        encoders.retire(&LIBX264);

        assert_eq!(encoders.current(), LIBX264);
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs a Mac with a media engine; a CI virtual machine may have none"]
    fn a_mac_chooses_videotoolbox() {
        assert_eq!(Encoders::default().current(), VIDEOTOOLBOX);
    }
}
