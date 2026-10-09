//! Runs `mediasim files` on the sample files in `fixtures`, with its output piped.
//!
//! The fixtures score `test1.avif`/`test2.avif` ≈ 0.774 and `test3.mkv`/`test4.mkv` ≈ 0.627, so the tests that expect
//! only the images to group pass [`THRESHOLD`], which falls between them. The two images have the same resolution and
//! `test1.avif` is the larger file, so it is best; `test3.mkv` is the longer video, so it is best.

mod common;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use common::{
    CSV_HEADER, THRESHOLD, assert_fails, assert_skipped, assert_usage_error, csv_rows, fixture, groups, json,
    json_groups, oriented_copies, sorted, stdout,
};
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
fn a_threshold_between_the_scores_groups_only_the_images_best_first() {
    let output = mediasim(&["-t", THRESHOLD], &fixtures(&["test1.avif", "test2.avif", "test3.mkv", "test4.mkv"]));

    let groups = groups(&output);

    assert_eq!(groups, [fixtures(&["test1.avif", "test2.avif"])]);
}

#[test]
fn zero_threshold_lists_groups_by_earliest_argument_best_first_without_mixing_types() {
    let output = mediasim(&["-t", "0"], &fixtures(&["test3.mkv", "test1.avif", "test4.mkv", "test2.avif"]));

    let groups = groups(&output);

    assert_eq!(groups, [fixtures(&["test3.mkv", "test4.mkv"]), fixtures(&["test1.avif", "test2.avif"])]);
}

#[test]
fn high_threshold_prints_nothing() {
    let output = mediasim(&["-t", "0.99"], &fixtures(&["test1.avif", "test2.avif"]));

    assert!(groups(&output).is_empty());
    assert!(output.stdout.is_empty(), "{:?}", stdout(&output));
}

#[test]
fn a_repeated_file_is_not_grouped_with_itself() {
    let output = mediasim(&[], &fixtures(&["test1.avif", "test1.avif"]));

    assert!(groups(&output).is_empty());
    assert!(output.stdout.is_empty(), "{:?}", stdout(&output));
}

#[test]
fn one_path_is_a_usage_error() {
    let output = mediasim(&[], &fixtures(&["test1.avif"]));

    assert_usage_error(&output);
}

#[test]
fn out_of_range_threshold_is_a_usage_error() {
    let output = mediasim(&["-t", "2"], &fixtures(&["test1.avif", "test2.avif"]));

    assert_usage_error(&output);
}

#[test]
fn missing_file_is_named() {
    let files = [fixture("test1.avif"), PathBuf::from("definitely-not-a-real-file.png"), fixture("test2.avif")];

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
    let files = [fixture("test1.avif"), broken.clone(), fixture("test2.avif")];

    let output = mediasim(&["--ie", "-t", THRESHOLD], &files);

    assert_skipped(&output, &[&broken]);
    assert_eq!(stdout(&output), stdout(&mediasim(&["-t", THRESHOLD], &fixtures(&["test1.avif", "test2.avif"]))));
    assert_eq!(groups(&output), [fixtures(&["test1.avif", "test2.avif"])]);
}

#[test]
fn ignore_errors_long_spelling_skips_a_missing_file() {
    let missing = Path::new("definitely-not-a-real-file.png");
    let files = [fixture("test1.avif"), missing.to_path_buf(), fixture("test2.avif")];

    let output = mediasim(&["--ignore-errors", "-t", THRESHOLD], &files);

    assert_skipped(&output, &[missing]);
    assert_eq!(groups(&output), [fixtures(&["test1.avif", "test2.avif"])]);
}

#[test]
fn ignore_errors_reports_skipped_files_in_argument_order() {
    let dir = mk_temp_dir("mediasim").unwrap();
    let broken = dir.path().join("broken.png");
    std::fs::write(&broken, b"not a png").unwrap();
    let missing = Path::new("definitely-not-a-real-file.png");
    let files = [fixture("test1.avif"), broken.clone(), missing.to_path_buf(), fixture("test2.avif")];

    let output = mediasim(&["--ie", "-t", THRESHOLD], &files);

    assert_skipped(&output, &[&broken, missing]);
    assert_eq!(groups(&output), [fixtures(&["test1.avif", "test2.avif"])]);
}

#[test]
fn ignore_errors_with_one_loadable_file_prints_nothing() {
    let missing = Path::new("definitely-not-a-real-file.png");
    let files = [fixture("test1.avif"), missing.to_path_buf()];

    let output = mediasim(&["--ie"], &files);

    assert_skipped(&output, &[missing]);
    assert!(output.stdout.is_empty(), "{:?}", stdout(&output));
}

#[test]
fn ignore_errors_without_failures_prints_no_report() {
    let files = fixtures(&["test1.avif", "test2.avif"]);

    let output = mediasim(&["--ie"], &files);

    assert!(output.stderr.is_empty(), "{:?}", common::stderr(&output));
    assert_eq!(output.stdout, mediasim(&[], &files).stdout);
}

