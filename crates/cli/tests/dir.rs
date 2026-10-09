//! Runs `mediasim dir` on temporary directories filled with copies of the sample files in `fixtures`, with its output
//! piped.
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
        ("test1.avif", "test1.avif"),
        ("test2.avif", "test2.avif"),
        ("test3.mkv", "test3.mkv"),
        ("test4.mkv", "test4.mkv"),
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
fn a_threshold_between_the_scores_groups_only_the_images_best_first() {
    let dir = all_fixtures();

    let groups = groups(&mediasim(&["-t", THRESHOLD], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["test1.avif", "test2.avif"])]);
}

#[test]
fn zero_threshold_lists_groups_in_listing_order() {
    // The videos sort first, so their group comes first even though the images group more strongly.
    let dir = directory(&[
        ("test3.mkv", "a.mkv"),
        ("test1.avif", "b.avif"),
        ("test4.mkv", "c.mkv"),
        ("test2.avif", "d.avif"),
    ]);

    let groups = groups(&mediasim(&["-t", "0"], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["a.mkv", "c.mkv"]), paths(dir.path(), &["b.avif", "d.avif"])]);
}

#[test]
fn groups_follow_the_earliest_file_in_the_listing() {
    // The `x` files match each other and the `y` files match each other. The `x` files are the videos, which finish
    // loading after the images, so the `x` group lists first only if groups follow the listing.
    let dir = directory(&[
        ("test3.mkv", "x1.mkv"),
        ("test4.mkv", "x2.mkv"),
        ("test1.avif", "y1.avif"),
        ("test2.avif", "y2.avif"),
    ]);

    for _ in 0..3 {
        let groups = groups(&mediasim(&["-t", "0.5"], dir.path()));

        assert_eq!(groups, [paths(dir.path(), &["x1.mkv", "x2.mkv"]), paths(dir.path(), &["y1.avif", "y2.avif"])]);
    }
}

#[test]
fn media_type_videos_loads_only_the_videos() {
    let dir = all_fixtures();

    let groups = groups(&mediasim(&["-t", "0", "-m", "videos"], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["test3.mkv", "test4.mkv"])]);
}

#[test]
fn media_type_images_loads_only_the_images() {
    let dir = all_fixtures();

    let groups = groups(&mediasim(&["-t", "0", "--media-type", "images"], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["test1.avif", "test2.avif"])]);
}

#[test]
fn subdirectories_are_scanned_only_when_recursive() {
    let dir = directory(&[("test1.avif", "test1.avif"), ("test2.avif", "sub/test2.avif")]);

    let flat = mediasim(&["-t", THRESHOLD], dir.path());
    let recursive = mediasim(&["-r", "-t", THRESHOLD], dir.path());

    assert!(groups(&flat).is_empty());
    assert!(flat.stdout.is_empty(), "{:?}", stdout(&flat));
    assert_eq!(groups(&recursive), [paths(dir.path(), &["test1.avif", "sub/test2.avif"])]);
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
    let dir = directory(&[("test1.avif", "test1.avif"), ("test2.avif", "test2.avif"), ("test3.mkv", "test3.mkv")]);

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
    let file = dir.path().join("test1.avif");

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

    let output = mediasim(&["--ie", "-t", THRESHOLD], dir.path());

    assert_skipped(&output, &[&bad]);
    assert_eq!(groups(&output), [paths(dir.path(), &["test1.avif", "test2.avif"])]);
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
    let dir = directory(&[("test3.mkv", "test3.mkv"), ("test4.mkv", "sub/test4.mkv"), ("test1.avif", "test1.avif")]);
    let bad_video = dir.path().join("sub").join("bad.mp4");
    std::fs::write(&bad_video, b"not an mp4").unwrap();
    std::fs::write(dir.path().join("bad.png"), b"not a png").unwrap();

    let output = mediasim(&["--ignore-errors", "-r", "-m", "videos", "-t", "0.5"], dir.path());

    assert_skipped(&output, &[&bad_video]);
    assert_eq!(groups(&output), [paths(dir.path(), &["test3.mkv", "sub/test4.mkv"])]);
}

#[test]
fn csv_uses_the_directory_joined_paths() {
    let dir = directory(&[("test1.avif", "a.avif"), ("test2.avif", "sub/b.avif")]);

    let (header, rows) = csv_rows(&mediasim(&["-r", "-o", "csv", "-t", THRESHOLD], dir.path()));

    assert_eq!(header, CSV_HEADER);
    let expected: Vec<_> = paths(dir.path(), &["a.avif", "sub/b.avif"]).into_iter().map(|path| (1, path)).collect();
    assert_eq!(rows, expected);
}

#[test]
fn json_uses_the_directory_joined_paths() {
    let dir = all_fixtures();

    let document = json(&mediasim(&["--output", "json", "-t", THRESHOLD], dir.path()));

    assert_eq!(json_groups(&document), [paths(dir.path(), &["test1.avif", "test2.avif"])]);
    assert_eq!(document["skipped"], serde_json::json!([]));
}

#[test]
fn ignore_errors_lists_the_undecodable_file_in_json() {
    let dir = directory(&[("test1.avif", "a.avif"), ("test2.avif", "a-copy.avif")]);
    let broken = dir.path().join("broken.png");
    std::fs::write(&broken, b"not a png").unwrap();

    let output = mediasim(&["-o", "json", "--ie", "-t", THRESHOLD], dir.path());

    assert_skipped(&output, &[&broken]);
    let document = json(&output);
    assert_eq!(json_groups(&document), [paths(dir.path(), &["a.avif", "a-copy.avif"])]);
    let skipped = document["skipped"].as_array().unwrap();
    assert_eq!(skipped.len(), 1, "{skipped:?}");
    assert_eq!(skipped[0]["path"].as_str(), Some(&*broken.to_string_lossy()));
}

