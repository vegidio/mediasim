//! The command line, parsed with clap.

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use mediasim::{CompareOptions, LoadOptions};

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
        #[command(flatten)]
        compare: CompareArgs,
        #[command(flatten)]
        output: OutputArgs,
    },

    /// Group two or more images and videos by similarity, listing the best file of each group first.
    Files {
        /// The images and videos to group.
        #[arg(required = true, num_args = 2..)]
        files: Vec<PathBuf>,
        #[command(flatten)]
        group: GroupArgs,
        #[command(flatten)]
        compare: CompareArgs,
        #[command(flatten)]
        output: OutputArgs,
    },

    /// Group the images and videos in a directory by similarity, listing the best file of each group first.
    Dir {
        /// The directory to scan.
        directory: PathBuf,
        /// Scan the subdirectories too.
        #[arg(short, long)]
        recursive: bool,
        /// Which media to load.
        #[arg(short = 'm', long, value_enum, default_value_t = MediaKind::All)]
        media_type: MediaKind,
        #[command(flatten)]
        group: GroupArgs,
        #[command(flatten)]
        compare: CompareArgs,
        #[command(flatten)]
        output: OutputArgs,
    },
}

/// The options shared by the commands that group media.
#[derive(Debug, Args)]
pub struct GroupArgs {
    /// The minimum similarity, from 0 to 1, for two files to be grouped.
    #[arg(short, long, default_value_t = 0.8, value_parser = parse_threshold, allow_negative_numbers = true)]
    pub threshold: f64,
    /// Skip files that fail to load instead of stopping, and report them once loading ends.
    #[arg(long = "ignore-errors", visible_alias = "ie")]
    pub ignore_errors: bool,
}

/// The options shared by the commands that compare media.
#[derive(Debug, Args)]
pub struct CompareArgs {
    /// Also compare the files flipped horizontally and vertically.
    #[arg(long = "frame-flip", visible_alias = "ff")]
    pub flip: bool,
    /// Also compare the files rotated by 90°, 180° and 270°.
    #[arg(long = "frame-rotate", visible_alias = "fr")]
    pub rotate: bool,
}

impl CompareArgs {
    /// The [`CompareOptions`] these flags enable.
    pub fn options(&self) -> CompareOptions {
        CompareOptions::new().flip(self.flip).rotate(self.rotate)
    }
}

/// The options shared by every command.
#[derive(Debug, Args)]
pub struct OutputArgs {
    /// How to print the result: for a terminal, or as CSV or JSON for other programs.
    #[arg(short, long, value_enum, default_value_t = OutputFormat::Term)]
    pub output: OutputFormat,
}

/// How a command prints its result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum OutputFormat {
    /// A report on a terminal, or the bare result when piped.
    Term,
    /// A CSV document.
    Csv,
    /// A JSON document on one line.
    Json,
}

/// The media a directory scan loads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum MediaKind {
    Images,
    Videos,
    All,
}

impl MediaKind {
    /// The [`LoadOptions`] that load this kind of media, scanning subdirectories if `recursive`.
    pub fn load_options(self, recursive: bool) -> LoadOptions {
        LoadOptions::new()
            .recursive(recursive)
            .images(self != Self::Videos)
            .videos(self != Self::Images)
    }
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

        let Command::Score { file1, file2, .. } = cli.command else { panic!("expected `score`") };
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
        let Command::Files { files, group, .. } = cli.command else { panic!("expected `files`") };
        Ok((files, group.threshold))
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

    fn parse_dir(args: &[&str]) -> Result<(PathBuf, bool, MediaKind, f64), clap::Error> {
        let cli = Cli::try_parse_from(["mediasim", "dir"].iter().chain(args))?;
        let Command::Dir { directory, recursive, media_type, group, .. } = cli.command else {
            panic!("expected `dir`")
        };
        Ok((directory, recursive, media_type, group.threshold))
    }

