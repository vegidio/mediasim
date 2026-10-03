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

    /// Group two or more images and videos by similarity, listing the best file of each group first.
    Files {
        /// The images and videos to group.
        #[arg(required = true, num_args = 2..)]
        files: Vec<PathBuf>,
        /// The minimum similarity, from 0 to 1, for two files to be grouped.
        #[arg(short, long, default_value_t = 0.8, value_parser = parse_threshold, allow_negative_numbers = true)]
        threshold: f64,
    },
}

/// Accepts a number from 0 to 1, inclusive.
fn parse_threshold(value: &str) -> Result<f64, String> {
    let threshold: f64 = value.parse().map_err(|_| format!("`{value}` is not a number"))?;
    if (0.0..=1.0).contains(&threshold) {
        Ok(threshold)
    } else {
        Err(format!("`{value}` is not between 0 and 1"))
    }
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

        let Command::Score { file1, file2 } = cli.command else { panic!("expected `score`") };
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

    fn parse_files(args: &[&str]) -> Result<(Vec<PathBuf>, f64), clap::Error> {
        let cli = Cli::try_parse_from(["mediasim", "files"].iter().chain(args))?;
        let Command::Files { files, threshold } = cli.command else { panic!("expected `files`") };
        Ok((files, threshold))
    }

    #[test]
    #[allow(clippy::float_cmp)]
    fn files_takes_several_paths_with_the_default_threshold() {
        let (files, threshold) = parse_files(&["a", "b", "c"]).unwrap();

        assert_eq!(files, [PathBuf::from("a"), PathBuf::from("b"), PathBuf::from("c")]);
        assert_eq!(threshold, 0.8);
    }

    #[test]
    #[allow(clippy::float_cmp)]
    fn files_takes_a_threshold() {
        assert_eq!(parse_files(&["-t", "0.95", "a", "b"]).unwrap().1, 0.95);
        assert_eq!(parse_files(&["a", "b", "--threshold", "0"]).unwrap().1, 0.0);
    }

    #[test]
    fn files_with_one_path_is_a_usage_error() {
        let err = parse_files(&["a"]).unwrap_err();

        assert_eq!(err.kind(), ErrorKind::TooFewValues);
        assert_eq!(err.exit_code(), 2);
    }

    #[test]
    fn files_with_an_invalid_threshold_is_a_usage_error() {
        for value in ["1.5", "-0.1", "abc", "NaN", "inf"] {
            let err = parse_files(&["-t", value, "a", "b"]).unwrap_err();

            assert_eq!(err.kind(), ErrorKind::ValueValidation, "{value}");
            assert_eq!(err.exit_code(), 2, "{value}");
        }
    }
}
