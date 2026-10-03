## Why

`mediasim score` compares exactly two files. Finding duplicates or near-duplicates in a set of files means running it
on every pair by hand. The Go version had `mediasim files <file1> <file2> [...]`, which loads any number of files,
groups the ones whose similarity reaches a threshold, and lists each group with its best file first. This change brings
that command to the Rust CLI. It also adds the grouping logic itself, which the GUI and a later `dir` command need too.

The change has 12 tasks, which is within the 15-task limit, so it is a single change.

## What Changes

- Add similarity grouping to `mediasim`. Media join a group when their similarity to any member reaches the threshold,
  and grouping is transitive, so if A matches B and B matches C, all three are one group. Only groups of two or more
  are returned. Within a group, media are ordered best first: longest duration, then most pixels, then largest file.
  An image and a video are never similar, and comparing them during grouping is not an error.
- Grouping is incremental. Media can be added one at a time as they finish loading, so the work runs while files
  load.
- Add the `mediasim files <file1> <file2> [<file3> ...]` command. It needs at least two paths, and repeated paths are
  loaded once.
- Add `-t`/`--threshold <0..1>` to `files`, defaulting to `0.8`. A value that is not a number from 0 to 1 is a usage
  error.
- On a terminal, print the `⏳` header, a `🔎 Grouping media with at least <t> similarity threshold...` line, a
  `Processing` progress display, and then each group as `Group N:` with its paths. The best path is in bold, and each
  path is followed by `(X.X MP)` for an image or `(N sec, X.X MP)` for a video. If no group is found, print
  `✅ No similar media found`.
- When stdout is not a terminal, print only the grouped paths: one per line, best first, with a blank line between
  groups. If no group is found, print nothing.
- Groups are listed in the order their first file appears on the command line.
- Generalise the CLI progress display so `files` can label it `Processing` and group media as they arrive. `score`
  looks and behaves exactly as before.

Out of scope: the `dir` and `rename` commands, Go's `--frame-flip`/`--frame-rotate`, `--ignore-errors`, and the
`-o json|csv` output formats.

## Capabilities

### New Capabilities

- `media-grouping`: groups loaded media by similarity at a threshold, with the best member first in each group.
- `cli-files`: the `mediasim files` terminal command. Covers argument and threshold handling, the progress display,
  terminal versus piped output, the empty result, error reporting and exit codes.

### Modified Capabilities

(none: `cli-score` keeps its behaviour and its `Loading` label; `media-loading` and `media-similarity` are used as they
are)

## Impact

- **Crates touched:** `mediasim` and `cli`. Grouping (the union-find, the threshold rule, the quality order and the
  handling of mixed media types) goes in `mediasim`, because the GUI will need the same groups. `cli` keeps only
  terminal concerns: argument parsing, the progress display, how groups are ordered for display, and how they are
  printed.
- **Infrastructure:** `rust-sak` has no union-find or grouping module. Its modules are `crypto`, `fetch`, `fs`,
  `github`, `image`, `memo`, `o11y` and `sysinfo`. `media-rs` only covers video. Neither needs extending. The
  union-find is a few dozen lines and is written locally in `mediasim`.
- **Dependencies:** none new. `mediasim` already uses `rayon` for comparing in parallel. `cli` already has `clap`,
  `ratatui` and `thiserror`.
- **Code:** new `crates/mediasim/src/core/dsu.rs` and `core/group.rs` with tests, a new public `Grouper` export, new
  `crates/cli/src/files.rs`, changes to `args.rs`, `main.rs`, `output.rs`, `progress/mod.rs` and `score.rs`, and new
  binary tests in `crates/cli/tests/files.rs` that run on `fixtures/`.
