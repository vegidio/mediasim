## Context

See proposal.md (Why) for the motivation, and `specs/cli-dir/spec.md` and `specs/media-loading/spec.md` for the
required behaviour.

What this change builds on:

- `Media::from_dir(dir, &LoadOptions) -> Result<MediaStream, MediaError>` already scans a directory and loads the
  selected files. `LoadOptions` has `recursive`, `images` and `videos`. The listing is a private `list_media` in
  `crates/mediasim/src/media/mod.rs`, built on `rust_sak::fs::list_path` and filtered by `MediaType::from_path`.
- `rust_sak::fs::list_path` walks with `WalkDir::new(dir).min_depth(1).sort_by_file_name()`. Entries keep the prefix
  they were given, symlinks are not followed below the root, and any unreadable entry fails the whole call. Because of
  `min_depth(1)`, a path that is a regular file yields its own (skipped) root entry and nothing else, so the call
  returns `Ok(vec![])` and not an error. That is the gap this change fixes in `rust-sak`.
- `crates/cli/src/files.rs::run(files, threshold)` holds the whole grouping pipeline: deduplicate, choose interactive
  or plain, `progress::run(stream, n, "Processing", Grouper::new(t), color)` or a plain loop, order groups by path
  position, and print. Only its header line is specific to `files`.
- The Go reference on `main` (`cmd/cli/cli.go`, `dir` command): `-r/--recursive`, `--mt image|video|all`, and the
  header `⏳ Calculating similarity in the directory <dir>` with the directory in green.

## Goals / Non-Goals

**Goals:**

- `dir` and `files` share one grouping pipeline, so their output, progress and errors cannot drift apart.
- The progress total is the real number of files to load, known before loading starts.
- A path that is not a directory is reported as an error by every caller of `list_path`, not only by `mediasim`.

**Non-Goals:**

- Faster-than-quadratic grouping for large directories. `Grouper` still compares every new media with every earlier
  one of the same type (see Risks).
- Accepting Go's spellings `--mt`, `image` and `video`. The flag and values are what the spec lists, and nothing else.
- Following symbolic links into subdirectories. That stays as `media-loading` already specifies.

## Crate split

- `rust-sak`: `fs::list_path` fails with `FsError::Io` of kind `NotADirectory` when its path exists but is not a
  directory.
- `mediasim`: a public `Media::list_dir` returns the files a directory load selects. `from_dir` is defined on top of
  it, so the two cannot disagree. The GUI needs the same list for its progress total and its ordering, so this is
  shared logic.
- `cli`: the `dir` subcommand and its options, mapping `--media-type` and `--recursive` to `LoadOptions`, the `dir`
  header, and the shared grouping pipeline taken out of `files.rs`.
- `gui`: does not exist yet.

## rust-sak / media-rs / new crates

- `rust-sak` `fs` (already a dependency): `list_path` and `ListOptions`. The not-a-directory fix lands there because
  any caller listing a path the user typed has the same problem, and a silent empty result is a bug, not a
  `mediasim`-specific need. It is released as `26.10.2` and the pin in the workspace `Cargo.toml` moves to that tag.
- `media-rs`: not used by this change.
- No new crates. `clap`'s `ValueEnum` derive (already enabled through `derive`) covers the media-type values.

## Decisions

### D1. `rust-sak`: `list_path` rejects a path that is not a directory

Before walking, `list_path` reads `std::fs::metadata(directory)`. If that fails, the error is returned as it is
(`NotFound` for a missing path, as today). If the path is not a directory, it returns
`FsError::Io(io::Error::new(ErrorKind::NotADirectory, ...))`.

- `metadata` follows symlinks, which matches `WalkDir`'s default `follow_root_links(true)`. A symlink to a directory
  given as the root still lists that directory, as it does now.
- `ErrorKind::NotADirectory` is stable since Rust 1.83, below the MSRV, so the kind is portable and testable.
- *Alternative: check `is_dir()` in `mediasim`.* Rejected: every other `list_path` caller would keep the silent empty
  result.
- *Alternative: drop `min_depth(1)` and inspect the root entry.* It works too, but an explicit check before the walk
  says what it means and does not change how the walk itself behaves.

Release: bump `version` in `rust-sak/Cargo.toml` to `26.10.2`, commit, tag `26.10.2` and push. Pushing is a release,
so it needs the user's go-ahead first.

### D2. `mediasim`: `Media::list_dir`

```rust
impl Media {
    /// The media files `from_dir` would load, sorted by name within each directory.
    pub fn list_dir(dir: impl AsRef<Path>, options: &LoadOptions) -> Result<Vec<PathBuf>, MediaError>;

    pub fn from_dir(dir: impl AsRef<Path>, options: &LoadOptions) -> Result<MediaStream, MediaError> {
        Ok(Self::from_files(Self::list_dir(dir, options)?))
    }
}
```

