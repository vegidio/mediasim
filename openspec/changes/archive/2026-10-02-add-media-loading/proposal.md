## Why

Comparing media needs a loaded `Media` for every file, but `mediasim` today only loads images, records nothing beyond a name and dimensions, silently skips directory errors, and has its own directory walker that duplicates `rust-sak`. Videos are half of what MediaSim compares, so loading needs to cover them before any comparison features can be built on top.

## What Changes

- Load **videos** as well as images: an image gives one frame; a video gives one frame per second of playback. Every frame becomes an `Icon` signature.
- **BREAKING** Reshape `Media`: replace `name: String` with `path`, and add file size, creation and modification dates, media type (image or video), width/height and duration (videos only).
- Keep `Media::from_file` and `Media::from_files`, which still stream results in completion order, with failures reported per file. Each failure now names the file it came from.
- **BREAKING** `Media::from_dir` takes a `LoadOptions` instead of a `recursive: bool`. The options choose root-only vs. recursive scanning and images only, videos only or both.
- **BREAKING** `from_dir` returns an error when the directory is missing or any subdirectory can't be read, instead of returning fewer results without saying so.
- **BREAKING** Replace `IconError` with a `MediaError` enum covering I/O, image, video and unsupported-file failures. `Icon::from_path` returns it too.
- Supported video extensions: `.avi`, `.m4v`, `.mp4`, `.mkv`, `.mov`, `.webm`, `.wmv`. Supported image formats stay whatever `rust-sak`'s image module recognises.

## Capabilities

### New Capabilities
- `media-loading`: turning image and video files, one file at a time, in batches or by scanning a directory, into `Media` values with file metadata and frame signatures.

### Modified Capabilities
<!-- None: openspec/specs/ is empty. -->

## Impact

- **Crates**: `mediasim` only. `cli` calls `Icon::from_path(..).unwrap()`, which still compiles after the error type changes, so it only needs a rebuild. No logic moves into a front end.
- **Infrastructure found**:
  - `rust-sak` `fs::list_path` + `ListOptions` covers directory listing (recursive or not, sorted, no symlink following, errors reported). It replaces the local `collect_image_paths`.
  - `rust-sak` `image::ImageFormat::from_path` covers image detection.
  - `media-rs` `probe` covers video duration and dimensions, and `FrameExtractor` with `Interval::EverySeconds` covers frame sampling.
  - Nothing first-party provides a video-extension list. The user's chosen set is specific to this app, so it stays in `mediasim`.
- **Dependencies**:
  - Adds `media-rs`, a git dependency that statically links FFmpeg. The first build downloads prebuilt FFmpeg binaries.
  - Adds `thiserror`.
  - Enables `rust-sak`'s `fs` feature.
- **Public API**: `Media`, `from_dir`, `IconError` → `MediaError` (all breaking; there are no external consumers yet).
