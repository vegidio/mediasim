//! The grouping pipeline shared by `files` and `dir`: load, group, order and print.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use mediasim::{CompareOptions, DirCache, Grouper, Media, MediaError};

use crate::args::{GroupArgs, OutputFormat};
use crate::error::CliError;
use crate::output::Ui;
use crate::{machine, output, progress};

/// Loads `paths`, groups the ones scoring at least `group`'s threshold against each other under `options`, and prints
/// the groups in `format`.
///
/// With [`OutputFormat::Term`] on a terminal it prints `header` (called with the colour flag), the threshold, the
/// progress display and a report of the groups, and otherwise only the grouped paths, so the output can be used in
/// scripts. CSV and JSON print only their document.
///
/// If `group` ignores errors, files that fail to load are skipped, and once loading ends they are reported on stderr,
/// in every format, in the order of `paths`. JSON lists them in its document too.
///
/// With a `cache`, the files load through it. Once every file has finished loading (skipped ones included), the cache
/// is deleted, before anything is printed; on any error, including Ctrl+C, it is kept for the next run.
pub fn run(
    paths: &[PathBuf],
    cache: Option<DirCache>,
    group: &GroupArgs,
    options: CompareOptions,
    format: OutputFormat,
    header: impl FnOnce(bool) -> String,
) -> Result<(), CliError> {
    let ui = Ui::for_stdout(format);

    if ui.interactive {
        println!();
        println!("{}", header(ui.color));
        println!("{}", output::threshold(group.threshold, ui.color));
    }
    let stream = match &cache {
        Some(cache) => Media::from_files_cached(paths.to_vec(), cache),
        None => Media::from_files(paths.to_vec()),
    };
    let grouper = Grouper::with_options(group.threshold, options);
    let progress::Loaded { sink, mut skipped } =
        progress::load(stream, paths.len(), "Processing", grouper, group.ignore_errors, ui)?;
    if let Some(cache) = cache {
        cache.finish();
    }
    let mut groups = sink.finish();
    for members in &mut groups {
        members.sort_by(best_first);
    }
    let positions = positions(paths);
    in_path_order(&mut groups, &positions);

    if !skipped.is_empty() {
        skipped_in_path_order(&mut skipped, &positions);
        if ui.interactive {
            eprintln!();
        }
        eprintln!("{}", output::skipped(&skipped, output::color_for(&std::io::stderr())));
    }

    match format {
        OutputFormat::Term if ui.interactive => {
            if groups.is_empty() {
                println!();
                println!("{}", output::NO_MATCHES);
            } else {
                println!("{}", output::groups(&groups, ui.color));
            }
        }
        OutputFormat::Term => {
            if !groups.is_empty() {
                println!("{}", output::plain_groups(&groups));
            }
        }
        OutputFormat::Csv => machine::groups_csv(&mut std::io::stdout().lock(), &groups)?,
        OutputFormat::Json => machine::groups_json(&mut std::io::stdout().lock(), &groups, &skipped)?,
    }

    Ok(())
}

/// Each path's position in `paths`, for putting media that loaded in completion order back in input order.
fn positions(paths: &[PathBuf]) -> HashMap<&Path, usize> {
    paths.iter().enumerate().map(|(i, path)| (path.as_path(), i)).collect()
}

/// Orders media best first: longer duration (an image counts as zero), then more pixels, then larger file, with the
/// path as the tie-break.
fn best_first(a: &Media, b: &Media) -> Ordering {
    b.duration
        .unwrap_or_default()
        .cmp(&a.duration.unwrap_or_default())
        .then_with(|| b.pixels().cmp(&a.pixels()))
        .then_with(|| b.size.cmp(&a.size))
        .then_with(|| a.path.cmp(&b.path))
}

/// Orders the groups by the earliest of their members' [`positions`], so the output does not depend on the order the
/// files finished loading in.
fn in_path_order(groups: &mut [Vec<Media>], positions: &HashMap<&Path, usize>) {
    groups.sort_by_cached_key(|group| {
        group
            .iter()
            .filter_map(|media| positions.get(media.path.as_path()).copied())
            .min()
            .expect("every grouped media was loaded from one of the paths")
    });
}

/// Orders the errors of skipped files by their path's [`positions`], so the report does not depend on the order the
/// files failed in.
fn skipped_in_path_order(errors: &mut [MediaError], positions: &HashMap<&Path, usize>) {
    errors.sort_by_key(|err| positions.get(err.path()).copied().unwrap_or(usize::MAX));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{self, paths};

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

        in_path_order(&mut groups, &positions(&args));

        assert_eq!(names(&groups), [paths(&["c", "a"]), paths(&["d", "b"])]);
    }

    #[test]
    fn group_order_does_not_depend_on_load_order() {
        let args = paths(&["a", "b", "c", "d"]);
        let mut forward = vec![vec![media("a"), media("c")], vec![media("b"), media("d")]];
        let mut backward = vec![vec![media("b"), media("d")], vec![media("a"), media("c")]];

        in_path_order(&mut forward, &positions(&args));
        in_path_order(&mut backward, &positions(&args));

        assert_eq!(names(&forward), names(&backward));
        assert_eq!(names(&forward), [paths(&["a", "c"]), paths(&["b", "d"])]);
    }

    fn best_first_order(mut group: Vec<Media>) -> Vec<PathBuf> {
        group.sort_by(best_first);
        group.into_iter().map(|m| m.path).collect()
    }

    fn sized(mut media: Media, size: u64) -> Media {
        media.size = size;
        media
    }

    #[test]
    fn resolution_decides() {
        let group = vec![test_support::media("a.png", 500, 500, None), test_support::media("b.png", 1000, 1000, None)];

        assert_eq!(best_first_order(group), paths(&["b.png", "a.png"]));
    }

    #[test]
    fn duration_decides_before_resolution() {
        let group = vec![
            test_support::media("a.mp4", 1920, 1080, Some(30)),
            test_support::media("b.mp4", 1280, 720, Some(60)),
        ];

        assert_eq!(best_first_order(group), paths(&["b.mp4", "a.mp4"]));
    }

    #[test]
    fn file_size_breaks_a_tie() {
        let group = vec![
            sized(test_support::media("a.png", 200, 50, None), 10),
            sized(test_support::media("b.png", 100, 100, None), 20),
        ];

        assert_eq!(best_first_order(group), paths(&["b.png", "a.png"]));
    }

    #[test]
    fn path_breaks_a_full_tie() {
        let group = vec![
            sized(test_support::media("b.png", 100, 100, None), 10),
            sized(test_support::media("a.png", 100, 100, None), 10),
        ];

        assert_eq!(best_first_order(group), paths(&["a.png", "b.png"]));
    }

    #[test]
    fn skipped_files_follow_the_paths() {
        let args = paths(&["a", "b", "c", "d"]);
        let mut errors: Vec<_> =
            ["d", "a", "c"].into_iter().map(|path| MediaError::Unsupported { path: path.into() }).collect();

        skipped_in_path_order(&mut errors, &positions(&args));

        let order: Vec<_> = errors.iter().map(MediaError::path).collect();
        assert_eq!(order, [Path::new("a"), Path::new("c"), Path::new("d")]);
    }
}
