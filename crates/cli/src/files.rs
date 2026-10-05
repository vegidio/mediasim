//! `mediasim files <file1> <file2> [...]`: groups similar images and videos, best file first.

use std::collections::HashSet;
use std::path::PathBuf;

use mediasim::CompareOptions;

use crate::args::{GroupArgs, OutputFormat};
use crate::error::CliError;
use crate::{group, output};

/// Groups every distinct file as `group` sets under `options` and prints the groups in `format`, as [`group::run`]
/// does.
pub fn run(
    files: Vec<PathBuf>,
    group: &GroupArgs,
    options: CompareOptions,
    format: OutputFormat,
) -> Result<(), CliError> {
    let paths = distinct(files);

    group::run(&paths, None, group, options, format, |color| output::header(paths.len(), color))
}

/// Drops repeated paths, keeping the first occurrence of each. Paths are compared exactly as typed.
fn distinct(files: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    files.into_iter().filter(|path| seen.insert(path.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::paths;

    #[test]
    fn repeated_paths_are_dropped_in_order() {
        assert_eq!(distinct(paths(&["b", "a", "b", "c", "a"])), paths(&["b", "a", "c"]));
    }
}
