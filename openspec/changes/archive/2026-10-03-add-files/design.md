## Context

See proposal.md (Why) for the motivation, and `specs/media-grouping/spec.md` and `specs/cli-files/spec.md` for the
required behaviour.

What this change builds on:

- `Media::from_files(Vec<P>) -> MediaStream` loads in parallel and yields results in completion order. `Media.path` is
  the exact path that was passed in.
- `Media::similarity(&Media) -> Result<f64, CompareError>`. Its only error is `MediaTypeMismatch`, for an image paired
  with a video. Two long videos can take a while, because DTW runs over every pair of per-second frames.
- `Media` exposes `width`, `height`, `size`, `duration: Option<Duration>` and `media_type`, which are all the quality
  order needs.
- `cli::progress::run(stream, total, color) -> Result<Vec<Media>, CliError>` draws the inline ratatui line with a
  hard-coded `Loading` label. A forwarding thread drains the blocking `MediaStream` into an `mpsc` channel, and the
  60 fps loop reads it with `try_recv`.
- The Go reference on `main`: `internal/dsu/dsu.go` (union by rank with recursive path compression),
  `load_and_group.go` (each new media is compared with all earlier ones as it arrives), `mediasim.go::extractGroups`
  (groups of 2+, sorted by length, then megapixels, then size), and `cmd/cli/internal/charm/print.go` (report lines,
  yellow `#e5db08`). Go builds its groups from a map, so their order changes from run to run. This change fixes that.

## Goals / Non-Goals

**Goals:**

- Group while files load, so the progress bar covers the whole run and not only the loading.
- Keep the UI loop responsive (redraws and Ctrl+C) while comparisons run.
- Print the same output for the same arguments on every run.
- `score` stays exactly as it looks and behaves today.

**Non-Goals:**

- Faster-than-quadratic grouping, such as indexing icons to skip obviously different pairs. Every new media is still
  compared with every earlier one (see Risks).
- Treating `a.png` and `./a.png` as the same file. Deduplication compares paths exactly as typed.

## Crate split

- `mediasim`: the union-find, the `Grouper` (threshold rule, transitive merge, mixed-type handling) and the quality
  order inside each group. The GUI will need exactly these groups, so all of it is shared.
- `cli`: the `files` subcommand and its threshold parser, deduplicating the arguments, ordering groups by argument
  position, all printing, and the progress display change. Group order is a CLI choice because it depends on the
  command line, which the GUI does not have.
- `gui`: does not exist yet.

## rust-sak / media-rs / new crates

None used and none added. `rust-sak` has no union-find. A DSU is about 30 lines and specific to this algorithm, so it
is not worth adding to `rust-sak`, and a crate such as `petgraph` or `disjoint` would be a large dependency for very
little. `rayon` is already a `mediasim` dependency.

## Decisions

### D1. `core/dsu.rs`: a growable union-find, crate-private

```rust
pub(crate) struct Dsu { parent: Vec<usize>, rank: Vec<u8> }
impl Dsu {
    fn push(&mut self) -> usize;              // adds a singleton set, returns its index
    fn find(&mut self, x: usize) -> usize;    // iterative, with path halving
    fn union(&mut self, a: usize, b: usize);  // union by rank
}
```

- **Growable** (`push`) and not pre-sized: the `Grouper` does not need to know the total up front. Go pre-sized its DSU
  with `total`.
- **Iterative path halving** and not Go's recursive compression: there is no recursion depth to worry about, and it
  is just as fast in practice.
- **`pub(crate)`**: it is an implementation detail of grouping, so it is not part of the public API.

### D2. `core/group.rs`: a public, incremental `Grouper`

```rust
pub struct Grouper { threshold: f64, media: Vec<Media>, dsu: Dsu }

impl Grouper {
    pub fn new(threshold: f64) -> Self;        // # Panics unless 0 <= threshold <= 1
    pub fn push(&mut self, media: Media);
    pub fn len(&self) -> usize;
    pub fn is_empty(&self) -> bool;
    pub fn finish(self) -> Vec<Vec<Media>>;
}
impl Extend<Media> for Grouper { ... }         // so callers can treat it like a Vec (see D4)
```

