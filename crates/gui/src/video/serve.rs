//! The `video` scheme handler: whether the file a request names may still be served, and which of its bytes cross
//! back.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use mediasim::MediaType;
use tauri::http::{HeaderValue, Request, Response, StatusCode, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use super::range::{Answer, answer};
use super::{content_type, parse};
use crate::thumbs::{Refusal, ThumbState, locate};

/// What a request is answered with.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Outcome {
    /// Bytes `start..=end` of a file of `size` bytes.
    Partial {
        start: u64,
        end: u64,
        size: u64,
        content_type: &'static str,
        bytes: Vec<u8>,
    },
    /// The range starts at or past the end of a file of `size` bytes.
    Unsatisfiable {
        size: u64,
    },
    Refused(Refusal),
}

/// The answer to a request for `identity` with `range`: locate, refuse a non-video, then read only the answered range.
/// Split from [`serve`] so it can be tested without a webview.
fn produce(state: &ThumbState, identity: &str, range: Option<&HeaderValue>) -> Outcome {
    let admitted = match locate(state, identity) {
        Ok(admitted) => admitted,
        Err(refusal) => return Outcome::Refused(refusal),
    };
    if MediaType::from_path(&admitted.path) != Some(MediaType::Video) {
        return Outcome::Refused(Refusal::NotFound);
    }

    // `locate` has just checked that the file still has the size it was admitted with.
    let size = admitted.size;
    let Answer::Partial { start, end } = answer(range, size) else {
        return Outcome::Unsatisfiable { size };
    };

    match read(&admitted.path, start, end) {
        Ok(bytes) => Outcome::Partial { start, end, size, content_type: content_type(&admitted.path), bytes },
        // Changed or removed since it was located.
        Err(_) => Outcome::Refused(Refusal::Gone),
    }
}

/// Bytes `start..=end` of `path`, and no others.
fn read(path: &Path, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    let length = usize::try_from(end - start + 1).map_err(std::io::Error::other)?;
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;

    let mut bytes = vec![0; length];
    file.read_exact(&mut bytes)?;

    Ok(bytes)
}

/// The response an outcome crosses as. None is cacheable: answers are large and cheap to read again.
fn respond(outcome: Outcome) -> Response<Vec<u8>> {
    let builder = Response::builder().header(header::CACHE_CONTROL, "no-store");

    let response = match outcome {
        Outcome::Partial { start, end, size, content_type, bytes } => builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
            .header(header::CONTENT_LENGTH, bytes.len())
            .header(header::ACCEPT_RANGES, "bytes")
            .body(bytes),
        Outcome::Unsatisfiable { size } => builder
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .header(header::CONTENT_RANGE, format!("bytes */{size}"))
            .header(header::ACCEPT_RANGES, "bytes")
            .body(b"that range starts past the end of the file".to_vec()),
        Outcome::Refused(refusal) => {
            let (status, body): (StatusCode, &[u8]) = match refusal {
                Refusal::NotFound => (StatusCode::NOT_FOUND, b"no video with that identity has been admitted"),
                Refusal::Gone => (StatusCode::GONE, b"that file has changed or can no longer be read; admit it again"),
            };
            builder
                .status(status)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(body.to_vec())
        }
    };

    response.expect("the response is built from valid parts and cannot be malformed")
}

