## Context

Today `crates/mediasim/src/media.rs` holds all of loading:
- `Media { name, width, height, frames }`
- `from_images`
- `from_file`, which loads images only
- `from_files`, which runs `rayon::spawn` + `into_par_iter` and sends results over an mpsc channel, yielding them in completion order
- `from_dir(dir, recursive)`, backed by a hand-written stack walker that skips errors without reporting them and follows symlinked directories

Errors are a single newtype, `IconError(rust_sak::image::ImageError)`. `Icon::from_image(&DynamicImage)` is the signature step; images and videos will share it.

`media-rs` facts that shape this design:
- It takes paths as `&str` / `Into<String>`, not `Path`.
- `FrameExtractor` decodes on the calling thread. With `to_callback`, it hands each frame to the callback with nothing buffered and nothing encoded.
- It has no git tags. `main` is at `6e268e0` (crate version 26.6.0), which moved its `rust-sak` dependency to tag `26.10.1` because the `26.7.0` tag it previously pinned no longer exists.

## Goals / Non-Goals

**Goals:**
- One loading path for images and videos that produces the `Media` described in `specs/media-loading`.
- Keep the streaming, completion-order batch API, which the CLI progress bar and the GUI both need.
- Bounded memory per video: never hold a whole video's decoded frames at once.

