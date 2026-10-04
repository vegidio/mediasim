//! Helpers shared by the tests that run the `mediasim` binary with its output piped.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Output;

use image::{DynamicImage, imageops};

/// The path of a file in the workspace's `fixtures` directory.
pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)
}

pub fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).unwrap()
}

pub fn stderr(output: &Output) -> String {
    String::from_utf8(output.stderr.clone()).unwrap()
}

/// The printed groups, each as its list of paths.
pub fn groups(output: &Output) -> Vec<Vec<PathBuf>> {
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

/// Asserts a failed run: exit code 1, nothing on stdout, and a `🧨` line without escapes on stderr, which it returns.
pub fn assert_fails(output: &Output) -> String {
    let stderr = stderr(output);

    assert_eq!(output.status.code(), Some(1), "{stderr}");
    assert!(output.stdout.is_empty(), "stdout: {}", stdout(output));
    assert!(stderr.starts_with("🧨 "), "{stderr}");
    assert!(!stderr.contains('\x1b'), "{stderr:?}");
    stderr
}

/// Asserts a successful run that skipped `skipped`, in that order: exit code 0, and a report on stderr without
/// escapes that counts them and names each one. Returns stderr.
pub fn assert_skipped(output: &Output, skipped: &[&Path]) -> String {
    let stderr = stderr(output);
    let noun = if skipped.len() == 1 { "file" } else { "files" };

    assert_eq!(output.status.code(), Some(0), "{stderr}");
    assert!(!stderr.contains('\x1b'), "{stderr:?}");
    assert!(!stderr.contains("🧨"), "{stderr}");

    let mut lines = stderr.lines();
    assert_eq!(
        lines.next(),
        Some(format!("⚠️ {} {noun} could not be loaded", skipped.len()).as_str()),
        "{stderr}"
    );
    for path in skipped {
        let line = lines.next().unwrap_or_default();
        assert!(line.starts_with("  -> ") && line.contains(&*path.to_string_lossy()), "{path:?} in {stderr}");
    }
    assert_eq!(lines.next(), None, "{stderr}");
    stderr
}

/// Asserts a usage error: exit code 2 and nothing on stdout.
pub fn assert_usage_error(output: &Output) {
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty(), "stdout: {}", stdout(output));
}

/// The copies [`oriented_copies`] writes: the fixture as it is, mirrored, and rotated by 90°.
pub struct OrientedCopies {
    pub original: PathBuf,
    pub mirrored: PathBuf,
    pub rotated: PathBuf,
}

/// Writes `test1.png` into `dir` as it is, mirrored horizontally, and rotated clockwise by 90°.
///
/// The changed copies are BMP, because encoding a large PNG takes most of a debug test run.
pub fn oriented_copies(dir: &Path) -> OrientedCopies {
    let copies = OrientedCopies {
        original: dir.join("original.png"),
        mirrored: dir.join("mirrored.bmp"),
        rotated: dir.join("rotated.bmp"),
    };
    let image = rust_sak::image::decode_file(fixture("test1.png")).unwrap();

    std::fs::copy(fixture("test1.png"), &copies.original).unwrap();
    let mirrored = DynamicImage::from(imageops::flip_horizontal(&image));
    rust_sak::image::encode_file(&mirrored, &copies.mirrored, None).unwrap();
    let rotated = DynamicImage::from(imageops::rotate90(&image));
    rust_sak::image::encode_file(&rotated, &copies.rotated, None).unwrap();

    copies
}

/// `groups` with the members of each group, and then the groups, sorted, for comparing without regard to order.
pub fn sorted(mut groups: Vec<Vec<PathBuf>>) -> Vec<Vec<PathBuf>> {
    for group in &mut groups {
        group.sort();
    }
    groups.sort();
    groups
}

/// The JSON document of a successful run.
pub fn json(output: &Output) -> serde_json::Value {
    assert!(output.status.success(), "{}", stderr(output));
    let stdout = stdout(output);
    assert_eq!(stdout.matches('\n').count(), 1, "one line: {stdout:?}");

    serde_json::from_str(&stdout).unwrap()
}

/// The groups of a JSON document, each as its list of paths.
pub fn json_groups(document: &serde_json::Value) -> Vec<Vec<PathBuf>> {
    document["groups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|group| {
            group
                .as_array()
                .unwrap()
                .iter()
                .map(|media| PathBuf::from(media["path"].as_str().unwrap()))
                .collect()
        })
        .collect()
}

/// The header of the CSV document of a successful run, and its rows as `(group, path)`.
pub fn csv_rows(output: &Output) -> (Vec<String>, Vec<(usize, PathBuf)>) {
    assert!(output.status.success(), "{}", stderr(output));
    let mut reader = csv::Reader::from_reader(output.stdout.as_slice());

    let header = reader.headers().unwrap().iter().map(String::from).collect();
    let rows = reader
        .records()
        .map(|record| {
            let record = record.unwrap();
            (record[0].parse().unwrap(), PathBuf::from(&record[1]))
        })
        .collect();
    (header, rows)
}

pub const CSV_HEADER: [&str; 9] =
    ["group", "path", "type", "width", "height", "size", "duration", "created", "modified"];
