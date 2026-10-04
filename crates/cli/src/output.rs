//! Text printed outside the progress display: the score, the header, the reports and the error line.

use std::ffi::OsStr;
use std::fmt::Display;
use std::io::IsTerminal;
use std::iter::once;
use std::path::Path;

use mediasim::{Media, MediaError, MediaType};
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

/// Whether `stream` may be coloured, per [`use_color`] and the process's `NO_COLOR`.
pub fn color_for(stream: &impl IsTerminal) -> bool {
    use_color(stream.is_terminal(), std::env::var_os("NO_COLOR").as_deref())
}

/// `⏳ Calculating similarity in <files> files`, with the count in green.
pub fn header(files: usize, color: bool) -> String {
    format!("⏳ Calculating similarity in {} files", paint(files, GREEN, color))
}

/// `⏳ Calculating similarity in the directory <dir>`, with the directory in green.
pub fn dir_header(dir: &Path, color: bool) -> String {
    format!("⏳ Calculating similarity in the directory {}", paint(dir.display(), GREEN, color))
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
    let megapixels = media.pixels() as f64 / 1_000_000.0;

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

pub const NO_MATCHES: &str = "✅ No similar media found";

/// The grouped paths alone: one per line, with an empty line between groups, and nothing when there are no groups.
pub fn plain_groups(groups: &[Vec<Media>]) -> String {
    groups
        .iter()
        .map(|group| group.iter().map(|media| media.path.display().to_string()).collect::<Vec<_>>().join("\n"))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// `⚠️ <N> files could not be loaded` (`file` when N is 1), then one `  -> <message>` line per error, all in yellow.
pub fn skipped(errors: &[MediaError], color: bool) -> String {
    let noun = if errors.len() == 1 { "file" } else { "files" };
    let header = format!("⚠️ {} {noun} could not be loaded", errors.len());

    once(header)
        .chain(errors.iter().map(|err| format!("  -> {err}")))
        .map(|line| paint(line, YELLOW, color))
        .collect::<Vec<_>>()
        .join("\n")
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
    use super::*;
    use crate::test_support::media;

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

    fn unsupported(path: &str) -> MediaError {
        MediaError::Unsupported { path: path.into() }
    }

    #[test]
    fn skipped_report_for_one_file() {
        assert_eq!(
            skipped(&[unsupported("a.txt")], false),
            "⚠️ 1 file could not be loaded\n  -> unsupported file a.txt"
        );
    }

    #[test]
    fn skipped_report_for_several_files() {
        assert_eq!(
            skipped(&[unsupported("a.txt"), unsupported("b.txt")], false),
            "⚠️ 2 files could not be loaded\n  -> unsupported file a.txt\n  -> unsupported file b.txt"
        );
    }

    #[test]
    fn skipped_report_colours_every_line_in_yellow() {
        let errors = [unsupported("a.txt"), unsupported("b.txt")];
        let plain = skipped(&errors, false);
        let report = skipped(&errors, true);

        assert!(!plain.contains('\x1b'), "{plain:?}");
        assert_eq!(report.lines().count(), 3, "{report:?}");
        for (line, text) in report.lines().zip(plain.lines()) {
            assert_eq!(line, paint(text, YELLOW, true));
        }
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
            dir_header(Path::new("photos"), false),
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
        for line in [
            header(2, true),
            dir_header(Path::new("photos"), true),
            report("0.5", true),
            error("boom", true),
            threshold(0.8, true),
        ] {
            assert!(line.contains('\x1b'), "{line:?}");
        }
    }

    #[test]
    fn lines_carry_their_values() {
        assert_eq!(header(2, false), "⏳ Calculating similarity in 2 files");
        assert_eq!(dir_header(Path::new("photos"), false), "⏳ Calculating similarity in the directory photos");
        assert_eq!(report("0.5", false), "🧮 Similarity score between the files is 0.5");
        assert_eq!(error("boom", false), "🧨 boom");
    }
}
