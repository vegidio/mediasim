//! The `thumb` scheme handler: what a request may ask for, whether the file it names may still be served, and what
//! crosses back.

use std::num::NonZeroU32;
use std::path::Path;

use image::DynamicImage;
use rust_sak::image::{EncodeOptions, ImageFormat};
use tauri::http::{Request, Response, StatusCode, Uri, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use super::cache::{Rendition, RenditionType};
use super::preview::{PreviewError, preview};
use super::{Admitted, ThumbState};

/// Length of an identity: XXH3-64 as 16 lowercase hex characters.
const IDENTITY_LENGTH: usize = 16;

/// The bounds a request may ask for, in pixels of the longer edge.
const BOUNDS: std::ops::RangeInclusive<u32> = 16..=2048;

/// JPEG quality thumbnails are encoded at.
const JPEG_QUALITY: u8 = 85;

/// What a request asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Asked {
    identity: String,
    bound: NonZeroU32,
}

/// Why a request was not answered with a picture.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Refusal {
    /// A malformed request, or an identity that was never admitted.
    NotFound,
    /// An admitted file that has been removed or changed since, or that can't be decoded.
    Gone,
}

/// What `<path>?size=<bound>` asked for, or `None` if it asked for nothing that can be served.
///
/// Only the path and the query are read, so `thumb://localhost/…` and `http://thumb.localhost/…` read the same. The
/// path must be exactly [`IDENTITY_LENGTH`] lowercase hex characters, so a filesystem path is refused before the
/// registry is consulted. `size` must be a whole number in [`BOUNDS`]; absent or malformed is refused, never read as a
/// default. Other query parameters are ignored.
fn parse(uri: &Uri) -> Option<Asked> {
    let identity = uri.path().strip_prefix('/')?;
    if identity.len() != IDENTITY_LENGTH || !identity.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'a'..=b'f')) {
        return None;
    }

    let size = uri.query()?.split('&').find_map(|pair| pair.strip_prefix("size="))?;
    // `parse` alone accepts a leading `+`, which no URL this application builds has.
    if !size.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let bound = size.parse().ok().filter(|bound| BOUNDS.contains(bound))?;

    Some(Asked { identity: identity.to_owned(), bound: NonZeroU32::new(bound)? })
}

/// The admitted file behind `identity`, if it is still the file that was admitted.
///
/// Runs before the cache, so a file that was removed or changed stops being served even while a rendition of it is
/// still cached.
fn locate(state: &ThumbState, identity: &str) -> Result<Admitted, Refusal> {
    let admitted = state.lookup(identity).ok_or(Refusal::NotFound)?;
    let metadata = std::fs::metadata(&admitted.path).map_err(|_| Refusal::Gone)?;

    let unchanged =
        metadata.is_file() && metadata.len() == admitted.size && metadata.modified().ok() == Some(admitted.modified);

    if unchanged { Ok(admitted) } else { Err(Refusal::Gone) }
}

