//! `mediasim dir <directory>`: groups the similar images and videos in a directory, best file first.

use std::path::Path;

use mediasim::Media;

use crate::args::MediaKind;
use crate::error::CliError;
use crate::{group, output};

/// Groups the media in `directory` that `media_type` selects at `threshold` and prints the groups, as [`group::run`]
/// does. Subdirectories are scanned only if `recursive`.
pub fn run(directory: &Path, recursive: bool, media_type: MediaKind, threshold: f64) -> Result<(), CliError> {
    let paths = Media::list_dir(directory, &media_type.load_options(recursive))?;

    group::run(&paths, threshold, |color| output::dir_header(directory, color))
}
