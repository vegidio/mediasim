//! `mediasim dir <directory>`: groups the similar images and videos in a directory, best file first.

use std::path::Path;

use mediasim::{CompareOptions, DirCache, LoadOptions, Media};

use crate::args::{GroupArgs, OutputFormat};
use crate::error::CliError;
use crate::{group, output};

/// Groups the media in `directory` that `load` selects (and scans subdirectories for, if it is recursive) as `group`
/// sets under `options` and prints the groups in `format`, as [`group::run`] does.
///
/// If `cache`, the files load through the directory's cache, so a run that was interrupted or aborted resumes where
/// it stopped. A directory with nothing to load gets no cache.
pub fn run(
    directory: &Path,
    load: &LoadOptions,
    cache: bool,
    group: &GroupArgs,
    options: CompareOptions,
    format: OutputFormat,
) -> Result<(), CliError> {
    let paths = Media::list_dir(directory, load)?;
    let cache = if cache && !paths.is_empty() { DirCache::open(directory) } else { None };

    group::run(&paths, cache, group, options, format, |color| output::dir_header(directory, color))
}
