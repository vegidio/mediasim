## 1. Dependencies and errors

- [x] 1.1 Add `media-rs` (git, `rev = "6e268e0…"`, imported as `media`) and `thiserror = "2"` to workspace dependencies, enable `rust-sak`'s `fs` feature, and wire all three into `crates/mediasim/Cargo.toml`. Verify that `cargo build -p mediasim` succeeds (the first build downloads FFmpeg).
- [x] 1.2 Add `error.rs` with the `thiserror`-based `MediaError` (`Io`, `Image`, `Video`, `NoFrames`, `Unsupported`, each carrying the path) plus conversions. Verify with unit tests that each variant's `Display` names the path and `source()` is set where one exists.
- [x] 1.3 Remove `IconError`, make `Icon::from_path` return `MediaError`, and update the `lib.rs` re-exports and doc example. Verify that `cargo test -p mediasim` (including doctests) passes and `cargo build -p cli` still compiles.

## 2. Model and classification

- [x] 2.1 Split `media.rs` into the `media/` module described in design.md (Decision 1), keeping the existing tests passing. Verify that `cargo test -p mediasim` is green with no behavior change yet.
- [x] 2.2 Add `MediaType` and the extension classifier (`rust-sak` image formats + `VIDEO_EXTENSIONS`: avi, m4v, mp4, mkv, mov, webm, wmv). Verify with unit tests covering upper/lower case, every video extension, an image extension and `notes.txt` → unsupported.
- [x] 2.3 Reshape `Media` (path, size, created, modified, media_type, width, height, duration, frames) and add a metadata helper built on `std::fs::metadata`. Verify with a unit test on a temp file that size and modified are correct and created is `Some` or `None` without erroring.

## 3. Loading

- [x] 3.1 Implement the image loader (decode → one `Icon`, dimensions from the image, `duration: None`). Verify with a test on `fixtures/test1.png` checking type, dimensions, one frame and file size.
- [x] 3.2 Implement the video loader (`probe` → dimensions/duration; `FrameExtractor` `EverySeconds(1.0)` + `to_callback` → `Icon`s; `NoFrames` on empty output; non-UTF-8 path → `Unsupported`). Verify with a test on `fixtures/test3.mp4` that the frame count is ⌈duration⌉ ± 1 and the metadata is correct.
- [x] 3.3 Implement `Media::from_file` dispatching by type. Verify with tests: image OK, video OK, `.txt` → `Unsupported`, missing file → error naming the path.
- [x] 3.4 Rework `from_files` so images run on the global pool and videos on the dedicated `VIDEO_WORKERS` pool, sharing one channel. Verify with a test on a mixed batch (png + mp4 + missing path) that it yields exactly 3 results (2 OK, 1 error with the path), then time the four fixtures to sanity-check the `VIDEO_WORKERS` ratio.
- [x] 3.5 Add the `LoadOptions` builder (`recursive`, `images`, `videos`; defaults root-only, both types). Verify with unit tests for defaults and builder chaining.
- [x] 3.6 Re-implement `from_dir(dir, &LoadOptions) -> Result<MediaStream, MediaError>` on `rust_sak::fs::list_path`, deleting `collect_image_paths`. Verify with temp-tree tests: root-only vs. recursive, images-only, videos-only, `.txt` skipped, missing directory → `Err(Io)`, and (on Unix) an unreadable subdirectory in a recursive scan → `Err(Io)`.

## 4. Wrap-up

- [x] 4.1 Run `cargo fmt --check`, `cargo clippy --workspace --all-targets` (pedantic, no new warnings) and `cargo test --workspace`. Verify that all three pass cleanly.
