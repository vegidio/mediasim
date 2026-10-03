//! Runs `mediasim files` on the sample files in `fixtures`, with its output piped.
//!
//! The fixtures score `test1.png`/`test2.png` ≈ 0.955 and `test3.mp4`/`test4.mp4` ≈ 0.507. The two images have the
//! same resolution and `test1.png` is the larger file, so it is best; `test4.mp4` is the longer video, so it is best.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)
}

fn fixtures(names: &[&str]) -> Vec<PathBuf> {
    names.iter().map(|name| fixture(name)).collect()
}

fn mediasim(args: &[&str], files: &[PathBuf]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mediasim"))
        .arg("files")
        .args(args)
        .args(files)
        .output()
        .unwrap()
}

fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).unwrap()
}

fn stderr(output: &Output) -> String {
    String::from_utf8(output.stderr.clone()).unwrap()
}

/// The printed groups, each as its list of paths.
fn groups(output: &Output) -> Vec<Vec<PathBuf>> {
    assert!(output.status.success(), "{}", stderr(output));
    let stdout = stdout(output);
    assert!(!stdout.contains('\x1b'), "{stdout:?}");

    stdout
        .strip_suffix('\n')
        .unwrap_or(&stdout)
        .split("\n\n")
        .filter(|group| !group.is_empty())
        .map(|group| group.lines().map(PathBuf::from).collect())
        .collect()
}

#[test]
fn default_threshold_groups_only_the_images_best_first() {
    let output = mediasim(&[], &fixtures(&["test1.png", "test2.png", "test3.mp4", "test4.mp4"]));

    let groups = groups(&output);

    assert_eq!(groups, [fixtures(&["test1.png", "test2.png"])]);
}

#[test]
fn zero_threshold_lists_groups_by_earliest_argument_best_first_without_mixing_types() {
    let output = mediasim(&["-t", "0"], &fixtures(&["test3.mp4", "test1.png", "test4.mp4", "test2.png"]));

    let groups = groups(&output);

    assert_eq!(groups, [fixtures(&["test4.mp4", "test3.mp4"]), fixtures(&["test1.png", "test2.png"])]);
}

#[test]
fn high_threshold_prints_nothing() {
    let output = mediasim(&["-t", "0.99"], &fixtures(&["test1.png", "test2.png"]));

    assert!(groups(&output).is_empty());
    assert!(output.stdout.is_empty(), "{:?}", stdout(&output));
}

#[test]
fn a_repeated_file_is_not_grouped_with_itself() {
    let output = mediasim(&[], &fixtures(&["test1.png", "test1.png"]));

    assert!(groups(&output).is_empty());
    assert!(output.stdout.is_empty(), "{:?}", stdout(&output));
}

#[test]
fn one_path_is_a_usage_error() {
    let output = mediasim(&[], &fixtures(&["test1.png"]));

    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty(), "stdout: {}", stdout(&output));
}

#[test]
fn out_of_range_threshold_is_a_usage_error() {
    let output = mediasim(&["-t", "2"], &fixtures(&["test1.png", "test2.png"]));

    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty(), "stdout: {}", stdout(&output));
}

#[test]
fn missing_file_is_named() {
    let files = [fixture("test1.png"), PathBuf::from("definitely-not-a-real-file.png"), fixture("test2.png")];

    let output = mediasim(&[], &files);

    let stderr = stderr(&output);
    assert_eq!(output.status.code(), Some(1), "{stderr}");
    assert!(output.stdout.is_empty(), "stdout: {}", stdout(&output));
    assert!(stderr.starts_with("🧨 "), "{stderr}");
    assert!(stderr.contains("definitely-not-a-real-file.png"), "{stderr}");
    assert!(!stderr.contains('\x1b'), "{stderr:?}");
}
