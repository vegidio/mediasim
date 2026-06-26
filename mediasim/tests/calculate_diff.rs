//! End-to-end checks for the public `calculate_diff` API.
//!
//! Like the `euc_metric` tests, these build deterministic solid-colour images in memory so they exercise the
//! full decode → resize → blur → normalize → distance pipeline without depending on any sample files.

use image::{DynamicImage, Rgb, RgbImage};
use mediasim::Icon;
use mediasim::core::diff::calculate_diff;

/// A solid-colour opaque RGB image.
fn solid(r: u8, g: u8, b: u8) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_pixel(32, 32, Rgb([r, g, b])))
}

#[test]
fn identical_images_have_zero_diff() {
    let a = Icon::from_image(&solid(73, 145, 211));
    let b = Icon::from_image(&solid(73, 145, 211));
    assert_eq!(calculate_diff(a, b), 0.0);
}

#[test]
fn black_vs_white_is_luma_only_contrast() {
    // Black and white differ only in luma (shared, centred chroma) at full range. A single channel at full
    // contrast is the normalizer, so the diff lands at ~1.0.
    let diff = calculate_diff(Icon::from_image(&solid(0, 0, 0)), Icon::from_image(&solid(255, 255, 255)));
    assert!((diff - 1.0).abs() < 1e-3, "diff = {diff}, expected ~1.0");
}

#[test]
fn diff_is_symmetric() {
    let a = || Icon::from_image(&solid(200, 30, 90));
    let b = || Icon::from_image(&solid(20, 180, 240));
    assert_eq!(calculate_diff(a(), b()), calculate_diff(b(), a()));
}

#[test]
fn diff_stays_within_unit_range() {
    let pairs = [
        ((255, 0, 0), (0, 255, 0)),
        ((0, 0, 0), (255, 255, 255)),
        ((10, 200, 30), (240, 15, 220)),
    ];
    for (c1, c2) in pairs {
        let diff = calculate_diff(
            Icon::from_image(&solid(c1.0, c1.1, c1.2)),
            Icon::from_image(&solid(c2.0, c2.1, c2.2)),
        );
        assert!((0.0..=1.0).contains(&diff), "diff {diff} out of range for {c1:?} vs {c2:?}");
    }
}
