## 1. Error type

- [x] 1.1 Implement `Display` for `MediaType` (`image` / `video`) in `media/kind.rs`; verify with a unit test asserting both strings
- [x] 1.2 Add the `#[non_exhaustive]` `CompareError` enum with `MediaTypeMismatch { left, left_type, right, right_type }` to `error.rs` (design D2); verify with a unit test that the message names both paths and both types

## 2. DTW

- [x] 2.1 Create private `core/dtw.rs` with `mean_cost(rows, cols, cost)`: two rolling rows of `(cost, steps)`, shorter side on the columns, tie-break on more steps, no backtracking (design D4); verify `cargo build -p mediasim` succeeds
- [x] 2.2 Fill each row's frame costs in parallel with Rayon into a reused buffer, with a minimum chunk length, keeping the DP sequential (design D5); verify results equal a sequential reference on a random 50×37 matrix in a unit test
- [x] 2.3 Add DTW unit tests: 1×1 matrix, hand-computed 3×3 and rectangular matrices (cost and step count), all-zero matrix, and bit-identical results when the input is transposed, including a matrix with deliberate ties; verify `cargo test -p mediasim dtw` passes

## 3. Media similarity

- [x] 3.1 Create `core/similarity.rs` with `Media::similarity(&self, other) -> Result<f64, CompareError>`: image/image as `1 - calculate_diff`, video/video via `dtw::mean_cost`, mixed types as `MediaTypeMismatch`, result clamped to `[0, 1]` (design D1, D3); verify `cargo build -p mediasim` succeeds
- [x] 3.2 Add unit tests building `Media` from hand-made icons: self-comparison is `1`, black vs white rounds to `0`, results are symmetric, image-vs-video and video-vs-image both fail with `MediaTypeMismatch`, single-frame videos equal their frame similarity, and a truncated video scores higher than an unrelated one; verify `cargo test -p mediasim similarity` passes
- [x] 3.3 Re-export `CompareError` from `lib.rs` and rewrite the crate docs to show loading two files and calling `similarity`; verify `cargo test --doc -p mediasim` passes

## 4. Integration

- [x] 4.1 Add `crates/mediasim/tests/similarity.rs` over the fixtures: `test1.png`/`test2.png` and `test3.mp4`/`test4.mp4` score in `[0, 1]` and symmetrically, each file scores `1` against itself, and `test1.png` vs `test3.mp4` is a `MediaTypeMismatch`; verify `cargo test -p mediasim --test similarity` passes
- [x] 4.2 Run `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace`; verify all three succeed with no warnings