/// Why a rendition could not be produced from a file that was located.
#[derive(Debug, thiserror::Error)]
enum RenderError {
    #[error(transparent)]
    Preview(#[from] PreviewError),
    #[error("failed to encode the thumbnail: {0}")]
    Encode(#[from] rust_sak::image::ImageError),
}

/// Renders and encodes the thumbnail of `path` at `bound`.
fn render(path: &Path, bound: NonZeroU32) -> Result<Rendition, RenderError> {
    encode(&preview(path, bound)?)
}

/// JPEG when the picture is fully opaque, PNG when it has any transparency.
fn encode(picture: &DynamicImage) -> Result<Rendition, RenderError> {
    let (format, options, media_type) = if is_opaque(picture) {
        (ImageFormat::Jpeg, Some(EncodeOptions::Jpeg { quality: JPEG_QUALITY }), RenditionType::Jpeg)
    } else {
        (ImageFormat::Png, None, RenditionType::Png)
    };

    let mut bytes = Vec::new();
    rust_sak::image::encode_writer(picture, &mut bytes, format, options)?;

    Ok(Rendition { bytes, media_type })
}

/// Whether every alpha sample of `picture` is fully opaque; a picture without alpha always is.
fn is_opaque(picture: &DynamicImage) -> bool {
    match picture {
        DynamicImage::ImageLumaA8(buffer) => buffer.pixels().all(|p| p.0[1] == u8::MAX),
        DynamicImage::ImageRgba8(buffer) => buffer.pixels().all(|p| p.0[3] == u8::MAX),
        DynamicImage::ImageLumaA16(buffer) => buffer.pixels().all(|p| p.0[1] == u16::MAX),
        DynamicImage::ImageRgba16(buffer) => buffer.pixels().all(|p| p.0[3] == u16::MAX),
        DynamicImage::ImageRgba32F(buffer) => buffer.pixels().all(|p| p.0[3] >= 1.0),
        other => !other.color().has_alpha() || other.to_rgba8().pixels().all(|p| p.0[3] == u8::MAX),
    }
}

/// The rendition a request asked for, or why not: locate, then the cache, then `render` on a miss. Split from
/// [`serve`] so it can be tested without a webview, and generic over `render` so the cache can be tested without
/// decoding.
fn produce<F, E>(state: &ThumbState, asked: &Asked, render: F) -> Result<Rendition, Refusal>
where
    F: FnOnce(&Path, NonZeroU32) -> Result<Rendition, E>,
    E: std::error::Error + Send + Sync + 'static,
{
    let admitted = locate(state, &asked.identity)?;

    state
        .renditions()
        .get_or_render(&asked.identity, asked.bound, || render(&admitted.path, asked.bound))
        .ok_or(Refusal::Gone)
}

/// The response a rendition or a refusal crosses as.
fn respond(outcome: Result<Rendition, Refusal>) -> Response<Vec<u8>> {
    let (status, body): (StatusCode, &[u8]) = match outcome {
        Ok(rendition) => {
            return Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, rendition.media_type.mime())
                // Safe because an identity's file never changes: a changed file gets a new identity.
                .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                .body(rendition.bytes)
                .expect("the response is built from constants and cannot be malformed");
        }
        Err(Refusal::NotFound) => (StatusCode::NOT_FOUND, b"no media with that identity has been admitted"),
        Err(Refusal::Gone) => (StatusCode::GONE, b"that file has changed or can no longer be read; admit it again"),
    };

    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(body.to_vec())
        .expect("the response is built from constants and cannot be malformed")
}

/// Serves a thumbnail to the window. The handler registered under [`SCHEME`](super::SCHEME) in `src/lib.rs`.
///
/// A malformed request is answered at once; anything else is produced on the blocking pool, so a large decode never
/// holds up the window.
#[allow(clippy::needless_pass_by_value, reason = "Tauri passes the handler's arguments by value")]
pub fn serve<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let Some(asked) = parse(request.uri()) else {
        responder.respond(respond(Err(Refusal::NotFound)));
        return;
    };