#[test]
fn term_given_explicitly_prints_the_plain_groups_when_piped() {
    let files = fixtures(&["test3.mkv", "test1.avif", "test4.mkv", "test2.avif"]);

    let output = mediasim(&["-o", "term", "-t", "0"], &files);

    assert!(output.status.success(), "{}", common::stderr(&output));
    assert_eq!(output.stdout, mediasim(&["-t", "0"], &files).stdout);
    assert_eq!(
        groups(&output),
        [fixtures(&["test3.mkv", "test4.mkv"]), fixtures(&["test1.avif", "test2.avif"])]
    );
}

#[test]
fn json_lists_the_groups_best_first_with_the_media_fields() {
    let output = mediasim(
        &["-o", "json", "-t", THRESHOLD],
        &fixtures(&["test1.avif", "test2.avif", "test3.mkv", "test4.mkv"]),
    );

    let document = json(&output);

    assert_eq!(json_groups(&document), [fixtures(&["test1.avif", "test2.avif"])]);
    assert_eq!(document["skipped"], serde_json::json!([]));
    let best = &document["groups"][0][0];
    // `Value` sorts its keys; the order they are printed in is checked by the unit tests.
    let fields: Vec<_> = best.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(fields, ["created", "duration", "height", "modified", "path", "size", "type", "width"]);
    assert_eq!(best["type"], "image");
    assert_eq!((best["width"].as_u64(), best["height"].as_u64()), (Some(427), Some(640)));
    assert_eq!(best["size"].as_u64(), Some(std::fs::metadata(fixture("test1.avif")).unwrap().len()));
    assert!(best["duration"].is_null());
    assert!(best["modified"].as_str().is_some_and(|time| time.ends_with('Z')), "{best}");
}

#[test]
fn json_gives_a_video_its_duration_in_seconds() {
    let document = json(&mediasim(&["-o", "json", "-t", "0"], &fixtures(&["test3.mkv", "test4.mkv"])));

    let durations: Vec<_> = document["groups"][0].as_array().unwrap().iter().map(|m| m["duration"].as_f64()).collect();
    assert!(durations.iter().all(|d| d.is_some_and(|d| d > 0.0)), "{durations:?}");
    assert_eq!(document["groups"][0][0]["type"], "video");
}

#[test]
fn csv_has_the_header_and_one_row_per_media_in_group_order() {
    let output =
        mediasim(&["-o", "csv", "-t", "0"], &fixtures(&["test3.mkv", "test1.avif", "test4.mkv", "test2.avif"]));

    let (header, rows) = csv_rows(&output);

    assert_eq!(header, CSV_HEADER);
    assert_eq!(
        rows,
        [
            (1, fixture("test3.mkv")),
            (1, fixture("test4.mkv")),
            (2, fixture("test1.avif")),
            (2, fixture("test2.avif"))
        ]
    );
}

#[test]
fn no_groups_is_the_csv_header_alone() {
    let output = mediasim(&["-o", "csv", "-t", "0.99"], &fixtures(&["test1.avif", "test2.avif"]));

    assert!(output.status.success(), "{}", common::stderr(&output));
    assert_eq!(stdout(&output), format!("{}\n", CSV_HEADER.join(",")));
}

#[test]
fn no_groups_is_an_empty_json_document() {
    let output = mediasim(&["-o", "json", "-t", "0.99"], &fixtures(&["test1.avif", "test2.avif"]));

    assert!(output.status.success(), "{}", common::stderr(&output));
    assert_eq!(stdout(&output), "{\"groups\":[],\"skipped\":[]}\n");
}

#[test]
fn ignore_errors_lists_skipped_files_in_json_and_reports_them_on_stderr() {
    let missing = Path::new("definitely-not-a-real-file.png");
    let files = [fixture("test1.avif"), missing.to_path_buf(), fixture("test2.avif")];

    let output = mediasim(&["--ie", "-o", "json", "-t", THRESHOLD], &files);

    assert_skipped(&output, &[missing]);
    let document = json(&output);
    assert_eq!(json_groups(&document), [fixtures(&["test1.avif", "test2.avif"])]);
    let skipped = document["skipped"].as_array().unwrap();
    assert_eq!(skipped.len(), 1, "{skipped:?}");
    assert_eq!(skipped[0]["path"], "definitely-not-a-real-file.png");
    assert!(skipped[0]["error"].as_str().unwrap().contains("definitely-not-a-real-file.png"), "{skipped:?}");
}

#[test]
fn ignore_errors_with_csv_reports_skipped_files_on_stderr_only() {
    let missing = Path::new("definitely-not-a-real-file.png");
    let files = [fixture("test1.avif"), missing.to_path_buf(), fixture("test2.avif")];

    let output = mediasim(&["-o", "csv", "--ie", "-t", THRESHOLD], &files);

    assert_skipped(&output, &[missing]);
    let (header, rows) = csv_rows(&output);
    assert_eq!(header, CSV_HEADER);
    assert_eq!(rows, [(1, fixture("test1.avif")), (1, fixture("test2.avif"))]);
}

#[test]
fn json_with_a_missing_file_prints_only_the_error() {
    let files = [fixture("test1.avif"), PathBuf::from("definitely-not-a-real-file.png")];

    let stderr = assert_fails(&mediasim(&["-o", "json"], &files));

    assert!(stderr.contains("definitely-not-a-real-file.png"), "{stderr}");
}
