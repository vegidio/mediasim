//! Runs `mediasim dir` on temporary directories filled with copies of the sample files in `fixtures`, with its output
//! piped.
//!
//! The fixtures score `test1.png`/`test2.png` ≈ 0.945 and `test3.mp4`/`test4.mp4` ≈ 0.507. The two images have the
//! same resolution and `test1.png` is the larger file, so it is best; `test4.mp4` is the longer video, so it is best.

mod common;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use common::{assert_fails, assert_skipped, assert_usage_error, fixture, groups, oriented_copies, sorted, stdout};
use rust_sak::fs::{TempDir, mk_temp_dir};

/// A temporary directory holding a copy of each `(fixture, path inside the directory)` pair.
fn directory(files: &[(&str, &str)]) -> TempDir {
    let dir = mk_temp_dir("mediasim").unwrap();

    for (name, path) in files {
        let dest = dir.path().join(path);
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::copy(fixture(name), dest).unwrap();
    }

    dir
}

/// All four fixtures under their own names.
fn all_fixtures() -> TempDir {
    directory(&[
        ("test1.png", "test1.png"),
        ("test2.png", "test2.png"),
        ("test3.mp4", "test3.mp4"),
        ("test4.mp4", "test4.mp4"),
    ])
}

fn mediasim(args: &[&str], dir: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mediasim")).arg("dir").args(args).arg(dir).output().unwrap()
}

/// The paths `names` inside `dir`.
fn paths(dir: &Path, names: &[&str]) -> Vec<PathBuf> {
    names
        .iter()
        .map(|name| name.split('/').fold(dir.to_path_buf(), |path, part| path.join(part)))
        .collect()
}

#[test]
fn default_threshold_groups_only_the_images_best_first() {
    let dir = all_fixtures();

    let groups = groups(&mediasim(&[], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["test1.png", "test2.png"])]);
}

#[test]
fn zero_threshold_lists_groups_in_listing_order() {
    // The videos sort first, so their group comes first even though the images group more strongly.
    let dir =
        directory(&[("test3.mp4", "a.mp4"), ("test1.png", "b.png"), ("test4.mp4", "c.mp4"), ("test2.png", "d.png")]);

    let groups = groups(&mediasim(&["-t", "0"], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["c.mp4", "a.mp4"]), paths(dir.path(), &["b.png", "d.png"])]);
}

#[test]
fn groups_follow_the_earliest_file_in_the_listing() {
    // The `x` files match each other and the `y` files match each other. The `x` files are the videos, which finish
    // loading after the images, so the `x` group lists first only if groups follow the listing.
    let dir = directory(&[
        ("test3.mp4", "x1.mp4"),
        ("test4.mp4", "x2.mp4"),
        ("test1.png", "y1.png"),
        ("test2.png", "y2.png"),
    ]);

    for _ in 0..3 {
        let groups = groups(&mediasim(&["-t", "0.5"], dir.path()));

        assert_eq!(groups, [paths(dir.path(), &["x2.mp4", "x1.mp4"]), paths(dir.path(), &["y1.png", "y2.png"])]);
    }
}

#[test]
fn media_type_videos_loads_only_the_videos() {
    let dir = all_fixtures();

    let groups = groups(&mediasim(&["-t", "0", "-m", "videos"], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["test4.mp4", "test3.mp4"])]);
}

#[test]
fn media_type_images_loads_only_the_images() {
    let dir = all_fixtures();

    let groups = groups(&mediasim(&["-t", "0", "--media-type", "images"], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["test1.png", "test2.png"])]);
}

#[test]
fn subdirectories_are_scanned_only_when_recursive() {
    let dir = directory(&[("test1.png", "test1.png"), ("test2.png", "sub/test2.png")]);

    let flat = mediasim(&[], dir.path());
    let recursive = mediasim(&["-r"], dir.path());

    assert!(groups(&flat).is_empty());
    assert!(flat.stdout.is_empty(), "{:?}", stdout(&flat));
    assert_eq!(groups(&recursive), [paths(dir.path(), &["test1.png", "sub/test2.png"])]);
}