    #[test]
    fn dir_takes_a_directory_with_the_defaults() {
        assert_eq!(parse_dir(&["photos"]).unwrap(), (PathBuf::from("photos"), false, MediaKind::All, 0.8));
    }

    #[test]
    fn dir_takes_its_options() {
        assert_eq!(
            parse_dir(&["-r", "-m", "videos", "-t", "0.9", "photos"]).unwrap(),
            (PathBuf::from("photos"), true, MediaKind::Videos, 0.9)
        );
        assert_eq!(parse_dir(&["--media-type", "images", "photos"]).unwrap().2, MediaKind::Images);
    }

    #[test]
    fn dir_usage_errors() {
        for (args, kind) in [
            (&[][..], ErrorKind::MissingRequiredArgument),
            (&["a", "b"][..], ErrorKind::UnknownArgument),
            (&["-m", "image", "photos"][..], ErrorKind::InvalidValue),
            (&["-m", "audio", "photos"][..], ErrorKind::InvalidValue),
            (&["-t", "1.5", "photos"][..], ErrorKind::ValueValidation),
        ] {
            let err = parse_dir(args).unwrap_err();

            assert_eq!(err.kind(), kind, "{args:?}");
            assert_eq!(err.exit_code(), 2, "{args:?}");
        }
    }

    #[test]
    fn media_kind_maps_to_load_options() {
        assert_eq!(MediaKind::All.load_options(false), LoadOptions::new());
        assert_eq!(MediaKind::Images.load_options(false), LoadOptions::new().videos(false));
        assert_eq!(MediaKind::Videos.load_options(true), LoadOptions::new().recursive(true).images(false));
    }

    /// The orientation options that `args` parse to for each command, with whatever positional arguments it needs.
    fn compare_options(command: &str, args: &[&str]) -> Result<CompareOptions, clap::Error> {
        let paths: &[&str] = if command == "dir" { &["photos"] } else { &["a", "b"] };
        let cli = Cli::try_parse_from(["mediasim", command].iter().chain(args).chain(paths))?;
        let compare = match cli.command {
            Command::Score { compare, .. } | Command::Files { compare, .. } | Command::Dir { compare, .. } => compare,
        };
        Ok(compare.options())
    }

    #[test]
    fn orientation_flags_are_off_by_default() {
        for command in ["score", "files", "dir"] {
            assert_eq!(compare_options(command, &[]).unwrap(), CompareOptions::new(), "{command}");
        }
    }

    #[test]
    fn orientation_flags_have_two_spellings() {
        let flip = CompareOptions::new().flip(true);
        let rotate = CompareOptions::new().rotate(true);

        for command in ["score", "files", "dir"] {
            for (args, want) in [
                (&["--ff"][..], flip),
                (&["--frame-flip"][..], flip),
                (&["--fr"][..], rotate),
                (&["--frame-rotate"][..], rotate),
                (&["--ff", "--fr"][..], flip.rotate(true)),
                (&["--frame-rotate", "--frame-flip"][..], flip.rotate(true)),
            ] {
                assert_eq!(compare_options(command, args).unwrap(), want, "{command} {args:?}");
            }
        }
    }

    #[test]
    fn orientation_flags_combine_with_the_other_options() {
        let cli = Cli::try_parse_from(["mediasim", "dir", "--ff", "-r", "--fr", "-m", "videos", "-t", "0.9", "photos"])
            .unwrap();
        let Command::Dir { directory, recursive, media_type, group, compare, .. } = cli.command else {
            panic!("expected `dir`")
        };
        assert_eq!((directory, recursive, media_type), (PathBuf::from("photos"), true, MediaKind::Videos));
        assert!((group.threshold - 0.9).abs() < f64::EPSILON);
        assert_eq!(compare.options(), CompareOptions::new().flip(true).rotate(true));

        let (files, threshold) = parse_files(&["--ff", "--fr", "-t", "0.9", "a", "b", "c"]).unwrap();
        assert_eq!(files.len(), 3);
        assert!((threshold - 0.9).abs() < f64::EPSILON);
    }

