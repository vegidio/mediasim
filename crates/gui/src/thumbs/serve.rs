//! The `thumb` scheme handler: what a request may ask for, whether the file it names may still be served, and what
//! crosses back.

use std::num::NonZeroU32;
use std::path::Path;

use image::DynamicImage;
use rust_sak::image::{EncodeOptions, ImageFormat};
use tauri::http::{Request, Response, StatusCode, Uri, header};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use super::ThumbState;
use super::cache::{Rendition, RenditionType, Unrendered};
use super::preview::{PreviewError, preview};
use crate::admission::{Admissions, still_admitted};
use crate::scheme::{Refusal, digits_only, parse_identity, refusal_response};

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

/// What `<path>?size=<bound>` asked for, or `None` if it asked for nothing that can be served.
///
/// The path must be an identity, as [`parse_identity`] reads it. `size` must be a whole number in [`BOUNDS`]; absent or
/// malformed is refused, never read as a default. Other query parameters are ignored.
fn parse(uri: &Uri) -> Option<Asked> {
    let identity = parse_identity(uri)?;

    let size = uri.query()?.split('&').find_map(|pair| pair.strip_prefix("size="))?;
    if !digits_only(size) {
        return None;
    }
    let bound = size.parse().ok().filter(|bound| BOUNDS.contains(bound))?;

    Some(Asked { identity: identity.to_owned(), bound: NonZeroU32::new(bound)? })
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
///
/// Only the check that the file is unchanged, a few `stat`s, holds a thread of the blocking pool, and only briefly: a
/// slow disk must not stall the async runtime. It also waits there for the cache to open, which only the first requests
/// of a run can find unfinished.
async fn produce<F, E>(
    registry: &Admissions,
    thumbs: &ThumbState,
    asked: &Asked,
    render: F,
) -> Result<Rendition, Refusal>
where
    F: FnOnce(&Path, NonZeroU32) -> Result<Rendition, E> + Send + 'static,
    E: std::error::Error,
{
    let admitted = registry.lookup(&asked.identity).ok_or(Refusal::NotFound)?;
    let opening = thumbs.opening();
    let admitted = tauri::async_runtime::spawn_blocking(move || {
        opening.wait();
        still_admitted(&admitted).then_some(admitted)
    })
    .await
    .map_err(|_| Refusal::Failed)?
    .ok_or(Refusal::Gone)?;

    let bound = asked.bound;
    thumbs
        .renditions()
        .get_or_render(&asked.identity, bound, move || render(&admitted.path, bound))
        .await
        .map_err(|unrendered| match unrendered {
            Unrendered::Undecodable => Refusal::Gone,
            Unrendered::Failed => Refusal::Failed,
        })
}

/// The response a rendition or a refusal crosses as.
fn respond(outcome: Result<Rendition, Refusal>) -> Response<Vec<u8>> {
    match outcome {
        Ok(rendition) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, rendition.media_type.mime())
            // Safe because an identity's file never changes: a changed file gets a new identity.
            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
            .body(rendition.bytes)
            .expect("the response is built from constants and cannot be malformed"),
        Err(refusal) => refusal_response(Response::builder(), refusal, "media"),
    }
}

