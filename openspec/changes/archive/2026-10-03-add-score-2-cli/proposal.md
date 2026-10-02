## Why

`mediasim` can now score two `Media` values (slice 1), but nothing exposes that to a user: `crates/cli/src/main.rs` is
still a placeholder that diffs two hard-coded `test1.jpg`/`test2.jpg` icons and panics on any error. This slice adds the
`mediasim score <file1> <file2>` command, with an inline progress bar and the output the Go version had.

This is slice 2 of 2 of the `add-score` series. The whole feature was estimated at about 16 tasks, over the 15-task
limit, so it was split:

1. `add-score-1-similarity` (done, archived): `Media`-level similarity in `mediasim`.
2. `add-score-2-cli` (this change): the `score` command in `cli`.

This slice is estimated at 14 tasks.

## What Changes

- Add a `clap`-based command line with one subcommand, `mediasim score <file1> <file2>`, plus `--help` and
  `--version`. The installed binary is named `mediasim`.
- While both files load, draw a one-line inline progress display with `ratatui`. It shows `Loading [n/2]`, a gradient
  bar that eases toward its target with a spring animation, the percentage, and an ETA. The ETA shows `--` until the
  first file has loaded. Progress advances once per loaded file.
- Print the score rounded to 5 decimal places with trailing zeros trimmed (`0.95513`, `0.5`, `1`, `0`). On a terminal
  it appears in a styled report line; when stdout is not a terminal, only the bare score is printed, with no progress
  display.
- Print any failure (a file that won't load, an image compared with a video) as `🧨 <message>` in red on stderr, and
  exit with a non-zero code.
- Ctrl+C during loading restores the terminal and exits.
- **BREAKING** (internal only): replace the placeholder `main.rs`. The `cli` crate's direct `image` dependency goes away.

Out of scope: output formats (`-o json|csv`), flip/rotate comparison, the `files`/`dir`/`rename` grouping commands,
`--ignore-errors` and the threshold flag. The Go CLI's `~` expansion of quoted paths is also out of scope (see design).

## Capabilities

### New Capabilities

- `cli-score`: the `mediasim score` terminal command. Covers argument handling, the progress display, score formatting,
  terminal versus piped output, error reporting and exit codes.

### Modified Capabilities

(none: `media-loading` and `media-similarity` are used as they are)

## Impact

- **Crates touched:** `cli` only. `mediasim` is not changed. Everything this slice adds is terminal-specific:
  argument parsing, the ratatui progress line, ANSI styling, the ETA text and the 5-decimal score string. The GUI will
  render its own progress and format scores in its own frontend, so none of it is shared logic. Loading
  (`Media::from_files`) and scoring (`Media::similarity`) already live in `mediasim` and are called as they are.
- **Infrastructure:** `rust-sak` has no terminal, argument-parsing or progress-rendering module. Its modules are
  `crypto`, `fetch`, `fs`, `github`, `image`, `memo`, `o11y` and `sysinfo`. The progress callback in `fetch` reports
  download bytes and draws nothing. `media-rs` only covers video decoding. Neither has anything to reuse here, and
  neither needs extending.
- **Dependencies:** new workspace dependencies `clap` 4.6 (with `derive`) and `ratatui` 0.30 (default `crossterm`
  backend). `crossterm` is used through `ratatui`'s re-export, not added directly. `cli` drops `image`.
- **Code:** `crates/cli/Cargo.toml` (adds a `[[bin]]` named `mediasim`), new modules under `crates/cli/src/`, and
  binary-level tests in `crates/cli/tests/` that run on the existing `fixtures/`.