- The private `list_media` becomes `list_dir`. Its body and its existing tests stay, so recursion, the type filter and
  the error mapping are not rewritten.
- *Alternative: give `MediaStream` a `len()` or an exact `size_hint`.* That solves the progress total, but the CLI
  also needs the ordered list to sort groups, and the stream only knows completion order.
- *Alternative: return `(MediaStream, usize)`, as Go's `LoadMediaFromDirectory` does.* Rejected for the same reason,
  and because a tuple return breaks the existing `from_dir` signature.

### D3. Arguments

```rust
#[derive(Debug, Args)]
pub struct GroupArgs {
    /// The minimum similarity, from 0 to 1, for two files to be grouped.
    #[arg(short, long, default_value_t = 0.8, value_parser = parse_threshold, allow_negative_numbers = true)]
    pub threshold: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum MediaKind { Images, Videos, All }

Files { #[arg(required = true, num_args = 2..)] files: Vec<PathBuf>, #[command(flatten)] group: GroupArgs },
Dir {
    directory: PathBuf,
    #[arg(short, long)] recursive: bool,
    #[arg(short = 'm', long, value_enum, default_value_t = MediaKind::All)] media_type: MediaKind,
    #[command(flatten)] group: GroupArgs,
},
```

- `GroupArgs` is flattened into both commands so `-t` is defined and validated once. The existing `files` parsing
  tests keep passing without changes to their command lines.
- `MediaKind` is a CLI type, not `mediasim::MediaType`. It has an `All` value that the library type does not have and
  should not have. A small `fn load_options(self, recursive: bool) -> LoadOptions` maps it in `args.rs`.
- `-m` is `-m` because clap short flags are one character. `-mt` is not offered, as decided during exploration.
- `directory` is a single required positional, so clap gives the exit-2 usage errors for zero or two paths.

### D4. One grouping pipeline: `cli/src/group.rs`

The body of `files::run` after deduplication moves to:

```rust
/// Loads `paths`, groups them at `threshold`, and prints the result, with `header` as the first report line.
pub fn run(paths: &[PathBuf], threshold: f64, header: impl FnOnce(bool) -> String) -> Result<(), CliError>
```

- `paths` is borrowed because the caller's `header` closure borrows it too. `run` copies it once for
  `Media::from_files` and keeps the slice for ordering the groups.
- `header` takes the colour flag and is only called on a terminal. `files` passes
  `|c| output::header(paths.len(), c)`, and `dir` passes `|c| output::dir_header(&directory, c)`.
- `files::run` becomes "deduplicate, then `group::run`". `dir::run` becomes "`Media::list_dir`, then `group::run`".
  The list from `list_dir` has no repeats, so it skips deduplication.
- Group ordering moves with the pipeline and is renamed `in_path_order`. It builds a
  `HashMap<&Path, usize>` of positions once instead of searching the list for every member. That is the same order
  as before, but no longer `O(members x paths)` on a directory with thousands of files.
- `list_dir` errors return through the existing `CliError::Load`, so `main.rs` prints `🧨` and exits 1 as it does for
  a missing file. Because it fails before `group::run`, nothing is printed to stdout.
- *Alternative: have `dir` call `files::run` with the listed paths.* That would print the `files` header and repeat
  deduplication. Passing the header in costs one parameter.

### D5. Output

`output::dir_header(dir: &Path, color) -> String` gives `⏳ Calculating similarity in the directory <dir>`, with
`dir.display()` in green. This uses the same `paint` helper and `GREEN` as `header`. Every other line is reused
unchanged.

## Risks / Trade-offs

- [A large directory means many comparisons. A thousand images is about half a million icon comparisons, and long
  videos cost a DTW per pair] → Each comparison is cheap for images and runs in parallel. Pre-filtering is a later
  change that does not alter `Grouper`'s API. The progress bar keeps the wait visible.
- [One undecodable file with a supported extension stops the whole directory run] → This matches `files` and the
  spec. Go's `--ignore-errors` is the remedy and is out of scope here.
- [The `rust-sak` release is a dependency of this change] → Its tasks come first, and the `mediasim` tasks that need
  the fix only assert it after the pin is bumped. If the release is delayed, everything else can be built and tested
  except the not-a-directory scenarios.
- [The plain-output scenario uses `/` and Windows prints `\`] → The binary tests build expected paths with
  `Path::join`, not string literals.

## Migration Plan

None for users. Developers: after the `rust-sak` tag is pushed, run `cargo update -p rust-sak` so `Cargo.lock` picks
up `26.10.2`. Rollback is reverting the pin. The new error only affects inputs that used to succeed silently with no
results.
