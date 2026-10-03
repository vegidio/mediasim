## Why

On a directory of a few hundred images, `mediasim dir` showed `Processing [002/372]` for almost the whole run, then
jumped to nearly 100%. `Grouper::push` compares each new media in parallel on rayon's global pool, the pool
`Media::from_files` uses to decode images. Work started from outside that pool waits until its workers run out of
their own work. So from the third file on, every push waited until nearly all images had loaded. That breaks the
`media-grouping` promise that grouping runs while files are still loading, and leaves the progress display stuck. It
affects `files` too, whenever many files are given.

Measured on that 372-file directory (release build): push #3 blocked for 339 ms while results #4–#359 queued up and
then all arrived within ~55 ms. With the comparisons on their own pool, results arrived steadily from 7 ms to 600 ms,
and the total time did not change.

The change has 4 tasks, well within the 15-task limit, so it is a single change.

## What Changes

- `Grouper::push` runs its comparisons on a dedicated, process-wide rayon pool with one thread per logical CPU,
  instead of on rayon's global pool. A video's DTW, which uses rayon inside the comparison, runs on that pool too.
- Adding a media to a `Grouper` no longer waits for an in-flight batch load to finish, so the `Processing` display
  of `files` and `dir` advances as each file loads.
- No public API changes. `Grouper`'s groups and their order are unchanged.

Out of scope: faster-than-quadratic grouping, and how `Media::similarity` schedules work when called directly (as
`score` does). Neither competes with a batch load today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `media-grouping`: "Incremental grouping" gains an explicit guarantee that adding a media does not wait for files
  that are still loading.

## Impact

- **Crates touched:** `mediasim` only (`crates/mediasim/src/core/group.rs` and a new test in `crates/mediasim/tests/`).
  The scheduling fix belongs with `Grouper`, so the GUI gets it too. `cli` needs no code change; `files` and `dir`
  get the fix through `Grouper`.
- **Infrastructure:** nothing in `rust-sak` or `media-rs` provides thread pools or work scheduling. `mediasim` already
  gives videos their own rayon pool (`video_pool` in `media/mod.rs`), and this follows the same pattern. `rayon` is
  already a dependency.
- **Dependencies:** none added.
- **Runtime:** one more pool of N threads, idle except during comparisons. For short bursts, more threads than cores
  can be runnable (see design Risks).
