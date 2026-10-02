## Context

See proposal.md (Why) for the motivation and `specs/cli-score/spec.md` for the required behaviour.

What this slice builds on:

- `Media::from_files(Vec<P>) -> MediaStream` loads in parallel. Results arrive in completion order, so each error
  names its path. `MediaStream` is a blocking `Iterator`, and it has no `try_next`.
- `Media::similarity(&Media) -> Result<f64, CompareError>` scores two media in `[0, 1]`. It fails with
  `MediaTypeMismatch` when given an image and a video. On two long videos it can take seconds.
- `Media.path` is the exact path that was passed in.
- `crates/cli` has a placeholder `main.rs` and depends on `image`. The package is called `cli`, so its binary is
  called `cli` too.
- The Go CLI on `main` is the behavioural reference: `cmd/cli/cli.go`, `app.go` and `internal/charm/*`. It used
  urfave/cli and bubbletea. Its progress bar was bubbles' `progress` widget with its default gradient
  (`#5A56E0 → #EE6FF8`), a harmonica spring, a width of 50 and a 10 Hz tick. Its colours were gray `#686868`, green
  `#00c202`, magenta `#c792e9` and red `#f44336`.

## Goals / Non-Goals

**Goals:**

- A `score` command that behaves like the Go one on a terminal, and is safe to use in scripts.
- Always restore the terminal: on success, on error, on Ctrl+C and on panic.
- Keep the presentation logic (formatting, ETA, spring, bar) in pure functions that can be tested without a terminal.

**Non-Goals:**

- Progress reporting while the two files are compared, after loading (see Risks).
- Expanding `~` in paths. The shell already does this for unquoted paths. The Go CLI also did it for quoted ones;
  that is a known parity gap, left for a later change if anyone needs it.
