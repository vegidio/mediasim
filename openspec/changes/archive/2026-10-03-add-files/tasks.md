## 1. Grouping in `mediasim`

- [x] 1.1 Add `core/dsu.rs`: a crate-private, growable `Dsu` with `push`, iterative `find` with path halving, and union by rank (design D1). Verify with unit tests: new sets are separate, `union` merges them, merges are transitive, a repeated `union` is a no-op, and a long chain of unions keeps `find` correct.
- [x] 1.2 Add `core/group.rs` with `Grouper::new`/`push`/`len`/`is_empty`/`finish`, which compare each new media only with earlier media of the same type, in parallel, and union matches `>= threshold`. Also add `impl Extend<Media>`, keep only groups of 2+ in `finish`, and order groups by their best member's path (design D2). Verify with unit tests on synthetic `Icon`s: a match, a score exactly equal to the threshold, a transitive match, nothing matching (empty result), an image and a video in one batch (no error, never grouped), and a `new` panic for `1.5` and `NaN`.
- [x] 1.3 Order each group by duration, then pixels, then size, all descending, with path as the final tie-break (design D3). Verify with unit tests: resolution decides, duration decides before resolution, and file size breaks a tie. Also check that pushing the same media in two different orders gives identical `finish` output.
- [x] 1.4 Export `Grouper` from `lib.rs` and mention it in the crate docs. Verify that `cargo test -p mediasim` and `cargo doc -p mediasim --no-deps` succeed with no warnings.

## 2. The `files` command in `cli`

- [x] 2.1 Add `Command::Files { files: Vec<PathBuf> (num_args = 2..), threshold: f64 (-t/--threshold, default 0.8) }` with a `parse_threshold` value parser (design D6). Verify with unit tests: three paths parse, the default is `0.8`, `-t 0.95` parses, and one path, `-t 1.5`, `-t -0.1`, `-t abc` and `-t NaN` are all usage errors with exit code 2. Also check that `Cli::command().debug_assert()` passes.
- [x] 2.2 Make the progress display take a `label` and an `Extend<Media> + Send` sink. The sink is fed on the forwarding thread and handed back through the `JoinHandle` (design D4). Update `score.rs` to pass `"Loading"` and a `Vec`. Verify that the existing progress and `score` tests pass unchanged, and that a new `TestBackend` test shows `Processing   [1/2]`.
- [x] 2.3 Add to `output.rs`: `YELLOW`, `threshold`, `media_info`, `groups` (magenta `Group N:`, bold best line), `no_matches` and `plain_groups` (design D7). Verify with unit tests: `0.8` prints as `0.8`; image info is `(5.3 MP)`; a 12 s 1280x720 video is `(12 sec, 0.9 MP)`; the exact uncoloured report text for two groups; `plain_groups` gives `a\nb\n\nc\nd` and an empty string for no groups; and no `\x1b` appears when colour is off.
- [x] 2.4 Implement `files.rs`: deduplicate the paths in order, take the interactive or plain path based on `stdout().is_terminal()`, group with `Grouper`, sort the groups by their earliest argument position, and print the report, `no_matches`, or the plain paths (design D5). Verify with a unit test that the group-ordering helper sorts by argument position whatever the load order, and that `cargo build -p cli` succeeds.
- [x] 2.5 Wire `Command::Files` into `main.rs`, reusing the existing error printing and exit codes. Verify by hand that `mediasim files --help` lists the paths and `-t/--threshold` with its default.

## 3. Verification

- [x] 3.1 Add `crates/cli/tests/files.rs`, which runs `CARGO_BIN_EXE_mediasim files` on `fixtures/` with stdout piped. The fixtures score `test1.png`/`test2.png` ≈ 0.955 and `test3.mp4`/`test4.mp4` ≈ 0.507. Cover: the default threshold on all four files prints one group with exactly the two images and exits 0; `-t 0` on `test3.mp4 test1.png test4.mp4 test2.png` prints two groups, the videos first (earliest argument) and the images second, with no group mixing an image and a video; `-t 0.99` on the two images prints nothing and exits 0; `test1.png test1.png` prints nothing; `files a.png` exits 2; `-t 2` exits 2; a missing file exits 1 with `🧨`, the path and no `\x1b`, and stdout is empty. Verify that `cargo test -p cli --test files` passes.
- [x] 3.2 Check the interactive path by hand on macOS: the header, the yellow threshold line, `Processing` reaching 100%, a magenta `Group N:` with a bold best line and the right MP/sec info, `✅ No similar media found` when nothing matches, `NO_COLOR=1` removing all escapes, and Ctrl+C exiting with code 130. Verify by recording what was observed, and list Windows and Linux as checked or not checked.
  - Observed on macOS (2026-10-03), driven through a 120x40 pseudo-terminal rather than by eye: the `⏳` header
    with the distinct file count; the threshold line with the value in yellow (`#e5db08`); `Processing   [0/N]` advancing
    to `N/N` and 100%; `Group 1:` with `1` in magenta, the best line in bold, and `(4.5 MP)` / `(11 sec, 2.1 MP)` info;
    videos and images in separate groups, ordered by earliest argument; `✅ No similar media found` at `-t 0.99`;
    `NO_COLOR=1` leaving no colour escapes and an escape-free report (the progress line still bolds its count, as it
    already does for `score`); Ctrl+C (`\x03` in raw mode) mid-run exiting with code 130.
  - Windows: not checked. Linux: not checked.
- [x] 3.3 Run `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace`. Verify that all three succeed with no warnings.
