## 1. Setup

- [x] 1.1 Add `clap = { version = "4.6", features = ["derive"] }` and `ratatui = "0.30"` to the workspace dependencies. In `crates/cli/Cargo.toml`, add `[[bin]] name = "mediasim"`, depend on `mediasim`, `clap`, `ratatui` and `thiserror`, and drop `image` (design D1, D11). Verify that `cargo build -p cli` produces `target/debug/mediasim`.
- [x] 1.2 Create `args.rs` with `Cli` and `Command::Score { file1, file2 }` (`version`, `about`, `arg_required_else_help`), and create `error.rs` with `CliError` (design D2, D3). Verify with unit tests: `Cli::command().debug_assert()` passes, `score a b` parses, and both `score a` and `score a b c` fail with a usage error.

## 2. Output formatting

- [x] 2.1 Add `output::format_score`, which rounds to 5 decimals and trims trailing zeros and a trailing `.` (design D9). Verify with unit tests for `0.955131 → 0.95513`, `0.5 → 0.5`, `1.0 → 1`, `0.0 → 0`, `0.000001 → 0` and `0.999996 → 1`.
- [x] 2.2 Add the per-stream colour decision (`is_terminal` and `NO_COLOR` unset or empty), plus the header, report and `🧨` error lines in Go's palette, using `ratatui::crossterm::style` (design D10). Verify with unit tests that call the colour decision with explicit inputs and check that lines rendered without colour contain no `\x1b`.

## 3. Progress display pieces

- [x] 3.1 Add `progress/spring.rs`, a semi-implicit Euler damped spring (frequency 18, damping 1, 60 fps) that snaps when settled (design D7). Verify with unit tests: it reaches the target, never overshoots at damping 1, and settles from 0 to 1 within 60 steps.
- [x] 3.2 Add `progress/eta.rs`: an `Eta` throttled to 1 s, `None` before the first file, `0` when all files are done, and the text format `--` / `4.2s` / `12s` / `1m5s` / `1h2m3s` (design D8). Verify with unit tests that pass the elapsed times explicitly.
- [x] 3.3 Add `progress/bar.rs`, a gradient bar `Widget` (`█` running `#5A56E0 → #EE6FF8`, with `░` in `#606060`) (design D6). Verify with unit tests on a ratatui `Buffer`: filled and empty cell counts at 0%, 50% and 100%, and the colours of the first and last cells.
- [x] 3.4 Compose the progress line `Loading   [n/total]  <bar>  xx.x%   ETA …`, with the bar width set to `min(50, available)` and a minimum of 10 (design D5). Verify with `TestBackend` unit tests at 120 and 40 columns.

## 4. Progress session and score command

- [x] 4.1 Implement the inline session in `progress/mod.rs`: `ratatui::try_init_with_options` with `Viewport::Inline(1)`, a drop guard that calls `ratatui::restore()` and moves the cursor below the line, a forwarding thread from `MediaStream` to an `mpsc` channel, and a 60 fps loop that drains `try_recv`, steps the spring and redraws (design D5). Verify that `cargo build -p cli` succeeds and that the module's unit tests pass.
- [x] 4.2 Handle the session's endings: the first `Err` returns at once, Ctrl+C returns `CliError::Interrupted`, and once both files have loaded the loop keeps drawing until the spring settles (capped at 1 s) (design D5). Verify by hand on a terminal that both bars reach 100%, and that Ctrl+C on a long video exits promptly with the terminal restored (cursor visible, typed input echoed).
- [x] 4.3 Implement `score.rs`: choose the interactive or plain path with `stdout().is_terminal()`, put the loaded media back into argument order by path, call `similarity`, and print the header, progress and report, or only the bare score (design D4). Verify that `cargo build -p cli` succeeds.
- [x] 4.4 Replace the placeholder `main.rs`: parse `Cli`, run `score`, print `🧨 <error>` to stderr, and return `ExitCode` 0, 1 or 130 (design D3). Verify by hand that `mediasim --version`, `mediasim` with no arguments, and `mediasim score fixtures/test1.png fixtures/test2.png` in a terminal behave as the spec describes.

## 5. Verification

- [x] 5.1 Add `crates/cli/tests/score.rs`, which runs `CARGO_BIN_EXE_mediasim` on `<workspace>/fixtures` with stdout piped. Cover: `test1.png`/`test2.png` print one line matching the score format, with a value in `[0, 1]`; `test1.png` against itself prints `1`; `test1.png`/`test3.mp4` exits 1 with `🧨`, both paths and no `\x1b` on stderr; a missing file exits 1 naming it; a single argument exits 2; and stdout is empty on every failure. Verify that `cargo test -p cli --test score` passes.
- [x] 5.2 Check the interactive path by hand on macOS: the header, the animated gradient bar, the ETA changing from `--` to an estimate and then to `0s`, and the coloured report on `test3.mp4`/`test4.mp4`; `NO_COLOR=1` removes the colours; a mixed-type pair shows a red `🧨` after the terminal is restored. Verify by recording what was observed, and list Windows and Linux as checked or not checked.
- [x] 5.3 Run `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace`. Verify that all three succeed with no warnings.

### 5.2 observations (2026-10-02 pty run; hand-checked on macOS by the user 2026-10-03)

Checked on macOS by running the binary in a pseudo-terminal (Python `pty`, 120×12, with the cursor-position query
answered) and rendering its output with the `pyte` terminal emulator. That is not the same as looking at a real terminal
window; the user then checked the interactive path by hand in a real macOS terminal on 2026-10-03.

- `test3.mp4`/`test4.mp4`: the header, then `Loading [0/2] … ETA --` → `[1/2] … 0.7s` → `[2/2] 100.0% ETA 0s`, then a
  blank line and the report with the score in magenta (`0.50719`). The progress line stays on screen above the report.
  The bar uses 56 distinct 24-bit colours, and its cells fill over about 40 frames after each file loads.
- `test3.mp4` against a generated 15-minute 720p video: the ETA moves from `--` to an estimate and is recalculated about
  once a second (`0.6s`, `1.6s`, … `19s`), then shows `0s` when both files have loaded.
- Ctrl+C 3 s into that run: exit code 130 within about 10 ms, with echo and canonical mode back on and the cursor visible.
- `NO_COLOR=1`: no 24-bit colour sequences are emitted.
- `test1.png`/`test3.mp4`: the progress line is restored first, then the error is printed in red as
  `🧨 cannot compare image fixtures/test1.png with video fixtures/test3.mp4`, with exit code 1.
- Windows: not checked. Linux: not checked.
