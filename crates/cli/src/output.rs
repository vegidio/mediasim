//! Text printed outside the progress display: the score, the header, the reports and the error line.

use std::ffi::OsStr;
use std::fmt::Display;
use std::io::IsTerminal;

use mediasim::{Media, MediaType};
use ratatui::crossterm::style::{Color, Stylize};

pub const GRAY: (u8, u8, u8) = (0x68, 0x68, 0x68);
pub const GREEN: (u8, u8, u8) = (0x00, 0xc2, 0x02);
pub const MAGENTA: (u8, u8, u8) = (0xc7, 0x92, 0xe9);
pub const RED: (u8, u8, u8) = (0xf4, 0x43, 0x36);
pub const YELLOW: (u8, u8, u8) = (0xe5, 0xdb, 0x08);

/// Formats a score with 5 decimal places, then trims trailing zeros and a trailing `.`: `0.5`, `0.95513`, `1`.
pub fn format_score(score: f64) -> String {
    let fixed = format!("{score:.5}");
    fixed.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// Whether a stream may be coloured: it must be a terminal, and `NO_COLOR` must be unset or empty.
pub fn use_color(is_terminal: bool, no_color: Option<&OsStr>) -> bool {
    is_terminal && no_color.is_none_or(OsStr::is_empty)
}

pub fn stdout_color() -> bool {
    use_color(std::io::stdout().is_terminal(), std::env::var_os("NO_COLOR").as_deref())
}

pub fn stderr_color() -> bool {
    use_color(std::io::stderr().is_terminal(), std::env::var_os("NO_COLOR").as_deref())
}

/// `⏳ Calculating similarity in <files> files`, with the count in green.
pub fn header(files: usize, color: bool) -> String {
    format!("⏳ Calculating similarity in {} files", paint(files, GREEN, color))
}

/// `🧮 Similarity score between the files is <score>`, with the score in magenta.
pub fn report(score: &str, color: bool) -> String {
    format!("🧮 Similarity score between the files is {}", paint(score, MAGENTA, color))
}

/// `🔎 Grouping media with at least <threshold> similarity threshold...`, with the threshold formatted like a score
/// and in yellow.
pub fn threshold(threshold: f64, color: bool) -> String {
    format!(
        "🔎 Grouping media with at least {} similarity threshold...",
        paint(format_score(threshold), YELLOW, color)
    )
}

/// `(X.X MP)` for an image, or `(N sec, X.X MP)` for a video, with the duration in whole seconds.
pub fn media_info(media: &Media) -> String {
    #[allow(clippy::cast_precision_loss)]
    let megapixels = (u64::from(media.width) * u64::from(media.height)) as f64 / 1_000_000.0;

    match media.media_type {
        MediaType::Image => format!("({megapixels:.1} MP)"),
        MediaType::Video => {
            format!("({} sec, {megapixels:.1} MP)", media.duration.unwrap_or_default().as_secs())
        }
    }
}

/// Each group as a blank line, `Group <N>:` with N in magenta, and one `  -> <path> <info>` line per media, the
/// first (best) one in bold.
pub fn groups(groups: &[Vec<Media>], color: bool) -> String {
    let mut lines = Vec::new();

    for (n, group) in groups.iter().enumerate() {
        lines.push(String::new());
        lines.push(format!("Group {}:", paint(n + 1, MAGENTA, color)));
        for (i, media) in group.iter().enumerate() {
            let entry = format!("{} {}", media.path.display(), media_info(media));
            lines.push(format!("  -> {}", if i == 0 { bold(entry, color) } else { entry }));
        }
    }

    lines.join("\n")
}

/// `✅ No similar media found`.
pub fn no_matches() -> &'static str {
    "✅ No similar media found"
}