/// Serves a thumbnail to the window. The handler registered under [`SCHEME`](super::SCHEME) in `src/lib.rs`.
///
/// A malformed request is answered at once; anything else is produced asynchronously, as [`produce`] says, so neither a
/// large decode nor a queue of them holds up the window or the blocking pool.
///
/// The responder answers nothing when dropped, so a request whose work panicked would never settle. The work runs in a
/// task of its own, whose panic its join reports, and is then answered with a 500.
#[allow(clippy::needless_pass_by_value, reason = "Tauri passes the handler's arguments by value")]
pub fn serve<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let Some(asked) = parse(request.uri()) else {
        responder.respond(respond(Err(Refusal::NotFound)));
        return;
    };

    let app = context.app_handle().clone();
    let producing = tauri::async_runtime::spawn(async move {
        produce(&app.state::<Admissions>(), &app.state::<ThumbState>(), &asked, render).await
    });
    tauri::async_runtime::spawn(async move {
        let outcome = producing.await.unwrap_or(Err(Refusal::Failed));
        responder.respond(respond(outcome));
    });
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{Duration, SystemTime};

    use image::{GenericImageView, Rgba, RgbaImage};
    use rust_sak::fs::mk_temp_dir;

    use super::*;
    use crate::admission::tests::fixture;
    use crate::thumbs::tests::state;
    use crate::video::fixtures::admit;

    /// An empty registry, and a cache in memory.
    fn states() -> (Admissions, ThumbState) {
        (Admissions::default(), state())
    }

    /// What [`produce`] answers `asked` with, waited for.
    fn produce_now<F, E>(
        (registry, thumbs): &(Admissions, ThumbState),
        asked: &Asked,
        render: F,
    ) -> Result<Rendition, Refusal>
    where
        F: FnOnce(&Path, NonZeroU32) -> Result<Rendition, E> + Send + 'static,
        E: std::error::Error,
    {
        tauri::async_runtime::block_on(produce(registry, thumbs, asked, render))
    }

    fn asked(url: &str) -> Option<Asked> {
        parse(&url.parse::<Uri>().unwrap())
    }

    fn asking(identity: &str, bound: u32) -> Asked {
        Asked { identity: identity.to_owned(), bound: NonZeroU32::new(bound).unwrap() }
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
        let state = states();

        assert_eq!(produce_now(&state, &asking("0123456789abcdef", 96), render).map(|_| ()), Err(Refusal::NotFound));
    }

    #[test]
    fn a_removed_file_is_gone() {
        let state = states();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.avif"), &path).unwrap();
        let identity = admit(&state.0, &path);

        std::fs::remove_file(&path).unwrap();

        assert_eq!(produce_now(&state, &asking(&identity, 96), render).map(|_| ()), Err(Refusal::Gone));
    }

    #[test]
    fn a_file_changed_after_admission_is_gone_even_when_cached() {
        let state = states();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::copy(fixture("test1.avif"), &path).unwrap();
        let identity = admit(&state.0, &path);
        assert!(produce_now(&state, &asking(&identity, 96), render).is_ok());

        let file = std::fs::File::options().write(true).open(&path).unwrap();
        file.set_modified(SystemTime::now() + Duration::from_secs(60)).unwrap();

        assert_eq!(produce_now(&state, &asking(&identity, 96), render).map(|_| ()), Err(Refusal::Gone));
    }

    #[test]
    fn an_admitted_file_that_will_not_decode_is_gone() {
        let state = states();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("corrupt.png");
        std::fs::write(&path, b"not a png").unwrap();
        let identity = admit(&state.0, &path);

        assert_eq!(produce_now(&state, &asking(&identity, 96), render).map(|_| ()), Err(Refusal::Gone));
    }

    #[test]
    fn an_opaque_image_answer_is_a_bounded_jpeg_cacheable_indefinitely() {
        let state = states();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("photo.jpg");
        DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1200, 900, image::Rgb([90, 120, 150])))
            .save(&path)
            .unwrap();
        let identity = admit(&state.0, &path);

        let response = respond(produce_now(&state, &asking(&identity, 384), render));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(response.headers()[header::CACHE_CONTROL], "public, max-age=31536000, immutable");
        assert_eq!(image::load_from_memory(response.body()).unwrap().dimensions(), (384, 288));
    }

    #[test]
    fn an_opaque_fixture_is_answered_as_jpeg() {
        // test1.avif has no alpha channel, so its thumbnail has no transparency to keep.
        let state = states();
        let identity = admit(&state.0, &fixture("test1.avif"));

        let response = respond(produce_now(&state, &asking(&identity, 384), render));

        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        // 427×640: 427 * 384 / 640 = 256.2.
        assert_eq!(image::load_from_memory(response.body()).unwrap().dimensions(), (256, 384));
    }

    #[test]
    fn the_largest_bound_caps_the_longer_edge() {
        let state = states();
        let identity = admit(&state.0, &fixture("test1.avif"));

        let response = respond(produce_now(&state, &asking(&identity, 2048), render));

        assert_eq!(response.status(), StatusCode::OK);
        let (width, height) = image::load_from_memory(response.body()).unwrap().dimensions();
        assert!(width.max(height) <= 2048, "{width}×{height}");
    }

    #[test]
    fn a_video_answer_is_its_frame_fitted_to_the_bound() {
        let state = states();
        let identity = admit(&state.0, &fixture("test3.mkv"));

        let response = respond(produce_now(&state, &asking(&identity, 384), render));

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
        // 338×640: 338 * 384 / 640 = 202.8.
        assert_eq!(image::load_from_memory(response.body()).unwrap().dimensions(), (203, 384));
    }

    #[test]
    fn a_transparent_image_answer_is_a_png_that_keeps_its_transparency() {
        let state = states();
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("transparent.png");
        let mut source = RgbaImage::from_pixel(200, 100, Rgba([255, 0, 0, 255]));
        source.put_pixel(150, 50, Rgba([0, 0, 0, 0]));
        DynamicImage::ImageRgba8(source).save(&path).unwrap();
        let identity = admit(&state.0, &path);

        let response = respond(produce_now(&state, &asking(&identity, 1024), render));

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
        for (refusal, status) in [
            (Refusal::NotFound, StatusCode::NOT_FOUND),
            (Refusal::Gone, StatusCode::GONE),
            (Refusal::Failed, StatusCode::INTERNAL_SERVER_ERROR),
        ] {
            let response = respond(Err(refusal));

            assert_eq!(response.status(), status);
            assert_eq!(response.headers()[header::CONTENT_TYPE], "text/plain; charset=utf-8");
            assert!(response.headers().get(header::CACHE_CONTROL).is_none());
            assert!(!response.body().is_empty());
        }
    }

    #[test]
    fn a_second_request_is_served_from_the_cache() {
        let state = states();
        let identity = admit(&state.0, &fixture("test1.avif"));
        let calls = Arc::new(AtomicUsize::new(0));
        let counting = |calls: &Arc<AtomicUsize>| {
            let calls = Arc::clone(calls);
            move |path: &Path, bound| {
                calls.fetch_add(1, Ordering::SeqCst);
                render(path, bound)
            }
        };

        let first = produce_now(&state, &asking(&identity, 96), counting(&calls)).unwrap();
        let second = produce_now(&state, &asking(&identity, 96), counting(&calls)).unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(first, second);
    }

    #[test]
    fn a_panicking_render_is_answered_with_a_server_error_and_retried_next_time() {
        let state = states();
        let identity = admit(&state.0, &fixture("test1.avif"));

        let panicked = produce_now(&state, &asking(&identity, 96), |_: &Path, _| -> Result<Rendition, RenderError> {
            panic!("the decoder panicked")
        });

        assert_eq!(respond(panicked).status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(produce_now(&state, &asking(&identity, 96), render).is_ok());
    }
}
