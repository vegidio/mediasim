//! The `serialize_with` helpers that give [`Media`](super::Media)'s fields their serialized shape. None can fail on
//! the data, so serializing a media never aborts a whole document.

use std::path::Path;
use std::time::{Duration, SystemTime};

use serde::Serializer;

/// The path as a string, with each sequence that isn't valid Unicode replaced by `U+FFFD`.
pub(super) fn path<S: Serializer>(path: &Path, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&path.to_string_lossy())
}

/// The duration in seconds, with a fractional part.
#[allow(clippy::ref_option)] // `serialize_with` passes a reference to the field.
pub(super) fn seconds<S: Serializer>(duration: &Option<Duration>, serializer: S) -> Result<S::Ok, S::Error> {
    match duration {
        Some(duration) => serializer.serialize_some(&duration.as_secs_f64()),
        None => serializer.serialize_none(),
    }
}

/// The time as an RFC 3339 timestamp in UTC, ending in `Z`, with the fractional second only when there is one. A
/// time outside the years −9999 to 9999 is written as none.
#[allow(clippy::ref_option)] // `serialize_with` passes a reference to the field.
pub(super) fn timestamp<S: Serializer>(time: &Option<SystemTime>, serializer: S) -> Result<S::Ok, S::Error> {
    match time.and_then(|time| jiff::Timestamp::try_from(time).ok()) {
        Some(timestamp) => serializer.serialize_some(&timestamp.to_string()),
        None => serializer.serialize_none(),
    }
}
