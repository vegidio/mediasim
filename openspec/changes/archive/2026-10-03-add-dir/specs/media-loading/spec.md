## ADDED Requirements

### Requirement: List a directory's media files
The system SHALL list the media files that loading a directory would load, with the same recursion and media-type
choices, without loading them. The listing SHALL be sorted by name within each directory, SHALL keep the directory path
as the caller gave it as each entry's prefix, and SHALL fail in the same cases as loading the directory. Loading a
directory SHALL load exactly the files its listing returns.

#### Scenario: Listing matches loading
- **WHEN** a directory containing `b.png`, `a.mp4`, `notes.txt` and `sub/c.png` is listed without recursion
- **THEN** the listing is `a.mp4` then `b.png`, each prefixed with the directory path, and nothing is loaded

#### Scenario: Listing with a filter
- **WHEN** the same directory is listed recursively with videos excluded
- **THEN** the listing is `b.png` then `sub/c.png`

## MODIFIED Requirements

### Requirement: Directory errors are reported
Loading a directory SHALL fail before any file is loaded when the directory does not exist, when the path is not a
directory, or when it, or any subdirectory scanned, cannot be read. A partial listing SHALL NOT be returned as if it
were complete.

#### Scenario: Missing directory
- **WHEN** a directory that does not exist is loaded
- **THEN** loading fails with an I/O error naming that directory

#### Scenario: Path is a file
- **WHEN** the path of a regular file is loaded as a directory
- **THEN** loading fails with an I/O error naming that path, instead of yielding no results

#### Scenario: Unreadable subdirectory in a recursive scan
- **WHEN** a recursive scan reaches a subdirectory whose permissions deny listing
- **THEN** loading fails with an I/O error instead of yielding results from the readable part
