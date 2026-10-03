//! Helpers shared by the integration tests.

use std::path::{Path, PathBuf};

use mediasim::Media;

/// The path of a file in the workspace's `fixtures` directory.
pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)
}

/// Loads a file from the workspace's `fixtures` directory.
#[allow(dead_code)]
pub fn load(name: &str) -> Media {
    Media::from_file(fixture(name)).unwrap_or_else(|e| panic!("{e}"))
}