    /// Whether `args` turn on `--ignore-errors` for `command`, with whatever positional arguments it needs.
    fn ignore_errors(command: &str, args: &[&str]) -> Result<bool, clap::Error> {
        let paths: &[&str] = if command == "dir" { &["photos"] } else { &["a", "b"] };
        let cli = Cli::try_parse_from(["mediasim", command].iter().chain(args).chain(paths))?;
        match cli.command {
            Command::Files { group, .. } | Command::Dir { group, .. } => Ok(group.ignore_errors),
            Command::Score { .. } => panic!("`score` has no `--ignore-errors`"),
        }
    }

    #[test]
    fn ignore_errors_is_off_by_default() {
        for command in ["files", "dir"] {
            assert!(!ignore_errors(command, &[]).unwrap(), "{command}");
        }
    }

    #[test]
    fn ignore_errors_has_two_spellings() {
        for command in ["files", "dir"] {
            for flag in ["--ie", "--ignore-errors"] {
                assert!(ignore_errors(command, &[flag]).unwrap(), "{command} {flag}");
            }
        }
    }

    #[test]
    fn ignore_errors_goes_in_any_position() {
        for args in [
            &["--ie", "a", "b", "c"][..],
            &["a", "b", "c", "--ie"][..],
            &["-t", "0.9", "--ie", "--ff", "a", "b", "c"][..],
        ] {
            let cli = Cli::try_parse_from(["mediasim", "files"].iter().chain(args)).unwrap();
            let Command::Files { files, group, .. } = cli.command else { panic!("expected `files`") };
            assert_eq!(files.len(), 3, "{args:?}");
            assert!(group.ignore_errors, "{args:?}");
        }

        for args in [&["--ie", "-r", "photos"][..], &["photos", "--ignore-errors", "-r"][..]] {
            let cli = Cli::try_parse_from(["mediasim", "dir"].iter().chain(args)).unwrap();
            let Command::Dir { directory, recursive, group, .. } = cli.command else {
                panic!("expected `dir`")
            };
            assert_eq!((directory, recursive, group.ignore_errors), (PathBuf::from("photos"), true, true), "{args:?}");
        }
    }

    #[test]
    fn score_rejects_ignore_errors() {
        for flag in ["--ie", "--ignore-errors"] {
            let err = Cli::try_parse_from(["mediasim", "score", flag, "a", "b"]).unwrap_err();

            assert_eq!(err.kind(), ErrorKind::UnknownArgument, "{flag}");
            assert_eq!(err.exit_code(), 2, "{flag}");
        }
    }

    #[test]
    fn ignore_errors_with_a_value_is_a_usage_error() {
        for command in ["files", "dir"] {
            for flag in ["--ie=yes", "--ignore-errors=true"] {
                let err = ignore_errors(command, &[flag]).unwrap_err();

                assert_eq!(err.kind(), ErrorKind::TooManyValues, "{command} {flag}");
                assert_eq!(err.exit_code(), 2, "{command} {flag}");
            }
        }
    }

    #[test]
    fn compare_args_map_to_compare_options() {
        for (flip, rotate) in [(false, false), (true, false), (false, true), (true, true)] {
            assert_eq!(CompareArgs { flip, rotate }.options(), CompareOptions::new().flip(flip).rotate(rotate));
        }
    }

    #[test]
    fn orientation_flag_with_a_value_is_a_usage_error() {
        for command in ["score", "files", "dir"] {
            for flag in ["--ff=yes", "--frame-rotate=true"] {
                let err = compare_options(command, &[flag]).unwrap_err();

                assert_eq!(err.kind(), ErrorKind::TooManyValues, "{command} {flag}");
                assert_eq!(err.exit_code(), 2, "{command} {flag}");
            }
        }
    }

