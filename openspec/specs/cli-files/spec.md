# cli-files Specification

## Purpose

The `mediasim files` terminal command loads two or more media files, groups the ones that are similar, and lists each
group with its best file first. It works on an interactive terminal and in scripts.

## Requirements

### Requirement: Files command arguments
The CLI SHALL provide a `files` command that takes two or more file paths, `mediasim files <file1> <file2> [<file3>
...]`. Running it with fewer than two paths SHALL print a usage error to stderr and exit with code 2 without loading
anything. A path given more than once, written exactly the same, SHALL be loaded and listed only once.

#### Scenario: Several paths
- **WHEN** the user runs `mediasim files a.png b.png c.png`
- **THEN** all three files are loaded and grouped

#### Scenario: One path
- **WHEN** the user runs `mediasim files a.png`
- **THEN** a usage error is printed to stderr, nothing is loaded, and the exit code is 2

#### Scenario: Repeated path
- **WHEN** the user runs `mediasim files a.png a.png b.png`
- **THEN** `a.png` is loaded once, and it is not grouped with itself

### Requirement: Threshold option
The `files` command SHALL accept `-t <value>` or `--threshold <value>`, the minimum similarity for two files to be
grouped, defaulting to `0.8`. A value that is not a number, or is outside the closed range `[0, 1]`, SHALL print a usage
error to stderr and exit with code 2 without loading anything.

#### Scenario: Default threshold
- **WHEN** the user runs `mediasim files a.png b.png` without `-t`
- **THEN** files are grouped at threshold `0.8`

#### Scenario: Custom threshold
- **WHEN** the user runs `mediasim files -t 0.95 a.png b.png`
- **THEN** files are grouped at threshold `0.95`

#### Scenario: Out of range
- **WHEN** the user runs `mediasim files -t 1.5 a.png b.png`, or passes `-t abc` or `-t NaN`
- **THEN** a usage error is printed to stderr, nothing is loaded, and the exit code is 2

### Requirement: Grouping rules
The command SHALL group the files following the `media-grouping` capability: a file joins a group when its similarity
to a member reaches the threshold, matches are transitive, an image and a video are never grouped with each other, and
each group lists its best file first. Only files that belong to a group of two or more SHALL be printed.

#### Scenario: Mixed images and videos
- **WHEN** the user runs `mediasim files a.png a-copy.png clip.mp4`, and the two images match
- **THEN** one group is printed with the two images, `clip.mp4` is not printed, and the exit code is 0

### Requirement: Group order
Groups SHALL be printed in the order their earliest file appears on the command line, so the same arguments always
print the same output regardless of the order in which files finish loading.

#### Scenario: Stable order
- **WHEN** the user runs `mediasim files x1.png y1.png x2.png y2.png`, where the `x` files match each other and the
  `y` files match each other
- **THEN** the group with `x1.png` and `x2.png` is printed first, on every run

### Requirement: Report output on a terminal
When stdout is a terminal, the CLI SHALL print a header saying that similarity is being calculated for N files, where N
counts each distinct path once. It SHALL then print `🔎 Grouping media with at least <threshold> similarity
threshold...`, with the threshold formatted like a score and highlighted in yellow. Then it SHALL show the progress
display labelled `Processing`, and then each group. A group SHALL be printed as a blank line, `Group N:` with N counting
from 1 and highlighted in magenta, and one `  -> <path> <info>` line per file. The path SHALL be printed as the user
typed it. The info SHALL be `(X.X MP)` for an image and `(N sec, X.X MP)` for a video, with megapixels to one decimal
and the duration in whole seconds. The first file's line SHALL be bold.

#### Scenario: Interactive run with groups
- **WHEN** the user runs `mediasim files a.png b.png c.png` in a terminal, and `a.png` and `b.png` match
- **THEN** the terminal shows the header with `3`, the threshold line with `0.8`, the progress display at 100%, and
  `Group 1:` with `a.png` and `b.png`, each with its `(X.X MP)` info and the better file first and bold

#### Scenario: Video info
- **WHEN** a group contains a 12-second 1280x720 video
- **THEN** its line ends with `(12 sec, 0.9 MP)`

### Requirement: No similar media on a terminal
When stdout is a terminal and no group is found, the CLI SHALL print a blank line and then `✅ No similar media found`
after the progress display, and exit with code 0.

#### Scenario: Nothing matches
- **WHEN** the user runs `mediasim files a.png b.png` in a terminal, and the files do not match
- **THEN** the terminal shows `✅ No similar media found` and the exit code is 0

### Requirement: Plain output when not on a terminal
When stdout is not a terminal, the CLI SHALL print only the grouped paths: one path per line, as typed, with the best
file of each group first and a blank line between groups. It SHALL print no header, no threshold line, no progress
display, no `Group N:` labels, no file info and no ANSI escape sequences. When no group is found it SHALL print nothing
and exit with code 0.

#### Scenario: Piped output with two groups
- **WHEN** the user runs `mediasim files x1.png y1.png x2.png y2.png | cat`, with `x1.png` better than `x2.png` and
  `y2.png` better than `y1.png`
- **THEN** stdout is exactly `x1.png\nx2.png\n\ny2.png\ny1.png\n`

#### Scenario: Piped output with no groups
- **WHEN** the user runs `mediasim files a.png b.png | cat`, and the files do not match
- **THEN** stdout is empty and the exit code is 0

### Requirement: Processing progress display
When stdout is a terminal, the CLI SHALL show the same single-line progress display as the `score` command, labelled
`Processing`. Progress SHALL advance once for each file that has been loaded and compared with the files loaded before
it. Its count, bar, percentage, ETA and its behaviour after finishing SHALL follow the `cli-score` progress display and
ETA requirements.

#### Scenario: All files processed
- **WHEN** all files have loaded and been compared
- **THEN** the display shows `Processing` with `N/N`, the bar reaches 100%, and the display stays on screen above the
  groups

### Requirement: Errors, colour and interruption
The `files` command SHALL report errors, disable colour and handle Ctrl+C as the `score` command does. A file that
cannot be loaded SHALL print `🧨 ` and a message naming the file to stderr, print no groups, and exit with code 1. The
first error SHALL stop the command. `NO_COLOR` and a non-terminal stream SHALL turn off colour. Ctrl+C during the
progress display SHALL restore the terminal and exit with code 130.

#### Scenario: Missing file
- **WHEN** the user runs `mediasim files a.png missing.png b.png`
- **THEN** stderr shows `🧨` and a message naming `missing.png`, stdout shows no groups, and the exit code is 1

#### Scenario: Interrupted
- **WHEN** the user presses Ctrl+C while the progress display is showing
- **THEN** the command exits with code 130 and the terminal is restored
