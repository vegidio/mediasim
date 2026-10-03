//! Runs the `mediasim` binary on the sample files in `fixtures`, with its output piped.

mod common;

use std::path::Path;
use std::process::{Command, Output};

use common::{assert_fails, assert_usage_error, fixture, stderr, stdout};

fn mediasim(args: &[&Path]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mediasim")).arg("score").args(args).output().unwrap()
}

#[test]
fn piped_score_is_a_bare_number() {
    let output = mediasim(&[&fixture("test1.png"), &fixture("test2.png")]);

    assert!(output.status.success(), "{}", stderr(&output));
    let stdout = stdout(&output);
    let score = stdout.strip_suffix('\n').expect("one line");
    assert!(!score.contains('\n') && !score.contains('\x1b'), "{stdout:?}");
    assert!(score.chars().all(|c| c.is_ascii_digit() || c == '.'), "{score}");
    assert!(
        score
            .split_once('.')
            .is_none_or(|(_, decimals)| decimals.len() <= 5 && !decimals.ends_with('0'))
    );
    let value: f64 = score.parse().unwrap();
    assert!((0.0..=1.0).contains(&value), "{value}");
}

#[test]
fn a_file_against_itself_scores_one() {
    let output = mediasim(&[&fixture("test1.png"), &fixture("test1.png")]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stdout(&output), "1\n");
}

#[test]
fn image_against_video_names_both_files() {
    let (image, video) = (fixture("test1.png"), fixture("test3.mp4"));

    let stderr = assert_fails(&mediasim(&[&image, &video]));

    assert!(stderr.contains(&image.display().to_string()), "{stderr}");
    assert!(stderr.contains(&video.display().to_string()), "{stderr}");
}

#[test]
fn missing_file_is_named() {
    let stderr = assert_fails(&mediasim(&[Path::new("definitely-not-a-real-file.png"), &fixture("test1.png")]));

    assert!(stderr.contains("definitely-not-a-real-file.png"), "{stderr}");
}

#[test]
fn one_path_is_a_usage_error() {
    let output = mediasim(&[&fixture("test1.png")]);

    assert_usage_error(&output);
}

#[test]
fn three_paths_is_a_usage_error() {
    let output = mediasim(&[&fixture("test1.png"), &fixture("test2.png"), &fixture("test1.png")]);

    assert_usage_error(&output);
}

#[test]
fn version_is_printed() {
    let output = Command::new(env!("CARGO_BIN_EXE_mediasim")).arg("--version").output().unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stdout(&output), format!("mediasim {}\n", env!("CARGO_PKG_VERSION")));
}

#[test]
fn no_command_prints_usage_and_fails() {
    let output = Command::new(env!("CARGO_BIN_EXE_mediasim")).output().unwrap();

    assert!(!output.status.success());
    assert!(stderr(&output).contains("Usage:"), "{}", stderr(&output));
}
