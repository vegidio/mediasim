//! Videos: how an admitted video's bytes reach the window's `<video>` element.
//!
//! The window loads `video://localhost/<identity>`, with an identity from the same registry as `thumbs`, and
//! [`serve`] answers each byte range the player asks for, at most [`range::CAP`] bytes at a time, so a file of any size
//! is played with bounded memory. A request names an identity, never a path, so the window can only reach files that
//! were admitted.
//!
//! A video the window can't play from its own bytes is played through Media Source Extensions instead: [`probe`] tells
//! the window what the file holds, and a session in [`sessions`] copies or encodes its main streams into fragmented
//! MP4, one segment per request. Encoded segments are kept in [`Segments`], and encoded by the encoder [`Encoders`]
//! chooses.

mod audio;
mod cache;
mod encoder;
mod error;
#[cfg(test)]
mod fixtures;
pub mod probe;
mod range;
mod serve;
mod session;
pub mod sessions;
mod transcode;

use std::path::Path;

use tauri::http::Uri;

pub use cache::Segments;
pub use encoder::Encoders;
pub use error::VideoError;
pub use serve::serve;
pub use sessions::SessionState;

// Must stay in sync with `tauri.conf.json`'s `media-src`, which needs both platform forms of it.
/// The URI scheme videos are served over. Registered in `src/lib.rs`.
pub const SCHEME: &str = "video";

/// Length of an identity: XXH3-64 as 16 lowercase hex characters.
const IDENTITY_LENGTH: usize = 16;

/// The identity `<path>` asks for, or `None` if it isn't exactly one.
///
/// Only the path is read, so `video://localhost/…` and `http://video.localhost/…` read the same, and the query is
/// ignored. The path must be exactly [`IDENTITY_LENGTH`] lowercase hex characters, so a filesystem path is refused
/// before the registry is consulted.
fn parse(uri: &Uri) -> Option<String> {
    let identity = uri.path().strip_prefix('/')?;
    let well_formed =
        identity.len() == IDENTITY_LENGTH && identity.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f'));

    well_formed.then(|| identity.to_owned())
}

/// The content type a video is served as, from its extension. Every video extension `mediasim` admits is listed.
fn content_type(path: &Path) -> &'static str {
    let extension = path.extension().and_then(|ext| ext.to_str()).unwrap_or_default().to_ascii_lowercase();

    match extension.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked(url: &str) -> Option<String> {
        parse(&url.parse::<Uri>().unwrap())
    }

    #[test]
    fn a_request_names_an_identity() {
        assert_eq!(asked("video://localhost/0123456789abcdef").as_deref(), Some("0123456789abcdef"));
    }

    #[test]
    fn both_platform_forms_ask_for_the_same_thing() {
        assert_eq!(asked("video://localhost/cafebabecafebabe"), asked("http://video.localhost/cafebabecafebabe"));
        assert!(asked("http://video.localhost/cafebabecafebabe").is_some());
    }

    #[test]
    fn the_query_is_ignored() {
        assert_eq!(asked("video://localhost/cafebabecafebabe?v=2&size=96").as_deref(), Some("cafebabecafebabe"));
    }

    #[test]
    fn a_path_instead_of_an_identity_is_refused() {
        for url in [
            "video://localhost/..%2F..%2Fetc%2Fpasswd",
            "video://localhost/../../../etc/passwd",
            "video://localhost//Users/someone/Movies/a.mp4",
            "video://localhost/0123456789abcdef/../x",
        ] {
            assert_eq!(asked(url), None, "{url} was accepted");
        }
    }

    #[test]
    fn a_malformed_identity_is_refused() {
        for url in [
            "video://localhost/",
            "video://localhost/0123456789abcde",
            "video://localhost/0123456789abcdef0",
            "video://localhost/0123456789ABCDEF",
            "video://localhost/0123456789abcdeg",
        ] {
            assert_eq!(asked(url), None, "{url} was accepted");
        }
    }

    #[test]
    fn every_video_extension_has_its_content_type() {
        for (name, expected) in [
            ("a.mp4", "video/mp4"),
            ("a.m4v", "video/mp4"),
            ("a.mov", "video/quicktime"),
            ("a.webm", "video/webm"),
            ("a.mkv", "video/x-matroska"),
            ("a.avi", "video/x-msvideo"),
            ("a.wmv", "video/x-ms-wmv"),
            ("A.MP4", "video/mp4"),
        ] {
            assert_eq!(content_type(Path::new(name)), expected, "{name}");
        }
    }

    #[test]
    fn tauri_conf_json_lets_the_window_load_the_scheme_and_object_urls() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json is JSON");

        for policy in ["csp", "devCsp"] {
            let media_src = conf["app"]["security"][policy]["media-src"].as_str().expect("media-src is set");
            let sources: Vec<_> = media_src.split_whitespace().collect();

            assert_eq!(
                sources,
                ["'self'", &format!("{SCHEME}:"), &format!("http://{SCHEME}.localhost"), "blob:"],
                "{policy}"
            );
        }
    }

    #[test]
    fn media_src_is_the_only_directive_that_mentions_the_scheme_or_blob() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json is JSON");

        for policy in ["csp", "devCsp"] {
            let directives = conf["app"]["security"][policy].as_object().expect("the policy is an object");
            for (name, sources) in directives.iter().filter(|(name, _)| name.as_str() != "media-src") {
                let sources = sources.as_str().unwrap_or_default();
                assert!(!sources.contains(SCHEME), "{policy} {name} mentions {SCHEME}");
                // An MSE player's object URL is media; nothing else may load from `blob:`.
                assert!(!sources.split_whitespace().any(|source| source == "blob:"), "{policy} {name} allows blob:");
            }
        }
    }
}