/// The cache `mediasim dir` keeps in `dir` while it runs.
fn cache_dir(dir: &Path) -> PathBuf {
    dir.join(".mediasim")
}

fn cache_file(dir: &Path) -> PathBuf {
    cache_dir(dir).join("cache.redb")
}

/// The two images under their own names, which group together at [`THRESHOLD`].
fn two_images() -> TempDir {
    directory(&[("test1.avif", "test1.avif"), ("test2.avif", "test2.avif")])
}

#[test]
fn a_successful_run_leaves_no_cache() {
    let dir = two_images();

    let groups = groups(&mediasim(&["-t", THRESHOLD], dir.path()));

    assert_eq!(groups, [paths(dir.path(), &["test1.avif", "test2.avif"])]);
    assert!(!cache_dir(dir.path()).exists());
}

#[test]
fn skipped_files_count_as_finished() {
    let dir = two_images();
    let bad = dir.path().join("bad.png");
    std::fs::write(&bad, b"not a png").unwrap();

    let output = mediasim(&["--ie"], dir.path());

    assert_skipped(&output, &[&bad]);
    assert!(!cache_dir(dir.path()).exists());
}

#[test]
fn an_aborted_run_keeps_the_cache() {
    let dir = two_images();
    std::fs::write(dir.path().join("bad.png"), b"not a png").unwrap();

    assert_fails(&mediasim(&[], dir.path()));

    assert!(cache_file(dir.path()).is_file());
}

#[test]
fn a_recursive_run_keeps_one_cache_at_the_root() {
    let dir = directory(&[("test1.avif", "sub/test1.avif"), ("test2.avif", "sub/test2.avif")]);
    std::fs::write(dir.path().join("bad.png"), b"not a png").unwrap();

    assert_fails(&mediasim(&["-r"], dir.path()));

    assert!(cache_file(dir.path()).is_file());
    assert!(!cache_dir(&dir.path().join("sub")).exists());
}

#[test]
fn an_empty_directory_gets_no_cache() {
    let dir = directory(&[]);
    std::fs::write(dir.path().join("notes.txt"), b"not media").unwrap();

    let output = mediasim(&[], dir.path());

    assert!(output.status.success());
    assert!(!cache_dir(dir.path()).exists());
}

#[test]
fn no_cache_creates_no_cache() {
    for flag in ["--nc", "--no-cache"] {
        let dir = two_images();
        std::fs::write(dir.path().join("bad.png"), b"not a png").unwrap();

        // An aborted run would keep the cache it created, so this shows none was created at all.
        assert_fails(&mediasim(&[flag], dir.path()));

        assert!(!cache_dir(dir.path()).exists(), "{flag}");
    }
}

#[cfg(unix)]
#[test]
fn a_read_only_directory_runs_without_a_cache() {
    use std::os::unix::fs::PermissionsExt;

    let dir = two_images();
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();

    // Root ignores permissions, so the scenario can't be reproduced there.
    let denied = std::fs::write(dir.path().join("probe"), b"").is_err();
    let output = mediasim(&["-t", THRESHOLD], dir.path());

    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();

    if !denied {
        eprintln!(
            "skipped a_read_only_directory_runs_without_a_cache: permissions are not enforced (running as root?)"
        );
        return;
    }
    assert_eq!(groups(&output), [paths(dir.path(), &["test1.avif", "test2.avif"])]);
    assert!(output.stderr.is_empty(), "{}", common::stderr(&output));
    assert!(!cache_dir(dir.path()).exists());
}

#[test]
fn a_run_resumes_from_the_cache_unless_told_not_to() {
    let dir = two_images();
    let names = paths(dir.path(), &["test1.avif", "test2.avif"]);
    let cache = mediasim::DirCache::open(dir.path()).unwrap();
    for result in mediasim::Media::from_files_cached(names.clone(), &cache) {
        result.unwrap();
    }
    drop(cache);

    // The cache still knows the image, but decoding it now fails: only a run that reads the cache succeeds.
    let replaced = &names[1];
    let meta = std::fs::metadata(replaced).unwrap();
    std::fs::write(replaced, vec![0xAB; usize::try_from(meta.len()).unwrap()]).unwrap();
    std::fs::File::options()
        .write(true)
        .open(replaced)
        .unwrap()
        .set_modified(meta.modified().unwrap())
        .unwrap();
    let before = (
        std::fs::read(cache_file(dir.path())).unwrap(),
        std::fs::metadata(cache_file(dir.path())).unwrap(),
    );

    let uncached = mediasim(&["--nc", "--ie"], dir.path());

    assert_skipped(&uncached, &[replaced]);
    let after = (
        std::fs::read(cache_file(dir.path())).unwrap(),
        std::fs::metadata(cache_file(dir.path())).unwrap(),
    );
    assert!(before.0 == after.0, "the cache's contents changed");
    assert_eq!(before.1.modified().unwrap(), after.1.modified().unwrap());

    let cached = mediasim(&["-t", THRESHOLD], dir.path());

    assert_eq!(groups(&cached), [names]);
    assert!(!cache_dir(dir.path()).exists());
}
