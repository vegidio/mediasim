//! The grouping pipeline shared by `files` and `dir`: load, group, order and print.

use std::collections::HashMap;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};

use mediasim::{CompareOptions, Grouper, Media, MediaError};

use crate::error::CliError;
use crate::{output, progress};

/// Loads `paths`, groups the ones scoring at least `threshold` against each other under `options`, and prints the
/// groups.
///
/// On a terminal it prints `header` (called with the colour flag), the threshold, the progress display and a report
/// of the groups. Otherwise it prints only the grouped paths, so the output can be used in scripts.
///
/// If `ignore_errors`, files that fail to load are skipped, and once loading ends they are reported on stderr, on a
/// terminal or not, in the order of `paths`.
pub fn run(
    paths: &[PathBuf],
    threshold: f64,
    options: CompareOptions,
    ignore_errors: bool,
    header: impl FnOnce(bool) -> String,
) -> Result<(), CliError> {
    let stdout = std::io::stdout();
    let (interactive, color) = (stdout.is_terminal(), output::color_for(&stdout));

    if interactive {
        println!();
        println!("{}", header(color));
        println!("{}", output::threshold(threshold, color));
    }
    let grouper = Grouper::with_options(threshold, options);
    let progress::Loaded { sink, mut skipped } =
        progress::load(paths, "Processing", grouper, ignore_errors, interactive, color)?;
    let mut groups = sink.finish();
    in_path_order(&mut groups, paths);

    if !skipped.is_empty() {
        skipped_in_path_order(&mut skipped, paths);
        if interactive {
            eprintln!();
        }
        eprintln!("{}", output::skipped(&skipped, output::color_for(&std::io::stderr())));
    }

    if interactive {
        if groups.is_empty() {
            println!();
            println!("{}", output::NO_MATCHES);
        } else {
            println!("{}", output::groups(&groups, color));
        }
    } else if !groups.is_empty() {
        println!("{}", output::plain_groups(&groups));
    }

    Ok(())
}

/// Each path's position in `paths`, for putting media that loaded in completion order back in input order.
pub fn positions(paths: &[PathBuf]) -> HashMap<&Path, usize> {
    paths.iter().enumerate().map(|(i, path)| (path.as_path(), i)).collect()
}

/// Orders the groups by the earliest position in `paths` among their members, so the output does not depend on the
/// order the files finished loading in.
fn in_path_order(groups: &mut [Vec<Media>], paths: &[PathBuf]) {
    let positions = positions(paths);

    groups.sort_by_cached_key(|group| {
        group
            .iter()
            .filter_map(|media| positions.get(media.path.as_path()).copied())
            .min()
            .expect("every grouped media was loaded from one of the paths")
    });
}

/// Orders the errors of skipped files by their path's position in `paths`, so the report does not depend on the order
/// the files failed in.
fn skipped_in_path_order(errors: &mut [MediaError], paths: &[PathBuf]) {
    let positions = positions(paths);

    errors.sort_by_key(|err| positions.get(err.path()).copied().unwrap_or(usize::MAX));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support;

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    fn media(path: &str) -> Media {
        test_support::media(path, 1, 1, None)
    }

    fn names(groups: &[Vec<Media>]) -> Vec<Vec<PathBuf>> {
        groups.iter().map(|g| g.iter().map(|m| m.path.clone()).collect()).collect()
    }

    #[test]
    fn groups_follow_the_earliest_path() {
        let args = paths(&["a", "b", "c", "d"]);
        let mut groups = vec![vec![media("d"), media("b")], vec![media("c"), media("a")]];

        in_path_order(&mut groups, &args);

        assert_eq!(names(&groups), [paths(&["c", "a"]), paths(&["d", "b"])]);
    }

    #[test]
    fn group_order_does_not_depend_on_load_order() {
        let args = paths(&["a", "b", "c", "d"]);
        let mut forward = vec![vec![media("a"), media("c")], vec![media("b"), media("d")]];
        let mut backward = vec![vec![media("b"), media("d")], vec![media("a"), media("c")]];

        in_path_order(&mut forward, &args);
        in_path_order(&mut backward, &args);

        assert_eq!(names(&forward), names(&backward));
        assert_eq!(names(&forward), [paths(&["a", "c"]), paths(&["b", "d"])]);
    }

    #[test]
    fn skipped_files_follow_the_paths() {
        let args = paths(&["a", "b", "c", "d"]);
        let mut errors: Vec<_> =
            ["d", "a", "c"].into_iter().map(|path| MediaError::Unsupported { path: path.into() }).collect();

        skipped_in_path_order(&mut errors, &args);

        let order: Vec<_> = errors.iter().map(MediaError::path).collect();
        assert_eq!(order, [Path::new("a"), Path::new("c"), Path::new("d")]);
    }
}
