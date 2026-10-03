//! The grouping pipeline shared by `files` and `dir`: load, group, order and print.

use std::collections::HashMap;
use std::io::IsTerminal;
use std::path::{Path, PathBuf};

use mediasim::{Grouper, Media};

use crate::error::CliError;
use crate::{output, progress};

/// Loads `paths`, groups the ones scoring at least `threshold` against each other, and prints the groups.
///
/// On a terminal it prints `header` (called with the colour flag), the threshold, the progress display and a report
/// of the groups. Otherwise it prints only the grouped paths, so the output can be used in scripts.
pub fn run(paths: &[PathBuf], threshold: f64, header: impl FnOnce(bool) -> String) -> Result<(), CliError> {
    let stream = Media::from_files(paths.to_vec());
    let interactive = std::io::stdout().is_terminal();

    let mut groups = if interactive {
        let color = output::stdout_color();
        println!();
        println!("{}", header(color));
        println!("{}", output::threshold(threshold, color));
        progress::run(stream, paths.len(), "Processing", Grouper::new(threshold), color)?.finish()
    } else {
        let mut grouper = Grouper::new(threshold);
        for result in stream {
            grouper.push(result?);
        }
        grouper.finish()
    };
    in_path_order(&mut groups, paths);

    if interactive {
        if groups.is_empty() {
            println!();
            println!("{}", output::no_matches());
        } else {
            println!("{}", output::groups(&groups, output::stdout_color()));
        }
    } else if !groups.is_empty() {
        println!("{}", output::plain_groups(&groups));
    }

    Ok(())
}

/// Orders the groups by the earliest position in `paths` among their members, so the output does not depend on the
/// order the files finished loading in.
fn in_path_order(groups: &mut [Vec<Media>], paths: &[PathBuf]) {
    let positions: HashMap<&Path, usize> = paths.iter().enumerate().map(|(i, path)| (path.as_path(), i)).collect();

    groups.sort_by_cached_key(|group| {
        group
            .iter()
            .filter_map(|media| positions.get(media.path.as_path()).copied())
            .min()
            .expect("every grouped media was loaded from one of the paths")
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(names: &[&str]) -> Vec<PathBuf> {
        names.iter().map(PathBuf::from).collect()
    }

    /// A loaded fixture image with its path replaced, since `Media` cannot be built from parts outside `mediasim`.
    fn media(path: &str) -> Media {
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/test1.png");
        let mut media = Media::from_file(fixture).unwrap();
        media.path = path.into();
        media
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
}
