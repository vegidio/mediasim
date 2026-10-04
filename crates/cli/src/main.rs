#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]

mod args;
mod dir;
mod error;
mod files;
mod group;
mod output;
mod progress;
mod score;
#[cfg(test)]
mod test_support;

use std::io::IsTerminal;
use std::process::ExitCode;

use clap::Parser;

use args::{Cli, Command};
use error::CliError;

fn main() -> ExitCode {
    let cli = Cli::parse();

    let result = match cli.command {
        Command::Score { file1, file2, compare } => score::run(file1, file2, compare.options()),
        Command::Files { files, group, compare } => {
            files::run(files, group.threshold, compare.options(), group.ignore_errors)
        }
        Command::Dir { directory, recursive, media_type, group, compare } => {
            dir::run(&directory, recursive, media_type, group.threshold, compare.options(), group.ignore_errors)
        }
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        // The shell's convention for a process ended by SIGINT.
        Err(CliError::Interrupted) => ExitCode::from(130),
        Err(err) => {
            let stderr = std::io::stderr();
            if stderr.is_terminal() {
                eprintln!();
            }
            eprintln!("{}", output::error(&err, output::color_for(&stderr)));
            ExitCode::FAILURE
        }
    }
}
