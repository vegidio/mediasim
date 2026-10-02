//! Text printed outside the progress display: the score, the header, the report and the error line.

use std::ffi::OsStr;
use std::fmt::Display;
use std::io::IsTerminal;

use ratatui::crossterm::style::{Color, Stylize};

pub const GRAY: (u8, u8, u8) = (0x68, 0x68, 0x68);
pub const GREEN: (u8, u8, u8) = (0x00, 0xc2, 0x02);
pub const MAGENTA: (u8, u8, u8) = (0xc7, 0x92, 0xe9);
pub const RED: (u8, u8, u8) = (0xf4, 0x43, 0x36);

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

/// `🧨 <message>`, with the message in red.
pub fn error(message: impl Display, color: bool) -> String {
    format!("🧨 {}", paint(message, RED, color))
}

fn paint(text: impl Display, (r, g, b): (u8, u8, u8), color: bool) -> String {
    if color { text.to_string().with(Color::Rgb { r, g, b }).to_string() } else { text.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        for line in [header(2, false), report("0.5", false), error("boom", false)] {
            assert!(!line.contains('\x1b'), "{line:?}");
        }
    }

    #[test]
    fn lines_with_color_are_styled() {
        for line in [header(2, true), report("0.5", true), error("boom", true)] {
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