- Telemetry (the Go CLI's `o11y` logging) and the leftover temp-dir cleanup. Neither is needed by `score` today.
- Any change to `mediasim`.

## Slices

| # | Change                   | Delivers                                                                                                                                                       | Depends on | Status      |
|---|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|-------------|
| 1 | `add-score-1-similarity` | `Media`-level similarity in `mediasim`: image/image, video/video (DTW), mixed-type error                                                                       | -          | done        |
| 2 | `add-score-2-cli`        | `mediasim score <file1> <file2>` in `cli`: clap, ratatui inline progress (gradient bar, spring animation, ETA), score formatting, non-TTY output, styled errors; removes the placeholder `main.rs` | slice 1    | **current** |

These decisions were agreed in slice 1 and are kept unchanged:

- The score is rounded to 5 decimal places with trailing zeros trimmed.
- On a non-terminal stdout, only the bare score is printed.
- The ETA shows `--` until the first file loads.
- Progress advances once per file.
- Errors print as red `🧨 <message>` on stderr, with a non-zero exit code.
- Only `score` is in scope.

## Crate split

- `mediasim`: unchanged. Loading and scoring are called as they are.
- `cli`: everything in this change. It is all terminal presentation: argv parsing, ANSI styling, the inline ratatui
  line, ETA text and the 5-decimal score string. The future GUI draws its own progress in React and formats numbers in
  its own frontend, so none of it would be shared.
- `gui`: does not exist yet.

## Decisions

### D1. Binary name and module layout

`crates/cli/Cargo.toml` gets `[[bin]] name = "mediasim", path = "src/main.rs"`. The package stays `cli`, matching the
directory and the workspace layout in the project context.

```text
crates/cli/src/
  main.rs            parse args, run, map the outcome to an ExitCode, print the 🧨 error
  args.rs            clap derive types (Cli, Command::Score { file1, file2 })
  error.rs           CliError (thiserror)
  score.rs           the score command: interactive vs plain path, load, reorder, compare, print
  output.rs          format_score, colour decision, header/report/error lines
  progress/mod.rs    the inline ratatui session and its event loop
  progress/bar.rs    the gradient bar widget
  progress/spring.rs the damped spring
  progress/eta.rs    the ETA tracker and its text format
crates/cli/tests/score.rs   runs the built binary on fixtures/
```

`main.rs` keeps `#![forbid(unsafe_code)]` and `#![warn(clippy::pedantic)]`, as `mediasim` does. Tests sit beside each
module.

### D2. clap with derive

The CLI is defined with `#[derive(Parser)]` and a `#[derive(Subcommand)] enum Command { Score { file1: PathBuf, file2:
PathBuf } }`. It uses `#[command(version, about, arg_required_else_help = true)]`.

clap handles usage errors itself: it prints a styled message to stderr and exits with code 2. Wrong argument counts
and unknown commands therefore get clap's standard message, not a `🧨` line. Usage errors are the usual place for
clap's own format (with its "did you mean" hints), and the `🧨` style is kept for runtime failures. An args test runs
`Cli::command().debug_assert()`.

- *Alternative: `argh` or `lexopt`.* Both are smaller, but they give no generated help, no version flag and no
  suggestions. clap is the de-facto standard, and later slices will add more subcommands and flags.
- *Alternative: take `Vec<PathBuf>` and check the length by hand (as Go did).* Rejected. Two named positionals let
  clap enforce the count, and they document themselves in `--help`.

### D3. Errors and exit codes

```rust
#[derive(Debug, thiserror::Error)]
enum CliError {
    #[error(transparent)] Load(#[from] MediaError),
    #[error(transparent)] Compare(#[from] CompareError),
    #[error("terminal error: {0}")] Terminal(#[from] std::io::Error),
    #[error("interrupted")] Interrupted,
}
```

`main` returns `ExitCode`. `Ok` gives 0, `Interrupted` gives 130 with no message, and every other error gives 1 after
`🧨 <Display>` is printed. `MediaError` and `CompareError` already name their paths, so the message needs nothing else.

### D4. Two output paths, chosen by `stdout().is_terminal()`

- **Interactive** (stdout is a TTY): print a blank line and `⏳ Calculating similarity in 2 files`. Then run the
  progress session (D5), then a blank line and `🧮 Similarity score between the files is <score>`, with the score in
  magenta.
- **Plain** (stdout is not a TTY): consume the `MediaStream` directly, stop on the first error, and print
  `<score>\n`. No ratatui and no raw mode.

In both paths, the loaded media are put back into argument order by matching `Media.path` against the two input
paths. Similarity is symmetric, so this does not change the score. It does make the mixed-type message read
`cannot compare image <file1> with video <file2>` in the order the user typed. If both files fail, the first error to
arrive is reported.

Comparison runs after loading, and after the progress session has closed, on the main thread. Go did the same.

- *Alternative: start the comparison on a worker thread while the bar finishes animating.* It would save at most the
  ~0.3 s settle time and adds a join. Rejected for simplicity.

### D5. Progress session: ratatui inline viewport, a forwarding thread, and a 60 fps loop

- **Terminal:** `ratatui::try_init_with_options(TerminalOptions { viewport: Viewport::Inline(1) })`, which returns an
  `io::Error` instead of panicking when the terminal cannot be set up. This enables raw mode, draws on a single line
  in the normal scrollback (no alternate screen), and installs a panic hook that restores the terminal. `ratatui::restore()` is called on every exit path through a small drop guard. After restoring, the
  cursor moves below the line, so the drawn line stays visible above the report.
- **Feeding results:** `MediaStream` blocks, and the UI must not. A `std::thread` drains the stream into an
  `mpsc::Sender<Result<Media, MediaError>>`, and the loop reads it with `try_recv`. When the receiver is dropped
  (on an error or Ctrl+C), the forwarder's next send fails, which drops the stream and stops any file that has not
  started loading. This needs no change to `mediasim`.
  - *Alternative: add a non-blocking `try_next` to `MediaStream` in `mediasim`.* Not needed now. The GUI will also
    consume the stream from a background task. Revisit if a second caller wants it.
- **Loop:** each iteration waits in `event::poll(frame_remaining)` (frame = 1/60 s). On Ctrl+C
  (`KeyCode::Char('c')` + `CONTROL`, or a `KeyEventKind::Press` of that), it returns `Interrupted`. In raw mode the
  terminal does not turn Ctrl+C into SIGINT, so it has to be read as a key, and this works the same way on Windows.
  Each iteration then drains `try_recv`, steps the spring, updates the ETA and draws.
- **End:** an `Err` ends the session at once. When both files have loaded, the target becomes 1.0, and the loop keeps
  drawing until the spring settles, with a 1 s cap, so the bar visibly reaches 100%.
- **Line layout** (blank line before it, as Go had):
  `Loading   [1/2]  ████████████░░░░░░░░░░░░  50.0%   ETA 4.2s`.
  The count is bold inside gray brackets, the percentage is green and the ETA is magenta. The bar width is
  `min(50, terminal width − fixed text)`, with a minimum of 10.

### D6. Gradient bar as a custom ratatui `Widget`

ratatui's `Gauge` and `LineGauge` take one colour, so they cannot draw a gradient. `progress/bar.rs` renders `width`
cells: filled cells are `█` coloured by linear RGB interpolation from `#5A56E0` to `#EE6FF8` across the full bar
width (as bubbles does by default), and empty cells are `░` in `#606060`. The filled count is
`round(position × width)`. The bar is tested against ratatui's `Buffer`, checking cell symbols and the end-point
colours.

### D7. Spring animation: a small local damped spring

The bar position follows the target through a damped harmonic oscillator. It uses bubbles' defaults: angular
frequency 18, damping ratio 1 (critically damped), stepped at 60 fps. The step is semi-implicit Euler on
`(position, velocity)`. The spring has settled when `|target − position| < 0.001` and `|velocity| < 0.01`. Then the
position snaps to the target.

This is about 30 lines with unit tests: it reaches the target, does not overshoot at damping 1, and settles in under
1 s from 0 to 1. Nothing in `rust-sak` or `media-rs` animates anything, and it is too small and too CLI-specific to
belong in either.

- *Alternative: a spring/tweening crate.* No well-maintained crate of comparable weight does this. A dependency for
  30 lines of arithmetic is not worth it.
- *Alternative: no animation, jump to each value.* Rejected. The agreed behaviour includes the spring.

### D8. ETA

`Eta { started: Instant, last_update: Instant, value: Option<Duration> }`. The value is recalculated at most once per
second (as Go did):

- `None` while `completed == 0`.
- Otherwise `elapsed / completed × (total − completed)`.
- `0` when `completed == total`, applied at once without waiting for the 1 s throttle.

The text format is `--` for `None`, one decimal below 10 s (`4.2s`), and whole units above that (`12s`, `1m5s`,
`1h2m3s`), matching Go's `Duration` output. It takes the elapsed time as a parameter, so tests need no clock.

### D9. Score formatting

The formatting is `format!("{score:.5}")`, then trailing `0`s are trimmed, then a trailing `.`. So `0.955131` becomes
`0.95513`, `0.5` stays `0.5`, `1.0` becomes `1`, and `0.000001` becomes `0`. A `-0` cannot occur, because
`similarity` clamps to `[0, 1]`.

Both output paths use the same function, so piped and interactive output always show the same number.

### D10. Colour

Styled text outside ratatui (the header, the report and the error) uses `ratatui::crossterm::style::Stylize` with
`Color::Rgb` values for Go's palette. This avoids adding a second styling crate. Each stream is coloured only when
it `is_terminal()` and `NO_COLOR` is unset or empty, and the decision is made per stream (stdout or stderr). The ratatui
line is only drawn on a terminal. When `NO_COLOR` is set, it is drawn with default colours, so the bar characters
still show progress.

### D11. Dependencies

Workspace `Cargo.toml` adds:

- `clap = { version = "4.6", features = ["derive"] }`
- `ratatui = "0.30"`, with default features, which include the `crossterm` backend. `crossterm` is imported only
  through `ratatui::crossterm`, so its version always matches the one ratatui was built against.

`cli` depends on `mediasim`, `clap`, `ratatui` and `thiserror`, and drops `image`. Neither new crate duplicates a
`rust-sak` or `media-rs` module. No crate is added for integration tests: they use `std::process::Command` with
`env!("CARGO_BIN_EXE_mediasim")`.

## Risks / Trade-offs

- [The comparison of two long videos runs after the bar has reached 100%, with nothing moving] → Accepted for this
  slice, and out of scope by agreement (progress advances per file). A later change can add a "Comparing…" spinner
  or phase without changing this structure: the session would simply stay open for one more phase.
- [The interactive path cannot be tested end to end without a pseudo-terminal] → The logic is kept in pure, tested
  units: the spring, the ETA, the bar `Buffer` and the score format. The binary tests cover the plain path. One task
  checks the interactive path by hand on macOS. Windows and Linux are checked in the same way when available, and
  any terminal not checked is reported, not assumed.
- [Raw mode swallows keystrokes while loading, and output written by another thread could garble the inline line] →
  Nothing else writes to the terminal during the session. Only Ctrl+C is acted on.
- [A terminal without true colour shows approximated gradient colours] → Cosmetic only. crossterm emits RGB, and most
  current terminals support it.
- [A process killed with SIGKILL leaves raw mode on] → This cannot be prevented. `reset` recovers the terminal.
  Ctrl+C, errors and panics all restore it.
- [clap's usage errors look different from `🧨` runtime errors] → This is intentional (D2). It is the convention
  for Rust CLIs and keeps clap's suggestions.
- [Fixtures are untracked (`fixtures/` is gitignored)] → The binary tests read `<workspace>/fixtures` like the
  existing `mediasim` tests do. CI will need them too, which is the same open point as in the earlier changes.

## Migration Plan

There are no users of the Rust CLI yet. The placeholder `main.rs` is replaced in one go, and the binary changes name
from `cli` to `mediasim`. To roll back, revert the change.