- `push` adds the media to the DSU. It then compares the media with every earlier one **of the same `media_type`**
  in parallel (`par_iter` on rayon's global pool), collects the indices whose score is `>= threshold`, and unions them
  one after another. Filtering by type first means `similarity` can never return `MediaTypeMismatch` here, so the
  result is matched explicitly and the impossible branch is an `unreachable!` with a message. No error is swallowed.
- `finish` groups indices by `find(i)`, keeps groups of two or more, sorts each group by quality (D3), and orders the
  groups by the path of their best member. Callers then get the same output from `mediasim` whatever the arrival
  order. The CLI reorders the groups again for display (D5).
- An invalid threshold panics in `new` and does not return a `Result`. Both front ends validate input before it gets
  here (clap in the CLI, a 0–1 slider in the GUI), so a bad value is a programming error, not a runtime one.
- *Alternative: a batch `fn group(media: Vec<Media>, threshold) -> Vec<Vec<Media>>`, like Go's `GroupMedia`.* That
  would only start comparing after every file has loaded, so the progress bar would hit 100% and then stall. An
  incremental API can also be used as a batch one (`grouper.extend(all)`), but not the other way round.
- *Alternative: an iterator adapter over `MediaStream` that yields progress events, like Go's `LoadAndGroupMedia`
  channel.* That ties grouping to one loading API and its error type. `Grouper` has no I/O and is easier to test.

### D3. Quality order

The order is a `sort_by` with a comparator chain:
`duration.unwrap_or_default()` descending, then `u64::from(width) * u64::from(height)` descending, then `size`
descending, then `path` ascending. The path is the last tie-break so equal-quality members always come out in the
same order.

### D4. Progress display: label and sink become parameters

```rust
pub fn run<C>(stream: MediaStream, total: usize, label: &str, sink: C, color: bool) -> Result<C, CliError>
where C: Extend<Media> + Send + 'static
```

- The forwarding thread owns `sink`. For each `Ok(media)` it calls `sink.extend(once(media))` and then sends a tick
  through the channel. It sends the first `Err` and stops. When the stream ends it returns `sink` through its
  `JoinHandle`, and `run` joins the thread once the bar has settled.
- For `files`, the sink is a `Grouper`, so comparisons run on the forwarding thread (and rayon), never on the UI loop.
  Redraws and Ctrl+C stay responsive even when a long video pair is being compared. A tick means "loaded and
  compared", which is what the `Processing` label says.
- For `score`, the sink is `Vec::with_capacity(2)` and the label is `"Loading"`, so it behaves exactly as before.
- On an error or Ctrl+C, `run` returns without joining. The receiver is dropped, so the forwarder's next send fails
  and it stops, as it does today. A comparison already running finishes in the background while the process exits.
- The line becomes `{label}   [n/total] …`. The existing `Loading   [1/2]` tests stay as they are, and a new test
  covers `Processing`.
- *Alternative: compare on the UI thread as ticks arrive.* Rejected, because a long video DTW would freeze the bar
  and delay Ctrl+C.
- *Alternative: share the `Grouper` through `Arc<Mutex<_>>`.* Rejected. Moving ownership into the thread and back out
  through the `JoinHandle` needs no lock.

### D5. `files.rs`: the command

1. Deduplicate the paths, keeping the first occurrence (exact `PathBuf` equality), and record each path's argument
   position.
2. **Interactive** (stdout is a terminal): a blank line, `output::header(n)`, `output::threshold(t)`, then
   `progress::run(stream, n, "Processing", Grouper::new(t), color)`, then `finish()`.
   **Plain:** `for result in stream { grouper.push(result?) }`, then `finish()`.
3. Sort the groups by the smallest argument position among their members. This is a stable, run-independent order,
   because positions come from the arguments and not from load order.
4. Print `output::groups(&groups, color)`, or `✅ No similar media found` if there are none, on a terminal. When
   piped, print `output::plain_groups(&groups)`, which prints nothing when there are no groups.

If deduplication leaves fewer than two distinct paths (`files a.png a.png`), the command still runs. It loads one
file, finds no groups, and reports that. Clap has already enforced the "at least two paths" usage rule on the raw
arguments.

### D6. Arguments

```rust
Files {
    #[arg(required = true, num_args = 2..)] files: Vec<PathBuf>,
    #[arg(short, long, default_value_t = 0.8, value_parser = parse_threshold)] threshold: f64,
}
```

`parse_threshold` parses an `f64` and accepts it only if it is finite and in `0.0..=1.0`. Anything else becomes a clap
value error, which exits with code 2. `-t` belongs to `files` only, not to the whole program as in Go, because `score`
does not use it.

### D7. Output

New in `output.rs`, all pure and unit-tested:

- `YELLOW = (0xe5, 0xdb, 0x08)`, from Go's palette.
- `threshold(t, color)` → `🔎 Grouping media with at least <format_score(t)> similarity threshold...`. The threshold
  reuses `format_score`, so `0.8` prints as `0.8` and not `0.80000`.
- `media_info(&Media)` → `(5.3 MP)`, or `(12 sec, 0.9 MP)` for a video (whole seconds, truncated).
- `groups(&[Vec<Media>], color)` → for each group, a blank line, `Group <N>:` with N in magenta, and
  `  -> <path> <info>`, where the first member's line is bold. Bold depends on the same `color` flag as the colours,
  so a `NO_COLOR` or non-terminal stream gets no escapes at all.
- `no_matches()` → `✅ No similar media found`.
- `plain_groups(&[Vec<Media>])` → paths joined by `\n`, with groups separated by an empty line.

Paths print with `Path::display()`, as typed.

## Risks / Trade-offs

- [Comparisons grow with the square of the file count. Hundreds of long videos mean many DTW runs] → Each `push`
  compares in parallel, which is enough for `files` (a handful of paths). A future `dir` command can add pre-filtering
  without changing `Grouper`'s API.
- [The last ticks can lag behind loading, because comparing happens on the forwarding thread while later files have
  already loaded] → This is intended. The bar measures the whole job, and the ETA uses the average time per processed
  file.
- [`a.png` and `./a.png` are not deduplicated, so a file can be grouped with itself under two spellings] → This is
  documented as a non-goal. Canonicalising would change the paths that are printed, which goes against the decision to
  print paths as typed.
- [`Grouper::new` panics on an invalid threshold] → Documented under `# Panics`. Both front ends validate first.
