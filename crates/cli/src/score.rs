//! `mediasim score <file1> <file2>`: how similar two images, or two videos, are.

use std::path::PathBuf;

use mediasim::{CompareOptions, Media};

use crate::args::OutputFormat;
use crate::error::CliError;
use crate::output::Ui;
use crate::{machine, output, progress};

/// Loads both files, compares them under `options` and prints the score in `format`.
///
/// With [`OutputFormat::Term`] on a terminal it prints a header, the loading display and a report line, and otherwise
/// only the bare score, so the output can be used in scripts. CSV and JSON print only their document.
pub fn run(file1: PathBuf, file2: PathBuf, options: CompareOptions, format: OutputFormat) -> Result<(), CliError> {
    let paths = [file1, file2];
    let ui = Ui::for_stdout(format);

    if ui.interactive {
        println!();
        println!("{}", output::header(paths.len(), ui.color));
    }
    let stream = Media::from_files(paths.to_vec());
    let loaded = progress::load(stream, paths.len(), "Loading", Vec::with_capacity(2), false, ui)?.sink;

    let [a, b] = in_argument_order(loaded, &paths);
    let score = a.similarity_with(&b, options)?;

    match format {
        OutputFormat::Term if ui.interactive => {
            println!();
            println!("{}", output::report(score, ui.color));
        }
        OutputFormat::Term => println!("{}", output::format_score(score)),
        OutputFormat::Csv => machine::score_csv(&mut std::io::stdout().lock(), score)?,
        OutputFormat::Json => machine::score_json(&mut std::io::stdout().lock(), score)?,
    }

    Ok(())
}

/// Puts the media back in the order their paths were given, since they load in completion order. The score is the
/// same either way, but an error comparing them then names the files in the order the user typed them.
fn in_argument_order(loaded: Vec<Media>, paths: &[PathBuf; 2]) -> [Media; 2] {
    let [a, b] = loaded.try_into().expect("`Media::from_files` yields one result per path");
    if a.path == paths[0] { [a, b] } else { [b, a] }
}
