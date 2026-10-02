#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]

mod args;
mod error;
mod output;
mod progress;
mod score;

use std::io::IsTerminal;
use std::process::ExitCode;

use clap::Parser;

use args::{Cli, Command};
use error::CliError;

fn main() -> ExitCode {
    let cli = Cli::parse();

    let result = match cli.command {
        Command::Score { file1, file2 } => score::run(file1, file2),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        // The shell's convention for a process ended by SIGINT.
        Err(CliError::Interrupted) => ExitCode::from(130),
        Err(err) => {
            if std::io::stderr().is_terminal() {
                eprintln!();
            }
            eprintln!("{}", output::error(&err, output::stderr_color()));
            ExitCode::FAILURE
        }
    }
}
