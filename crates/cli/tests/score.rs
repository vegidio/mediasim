//! Runs the `mediasim` binary on the sample files in `fixtures`, with its output piped.

mod common;

use std::path::Path;
use std::process::{Command, Output};

use common::{assert_fails, assert_usage_error, fixture, oriented_copies, stderr, stdout};
use rust_sak::fs::mk_temp_dir;

fn mediasim(args: &[&Path]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mediasim")).arg("score").args(args).output().unwrap()
}

#[test]
fn piped_score_is_a_bare_number() {
    let output = mediasim(&[&fixture("test1.avif"), &fixture("test2.avif")]);

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
    let output = mediasim(&[&fixture("test1.avif"), &fixture("test1.avif")]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stdout(&output), "1\n");
}

#[test]
fn image_against_video_names_both_files() {
    let (image, video) = (fixture("test1.avif"), fixture("test3.mkv"));

    let stderr = assert_fails(&mediasim(&[&image, &video]));

    assert!(stderr.contains(&image.display().to_string()), "{stderr}");
    assert!(stderr.contains(&video.display().to_string()), "{stderr}");
}

#[test]
fn missing_file_is_named() {
    let stderr = assert_fails(&mediasim(&[Path::new("definitely-not-a-real-file.png"), &fixture("test1.avif")]));

    assert!(stderr.contains("definitely-not-a-real-file.png"), "{stderr}");
}

#[test]
fn one_path_is_a_usage_error() {
    let output = mediasim(&[&fixture("test1.avif")]);

    assert_usage_error(&output);
}

#[test]
fn three_paths_is_a_usage_error() {
    let output = mediasim(&[&fixture("test1.avif"), &fixture("test2.avif"), &fixture("test1.avif")]);

    assert_usage_error(&output);
}

#[test]
fn version_is_printed() {
    for flag in ["-v", "--version"] {
        let output = Command::new(env!("CARGO_BIN_EXE_mediasim")).arg(flag).output().unwrap();

        assert!(output.status.success(), "{flag}: {}", stderr(&output));
        assert_eq!(stdout(&output), format!("mediasim {}\n", env!("CARGO_PKG_VERSION")), "{flag}");
    }
}

#[test]
fn no_command_prints_usage_and_fails() {
    let output = Command::new(env!("CARGO_BIN_EXE_mediasim")).output().unwrap();

    assert!(!output.status.success());
    assert!(stderr(&output).contains("Usage:"), "{}", stderr(&output));
}

/// The score that `mediasim score <flags> <a> <b>` prints, piped.
fn score_with(flags: &[&str], a: &Path, b: &Path) -> f64 {
    let output = Command::new(env!("CARGO_BIN_EXE_mediasim"))
        .arg("score")
        .args(flags)
        .arg(a)
        .arg(b)
        .output()
        .unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    stdout(&output).trim().parse().unwrap()
}

#[test]
fn frame_flip_scores_a_mirrored_copy_higher() {
    let dir = mk_temp_dir("mediasim").unwrap();
    let copies = oriented_copies(dir.path());

    let plain = score_with(&[], &copies.original, &copies.mirrored);
    let flipped = score_with(&["--ff"], &copies.original, &copies.mirrored);

    assert!(flipped > plain, "{flipped} <= {plain}");
    assert!(flipped > 0.999, "{flipped}");
}

#[test]
fn frame_rotate_scores_a_rotated_copy_higher() {
    let dir = mk_temp_dir("mediasim").unwrap();
    let copies = oriented_copies(dir.path());

    let plain = score_with(&[], &copies.original, &copies.rotated);
    let rotated = score_with(&["--fr"], &copies.original, &copies.rotated);

    assert!(rotated > plain, "{rotated} <= {plain}");
    assert!(rotated > 0.999, "{rotated}");
}

#[test]
fn an_orientation_flag_with_a_value_is_a_usage_error() {
    let output = Command::new(env!("CARGO_BIN_EXE_mediasim"))
        .args(["score", "--ff=yes"])
        .arg(fixture("test1.avif"))
        .arg(fixture("test2.avif"))
        .output()
        .unwrap();

    assert_usage_error(&output);
}

fn score_as(format: &str, a: &Path, b: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mediasim"))
        .args(["score", "-o", format])
        .arg(a)
        .arg(b)
        .output()
        .unwrap()
}

#[test]
fn csv_is_a_header_and_the_score() {
    let output = score_as("csv", &fixture("test1.avif"), &fixture("test1.avif"));

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stdout(&output), "score\n1\n");

    let (a, b) = (fixture("test1.avif"), fixture("test2.avif"));
    assert_eq!(stdout(&score_as("csv", &a, &b)), format!("score\n{}", stdout(&mediasim(&[&a, &b]))));
}

#[test]
fn json_is_an_object_with_the_score() {
    let output = score_as("json", &fixture("test1.avif"), &fixture("test1.avif"));

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stdout(&output), "{\"score\":1.0}\n");

    let (a, b) = (fixture("test1.avif"), fixture("test2.avif"));
    let bare = stdout(&mediasim(&[&a, &b]));
    assert_eq!(stdout(&score_as("json", &a, &b)), format!("{{\"score\":{}}}\n", bare.trim()));
}

#[test]
fn term_given_explicitly_prints_the_bare_score_when_piped() {
    let (a, b) = (fixture("test1.avif"), fixture("test2.avif"));

    let output = score_as("term", &a, &b);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(output.stdout, mediasim(&[&a, &b]).stdout);
}

#[test]
fn json_with_a_missing_file_prints_only_the_error() {
    let output = score_as("json", &fixture("test1.avif"), Path::new("definitely-not-a-real-file.png"));

    let stderr = assert_fails(&output);
    assert!(stderr.contains("definitely-not-a-real-file.png"), "{stderr}");
}

#[test]
fn an_unknown_output_format_is_a_usage_error() {
    let output = score_as("xml", &fixture("test1.avif"), &fixture("test2.avif"));

    assert_usage_error(&output);
    assert!(stderr(&output).contains("term, csv, json"), "{}", stderr(&output));
}