    let app = context.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = produce(&app.state::<ThumbState>(), &asked, render);
        responder.respond(respond(outcome));
    });
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, SystemTime};

    use image::{GenericImageView, Rgba, RgbaImage};
    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::thumbs::admit_one;
    use crate::thumbs::tests::{fixture, state};

    fn asked(url: &str) -> Option<Asked> {
        parse(&url.parse::<Uri>().unwrap())
    }

    fn asking(identity: &str, bound: u32) -> Asked {
        Asked { identity: identity.to_owned(), bound: NonZeroU32::new(bound).unwrap() }
    }

    /// Admits `path` into `state` and returns its identity.
    fn admit(state: &ThumbState, path: &Path) -> String {
        let (identity, entry, _) = admit_one(path).unwrap();
        state.admit([(identity.clone(), entry)]);
        identity
    }

    #[test]
    fn a_request_names_an_identity_and_a_bound() {
        assert_eq!(asked("thumb://localhost/0123456789abcdef?size=384"), Some(asking("0123456789abcdef", 384)));
    }

    #[test]
    fn both_platform_forms_ask_for_the_same_thing() {
        assert_eq!(
            asked("thumb://localhost/cafebabecafebabe?size=96"),
            asked("http://thumb.localhost/cafebabecafebabe?size=96")
        );
        assert!(asked("http://thumb.localhost/cafebabecafebabe?size=96").is_some());
    }

    #[test]
    fn unknown_query_parameters_are_ignored() {
        assert_eq!(asked("thumb://localhost/cafebabecafebabe?v=2&size=96&x"), Some(asking("cafebabecafebabe", 96)));
    }

    #[test]
    fn a_path_instead_of_an_identity_is_refused() {
        for url in [
            "thumb://localhost/..%2F..%2Fetc%2Fpasswd?size=256",
            "thumb://localhost/../../../etc/passwd?size=256",
            "thumb://localhost//Users/someone/Pictures/a.jpg?size=256",
            "thumb://localhost/0123456789abcdef/../x?size=256",
        ] {
            assert_eq!(asked(url), None, "{url} was accepted");
        }
    }

    #[test]
    fn a_malformed_identity_is_refused() {
        for url in [
            "thumb://localhost/?size=96",
            "thumb://localhost/0123456789abcde?size=96",
            "thumb://localhost/0123456789abcdef0?size=96",
            "thumb://localhost/0123456789ABCDEF?size=96",
            "thumb://localhost/0123456789abcdeg?size=96",
        ] {
            assert_eq!(asked(url), None, "{url} was accepted");
        }
    }

    #[test]
    fn a_missing_malformed_or_out_of_range_bound_is_refused() {
        for url in [
            "thumb://localhost/cafebabecafebabe",
            "thumb://localhost/cafebabecafebabe?other=1",
            "thumb://localhost/cafebabecafebabe?size=",
            "thumb://localhost/cafebabecafebabe?size=large",
            "thumb://localhost/cafebabecafebabe?size=-1",
            "thumb://localhost/cafebabecafebabe?size=+96",
            "thumb://localhost/cafebabecafebabe?size=9.5",
            "thumb://localhost/cafebabecafebabe?size=0",
            "thumb://localhost/cafebabecafebabe?size=15",
            "thumb://localhost/cafebabecafebabe?size=2049",
            "thumb://localhost/cafebabecafebabe?size=4096",
            "thumb://localhost/cafebabecafebabe?size=99999999999999999999",
        ] {
            assert_eq!(asked(url), None, "{url} was accepted");
        }

        assert!(asked("thumb://localhost/cafebabecafebabe?size=16").is_some());
        assert!(asked("thumb://localhost/cafebabecafebabe?size=1024").is_some());
        assert!(asked("thumb://localhost/cafebabecafebabe?size=2048").is_some());
    }

    #[test]
    fn an_identity_never_admitted_is_not_found() {
        let state = state();

        assert_eq!(produce(&state, &asking("0123456789abcdef", 96), render).map(|_| ()), Err(Refusal::NotFound));
    }

    #[test]
    fn a_removed_file_is_gone() {
        let state = state();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        let identity = admit(&state, &path);

        std::fs::remove_file(&path).unwrap();

        assert_eq!(produce(&state, &asking(&identity, 96), render).map(|_| ()), Err(Refusal::Gone));
    }

    #[test]
    fn a_file_changed_after_admission_is_gone_even_when_cached() {
        let state = state();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &path).unwrap();
        let identity = admit(&state, &path);
        assert!(produce(&state, &asking(&identity, 96), render).is_ok());

        let file = std::fs::File::options().write(true).open(&path).unwrap();
        file.set_modified(SystemTime::now() + Duration::from_secs(60)).unwrap();

        assert_eq!(produce(&state, &asking(&identity, 96), render).map(|_| ()), Err(Refusal::Gone));
    }

    #[test]
    fn an_admitted_file_that_will_not_decode_is_gone() {
        let state = state();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("corrupt.png");
        std::fs::write(&path, b"not a png").unwrap();
        let identity = admit(&state, &path);

        assert_eq!(produce(&state, &asking(&identity, 96), render).map(|_| ()), Err(Refusal::Gone));
    }

    #[test]
    fn an_opaque_image_answer_is_a_bounded_jpeg_cacheable_indefinitely() {
        let state = state();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("photo.jpg");
        DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1200, 900, image::Rgb([90, 120, 150])))
            .save(&path)
            .unwrap();
        let identity = admit(&state, &path);

        let response = respond(produce(&state, &asking(&identity, 384), render));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(response.headers()[header::CACHE_CONTROL], "public, max-age=31536000, immutable");
        assert_eq!(image::load_from_memory(response.body()).unwrap().dimensions(), (384, 288));
    }

    #[test]
    fn a_fixture_with_transparent_pixels_is_answered_as_png() {
        // test1.png is a palette PNG whose transparent entry is used, so its thumbnail has to keep alpha.
        let state = state();
        let identity = admit(&state, &fixture("test1.png"));

        let response = respond(produce(&state, &asking(&identity, 384), render));

        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        // 1440×3098: 1440 * 384 / 3098 = 178.5.
        assert_eq!(image::load_from_memory(response.body()).unwrap().dimensions(), (178, 384));
    }

    #[test]
    fn the_largest_bound_caps_the_longer_edge() {
        let state = state();
        let identity = admit(&state, &fixture("test1.png"));

        let response = respond(produce(&state, &asking(&identity, 2048), render));

        assert_eq!(response.status(), StatusCode::OK);
        let (width, height) = image::load_from_memory(response.body()).unwrap().dimensions();
        assert!(width.max(height) <= 2048, "{width}×{height}");
    }

    #[test]
    fn a_video_answer_is_its_frame_fitted_to_the_bound() {
        let state = state();
        let identity = admit(&state, &fixture("test3.mp4"));

        let response = respond(produce(&state, &asking(&identity, 384), render));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(image::load_from_memory(response.body()).unwrap().dimensions(), (216, 384));
    }

    #[test]
    fn a_transparent_image_answer_is_a_png_that_keeps_its_transparency() {
        let state = state();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("transparent.png");
        let mut source = RgbaImage::from_pixel(200, 100, Rgba([255, 0, 0, 255]));
        source.put_pixel(150, 50, Rgba([0, 0, 0, 0]));
        DynamicImage::ImageRgba8(source).save(&path).unwrap();
        let identity = admit(&state, &path);

        let response = respond(produce(&state, &asking(&identity, 1024), render));

        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/png");
        let picture = image::load_from_memory(response.body()).unwrap();
        assert_eq!(picture.get_pixel(150, 50).0[3], 0);
        assert_eq!(picture.get_pixel(10, 10).0[3], 255);
    }

    #[test]
    fn an_opaque_picture_with_an_alpha_channel_is_a_jpeg() {
        let opaque = DynamicImage::ImageRgba8(RgbaImage::from_pixel(32, 32, Rgba([1, 2, 3, 255])));

        assert_eq!(encode(&opaque).unwrap().media_type, RenditionType::Jpeg);
        assert!(is_opaque(&DynamicImage::ImageRgb8(image::RgbImage::new(4, 4))));
        assert!(!is_opaque(&DynamicImage::ImageRgba16(image::ImageBuffer::new(4, 4))));
    }

    #[test]
    fn a_refusal_is_plain_text_and_not_cacheable() {
        for (refusal, status) in [(Refusal::NotFound, StatusCode::NOT_FOUND), (Refusal::Gone, StatusCode::GONE)] {
            let response = respond(Err(refusal));

            assert_eq!(response.status(), status);
            assert_eq!(response.headers()[header::CONTENT_TYPE], "text/plain; charset=utf-8");
            assert!(response.headers().get(header::CACHE_CONTROL).is_none());
            assert!(!response.body().is_empty());
        }
    }

    #[test]
    fn a_second_request_is_served_from_the_cache() {
        let state = state();
        let identity = admit(&state, &fixture("test1.png"));
        let calls = AtomicUsize::new(0);
        let counting = |path: &Path, bound| {
            calls.fetch_add(1, Ordering::SeqCst);
            render(path, bound)
        };

        let first = produce(&state, &asking(&identity, 96), counting).unwrap();
        let second = produce(&state, &asking(&identity, 96), counting).unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(first, second);
    }
}
