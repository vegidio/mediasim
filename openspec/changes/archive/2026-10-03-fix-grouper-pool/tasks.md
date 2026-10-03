## 1. Comparisons on their own pool

- [x] 1.1 In `crates/mediasim/src/core/group.rs`, add the process-wide `compare_pool()` (one thread per logical CPU, threads named `mediasim-compare-{i}`), wrap the comparisons in `Grouper::push` in `compare_pool().install(...)`, and say in `push`'s doc comment that comparisons run on their own pool and do not wait for a batch load (design D1). Verify that the existing `core::group` unit tests pass unchanged with `cargo test -p mediasim core::group`.
- [x] 1.2 Add `crates/mediasim/tests/grouper_pool.rs` as in design D2: load the four fixtures, park every global-pool worker behind a gate, push them into a `Grouper` on another thread, and assert within 10 s that `finish()` returns the `test1.png`/`test2.png` group before opening the gate. Verify that `cargo test -p mediasim --test grouper_pool` passes, and that it fails with the timeout when the `install` from 1.1 is temporarily removed.

## 2. Verification

- [x] 2.1 Check by hand, with a release build in a terminal on macOS: `mediasim dir` on a directory of a few hundred images (for example `~/Downloads/UMD/Reddit/AellaGirl`, 372 files) shows the `Processing` count climbing steadily instead of stopping at `002` and jumping near the end. Also compare `time mediasim dir <dir> | cat` with and without the change (build the "without" binary from the commit before 1.1). Verify by recording both observations, and list Windows and Linux as checked or not checked.
  - Observed on macOS (release builds, `~/Downloads/UMD/Reddit/AellaGirl`, 372 media), by running `mediasim dir` on a
    pseudo-terminal and replaying its output into a virtual screen to timestamp each `Processing` count. Without the
    change ("without" = 70cc02c): the count sat at `002` until ~0.43–0.50 s, then jumped to `371` within ~0.1 s
    (`002` at 25% of runtime, `371` at 50%). With the change: the count climbed steadily (e.g. 15 → 41 → 119 → 130 in the
    first 0.11 s; 119–182 at 10–25% of runtime), with 24–32 distinct updates versus 8–10.
  - `time mediasim dir <dir> | cat`, 5 runs each: without 0.648 s mean, with 0.655 s mean, no meaningful difference;
    the two outputs are byte-identical.
  - Windows: not checked. Linux: not checked.
- [x] 2.2 Run `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace`. Verify that all three succeed with no warnings.