    /// The output format that `args` parse to for `command`, with whatever positional arguments it needs after them.
    fn output_format(command: &str, args: &[&str]) -> Result<OutputFormat, clap::Error> {
        let paths: &[&str] = if command == "dir" { &["photos"] } else { &["a", "b"] };
        let cli = Cli::try_parse_from(["mediasim", command].iter().chain(args).chain(paths))?;
        let (Command::Score { output, .. } | Command::Files { output, .. } | Command::Dir { output, .. }) = cli.command;
        Ok(output.output)
    }

    #[test]
    fn output_is_term_by_default() {
        for command in ["score", "files", "dir"] {
            assert_eq!(output_format(command, &[]).unwrap(), OutputFormat::Term, "{command}");
        }
    }

    #[test]
    fn output_has_two_spellings() {
        for command in ["score", "files", "dir"] {
            for (args, want) in [
                (&["-o", "csv"][..], OutputFormat::Csv),
                (&["--output", "json"][..], OutputFormat::Json),
                (&["--output=csv"][..], OutputFormat::Csv),
                (&["-o", "term"][..], OutputFormat::Term),
            ] {
                assert_eq!(output_format(command, args).unwrap(), want, "{command} {args:?}");
            }
        }
    }

    #[test]
    fn output_goes_in_any_position() {
        let cli = Cli::try_parse_from(["mediasim", "score", "a", "b", "--output", "json"]).unwrap();
        let Command::Score { file1, file2, output, .. } = cli.command else {
            panic!("expected `score`")
        };
        assert_eq!((file1, file2, output.output), (PathBuf::from("a"), PathBuf::from("b"), OutputFormat::Json));

        let cli = Cli::try_parse_from(["mediasim", "files", "a", "b", "c", "-o", "csv"]).unwrap();
        let Command::Files { files, output, .. } = cli.command else { panic!("expected `files`") };
        assert_eq!((files.len(), output.output), (3, OutputFormat::Csv));

        let cli = Cli::try_parse_from(["mediasim", "dir", "photos", "-o", "json"]).unwrap();
        let Command::Dir { directory, output, .. } = cli.command else { panic!("expected `dir`") };
        assert_eq!((directory, output.output), (PathBuf::from("photos"), OutputFormat::Json));
    }

    #[test]
    fn output_combines_with_the_other_options() {
        let cli = Cli::try_parse_from([
            "mediasim", "dir", "-r", "-m", "images", "-t", "0.9", "--ie", "--ff", "-o", "csv", "photos",
        ])
        .unwrap();
        let Command::Dir { directory, recursive, media_type, group, compare, output } = cli.command else {
            panic!("expected `dir`")
        };

        assert_eq!((directory, recursive, media_type), (PathBuf::from("photos"), true, MediaKind::Images));
        assert!((group.threshold - 0.9).abs() < f64::EPSILON);
        assert!(group.ignore_errors);
        assert_eq!(compare.options(), CompareOptions::new().flip(true));
        assert_eq!(output.output, OutputFormat::Csv);
    }

    #[test]
    fn an_unknown_or_missing_output_is_a_usage_error() {
        for command in ["score", "files", "dir"] {
            let err = output_format(command, &["-o", "xml"]).unwrap_err();
            assert_eq!(err.kind(), ErrorKind::InvalidValue, "{command}");
            assert_eq!(err.exit_code(), 2, "{command}");
            assert!(err.to_string().contains("term, csv, json"), "{err}");

            let paths: &[&str] = if command == "dir" { &["photos"] } else { &["a", "b"] };
            let err = Cli::try_parse_from(["mediasim", command].iter().chain(paths).chain(&["-o"])).unwrap_err();
            assert_eq!(err.kind(), ErrorKind::InvalidValue, "{command}");
            assert_eq!(err.exit_code(), 2, "{command}");
        }
    }
}
