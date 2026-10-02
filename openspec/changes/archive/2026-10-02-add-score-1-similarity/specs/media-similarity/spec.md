## Purpose

Compares two loaded media files and produces a single similarity score, so front ends can tell how alike two images or
two videos are.

## ADDED Requirements

### Requirement: Similarity score range
The system SHALL express the similarity of two media files as a number in the closed range `[0, 1]`, where `1` means
the files are visually identical and `0` means they are completely different. The score SHALL never fall outside that
range.

#### Scenario: Score stays in range
- **WHEN** any two media files of the same type are compared
- **THEN** the score is greater than or equal to `0` and less than or equal to `1`

#### Scenario: Identical media scores one
- **WHEN** a media file is compared with itself
- **THEN** the score is `1`

### Requirement: Similarity is symmetric
The system SHALL produce the same score regardless of the order in which two media files are compared.

#### Scenario: Swapped order
- **WHEN** media A is compared with media B, and then media B is compared with media A
- **THEN** both comparisons produce the same score

### Requirement: Image similarity
The system SHALL compare two images by their visual content, giving the most weight to brightness and less weight to
colour, so that images that look alike score higher than images that look different.

#### Scenario: Similar images score higher than different images
- **WHEN** an image is compared with a near-copy of itself, and separately with a visually unrelated image
- **THEN** the near-copy comparison produces a higher score than the unrelated comparison

#### Scenario: Opposite images score zero
- **WHEN** a solid black image is compared with a solid white image
- **THEN** the score is `0` to within floating-point tolerance (it rounds to `0` at 5 decimal places)

### Requirement: Video similarity
The system SHALL compare two videos by aligning their sampled frames in time order, so that videos with different
lengths, or where one is a trimmed or padded version of the other, can still be recognised as similar. The score SHALL
reflect the average frame similarity along the best alignment of the two videos.

#### Scenario: Videos of different lengths can be compared
- **WHEN** two videos with a different number of sampled frames are compared
- **THEN** the comparison succeeds and produces a score in `[0, 1]`

#### Scenario: Trimmed copy scores high
- **WHEN** a video is compared with a copy of itself that is missing some frames at the end
- **THEN** the score is higher than when the same video is compared with an unrelated video

#### Scenario: Single-frame videos
- **WHEN** two videos that each yield exactly one sampled frame are compared
- **THEN** the score equals the similarity of those two frames

### Requirement: Mixed media types are rejected
The system SHALL refuse to compare an image with a video, and SHALL report an error that states which media types were
involved, instead of producing a score.

#### Scenario: Image compared with a video
- **WHEN** an image is compared with a video
- **THEN** the comparison fails with a media-type mismatch error and no score is produced

#### Scenario: Video compared with an image
- **WHEN** a video is compared with an image
- **THEN** the comparison fails with a media-type mismatch error and no score is produced
