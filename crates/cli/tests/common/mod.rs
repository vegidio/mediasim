//! Helpers shared by the tests that run the `mediasim` binary with its output piped.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Output;

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

/// Asserts a usage error: exit code 2 and nothing on stdout.
pub fn assert_usage_error(output: &Output) {
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty(), "stdout: {}", stdout(output));
}
