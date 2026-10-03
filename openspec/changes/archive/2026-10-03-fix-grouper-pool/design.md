## Context

See proposal.md (Why) for the symptom and measurements, and `specs/media-grouping/spec.md` for the requirement.

The current state:

- `Media::from_files` decodes images with `into_par_iter().try_for_each_with(...)` inside `rayon::spawn`, on rayon's
  **global** pool. Videos are decoded on `video_pool()`, a dedicated process-wide pool with a quarter of the CPUs
  (`crates/mediasim/src/media/mod.rs`).
- `Grouper::push` (`crates/mediasim/src/core/group.rs`) compares the new media with every earlier one through
  `self.media.par_iter()`, also on the global pool. For videos, `Media::similarity` runs DTW, which uses
  `par_iter_mut` (`core/dtw.rs`), again on whichever pool it is called from.
- `push` is called from a thread outside the pool: the CLI's progress forwarder, or the plain loop on the main thread.
  rayon queues work from outside the pool in a shared queue. A worker only takes from that queue when its own queue,
  and what it can steal from other workers, is empty. While a large decode is split across every worker, a push
  waits until almost all of it is done.

## Goals / Non-Goals

**Goals:**

- A `push` during a batch load completes in about the time its comparisons take, independent of the batch size.
- Video comparisons keep their parallel DTW.
- Total run time is not noticeably worse than today.

**Non-Goals:**

- Reworking how `from_files` schedules decoding, or merging the loading and grouping pools.
- Making `Media::similarity`, when called directly (as `score` does), run on the new pool. Nothing competes with it
  there.

## Crate split

- `mediasim`: all of it. Where comparisons run is part of `Grouper`, and the GUI will drive a `Grouper` during a batch
  load just as the CLI does.
- `cli`: no change. `files` and `dir` get the fix through `Grouper`.
- `gui`: does not exist yet.

## rust-sak / media-rs / new crates

Neither `rust-sak` nor `media-rs` provides thread pools or work scheduling, and this need is internal to how
`mediasim` overlaps its own loading and grouping, so it stays local. It uses `rayon`, already a dependency, the same
way `video_pool()` does. No new crates.

## Decisions

### D1. A dedicated comparison pool, entered with `install`

```rust
/// The process-wide pool that runs `Grouper` comparisons, created on first use.
fn compare_pool() -> &'static rayon::ThreadPool {
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(std::thread::available_parallelism().map_or(1, NonZeroUsize::get))
            .thread_name(|i| format!("mediasim-compare-{i}"))
            .build()
            .expect("failed to spawn the comparison threads")
    })
}

pub fn push(&mut self, media: Media) {
    let matches: Vec<usize> = compare_pool().install(|| self.media.par_iter()/* ... unchanged ... */.collect());
    // ... DSU updates unchanged ...
}
```

- `install` runs the closure on the comparison pool, so the nested `par_iter_mut` in DTW also runs there. Neither
  part of a comparison waits behind decoding.
- One thread per logical CPU, as the user chose. It matches rayon's global default, so video-to-video DTW keeps its
  current parallelism. The pool lives in `core/group.rs` next to its only user, in the same pattern as `video_pool()`.
- *Alternative: compare sequentially, without rayon.* An image comparison takes microseconds, but a video comparison
  runs DTW per pair, and long videos would lose all parallelism. Rejected.
- *Alternative: reuse `video_pool()`.* It has a quarter of the CPUs and is busy decoding videos during a batch, so
  video pushes would starve the same way. Rejected.
- *Alternative: move image decoding to its own pool and leave the global pool for comparisons.* It also fixes this
  case, but it changes loading, which is not broken. A caller's own use of the global pool could still starve
  `push`. Rejected.
- *Alternative: count progress on load and group after loading.* The bar would reach 100% while grouping is still
  running, and grouping would no longer overlap loading. Rejected.

### D2. Test the guarantee with a starved global pool, in its own test binary

`crates/mediasim/tests/grouper_pool.rs`:

1. Load `test1.png`, `test2.png`, `test3.mp4` and `test4.mp4` first, so loading does not depend on the global pool
   later.
2. Park every global-pool worker behind a shared `RwLock` gate with `rayon::broadcast`, run from a spawned thread, and
   wait until all of them have checked in, as `from_files_streams_results_before_the_batch_completes` does with the
   video pool.
3. On a separate thread, push the four media into a `Grouper` and send the result of `finish()` back over a channel.
4. Assert it arrives within a generous timeout (10 s), and that the images are grouped. Then open the gate.

With the global pool fully occupied, a `push` that used it would never finish, so the old behaviour fails with a
timeout instead of hanging, and opening the gate lets the stuck thread end. The videos' push covers DTW running on the
comparison pool. It is a separate integration-test file because each one runs in its own process: parking the global
pool there cannot slow down unrelated tests.

## Risks / Trade-offs

- [More runnable threads than cores during a burst: N decode + N/4 video + N comparison] → The comparison threads are
  idle except during a push, and image comparisons take microseconds. The OS shares the cores, which is what lets
  pushes keep going. If profiling shows contention, the pool size can be lowered without changing anything else.
- [N extra idle threads per process] → Created only when the first `Grouper::push` runs, and they cost only their
  stacks while idle.
- [Calling `push` from inside a global-pool task blocks that worker while the comparisons run] → `install` from a
  worker of another pool keeps that worker taking jobs from its own pool while it waits, so it is not a deadlock.
  Today's callers push from outside any pool.

## Migration Plan

None. No API or output changes. Rollback is reverting the commit.
