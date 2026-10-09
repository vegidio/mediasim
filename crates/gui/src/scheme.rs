//! What the `thumb` and `video` URI schemes share: how a request names an admitted file, and how a request that can't
//! be answered with one is refused.

use tauri::http::{Response, StatusCode, Uri, header, response};

/// Length of an identity: XXH3-64 as 16 lowercase hex characters.
const IDENTITY_LENGTH: usize = 16;

/// Why a request was not answered with what it asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// A malformed request, or an identity that was never admitted.
    NotFound,
    /// An admitted file that has been removed or changed since, or that can't be decoded.
    Gone,
    /// The work behind the answer panicked, so nothing can be said about the file.
    Failed,
}

/// The identity `uri`'s path names, or `None` if it isn't exactly one.
///
/// Only the path is read, so `thumb://localhost/…` and `http://thumb.localhost/…` read the same. It must be exactly
/// [`IDENTITY_LENGTH`] lowercase hex characters, so a filesystem path is refused before the registry is consulted.
pub(crate) fn parse_identity(uri: &Uri) -> Option<&str> {
    let identity = uri.path().strip_prefix('/')?;
    let well_formed =
        identity.len() == IDENTITY_LENGTH && identity.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'));

    well_formed.then_some(identity)
}

/// Whether `text` is only ASCII digits, which a number in a request must be: `parse` alone accepts a leading `+`, which
/// no URL or header this application builds has.
pub(crate) fn digits_only(text: &str) -> bool {
    text.bytes().all(|b| b.is_ascii_digit())
}

/// The plain-text response `refusal` crosses as, from `builder`, which may carry headers already: `what` names what
/// was not found, such as `media`.
pub(crate) fn refusal_response(builder: response::Builder, refusal: Refusal, what: &str) -> Response<Vec<u8>> {
    let (status, body) = match refusal {
        Refusal::NotFound => (StatusCode::NOT_FOUND, format!("no {what} with that identity has been admitted")),
        Refusal::Gone => {
            (StatusCode::GONE, "that file has changed or can no longer be read; admit it again".to_owned())
        }
        Refusal::Failed => (StatusCode::INTERNAL_SERVER_ERROR, "the request could not be answered".to_owned()),
    };

    builder
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(body.into_bytes())
        .expect("the response is built from constants and cannot be malformed")
}
