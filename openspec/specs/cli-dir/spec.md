# cli-dir Specification

## Purpose

The `mediasim dir` terminal command loads the media files in a directory, groups the ones that are similar, and lists
each group with its best file first. It can scan subdirectories and limit the scan to images or videos, and it works on
an interactive terminal and in scripts.

## Requirements

### Requirement: Dir command arguments
The CLI SHALL provide a `dir` command that takes exactly one directory path, `mediasim dir <directory>`. Running it
without a path, or with more than one, SHALL print a usage error to stderr and exit with code 2 without loading
anything.

#### Scenario: One directory
- **WHEN** the user runs `mediasim dir photos`
- **THEN** the supported media files directly inside `photos` are loaded and grouped

#### Scenario: No directory
- **WHEN** the user runs `mediasim dir`
- **THEN** a usage error is printed to stderr, nothing is loaded, and the exit code is 2

#### Scenario: Two directories
- **WHEN** the user runs `mediasim dir photos videos`
- **THEN** a usage error is printed to stderr, nothing is loaded, and the exit code is 2

### Requirement: Dir threshold option
The `dir` command SHALL accept `-t <value>` or `--threshold <value>` with the same default, range and usage errors as
the `files` command's threshold option.

#### Scenario: Default threshold
- **WHEN** the user runs `mediasim dir photos` without `-t`
- **THEN** files are grouped at threshold `0.8`

#### Scenario: Custom threshold
- **WHEN** the user runs `mediasim dir -t 0.95 photos`
- **THEN** files are grouped at threshold `0.95`

#### Scenario: Out of range
- **WHEN** the user runs `mediasim dir -t 1.5 photos`, or passes `-t abc` or `-t NaN`
- **THEN** a usage error is printed to stderr, nothing is loaded, and the exit code is 2

### Requirement: Recursive option
The `dir` command SHALL accept `-r` or `--recursive`. Without it, only the directory's direct entries SHALL be loaded.
With it, the files in every subdirectory SHALL be loaded too. Symbolic links SHALL NOT be followed into directories in
either case.

#### Scenario: Without recursion
- **WHEN** `photos` contains `a.png` and `sub/b.png`, and the user runs `mediasim dir photos`
- **THEN** only `a.png` is loaded

#### Scenario: With recursion
- **WHEN** the user runs `mediasim dir -r photos` on the same directory
- **THEN** both `a.png` and `sub/b.png` are loaded

### Requirement: Media type option
The `dir` command SHALL accept `-m <type>` or `--media-type <type>`, where `<type>` is `images`, `videos` or `all`,
defaulting to `all`. `images` SHALL load only image files, `videos` only video files, and `all` both. Any other value
SHALL print a usage error to stderr and exit with code 2 without loading anything.

#### Scenario: Default media type
- **WHEN** a directory contains images and videos, and the user runs `mediasim dir photos`
- **THEN** both the images and the videos are loaded

#### Scenario: Images only
- **WHEN** the user runs `mediasim dir -m images photos` on the same directory
- **THEN** only the images are loaded

#### Scenario: Videos only
- **WHEN** the user runs `mediasim dir --media-type videos photos` on the same directory
- **THEN** only the videos are loaded

#### Scenario: Invalid media type
- **WHEN** the user runs `mediasim dir -m image photos`, or passes `-m audio`
- **THEN** a usage error is printed to stderr, nothing is loaded, and the exit code is 2

### Requirement: Dir grouping and output
The `dir` command SHALL group the loaded files and print the result following the `cli-files` requirements for grouping
rules, the terminal report, the no-similar-media message, plain output when not on a terminal, the processing progress
display, and errors, colour and interruption. Each file's path SHALL be printed as the directory path the user typed,
joined with the file's path inside it.

#### Scenario: Piped output
- **WHEN** `photos` contains `a.png` and `b.png`, which match with `a.png` the better file, and the user runs
  `mediasim dir photos | cat`
- **THEN** stdout is exactly `photos/a.png\nphotos/b.png\n` on macOS and Linux, using the platform's separator on
  Windows

#### Scenario: Unreadable media file
- **WHEN** a directory contains a file with a supported extension that cannot be decoded
- **THEN** stderr shows `🧨` and a message naming that file, stdout shows no groups, and the exit code is 1

### Requirement: Dir header on a terminal
When stdout is a terminal, the `dir` command SHALL print `⏳ Calculating similarity in the directory <dir>`, with the
directory path as the user typed it and highlighted in green, in place of the `files` command's header. The threshold
line, progress display and groups SHALL follow, as for `files`. The progress display's total SHALL be the number of
media files selected for loading.

#### Scenario: Interactive run
- **WHEN** the user runs `mediasim dir photos` in a terminal, and `photos` holds three media files
- **THEN** the terminal shows `⏳ Calculating similarity in the directory photos`, the threshold line, and the
  `Processing` display reaching `3/3`

### Requirement: Dir group order
Groups SHALL be printed in the order their earliest file appears in the directory listing, where entries are sorted by
name within each directory, so the same directory always prints the same output regardless of the order in which files
finish loading.

#### Scenario: Stable order
- **WHEN** a directory contains `x1.png`, `x2.png`, `y1.png` and `y2.png`, where the `x` files match each other and the
  `y` files match each other
- **THEN** the group with `x1.png` and `x2.png` is printed first, on every run

### Requirement: Too few media files
A directory that holds fewer than two media files of the selected type SHALL NOT be an error. The command SHALL find no
groups, print `✅ No similar media found` on a terminal or nothing when not on a terminal, and exit with code 0.

#### Scenario: Empty directory
- **WHEN** the user runs `mediasim dir empty` on a directory with no media files
- **THEN** the terminal shows `✅ No similar media found`, or stdout is empty when piped, and the exit code is 0

#### Scenario: Filter leaves one file
- **WHEN** a directory holds one video and several images, and the user runs `mediasim dir -m videos` on it
- **THEN** no groups are found and the exit code is 0

### Requirement: Directory errors
When the directory does not exist, is not a directory, or cannot be read, or when recursion reaches a subdirectory that
cannot be read, the `dir` command SHALL print `🧨 ` and a message naming the path to stderr, load nothing, print no
groups, and exit with code 1.

#### Scenario: Missing directory
- **WHEN** the user runs `mediasim dir missing`
- **THEN** stderr shows `🧨` and a message naming `missing`, stdout is empty, and the exit code is 1

#### Scenario: Path is a file
- **WHEN** the user runs `mediasim dir a.png`, where `a.png` is a file
- **THEN** stderr shows `🧨` and a message naming `a.png`, stdout is empty, and the exit code is 1
