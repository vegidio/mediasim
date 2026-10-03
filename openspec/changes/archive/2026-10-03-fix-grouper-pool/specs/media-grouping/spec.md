## MODIFIED Requirements

### Requirement: Incremental grouping
The system SHALL accept media one at a time, in any order, and SHALL produce the same groups as when all media are
given at once. Each media added SHALL be compared with every media added before it, so grouping can run while files
are still loading. Adding a media SHALL NOT wait for a batch load that is still in progress: its comparisons SHALL
complete while other files of the batch are still loading, however many files the batch holds.

#### Scenario: Order of arrival
- **WHEN** the same media are added in two different orders
- **THEN** both runs produce the same groups, each with the same members in the same order

#### Scenario: Adding during a batch load
- **WHEN** several media have already been added, and a batch load is still decoding other files
- **THEN** adding another media completes without waiting for the batch load to finish

#### Scenario: Progress during a large batch
- **WHEN** a few hundred images are loaded as one batch and each result is added as it arrives
- **THEN** the results are added steadily as they load, and not held back until almost every image has loaded