**Non-Goals:**
- Comparing or grouping media.
- Progress reporting beyond what the result stream already gives.
- Caching signatures.
- Cancelling a load midway beyond the caller dropping the iterator.
- Animated images (GIF/WebP): only their first frame is used.
- Video rotation metadata: dimensions are the coded stream dimensions, as `probe` reports them.
- Camera RAW formats (`rust-sak`'s `image-raw` feature).

## Slices

This feature is a single change: about 13 tasks, under the 15-task limit.

1. **`add-media-loading`** (current): the whole feature. No dependencies.

## Crate split

All logic lives in `mediasim`. `cli` calls `Icon::from_path(..).unwrap()`, which compiles unchanged with the new error type. `gui` does not exist yet.

## Decisions

### 1. Module layout
Split `media.rs` into a `media/` module, with tests next to each file:
- `media/mod.rs`: `Media`, `MediaType`, `MediaStream`, `from_file` / `from_files` / `from_dir`.
- `media/kind.rs`: classifies a path as image, video or unsupported.
- `media/options.rs`: `LoadOptions`.
- `media/image.rs`: the image loader.
- `media/video.rs`: the video loader.
- `error.rs` (at the crate root): `MediaError`.

`from_images` is removed: it built a `Media` from a name and decoded images, which no longer fits a `Media` that is always loaded from a file.

*Alternative*: keep a single file. Rejected: it would mix two decoders, the directory scan and the model in one file of about 500 lines.

### 2. `Media` shape
```rust
pub enum MediaType { Image, Video }

pub struct Media {
    pub path: PathBuf,
    pub size: u64,
    pub created: Option<SystemTime>,
    pub modified: Option<SystemTime>,
    pub media_type: MediaType,
    pub width: u32,
    pub height: u32,
    pub duration: Option<Duration>,
    pub(crate) frames: Vec<Icon>,
}
```
- The timestamps use `Option<SystemTime>` from `std::fs::Metadata::{created, modified}().ok()`, because `created` is unsupported on some Linux filesystems.
- `duration` uses `std::time::Duration` rather than `f64` seconds; callers get seconds from `as_secs_f64()`.
- The existing derives are kept.

*Alternative*: `chrono` dates. Rejected: it's a new dependency for no gain, since callers can convert.

### 3. `MediaError` with `thiserror`, every variant carries the path
```rust
pub enum MediaError {
    Io { path: PathBuf, source: std::io::Error },
    Image { path: PathBuf, source: rust_sak::image::ImageError },
    Video { path: PathBuf, source: media::Error },
    NoFrames { path: PathBuf },
    Unsupported { path: PathBuf },
}
```
- Each variant carries the path because `from_files` yields results in completion order. Without the path, a caller couldn't tell which file an error belongs to.
- A path that isn't valid UTF-8 can't be passed to `media-rs` and maps to `Unsupported`.
- `rust_sak::fs::FsError` from `list_path` is converted to `Io` carrying the directory path.
- `Icon::from_path` now returns `MediaError` (the `Image` variant). `IconError` is removed.

*Alternative*: keep `IconError` and add a second error type. Rejected: callers would juggle two types for one operation.

### 4. Type detection by extension
- Images: `rust_sak::image::ImageFormat::from_path`.
- Videos: a `const VIDEO_EXTENSIONS: [&str; 7]`, compared ASCII-case-insensitively.
- Neither content sniffing nor `probe` is used to classify. Probing every file during a directory scan would open each one through FFmpeg.

### 5. Video loading
1. `media::probe(path_str)` gives the duration and the dimensions of the first video stream. A file with no video stream fails with `Video` (`media-rs` reports `NoVideoStream`).
2. `FrameExtractor::builder().input(..).interval(Interval::EverySeconds(1.0)).to_callback(..)` runs. The callback rebuilds an `RgbImage` from `to_rgb_bytes()` + `dimensions()`, turns it into an `Icon`, and pushes it into an `Rc<RefCell<Vec<Icon>>>` shared with the caller. The callback must be `'static`, so it can't borrow a local `Vec`.
3. If no frames come out, the result is `NoFrames`.

Width and height come from `probe`, not from the first frame, so an empty extraction still reports correct metadata in the error case and needs no special handling.

*Alternative*: `to_memory()`. Rejected: it buffers every full-resolution RGB frame (about 6 MB per 1080p frame, so about 3.6 GB for a 10-minute video).

### 6. Concurrency: images on the global pool, videos on a dedicated small pool
- `from_files` classifies the paths first.
- Images and unsupported paths go to Rayon's global pool, as today.
- Videos go to a lazily created, process-wide `rayon::ThreadPool` with `VIDEO_WORKERS = max(1, available_parallelism / 4)` threads.
- Both pools send into the same channel. Each pool's dispatch is a `spawn` around a `par_iter`, so neither blocks the caller.

The reason is that FFmpeg decoders are themselves multithreaded. Running one video per core on the global pool would oversubscribe the CPU (cores × FFmpeg threads) and keep many decoder contexts in memory at once.

*Alternatives*:
- A semaphore inside the global pool. Rejected: it parks Rayon workers, which then can't steal image work.
- One pool for everything. Rejected: the oversubscription above.

The `/ 4` ratio is a starting point. Task 3.4 measures it on the fixtures; changing it doesn't affect the API.

### 7. Directory scanning and `LoadOptions`
```rust
LoadOptions::new()       // root only, images + videos
    .recursive(true)
    .images(true)
    .videos(false)
```
- The shape mirrors `rust_sak::fs::ListOptions` (consuming builder, `Default`, `Clone`, `PartialEq`).
- `from_dir` calls `rust_sak::fs::list_path` with `ListOptions::new().recursive(opts.recursive)`. It filters the paths with the classifier from Decision 4 and the image/video flags, then passes them to `from_files`.
- `from_files` and `from_dir` return a named `MediaStream` iterator rather than `impl Iterator`, so callers can store it in a struct field (for example, GUI app state). It owns the channel receiver and yields `Result<Media, MediaError>`.
- An extension filter could be pushed into `ListOptions::extensions`. It isn't, because the image extensions come from `rust-sak`'s format table, and listing them out by hand would drift from it.
- Listing happens up front, so the scan either fails before anything loads or returns an iterator. This gives the "no partial listing" guarantee in the spec.
- `list_path` doesn't follow symlinks and returns paths sorted by name.

### 8. Dependencies
- `media-rs`: added as `{ git = "https://github.com/vegidio/media-rs", rev = "6e268e0…" }` in workspace dependencies, with no features (it has none). The crate is imported as `media`. It's pinned by `rev` because the repository has no tags; switch to a tag once one is published.
- `thiserror = "2"`: added, as the project conventions require.
- `rust-sak`: adds the `fs` feature alongside `image`.

## Risks / Trade-offs

- [`media-rs` and `mediasim` must stay on the same `rust-sak` tag] → Both now use 26.10.1, so Cargo builds a single copy. When `mediasim` moves to a newer `rust-sak`, `media-rs` should move with it, or Cargo will compile two copies again.
- [`media-rs` has no tag] → A `rev` pin is reproducible but doesn't show which version it is. Replace it once `media-rs` is tagged.
- [The first build downloads FFmpeg binaries] → CI and offline builds need network access or `media-rs`'s offline setup. Covered by `media-rs`'s own troubleshooting docs.
- [Statically linked FFmpeg affects licensing] → The licence of the shipped binary depends on the codecs in the FFmpeg build. Review before the first release; out of scope for this change.
- [The video worker count is guessed] → It's a single constant, tuned in task 3.4.
- [Fixtures are about 22 MB of MP4, untracked] → Tests read them from `<workspace>/fixtures`. Committing them as they are would bloat the repository. Short, low-resolution clips would serve the tests equally well. Whether and how to commit them is the user's call; tests don't depend on their size.
- [Frame count for "one per second" depends on `media-rs`'s seek-based sampler] → Tests assert a range of ⌈D⌉ ± 1 frames, not an exact number.
- [Extension-based detection] → A mislabelled file fails at decode time with `Image` or `Video` naming the path. It is never silently misloaded.

## Migration Plan

There are no external consumers. The `Media` / `from_dir` / `IconError` breaking changes land in one go, and `cli` still compiles. Rollback means reverting the change.
