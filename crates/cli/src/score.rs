//! `mediasim score <file1> <file2>`: how similar two images, or two videos, are.

use std::io::IsTerminal;
use std::path::PathBuf;

use mediasim::{CompareOptions, Media};

use crate::error::CliError;
use crate::{group, output, progress};

/// Loads both files, compares them under `options` and prints the score.
///
/// On a terminal it prints a header, the loading display and a report line. Otherwise it prints only the bare score,
/// so the output can be used in scripts.
pub fn run(file1: PathBuf, file2: PathBuf, options: CompareOptions) -> Result<(), CliError> {
    let paths = [file1, file2];
    let stdout = std::io::stdout();
    let (interactive, color) = (stdout.is_terminal(), output::color_for(&stdout));

    if interactive {
        println!();
        println!("{}", output::header(paths.len(), color));
    }
    let loaded = progress::load(&paths, "Loading", Vec::with_capacity(2), false, interactive, color)?.sink;

    let [a, b] = in_argument_order(loaded, &paths);
    let score = output::format_score(a.similarity_with(&b, options)?);

    if interactive {
        println!();
        println!("{}", output::report(&score, color));
    } else {
        println!("{score}");
    }

    Ok(())
}

/// Puts the media back in the order their paths were given, since they load in completion order. The score is the
/// same either way, but an error comparing them then names the files in the order the user typed them.
fn in_argument_order(mut loaded: Vec<Media>, paths: &[PathBuf; 2]) -> [Media; 2] {
    let positions = group::positions(paths);
    loaded.sort_by_key(|media| positions[media.path.as_path()]);
    loaded.try_into().expect("`Media::from_files` yields one result per path")
}
