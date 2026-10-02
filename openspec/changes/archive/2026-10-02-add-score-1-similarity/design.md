## Context

See proposal.md (Why) for motivation and `specs/media-similarity/spec.md` for the required behaviour.

The relevant parts of `mediasim` today:

- `Media` (in `media/mod.rs`) carries `frames: Vec<Icon>`, which is `pub(crate)`: one icon for an image, one per second
  for a video.
- `core::diff::calculate_diff(&Icon, &Icon) -> f64` already returns a normalized difference in `[0, 1]`, with luma
  weighted fully and the two chroma channels at half weight.
- `MediaError` is the loading error. Every variant names a path, because batch loads return results in completion order.

The Go version on `main` defines how scoring should behave (DTW over per-second frames, `1 - diff` for images). Per the
project context it is a behavioural reference only, so the design below keeps that behaviour but not the Go structure.

## Slices

| # | Change                   | Delivers                                                                                   | Depends on | Status      |
|---|--------------------------|--------------------------------------------------------------------------------------------|------------|-------------|
| 1 | `add-score-1-similarity` | `Media`-level similarity in `mediasim`: image/image, video/video (DTW), mixed-type error   | -          | **current** |
| 2 | `add-score-2-cli`        | `mediasim score <file1> <file2>` in `cli`: clap, ratatui inline progress (gradient bar, spring animation, ETA), score formatting, non-TTY output, styled errors; removes the placeholder `main.rs` | slice 1    | pending     |

Decisions already agreed for slice 2, recorded here so they are not lost: the score prints rounded to 5 decimal places
with trailing zeros trimmed (`0.95513`, `0.5`, `1`, `0`); when stdout is not a terminal only the bare score is printed;
the ETA shows `--` until the first file has loaded; progress advances per file; errors print as `🧨 <message>` in red
on stderr with a non-zero exit; only the `score` command is in scope (no `-o`, flip/rotate or grouping commands).

## Goals / Non-Goals

**Goals:**

- One public entry point that both `cli` and `gui` call to score two `Media` values.
- Video scoring whose memory grows linearly with video length, not quadratically.
- Bit-for-bit symmetric results: `a.similarity(&b) == b.similarity(&a)`.

**Non-Goals:**

- Flip/rotate-tolerant comparison, grouping many files, and progress reporting during comparison.
- Speed-ups that change results, such as limiting how far DTW may warp (a Sakoe-Chiba band) or dropping frames.
- Matching Go's scores digit for digit (see Risks).
- Any `cli` or `gui` change.

## Decisions

### D1. API: `Media::similarity(&self, other: &Media) -> Result<f64, CompareError>`

A method reads naturally at call sites (`a.similarity(&b)?`) and keeps `frames` private to the crate. It borrows both
values, so callers can compare one `Media` against many without cloning.

- *Alternative: a free function `similarity(a, b)`.* Works the same, but the method form matches `Media::from_file` and
  is easier to discover.
- *Alternative: return `f64` and score mixed types as `0` (the Go behaviour).* Rejected: a silent `0` cannot be told
  apart from "completely different", and the user decided mixed types are an error.
- *Alternative: return `Option<f64>`.* Rejected: `None` says nothing about why, and front ends need a message.

### D2. A separate `CompareError`, not a new `MediaError` variant

`MediaError` is about loading a file, and every variant has a single `path()`. A comparison failure involves two files
and no I/O, so folding it in would weaken `MediaError::path()`. Instead, add a `thiserror` enum next to it in `error.rs`:

```rust
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum CompareError {
    #[error("cannot compare {left_type} {} with {right_type} {}", left.display(), right.display())]
    MediaTypeMismatch { left: PathBuf, left_type: MediaType, right: PathBuf, right_type: MediaType },
}
```

`MediaType` gets a `Display` impl (`image` / `video`) so the message reads
"cannot compare image a.png with video b.mp4". The enum is marked `#[non_exhaustive]` so future comparison errors can
be added without a breaking change.

### D3. Frame similarity is `1 - calculate_diff`

Reuse the existing, tested metric rather than adding a second one. Images compare their single frames directly. Note
that `calculate_diff` already clamps to `[0, 1]`, so frame similarity is always in range.

### D4. DTW with two rolling rows that also count steps, and no backtracking

