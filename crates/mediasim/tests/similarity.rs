//! End-to-end checks for `Media::similarity` over the sample files in `fixtures`.

mod common;

use common::{fixture, load};
use image::{DynamicImage, imageops};
use mediasim::{CompareError, CompareOptions, Media, MediaType};
use rust_sak::fs::mk_temp_dir;

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
    assert_in_range_and_symmetric(&load("test1.avif"), &load("test2.avif"));
}

#[test]
fn videos_score_in_range_and_symmetrically() {
    assert_in_range_and_symmetric(&load("test3.mkv"), &load("test4.mkv"));
}

#[test]
fn every_file_scores_one_against_itself() {
    for name in ["test1.avif", "test2.avif", "test3.mkv", "test4.mkv"] {
        let media = load(name);
        assert_eq!(media.similarity(&media).unwrap(), 1.0, "{name}");
    }
}

#[test]
fn image_vs_video_is_a_type_mismatch() {
    let err = load("test1.avif").similarity(&load("test3.mkv")).unwrap_err();

    assert!(
        matches!(
            err,
            CompareError::MediaTypeMismatch { left_type: MediaType::Image, right_type: MediaType::Video, .. }
        ),
        "{err:?}"
    );
    assert!(err.to_string().contains("test1.avif") && err.to_string().contains("test3.mkv"), "{err}");
}

/// Turns an image into an oriented copy of it.
type Orient = fn(&DynamicImage) -> DynamicImage;

/// Writes `image` to a temporary directory and loads it.
fn load_copy(image: &DynamicImage) -> Media {
    let dir = mk_temp_dir("mediasim").unwrap();
    // BMP, because encoding a large PNG dominates the test time in a debug build.
    let path = dir.path().join("copy.bmp");
    rust_sak::image::encode_file(image, &path, None).unwrap();

    Media::from_file(&path).unwrap()
}

#[test]
fn oriented_image_copies_score_close_to_one_with_the_matching_option() {
    let flip = CompareOptions::new().flip(true);
    let rotate = CompareOptions::new().rotate(true);
    let both = flip.rotate(true);
    let cases: [(&str, Orient, CompareOptions); 6] = [
        ("mirrored", |i| DynamicImage::from(imageops::flip_horizontal(i)), flip),
        ("flipped", |i| DynamicImage::from(imageops::flip_vertical(i)), flip),
        ("rotated 90°", |i| DynamicImage::from(imageops::rotate90(i)), rotate),
        ("rotated 180°", |i| DynamicImage::from(imageops::rotate180(i)), rotate),
        ("rotated 270°", |i| DynamicImage::from(imageops::rotate270(i)), rotate),
        (
            "mirrored and rotated 90°",
            |i| DynamicImage::from(imageops::rotate90(&imageops::flip_horizontal(i))),
            both,
        ),
    ];

    let decoded = rust_sak::image::decode_file(fixture("test1.avif")).unwrap();
    let original = load("test1.avif");

    for (name, orient, options) in cases {
        let copy = load_copy(&orient(&decoded));

        let plain = original.similarity(&copy).unwrap();
        let matched = original.similarity_with(&copy, options).unwrap();

        assert!(matched > plain, "{name}: {matched} <= {plain}");
        assert!(matched > 0.999, "{name}: {matched}");
        assert_eq!(matched.to_bits(), copy.similarity_with(&original, options).unwrap().to_bits(), "{name}");
    }
}