/// Serves part of a video to the window. The handler registered under [`SCHEME`](super::SCHEME) in `src/lib.rs`.
///
/// A malformed request is answered at once; anything else is read on the blocking pool, so disk access never holds up
/// the window.
#[allow(clippy::needless_pass_by_value, reason = "Tauri passes the handler's arguments by value")]
pub fn serve<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let Some(identity) = parse(request.uri()) else {
        responder.respond(respond(Outcome::Refused(Refusal::NotFound)));
        return;
    };
    let range = request.headers().get(header::RANGE).cloned();

    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = produce(&app.state::<ThumbState>(), &identity, range.as_ref());
        responder.respond(respond(outcome));
    });
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::thumbs::admit_one;
    use crate::thumbs::tests::{fixture, set_modified, state};
    use crate::video::range::CAP;

    /// Admits `path` into `state` and returns its identity.
    fn admit(state: &ThumbState, path: &Path) -> String {
        let (identity, entry, _) = admit_one(path).unwrap();
        state.admit([(identity.clone(), entry)]);
        identity
    }

    /// The response to a request for `identity`, with `range` as its `Range` header if any.
    fn request(state: &ThumbState, identity: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let range = range.map(|range| HeaderValue::from_str(range).unwrap());
        respond(produce(state, identity, range.as_ref()))
    }

    fn header(response: &Response<Vec<u8>>, name: header::HeaderName) -> &str {
        response.headers()[name].to_str().unwrap()
    }

    /// A file of `size` bytes named `name` in `dir`, where byte `i` is `i % 251`, so any slice is recognisable.
    fn patterned(dir: &Path, name: &str, size: usize) -> (std::path::PathBuf, Vec<u8>) {
        let path = dir.join(name);
        #[allow(clippy::cast_possible_truncation, reason = "the remainder is below 251")]
        let bytes: Vec<u8> = (0..size).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &bytes).unwrap();
        (path, bytes)
    }

    fn assert_partial(response: &Response<Vec<u8>>, content_range: &str, body: &[u8]) {
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(header(response, header::CONTENT_RANGE), content_range);
        assert_eq!(header(response, header::CONTENT_LENGTH), body.len().to_string());
        assert_eq!(header(response, header::ACCEPT_RANGES), "bytes");
        assert_eq!(header(response, header::CACHE_CONTROL), "no-store");
        assert!(response.body() == body, "the body is not the expected bytes");
    }

    #[test]
    fn a_closed_range_is_those_bytes() {
        let state = state();
        let dir = mk_temp_dir("mediasim-video-").unwrap();
        let (path, bytes) = patterned(dir.path(), "clip.mp4", 10_000_000);
        let identity = admit(&state, &path);

        let response = request(&state, &identity, Some("bytes=100-199"));

        assert_partial(&response, "bytes 100-199/10000000", &bytes[100..200]);
        assert_eq!(header(&response, header::CONTENT_TYPE), "video/mp4");
    }

    #[test]
    fn an_open_range_on_a_large_file_is_capped() {
        let state = state();
        let dir = mk_temp_dir("mediasim-video-").unwrap();
        let path = dir.path().join("large.mkv");
        // Sparse where the filesystem allows it, so the test doesn't write a gigabyte.
        File::create(&path).unwrap().set_len(1_000_000_000).unwrap();
        let identity = admit(&state, &path);

        let response = request(&state, &identity, Some("bytes=0-"));

        assert_partial(&response, "bytes 0-4194303/1000000000", &vec![0; usize::try_from(CAP).unwrap()]);
        assert_eq!(header(&response, header::CONTENT_TYPE), "video/x-matroska");
    }

    #[test]
    fn a_suffix_range_is_the_last_bytes() {
        let state = state();
        let dir = mk_temp_dir("mediasim-video-").unwrap();
        let (path, bytes) = patterned(dir.path(), "clip.webm", 10_000_000);
        let identity = admit(&state, &path);

        let response = request(&state, &identity, Some("bytes=-500"));

        assert_partial(&response, "bytes 9999500-9999999/10000000", &bytes[9_999_500..]);
        assert_eq!(header(&response, header::CONTENT_TYPE), "video/webm");
    }

    #[test]
    fn no_range_is_the_file_from_its_start() {
        let state = state();
        let dir = mk_temp_dir("mediasim-video-").unwrap();
        let (path, bytes) = patterned(dir.path(), "clip.mov", 1_000);
        let identity = admit(&state, &path);

        let response = request(&state, &identity, None);

        assert_partial(&response, "bytes 0-999/1000", &bytes);
        assert_eq!(header(&response, header::CONTENT_TYPE), "video/quicktime");
    }

    #[test]
    fn a_range_past_the_end_is_unsatisfiable() {
        let state = state();
        let dir = mk_temp_dir("mediasim-video-").unwrap();
        let (path, _) = patterned(dir.path(), "clip.avi", 1_000);
        let identity = admit(&state, &path);

        let response = request(&state, &identity, Some("bytes=1000-"));

        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(header(&response, header::CONTENT_RANGE), "bytes */1000");
        assert_eq!(header(&response, header::CACHE_CONTROL), "no-store");
    }

    #[test]
    fn a_fixture_is_served_unchanged() {
        let state = state();
        let path = fixture("test3.mp4");
        let bytes = std::fs::read(&path).unwrap();
        let identity = admit(&state, &path);

        let response = request(&state, &identity, Some("bytes=0-1023"));
        assert_partial(&response, &format!("bytes 0-1023/{}", bytes.len()), &bytes[..1024]);

        let response = request(&state, &identity, Some("bytes=-64"));
        let start = bytes.len() - 64;
        assert_partial(&response, &format!("bytes {start}-{}/{}", bytes.len() - 1, bytes.len()), &bytes[start..]);
    }

    #[test]
    fn an_admitted_image_is_not_found() {
        let state = state();
        let identity = admit(&state, &fixture("test1.png"));

        assert_eq!(request(&state, &identity, None).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn an_identity_never_admitted_is_not_found() {
        let state = state();

        assert_eq!(request(&state, "0123456789abcdef", Some("bytes=0-")).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn a_removed_file_is_gone() {
        let state = state();
        let dir = mk_temp_dir("mediasim-video-").unwrap();
        let (path, _) = patterned(dir.path(), "clip.mp4", 1_000);
        let identity = admit(&state, &path);
        assert_eq!(request(&state, &identity, Some("bytes=0-99")).status(), StatusCode::PARTIAL_CONTENT);

        std::fs::remove_file(&path).unwrap();

        assert_eq!(request(&state, &identity, Some("bytes=100-199")).status(), StatusCode::GONE);
    }

    #[test]
    fn a_rewritten_file_is_gone() {
        let state = state();
        let dir = mk_temp_dir("mediasim-video-").unwrap();
        let (path, _) = patterned(dir.path(), "clip.mp4", 1_000);
        set_modified(&path, SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        let identity = admit(&state, &path);

        std::fs::write(&path, vec![1; 1_000]).unwrap();
        set_modified(&path, SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_001));

        assert_eq!(request(&state, &identity, Some("bytes=0-")).status(), StatusCode::GONE);
    }

    #[test]
    fn a_refusal_is_plain_text_and_not_cacheable() {
        for (refusal, status) in [(Refusal::NotFound, StatusCode::NOT_FOUND), (Refusal::Gone, StatusCode::GONE)] {
            let response = respond(Outcome::Refused(refusal));

            assert_eq!(response.status(), status);
            assert_eq!(header(&response, header::CONTENT_TYPE), "text/plain; charset=utf-8");
            assert_eq!(header(&response, header::CACHE_CONTROL), "no-store");
            assert!(!response.body().is_empty());
        }
    }
}
