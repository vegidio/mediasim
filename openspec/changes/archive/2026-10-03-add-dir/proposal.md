## Why

`mediasim files` groups files that are listed one by one on the command line. To find duplicates in a folder, the user
has to expand the folder into arguments, and the shell cannot filter by media type or reach into subfolders. The Go
version had `mediasim dir <directory>` for this. This change brings that command to the Rust CLI. `mediasim` can already
scan a directory (`Media::from_dir` with `LoadOptions`), so most of the work is in the CLI.

The change has 12 tasks, which is within the 15-task limit, so it is a single change.

## What Changes

- Add the `mediasim dir <directory>` command. It groups the media in the directory exactly as `files` groups its
  arguments, with the same progress display, report, plain output, errors and exit codes.
- Add `-t`/`--threshold <0..1>` to `dir`, defaulting to `0.8`, with the same validation as `files`.
- Add `-r`/`--recursive` to `dir`. By default only the directory's direct entries are scanned.
- Add `-m`/`--media-type <images|videos|all>` to `dir`, defaulting to `all`. Any other value is a usage error.
- On a terminal, the header reads `⏳ Calculating similarity in the directory <dir>`. The other lines are the same as
  for `files`.
- Groups are listed in the order of their earliest file in the directory listing, which is sorted by name within each
  directory, so the same directory always prints the same output.
- A directory with fewer than two matching media files is not an error: the command finds no groups, and exits 0.
- A directory that is missing, cannot be read, or is a file is an error: `🧨`, a message naming the path, and exit
  code 1.
- Add a public way in `mediasim` to list the media files that a directory load would load, without loading them.
- Fix `rust_sak::fs::list_path` so it fails when its path is not a directory. Today it returns an empty list.

Out of scope: the `rename` command, Go's `--frame-flip`/`--frame-rotate`, `--ignore-errors`, the `-o json|csv`
output formats, and Go's `--mt` spelling (clap short flags are one character).

## Capabilities

### New Capabilities

- `cli-dir`: the `mediasim dir` terminal command. Covers the directory argument, the threshold, recursion and
  media-type options, the header, group order, the empty result, and how errors and output follow `cli-files`.

### Modified Capabilities

- `media-loading`: adds listing a directory's media files without loading them, and makes a path that is not a
  directory a load error, like a missing one.

## Impact

- **Crates touched:** `mediasim` and `cli`. Listing which files a directory load selects goes in `mediasim`, because
  the GUI needs the same count for its progress and the same list for a stable order. `cli` keeps only argument
  parsing, the header text, group ordering for display, and printing. The grouping pipeline that `files` already has
  is shared between the two commands.
- **Infrastructure:** `rust-sak`'s `fs::list_path` already does the directory walk, symlink handling and error
  reporting that `Media::from_dir` uses. It has one gap: a path that is a file gives an empty listing instead of an
  error. That is a general bug, so it is fixed in `rust-sak` and released as a new tag, and this project bumps its
  pin. `media-rs` is not involved.
- **Dependencies:** no new crates. `rust-sak` moves from `26.10.1` to the release with the fix.
- **Code:** `rust-sak/src/fs/list_path.rs` and its tests; `crates/mediasim/src/media/mod.rs` and `lib.rs` docs; in
  `cli`, `args.rs`, `main.rs`, `files.rs`, `output.rs`, a new `dir.rs`, and new binary tests in
  `crates/cli/tests/dir.rs`.
