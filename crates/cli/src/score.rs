//! `mediasim score <file1> <file2>`: how similar two images, or two videos, are.

use std::io::IsTerminal;
use std::path::PathBuf;

use mediasim::Media;

use crate::error::CliError;
use crate::{output, progress};

/// Loads both files, compares them and prints the score.
///
/// On a terminal it prints a header, the loading display and a report line. Otherwise it prints only the bare score,
/// so the output can be used in scripts.
pub fn run(file1: PathBuf, file2: PathBuf) -> Result<(), CliError> {
    let paths = [file1, file2];
    let stream = Media::from_files(paths.to_vec());
    let interactive = std::io::stdout().is_terminal();

    let loaded = if interactive {
        let color = output::stdout_color();
        println!();
        println!("{}", output::header(paths.len(), color));
        progress::run(stream, paths.len(), color)?
    } else {
        stream.collect::<Result<Vec<_>, _>>()?
    };

    let [a, b] = in_argument_order(loaded, &paths);
    let score = output::format_score(a.similarity(&b)?);

    if interactive {
        println!();
        println!("{}", output::report(&score, output::stdout_color()));
    } else {
        println!("{score}");
    }

    Ok(())
}

/// Puts the media back in the order their paths were given, since they load in completion order. The score is the
/// same either way, but an error comparing them then names the files in the order the user typed them.
fn in_argument_order(mut loaded: Vec<Media>, paths: &[PathBuf; 2]) -> [Media; 2] {
    loaded.sort_by_key(|media| paths.iter().position(|path| *path == media.path));
    loaded.try_into().expect("`Media::from_files` yields one result per path")
}
