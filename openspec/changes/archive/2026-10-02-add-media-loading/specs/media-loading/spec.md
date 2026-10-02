## Purpose

Turns image and video files into `Media` values with their file metadata and per-frame visual signatures. Files can be loaded one at a time, in batches, or by scanning a directory, so they can be compared for similarity.

## ADDED Requirements

### Requirement: Media type detection
The system SHALL classify a file as an image or a video from its extension, case-insensitively. A file is a video when its extension is one of `avi`, `m4v`, `mp4`, `mkv`, `mov`, `webm` or `wmv`. A file is an image when its extension belongs to a supported image format. Any other file is unsupported.

#### Scenario: Video extension
- **WHEN** a file named `clip.MOV` is classified
- **THEN** it is classified as a video

#### Scenario: Image extension
- **WHEN** a file named `photo.png` is classified
- **THEN** it is classified as an image

#### Scenario: Unknown extension
- **WHEN** a file named `notes.txt` is classified
- **THEN** it is classified as unsupported

### Requirement: Load a single media file
The system SHALL load one file into a `Media`. An image SHALL produce exactly one frame signature. A video SHALL produce one frame signature per second of playback, starting at the beginning of the video.

#### Scenario: Load an image
- **WHEN** an image file is loaded
- **THEN** the result is a `Media` of type image with exactly one frame

#### Scenario: Load a video
- **WHEN** a video file with a duration of D seconds is loaded
- **THEN** the result is a `Media` of type video with one frame for each whole second sampled from 0 to D (approximately ⌈D⌉ frames)

#### Scenario: Unsupported file
- **WHEN** a file with an unsupported extension is loaded
- **THEN** loading fails with an unsupported-file error naming that file

#### Scenario: Unreadable or corrupt file
- **WHEN** a file is missing, cannot be read, or cannot be decoded
- **THEN** loading fails with an error naming that file

#### Scenario: Video with no decodable frames
- **WHEN** a video yields no frames
- **THEN** loading fails with a video error naming that file

### Requirement: Media metadata
Every loaded `Media` SHALL carry the file path, the file size in bytes, the file's creation and modification times, the media type, and the width and height in pixels. A video SHALL also carry its duration; an image SHALL carry no duration. The creation or modification time SHALL be absent, not an error, when the platform or filesystem does not provide it.

#### Scenario: Image metadata
- **WHEN** an image of 640×480 pixels and 12 345 bytes is loaded
- **THEN** the `Media` reports that path, size 12 345, width 640, height 480, type image and no duration

#### Scenario: Video metadata
- **WHEN** a video is loaded
- **THEN** the `Media` reports its path, file size, type video, the video stream's width and height, and a duration greater than zero

#### Scenario: Creation time unavailable
- **WHEN** the filesystem does not record a file's creation time
- **THEN** the file still loads and its creation time is absent

### Requirement: Load multiple media files
The system SHALL load a batch of files in parallel and return a stream of results with exactly one result per input file. Each result SHALL be delivered as soon as it is ready, in completion order. One file failing SHALL NOT stop the others from loading. The caller SHALL be able to stop consuming results early.

#### Scenario: Mixed success and failure
- **WHEN** a batch of one valid image, one valid video and one missing path is loaded
- **THEN** the stream yields three results: two `Media` and one error naming the missing path

#### Scenario: Results stream before the batch completes
- **WHEN** a batch is loading
- **THEN** results already finished can be consumed while the rest are still loading

### Requirement: Load a directory
The system SHALL load every supported media file in a directory and SHALL let the caller choose whether subdirectories are included. By default only the directory's direct entries are loaded. Symbolic links SHALL NOT be followed into directories.

#### Scenario: Root-only scan
- **WHEN** a directory containing `a.png` and `sub/b.mp4` is loaded without recursion
- **THEN** only `a.png` is loaded

#### Scenario: Recursive scan
- **WHEN** the same directory is loaded with recursion
- **THEN** both `a.png` and `sub/b.mp4` are loaded

#### Scenario: Unsupported files are skipped
- **WHEN** a directory contains `notes.txt` alongside media files
- **THEN** `notes.txt` is not loaded and produces no result

### Requirement: Directory media-type filter
When loading a directory, the system SHALL let the caller choose to load only images, only videos, or both. By default both are loaded.

#### Scenario: Images only
- **WHEN** a directory containing images and videos is loaded with videos excluded
- **THEN** only the images are loaded

#### Scenario: Videos only
- **WHEN** a directory containing images and videos is loaded with images excluded
- **THEN** only the videos are loaded

### Requirement: Directory errors are reported
Loading a directory SHALL fail before any file is loaded when the directory does not exist or when it, or any subdirectory scanned, cannot be read. A partial listing SHALL NOT be returned as if it were complete.

#### Scenario: Missing directory
- **WHEN** a directory that does not exist is loaded
- **THEN** loading fails with an I/O error naming that directory

#### Scenario: Unreadable subdirectory in a recursive scan
- **WHEN** a recursive scan reaches a subdirectory whose permissions deny listing
- **THEN** loading fails with an I/O error instead of yielding results from the readable part
