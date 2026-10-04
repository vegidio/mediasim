//! Runs `mediasim files` on the sample files in `fixtures`, with its output piped.
//!
//! The fixtures score `test1.png`/`test2.png` ≈ 0.945 and `test3.mp4`/`test4.mp4` ≈ 0.507. The two images have the
//! same resolution and `test1.png` is the larger file, so it is best; `test4.mp4` is the longer video, so it is best.

mod common;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use common::{assert_fails, assert_skipped, assert_usage_error, fixture, groups, oriented_copies, sorted, stdout};
use rust_sak::fs::mk_temp_dir;

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

    assert_usage_error(&output);
}

#[test]
fn out_of_range_threshold_is_a_usage_error() {
    let output = mediasim(&["-t", "2"], &fixtures(&["test1.png", "test2.png"]));

    assert_usage_error(&output);
}

#[test]
fn missing_file_is_named() {
    let files = [fixture("test1.png"), PathBuf::from("definitely-not-a-real-file.png"), fixture("test2.png")];

    let stderr = assert_fails(&mediasim(&[], &files));

    assert!(stderr.contains("definitely-not-a-real-file.png"), "{stderr}");
}

#[test]
fn frame_flip_groups_a_mirrored_copy_with_its_original() {
    let dir = mk_temp_dir("mediasim").unwrap();
    let copies = oriented_copies(dir.path());
    let files = [copies.original.clone(), copies.mirrored.clone()];

    let plain = groups(&mediasim(&[], &files));
    let flipped = groups(&mediasim(&["--ff"], &files));

    assert!(plain.is_empty(), "{plain:?}");
    assert_eq!(sorted(flipped), sorted(vec![files.to_vec()]));
}

#[test]
fn ignore_errors_skips_an_undecodable_file_and_groups_the_rest() {
    let dir = mk_temp_dir("mediasim").unwrap();
    let broken = dir.path().join("broken.png");
    std::fs::write(&broken, b"not a png").unwrap();
    let files = [fixture("test1.png"), broken.clone(), fixture("test2.png")];

    let output = mediasim(&["--ie"], &files);

    assert_skipped(&output, &[&broken]);
    assert_eq!(stdout(&output), stdout(&mediasim(&[], &fixtures(&["test1.png", "test2.png"]))));
    assert_eq!(groups(&output), [fixtures(&["test1.png", "test2.png"])]);
}

#[test]
fn ignore_errors_long_spelling_skips_a_missing_file() {
    let missing = Path::new("definitely-not-a-real-file.png");
    let files = [fixture("test1.png"), missing.to_path_buf(), fixture("test2.png")];

    let output = mediasim(&["--ignore-errors"], &files);

    assert_skipped(&output, &[missing]);
    assert_eq!(groups(&output), [fixtures(&["test1.png", "test2.png"])]);
}

#[test]
fn ignore_errors_reports_skipped_files_in_argument_order() {
    let dir = mk_temp_dir("mediasim").unwrap();
    let broken = dir.path().join("broken.png");
    std::fs::write(&broken, b"not a png").unwrap();
    let missing = Path::new("definitely-not-a-real-file.png");
    let files = [fixture("test1.png"), broken.clone(), missing.to_path_buf(), fixture("test2.png")];

    let output = mediasim(&["--ie"], &files);

    assert_skipped(&output, &[&broken, missing]);
    assert_eq!(groups(&output), [fixtures(&["test1.png", "test2.png"])]);
}

#[test]
fn ignore_errors_with_one_loadable_file_prints_nothing() {
    let missing = Path::new("definitely-not-a-real-file.png");
    let files = [fixture("test1.png"), missing.to_path_buf()];

    let output = mediasim(&["--ie"], &files);

    assert_skipped(&output, &[missing]);
    assert!(output.stdout.is_empty(), "{:?}", stdout(&output));
}

#[test]
fn ignore_errors_without_failures_prints_no_report() {
    let files = fixtures(&["test1.png", "test2.png"]);

    let output = mediasim(&["--ie"], &files);

    assert!(output.stderr.is_empty(), "{:?}", common::stderr(&output));
    assert_eq!(output.stdout, mediasim(&[], &files).stdout);
}
