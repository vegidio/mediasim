//! Which bytes of a file a `Range` header is answered with.

use tauri::http::HeaderValue;

use crate::thumbs::digits_only;

/// The most bytes one answer carries, from the range's start: 4 MiB. The player asks again for the rest.
pub(super) const CAP: u64 = 4 * 1024 * 1024;

/// How a request's range is answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Answer {
    /// Bytes `start..=end` of the file, both inclusive.
    Partial { start: u64, end: u64 },
    /// The range starts at or past the end of the file.
    Unsatisfiable,
}

/// How `header` is answered for a file of `size` bytes.
///
/// A missing or unreadable header is read as `bytes=0-`, and only the first of several ranges is answered. The answer
/// never runs past the file's last byte, nor carries more than [`CAP`] bytes.
pub(super) fn answer(header: Option<&HeaderValue>, size: u64) -> Answer {
    let (start, last) = match header.and_then(first_range) {
        Some(Asked::From { first, last }) => (first, last.unwrap_or(u64::MAX)),
        // RFC 9110: a suffix of zero bytes can't be satisfied.
        Some(Asked::Suffix { count: 0 }) => return Answer::Unsatisfiable,
        Some(Asked::Suffix { count }) => (size.saturating_sub(count), u64::MAX),
        None => (0, u64::MAX),
    };

    if start >= size {
        return Answer::Unsatisfiable;
    }

    let end = last.min(size - 1).min(start + CAP - 1);

    Answer::Partial { start, end }
}

/// A range as the header spelled it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Asked {
    /// `bytes=<first>-<last>`, or `bytes=<first>-` when `last` is `None`.
    From { first: u64, last: Option<u64> },
    /// `bytes=-<count>`: the file's last `count` bytes.
    Suffix { count: u64 },
}

/// The first range in `header`, or `None` if it can't be read.
fn first_range(header: &HeaderValue) -> Option<Asked> {
    let header = header.to_str().ok()?.trim();
    let (unit, ranges) = header.split_once('=')?;
    if !unit.trim().eq_ignore_ascii_case("bytes") {
        return None;
    }

    let range = ranges.split(',').next()?.trim();
    let (first, last) = range.split_once('-')?;
    let (first, last) = (first.trim(), last.trim());

    match (first.is_empty(), last.is_empty()) {
        (true, true) => None,
        (true, false) => Some(Asked::Suffix { count: number(last)? }),
        (false, true) => Some(Asked::From { first: number(first)?, last: None }),
        (false, false) => {
            let (first, last) = (number(first)?, number(last)?);
            // RFC 9110: a range whose last byte comes before its first is invalid, and the header is ignored.
            (first <= last).then_some(Asked::From { first, last: Some(last) })
        }
    }
}

/// `digits` as a number, if it is only ASCII digits; see [`digits_only`].
fn number(digits: &str) -> Option<u64> {
    if digits_only(digits) { digits.parse().ok() } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answering(header: &str, size: u64) -> Answer {
        answer(Some(&HeaderValue::from_str(header).unwrap()), size)
    }

    fn partial(start: u64, end: u64) -> Answer {
        Answer::Partial { start, end }
    }

    #[test]
    fn a_closed_range_is_answered_as_asked() {
        assert_eq!(answering("bytes=100-199", 10_000_000), partial(100, 199));
        assert_eq!(answering("bytes=0-0", 10), partial(0, 0));
    }

    #[test]
    fn an_open_range_runs_towards_the_end() {
        assert_eq!(answering("bytes=500-", 1_000), partial(500, 999));
    }

    #[test]
    fn a_suffix_range_is_the_last_bytes() {
        assert_eq!(answering("bytes=-500", 10_000_000), partial(9_999_500, 9_999_999));
    }

    #[test]
    fn a_suffix_longer_than_the_file_is_the_whole_file() {
        assert_eq!(answering("bytes=-5000", 1_000), partial(0, 999));
    }

    #[test]
    fn the_end_is_clamped_to_the_last_byte() {
        assert_eq!(answering("bytes=900-5000", 1_000), partial(900, 999));
    }

    #[test]
    fn an_answer_carries_at_most_four_mebibytes_from_its_start() {
        assert_eq!(answering("bytes=0-", 1_000_000_000), partial(0, 4_194_303));
        assert_eq!(answering("bytes=10-999999999", 1_000_000_000), partial(10, 10 + CAP - 1));
        assert_eq!(answering("bytes=-100000000", 1_000_000_000), partial(900_000_000, 900_000_000 + CAP - 1));
    }

    #[test]
    fn a_missing_or_unreadable_header_is_read_as_from_the_start() {
        assert_eq!(answer(None, 1_000), partial(0, 999));

        for header in [
            "",
            "bytes",
            "bytes=",
            "bytes=-",
            "bytes=abc-",
            "bytes=+5-",
            "bytes=5-+9",
            "bytes=1.5-",
            "bytes=200-100",
            "items=0-5",
            "bytes=99999999999999999999999-",
        ] {
            assert_eq!(answering(header, 1_000), partial(0, 999), "{header:?}");
        }

        assert_eq!(answer(Some(&HeaderValue::from_bytes(b"bytes=\xff-").unwrap()), 1_000), partial(0, 999));
    }

    #[test]
    fn only_the_first_of_several_ranges_is_answered() {
        assert_eq!(answering("bytes=10-19, 50-59", 1_000), partial(10, 19));
        assert_eq!(answering("bytes=-10,0-5", 1_000), partial(990, 999));
    }

    #[test]
    fn the_unit_and_whitespace_are_read_leniently() {
        assert_eq!(answering(" Bytes = 10 - 19 ", 1_000), partial(10, 19));
    }

    #[test]
    fn a_start_at_or_past_the_end_is_unsatisfiable() {
        assert_eq!(answering("bytes=1000-", 1_000), Answer::Unsatisfiable);
        assert_eq!(answering("bytes=5000-6000", 1_000), Answer::Unsatisfiable);
        assert_eq!(answering("bytes=-0", 1_000), Answer::Unsatisfiable);
        assert_eq!(answer(None, 0), Answer::Unsatisfiable);
        assert_eq!(answering("bytes=-10", 0), Answer::Unsatisfiable);
    }
}
