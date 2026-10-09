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

/// Drops paths that name a file already listed, keeping the first occurrence of each as typed. Paths are compared by
/// their canonical form, so `a.png`, `./a.png` and a symbolic link to it are one file; a path that can't be
/// canonicalized (such as a missing file, which then fails to load) is compared exactly as typed.
fn distinct(files: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    files
        .into_iter()
        .filter(|path| seen.insert(std::fs::canonicalize(path).unwrap_or_else(|_| path.clone())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::paths;

    #[test]
    fn repeated_paths_are_dropped_in_order() {
        assert_eq!(distinct(paths(&["b", "a", "b", "c", "a"])), paths(&["b", "a", "c"]));
    }

    #[test]
    fn other_spellings_of_one_file_are_dropped() {
        let dir = rust_sak::fs::mk_temp_dir("mediasim").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let (a, b) = (dir.path().join("a.png"), dir.path().join("b.png"));
        std::fs::write(&a, b"").unwrap();
        std::fs::write(&b, b"").unwrap();
        let dotted = dir.path().join(".").join("a.png");
        let roundabout = dir.path().join("sub").join("..").join("a.png");

        assert_eq!(distinct(vec![a.clone(), b.clone(), dotted, roundabout, b.clone()]), [a, b]);
    }

    #[cfg(unix)]
    #[test]
    fn a_symbolic_link_to_a_listed_file_is_dropped() {
        let dir = rust_sak::fs::mk_temp_dir("mediasim").unwrap();
        let (file, link) = (dir.path().join("a.png"), dir.path().join("link.png"));
        std::fs::write(&file, b"").unwrap();
        std::os::unix::fs::symlink(&file, &link).unwrap();

        assert_eq!(distinct(vec![link.clone(), file]), [link]);
    }

    #[test]
    fn missing_files_are_compared_as_typed() {
        assert_eq!(
            distinct(paths(&["missing.png", "./missing.png", "missing.png"])),
            paths(&["missing.png", "./missing.png"])
        );
    }
}
