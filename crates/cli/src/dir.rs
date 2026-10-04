//! `mediasim dir <directory>`: groups the similar images and videos in a directory, best file first.

use std::path::Path;

use mediasim::{CompareOptions, Media};

use crate::args::{MediaKind, OutputFormat};
use crate::error::CliError;
use crate::{group, output};

/// Groups the media in `directory` that `media_type` selects at `threshold` under `options` and prints the groups in
/// `format`, as [`group::run`] does, skipping files that fail to load if `ignore_errors`. Subdirectories are scanned
/// only if `recursive`.
pub fn run(
    directory: &Path,
    recursive: bool,
    media_type: MediaKind,
    threshold: f64,
    options: CompareOptions,
    ignore_errors: bool,
    format: OutputFormat,
) -> Result<(), CliError> {
    let paths = Media::list_dir(directory, &media_type.load_options(recursive))?;

    group::run(&paths, threshold, options, ignore_errors, format, |color| output::dir_header(directory, color))
}