/// The grouped paths alone: one per line, with an empty line between groups, and nothing when there are no groups.
pub fn plain_groups(groups: &[Vec<Media>]) -> String {
    groups
        .iter()
        .map(|group| group.iter().map(|media| media.path.display().to_string()).collect::<Vec<_>>().join("\n"))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// `🧨 <message>`, with the message in red.
pub fn error(message: impl Display, color: bool) -> String {
    format!("🧨 {}", paint(message, RED, color))
}

fn paint(text: impl Display, (r, g, b): (u8, u8, u8), color: bool) -> String {
    if color { text.to_string().with(Color::Rgb { r, g, b }).to_string() } else { text.to_string() }
}

fn bold(text: impl Display, color: bool) -> String {
    if color { text.to_string().bold().to_string() } else { text.to_string() }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::time::Duration;

    use super::*;

    /// A loaded fixture image with its path, size and type replaced, since `Media` cannot be built from parts outside
    /// `mediasim`.
    fn media(path: &str, width: u32, height: u32, seconds: Option<u64>) -> Media {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/test1.png");
        let mut media = Media::from_file(fixture).unwrap();
        media.path = path.into();
        (media.width, media.height) = (width, height);
        media.duration = seconds.map(Duration::from_secs);
        media.media_type = if seconds.is_some() { MediaType::Video } else { MediaType::Image };
        media
    }

    fn two_groups() -> Vec<Vec<Media>> {
        vec![
            vec![media("a", 2000, 2650, None), media("b", 1000, 1000, None)],
            vec![media("c", 1280, 720, Some(12)), media("d", 640, 360, Some(5))],
        ]
    }

    #[test]
    fn score_keeps_five_decimals() {
        assert_eq!(format_score(0.955_131), "0.95513");
    }

    #[test]
    fn score_trims_trailing_zeros() {
        assert_eq!(format_score(0.5), "0.5");
    }

    #[test]
    fn score_drops_the_point_on_whole_numbers() {
        assert_eq!(format_score(1.0), "1");
        assert_eq!(format_score(0.0), "0");
    }

    #[test]
    fn score_rounding_to_a_whole_number() {
        assert_eq!(format_score(0.000_001), "0");
        assert_eq!(format_score(0.999_996), "1");
    }

    #[test]
    fn threshold_is_formatted_like_a_score() {
        assert_eq!(threshold(0.8, false), "🔎 Grouping media with at least 0.8 similarity threshold...");
        assert_eq!(threshold(1.0, false), "🔎 Grouping media with at least 1 similarity threshold...");
    }

    #[test]
    fn image_info_is_megapixels() {
        assert_eq!(media_info(&media("a.png", 2000, 2650, None)), "(5.3 MP)");
    }

    #[test]
    fn video_info_is_seconds_and_megapixels() {
        assert_eq!(media_info(&media("a.mp4", 1280, 720, Some(12))), "(12 sec, 0.9 MP)");
    }

    #[test]
    fn group_report_lists_each_group() {
        assert_eq!(
            groups(&two_groups(), false),
            "\nGroup 1:\n  -> a (5.3 MP)\n  -> b (1.0 MP)\n\nGroup 2:\n  -> c (12 sec, 0.9 MP)\n  -> d (5 sec, 0.2 MP)"
        );
    }

    #[test]
    fn group_report_bolds_only_the_best_line() {
        let report = groups(&two_groups(), true);
        let lines: Vec<_> = report.lines().collect();

        assert!(lines[1].contains(&paint(1, MAGENTA, true)), "{report:?}");
        assert!(lines[2].contains(&bold("a (5.3 MP)", true)), "{report:?}");
        assert_eq!(lines[3], "  -> b (1.0 MP)");
    }

    #[test]
    fn plain_groups_are_bare_paths() {
        assert_eq!(plain_groups(&two_groups()), "a\nb\n\nc\nd");
        assert_eq!(plain_groups(&[]), "");
    }

    #[test]
    fn color_needs_a_terminal() {
        assert!(!use_color(false, None));
        assert!(use_color(true, None));
    }

    #[test]
    fn color_is_disabled_by_a_non_empty_no_color() {
        assert!(!use_color(true, Some(OsStr::new("1"))));
        assert!(use_color(true, Some(OsStr::new(""))));
    }

    #[test]
    fn lines_without_color_have_no_escapes() {
        for line in [
            header(2, false),
            report("0.5", false),
            error("boom", false),
            threshold(0.8, false),
            groups(&two_groups(), false),
        ] {
            assert!(!line.contains('\x1b'), "{line:?}");
        }
    }

    #[test]
    fn lines_with_color_are_styled() {
        for line in [header(2, true), report("0.5", true), error("boom", true), threshold(0.8, true)] {
            assert!(line.contains('\x1b'), "{line:?}");
        }
    }

    #[test]
    fn lines_carry_their_values() {
        assert_eq!(header(2, false), "⏳ Calculating similarity in 2 files");
        assert_eq!(report("0.5", false), "🧮 Similarity score between the files is 0.5");
        assert_eq!(error("boom", false), "🧨 boom");
    }
}
