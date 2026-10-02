## Purpose

The `mediasim score` terminal command loads two media files, shows their loading progress on an interactive terminal,
and prints how similar they are. It works the same way in scripts, where only the bare score is printed.

## ADDED Requirements

### Requirement: Score command arguments
The CLI SHALL provide a `score` command that takes exactly two file paths, `mediasim score <file1> <file2>`. Running it
with fewer or more than two paths, or with an unknown command or flag, SHALL print a usage error to stderr and exit with
code 2 without loading anything. `mediasim --help` and `mediasim --version` SHALL print help and the version and exit
with code 0. Running `mediasim` with no command SHALL print usage help and exit with a non-zero code.

#### Scenario: Two paths given
- **WHEN** the user runs `mediasim score a.png b.png`
- **THEN** both files are loaded and compared

#### Scenario: Wrong number of paths
- **WHEN** the user runs `mediasim score a.png`, or `mediasim score a.png b.png c.png`
- **THEN** a usage error is printed to stderr, nothing is loaded, and the exit code is 2

#### Scenario: Version
- **WHEN** the user runs `mediasim --version`
- **THEN** the version is printed and the exit code is 0

### Requirement: Score formatting
The CLI SHALL print the similarity score rounded to 5 decimal places, with trailing zeros removed, and with the decimal
point removed when nothing follows it.

#### Scenario: Five significant decimals
- **WHEN** the score is `0.955131`
- **THEN** it is printed as `0.95513`

#### Scenario: Trailing zeros trimmed
- **WHEN** the score is `0.5`
- **THEN** it is printed as `0.5`

#### Scenario: Whole numbers
- **WHEN** the score is `1` or `0`, or rounds to either at 5 decimal places
- **THEN** it is printed as `1` or `0`

### Requirement: Report output on a terminal
When stdout is a terminal, the CLI SHALL print a header line saying that similarity is being calculated for 2 files,
then the progress display while the files load, and then a report line containing the formatted score. The score
SHALL be highlighted with colour.

#### Scenario: Interactive run
- **WHEN** the user runs `mediasim score a.png b.png` in a terminal and both files load
- **THEN** the terminal shows the header, the progress display at 100%, and a report line with the formatted score,
  and the exit code is 0

### Requirement: Bare output when not on a terminal
When stdout is not a terminal, the CLI SHALL print only the formatted score followed by a newline. It SHALL print no
header, no progress display, no report text and no ANSI escape sequences.

#### Scenario: Piped output
- **WHEN** the user runs `mediasim score a.png b.png | cat`
- **THEN** stdout contains exactly the formatted score and a newline, and the exit code is 0

### Requirement: Loading progress display
When stdout is a terminal, the CLI SHALL show a single-line progress display while the two files load. The display
SHALL show the number of files loaded out of the total, a progress bar, the percentage with one decimal, and an ETA.
Progress SHALL advance once for each file that finishes loading. The bar SHALL move smoothly toward its new position
instead of jumping. The display SHALL stay in the normal terminal flow, not take over the whole screen, and SHALL
remain visible after loading ends.

#### Scenario: One of two files loaded
- **WHEN** the first of the two files has finished loading
- **THEN** the display shows `1/2` and the bar moves toward 50%

#### Scenario: Both files loaded
- **WHEN** both files have finished loading
- **THEN** the display shows `2/2`, the bar reaches 100%, and the display stays on screen above the score

### Requirement: ETA
The progress display SHALL show an ETA estimated from the average time per loaded file. Before the first file has
loaded, the ETA SHALL show `--`. The ETA SHALL be recalculated at most once per second, and SHALL show `0s` once all
files are loaded.

#### Scenario: Nothing loaded yet
- **WHEN** loading has started and no file has finished
- **THEN** the ETA reads `--`

#### Scenario: Estimate after the first file
- **WHEN** one of two files took 4 seconds to load
- **THEN** the ETA estimates about 4 seconds remaining

### Requirement: Error reporting
When a file cannot be loaded, or the two files cannot be compared (for example an image and a video), the CLI SHALL
print `🧨 ` followed by the error message to stderr and exit with code 1. The message SHALL name the file or files
involved. When stderr is a terminal, the message SHALL be shown in red. The first error SHALL stop the command, and no
score SHALL be printed. If a progress display was showing, it SHALL be closed and the terminal restored before the
error is printed.

#### Scenario: Missing file
- **WHEN** the user runs `mediasim score missing.png b.png`
- **THEN** stderr shows `🧨` and a message naming `missing.png`, stdout shows no score, and the exit code is 1

#### Scenario: Image compared with a video
- **WHEN** the user runs `mediasim score a.png b.mp4`
- **THEN** stderr shows `🧨` and a message naming both files and their media types, and the exit code is 1

#### Scenario: Error when piped
- **WHEN** an error occurs while stderr is not a terminal
- **THEN** the message is printed without ANSI escape sequences

### Requirement: Colour can be disabled
The CLI SHALL emit no ANSI colour sequences when the `NO_COLOR` environment variable is set to a non-empty value, or
when the stream being written is not a terminal.

#### Scenario: NO_COLOR on a terminal
- **WHEN** `NO_COLOR=1` is set and the command runs in a terminal
- **THEN** the report and any error message are printed without colour

### Requirement: Interrupting with Ctrl+C
Pressing Ctrl+C while the progress display is showing SHALL stop the command, restore the terminal to its previous
state, print no score, and exit with code 130.

#### Scenario: Interrupted during loading
- **WHEN** the user presses Ctrl+C while a large video is still loading
- **THEN** the command exits promptly with code 130, and the terminal echoes typed input and shows the cursor as before
