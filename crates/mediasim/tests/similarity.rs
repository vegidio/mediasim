//! End-to-end checks for `Media::similarity` over the sample files in `fixtures`.

use std::path::{Path, PathBuf};

use mediasim::{CompareError, Media, MediaType};

fn load(name: &str) -> Media {
    let path: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name);
    Media::from_file(&path).unwrap_or_else(|e| panic!("{e}"))
}

/// Asserts that `a` and `b` score in `[0, 1]`, identically in either order, and returns the score.
fn assert_in_range_and_symmetric(a: &Media, b: &Media) -> f64 {
    let ab = a.similarity(b).unwrap();
    let ba = b.similarity(a).unwrap();

    assert!((0.0..=1.0).contains(&ab), "score {ab} out of range");
    assert_eq!(ab.to_bits(), ba.to_bits(), "{ab} != {ba}");
    ab
}

#[test]
fn images_score_in_range_and_symmetrically() {
    assert_in_range_and_symmetric(&load("test1.png"), &load("test2.png"));
}

#[test]
fn videos_score_in_range_and_symmetrically() {
    assert_in_range_and_symmetric(&load("test3.mp4"), &load("test4.mp4"));
}

#[test]
fn every_file_scores_one_against_itself() {
    for name in ["test1.png", "test2.png", "test3.mp4", "test4.mp4"] {
        let media = load(name);
        assert_eq!(media.similarity(&media).unwrap(), 1.0, "{name}");
    }
}

#[test]
fn image_vs_video_is_a_type_mismatch() {
    let err = load("test1.png").similarity(&load("test3.mp4")).unwrap_err();

    assert!(
        matches!(
            err,
            CompareError::MediaTypeMismatch { left_type: MediaType::Image, right_type: MediaType::Video, .. }
        ),
        "{err:?}"
    );
    assert!(err.to_string().contains("test1.png") && err.to_string().contains("test3.mp4"), "{err}");
}