#[test]
fn an_empty_directory_prints_nothing() {
    let dir = directory(&[]);

    let output = mediasim(&[], dir.path());

    assert!(groups(&output).is_empty());
    assert!(output.stdout.is_empty(), "{:?}", stdout(&output));
}

#[test]
fn a_filter_that_leaves_one_file_prints_nothing() {
    let dir = directory(&[("test1.png", "test1.png"), ("test2.png", "test2.png"), ("test3.mp4", "test3.mp4")]);

    let output = mediasim(&["-t", "0", "-m", "videos"], dir.path());

    assert!(groups(&output).is_empty());
    assert!(output.stdout.is_empty(), "{:?}", stdout(&output));
}

#[test]
fn a_missing_directory_is_named() {
    let dir = directory(&[]);
    let missing = dir.path().join("missing");

    let stderr = assert_fails(&mediasim(&[], &missing));
    assert!(stderr.contains(&*missing.to_string_lossy()), "{stderr}");
}

#[test]
fn a_regular_file_is_named() {
    let dir = all_fixtures();
    let file = dir.path().join("test1.png");

    let stderr = assert_fails(&mediasim(&[], &file));
    assert!(stderr.contains(&*file.to_string_lossy()), "{stderr}");
}

#[test]
fn an_undecodable_media_file_is_named() {
    let dir = all_fixtures();
    let bad = dir.path().join("bad.png");
    std::fs::write(&bad, b"not a png").unwrap();

    let stderr = assert_fails(&mediasim(&[], dir.path()));
    assert!(stderr.contains(&*bad.to_string_lossy()), "{stderr}");
}

#[test]
fn an_invalid_media_type_is_a_usage_error() {
    let dir = all_fixtures();

    let output = mediasim(&["-m", "image"], dir.path());

    assert_usage_error(&output);
}

#[test]
fn frame_rotate_groups_a_rotated_copy_with_its_original() {
    let dir = directory(&[]);
    let copies = oriented_copies(dir.path());
    std::fs::remove_file(&copies.mirrored).unwrap();

    let plain = groups(&mediasim(&[], dir.path()));
    let rotated = groups(&mediasim(&["--fr"], dir.path()));

    assert!(plain.is_empty(), "{plain:?}");
    assert_eq!(sorted(rotated), sorted(vec![vec![copies.original, copies.rotated]]));
}

#[test]
fn ignore_errors_skips_an_undecodable_file_and_groups_the_rest() {
    let dir = all_fixtures();
    let bad = dir.path().join("bad.png");
    std::fs::write(&bad, b"not a png").unwrap();

    let output = mediasim(&["--ie"], dir.path());

    assert_skipped(&output, &[&bad]);
    assert_eq!(groups(&output), [paths(dir.path(), &["test1.png", "test2.png"])]);
}

#[test]
fn ignore_errors_does_not_ignore_a_missing_directory() {
    let dir = directory(&[]);
    let missing = dir.path().join("missing");

    let stderr = assert_fails(&mediasim(&["--ie"], &missing));
    assert!(stderr.contains(&*missing.to_string_lossy()), "{stderr}");
}

#[test]
fn ignore_errors_combines_with_the_other_options() {
    // The broken image is filtered out by `-m videos`, so only the broken video in the subdirectory is skipped.
    let dir = directory(&[("test3.mp4", "test3.mp4"), ("test4.mp4", "sub/test4.mp4"), ("test1.png", "test1.png")]);
    let bad_video = dir.path().join("sub").join("bad.mp4");
    std::fs::write(&bad_video, b"not an mp4").unwrap();
    std::fs::write(dir.path().join("bad.png"), b"not a png").unwrap();

    let output = mediasim(&["--ignore-errors", "-r", "-m", "videos", "-t", "0.5"], dir.path());

    assert_skipped(&output, &[&bad_video]);
    assert_eq!(groups(&output), [paths(dir.path(), &["sub/test4.mp4", "test3.mp4"])]);
}
