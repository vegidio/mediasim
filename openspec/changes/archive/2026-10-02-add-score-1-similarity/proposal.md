## Why

`mediasim` can load images and videos into per-frame `Icon` signatures and diff two icons, but it cannot answer the
question the whole project exists for: how similar are two media files? There is no `Media`-level comparison and no way
to compare two videos at all. The upcoming `mediasim score <file1> <file2>` command (and later the GUI) needs this, and
because both front ends need it, it belongs in the core crate.

This is slice 1 of 2 of the `add-score` series. The full feature (core similarity plus the CLI `score` command with its
TUI) is estimated at ~16 tasks, over the 15-task limit, so it is split:

1. `add-score-1-similarity` (this change) - `Media`-level similarity in `mediasim`.
2. `add-score-2-cli` - the `score` command, ratatui progress UI and output formatting in `cli`.

## What Changes

- Add a public similarity API on `Media` that returns a score in `[0, 1]`, where `1` means identical and `0` means
  completely different.
- Two images are scored from their single frame signatures.
- Two videos are scored by aligning their per-second frame sequences with Dynamic Time Warping (DTW), so videos of
  different lengths or with trimmed/padded sections can still match.
- Comparing an image with a video is rejected with a dedicated error instead of silently scoring `0`.
- Add a new `thiserror` error type for comparison failures, kept separate from `MediaError` (which is about loading).

## Capabilities

### New Capabilities

- `media-similarity`: comparing two loaded `Media` values and producing a similarity score - image-to-image,
  video-to-video, and the rejection of mixed image/video comparisons.

### Modified Capabilities

(none - `media-loading` requirements are unchanged)

## Impact

- **Crates touched:** `mediasim` only. No `cli` or `gui` code changes in this slice; the CLI placeholder stays until
  slice 2.
- **Code:** a new private DTW module and a public similarity entry point under `crates/mediasim/src/core/`, a new error
  type, and re-exports in `lib.rs`.
- **Infrastructure:** none needed. `rust-sak` has nothing for sequence alignment or similarity scoring (its modules are
  crypto, fetch, fs, github, image, memo, o11y, sysinfo), and `media-rs` only covers video decoding and frame
  extraction, which loading already uses. DTW is app-specific algorithm code, so it lives in `mediasim`.
- **Dependencies:** no new crates. Uses the existing `rayon` and `thiserror`.
