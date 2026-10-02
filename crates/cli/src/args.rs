//! The command line, parsed with clap.

use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "mediasim", version, about, arg_required_else_help = true)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Print how similar two images, or two videos, are: 1 means identical and 0 completely different.
    Score {
        /// The first image or video.
        file1: PathBuf,
        /// The second image or video.
        file2: PathBuf,
    },
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;
    use clap::error::ErrorKind;

    use super::*;

    #[test]
    fn command_is_well_formed() {
        Cli::command().debug_assert();
    }

    #[test]
    fn score_takes_two_paths() {
        let cli = Cli::try_parse_from(["mediasim", "score", "a", "b"]).unwrap();

        let Command::Score { file1, file2 } = cli.command;
        assert_eq!((file1, file2), (PathBuf::from("a"), PathBuf::from("b")));
    }

    #[test]
    fn score_with_one_path_is_a_usage_error() {
        let err = Cli::try_parse_from(["mediasim", "score", "a"]).unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MissingRequiredArgument);
        assert_eq!(err.exit_code(), 2);
    }

    #[test]
    fn score_with_three_paths_is_a_usage_error() {
        let err = Cli::try_parse_from(["mediasim", "score", "a", "b", "c"]).unwrap_err();

        assert_eq!(err.kind(), ErrorKind::UnknownArgument);
        assert_eq!(err.exit_code(), 2);
    }
}
