## Purpose

Groups loaded media files by how similar they are, so front ends can show which files are duplicates or near-duplicates
of each other, with the best copy of each group first.

## ADDED Requirements

### Requirement: Grouping by threshold
The system SHALL group media so that two media whose similarity score is greater than or equal to the threshold end up
in the same group. Grouping SHALL be transitive: if A matches B and B matches C, A, B and C SHALL be one group even
when A and C do not match each other. The threshold SHALL be a number in the closed range `[0, 1]`.

#### Scenario: Two matching media
- **WHEN** media A and B score `0.9` against each other and the threshold is `0.8`
- **THEN** A and B are in the same group

#### Scenario: Score equal to the threshold
- **WHEN** media A and B score exactly the threshold
- **THEN** A and B are in the same group

#### Scenario: Transitive match
- **WHEN** A matches B, B matches C, and A does not match C
- **THEN** A, B and C are one group

#### Scenario: No match
- **WHEN** media A scores below the threshold against every other media
- **THEN** A is in no returned group

### Requirement: Only groups of two or more
The system SHALL return only groups with at least two members. Media that matched nothing SHALL be left out of the
result. When no two media match, the result SHALL be empty.

#### Scenario: Nothing matches
- **WHEN** three media are grouped and none of them matches another
- **THEN** the result has no groups

### Requirement: Mixed media types never match
An image and a video SHALL never be in the same group because of comparing them with each other, and comparing them
during grouping SHALL NOT be an error. Images SHALL be grouped with images and videos with videos.

#### Scenario: Image and video in one batch
- **WHEN** two identical images and one video are grouped
- **THEN** the result has one group with the two images, the video is in no group, and no error is returned

### Requirement: Best media first
Within each group, media SHALL be ordered best first: longer duration first (an image counts as zero duration), then
more pixels (width times height), then larger file size. Media equal on all three SHALL be ordered by path, so the
order is the same on every run.

#### Scenario: Resolution decides
- **WHEN** a group holds a 1000x1000 image and an otherwise identical 500x500 image
- **THEN** the 1000x1000 image is first

#### Scenario: Duration decides before resolution
- **WHEN** a group holds a 60-second 720p video and a 30-second 1080p video
- **THEN** the 60-second video is first

#### Scenario: File size breaks a tie
- **WHEN** two images in a group have the same pixel count and different file sizes
- **THEN** the larger file is first

### Requirement: Incremental grouping
The system SHALL accept media one at a time, in any order, and SHALL produce the same groups as when all media are
given at once. Each media added SHALL be compared with every media added before it, so grouping can run while files
are still loading.

#### Scenario: Order of arrival
- **WHEN** the same media are added in two different orders
- **THEN** both runs produce the same groups, each with the same members in the same order