The video score is `1 - (total cost of the cheapest alignment / number of steps on that alignment)`, where a cell's cost
is `calculate_diff` of the two frames. This keeps the meaning the spec asks for: the average frame similarity along the
best alignment.

The Go version builds the full cost matrix and the full cumulative matrix (two n×m allocations), then walks back through
them only to learn the path length. Here, each dynamic-programming cell stores a pair `(cost, steps)`, and only the
previous and current rows are kept:

```text
cell(i, j) = frame_cost(i, j) + best_of(cell(i-1, j-1), cell(i-1, j), cell(i, j-1)),  steps + 1
best_of   = lowest cost; on an exact cost tie, the one with MORE steps
```

- Memory is O(min(n, m)): the shorter video is put on the columns.
- No backtracking pass and no stored path.
- **Tie-break on step count**, not on direction. Choosing by value means transposing the matrix (swapping the inputs)
  picks the same predecessors with the same arithmetic, so results are bit-identical in either order - this is what
  makes the symmetry requirement hold exactly. Preferring more steps on a tie gives the lower average cost, which is
  the better alignment for this score.
- The result is clamped to `[0, 1]` as a final guard.

The algorithm lives in a private `core/dtw.rs` and takes the cost as a closure,
`fn mean_cost(rows: usize, cols: usize, cost: impl Fn(usize, usize) -> f64 + Sync) -> f64`. That keeps it independent
of `Icon`, so unit tests can feed hand-written matrices.

- *Alternative: port the Go version (full matrices + backtracking).* Rejected: quadratic memory - two 2-hour videos
  (7 200 frames each) would need two ~415 MB matrices - for no change in result.
- *Alternative: normalize by `n + m` or `max(n, m)` instead of path length.* Rejected: it no longer means "average
  similarity along the alignment", and scores would drift with length differences.

### D5. Compute each row's frame costs in parallel with Rayon; keep the DP sequential

Almost all of the work is the n×m `calculate_diff` calls (each ~363 multiply-adds); the DP update per cell is a few
comparisons. For each row, fill a reused `Vec<f64>` of the row's frame costs with `par_iter_mut` (with a minimum chunk
length so short rows are not split into tiny tasks), then run the cheap sequential DP over it. The calling thread joins
Rayon's global pool, which is fine because comparison runs after loading has finished.

- *Alternative: parallelize along anti-diagonals (wavefront).* Rejected: more complex and needs three rows, for little
  gain once the expensive part is already parallel.
- *Alternative: precompute the whole cost matrix in parallel.* Rejected: brings back quadratic memory (D4).

### D6. Module layout

- `core/dtw.rs` - private DTW (D4, D5) with its unit tests.
- `core/similarity.rs` - `impl Media { pub fn similarity(..) }` dispatching on `(media_type, media_type)`; unit tests
  build `Media` values from hand-made icons.
- `error.rs` - `CompareError`; `media/kind.rs` - `Display for MediaType`.
- `lib.rs` - re-export `CompareError` and update the crate docs, which still describe only `euc_metric`.
- `tests/` - an integration test over the fixtures (`test1.png`/`test2.png`, `test3.mp4`/`test4.mp4`).

No new crates: `rayon` and `thiserror` are already dependencies. Nothing in `rust-sak` or `media-rs` covers sequence
alignment or scoring, and DTW over icon signatures is specific to this app, so it is local code, not an extension of
either first-party crate.

## Risks / Trade-offs

- [Scores differ slightly from the Go version] → Accepted. The Rust metric normalizes by 2 805 and clamps, where Go used
  2 804 without a clamp, and DTW tie-breaking is by step count rather than direction. Differences show up around the
  4th–5th decimal place. Go is a behavioural reference, not a numeric oracle.
- [Long videos are quadratic in time: two 2-hour videos mean ~52 M frame comparisons] → Parallel row costs (D5) keep
  this to seconds on a typical machine. If it becomes a problem, a later change can add a warping band or a cheap
  pre-filter, both of which change results and so are out of scope here.
- [Floating-point ties are rare, so the tie-break rarely matters] → It still matters for correctness of the symmetry
  guarantee, and is covered by a unit test that swaps inputs on a matrix with deliberate ties.
- [`#[non_exhaustive]` on `CompareError` forces a wildcard arm in callers] → Acceptable; slice 2 only needs `Display`.
