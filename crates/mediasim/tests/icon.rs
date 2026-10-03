//! End-to-end checks for the public `Icon`, `euc_metric` and `calculate_diff` APIs.
//!
//! These build deterministic, solid-colour images in memory so they exercise the full decode → resize → blur →
//! normalize → distance pipeline without depending on any sample files.

use image::{DynamicImage, Rgb, RgbImage};
use mediasim::{Icon, calculate_diff, euc_metric};

/// A solid-colour opaque RGB image.
fn solid(r: u8, g: u8, b: u8) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_pixel(32, 32, Rgb([r, g, b])))
}

#[test]
fn different_colours_have_positive_distance() {
    let a = Icon::from_image(&solid(255, 0, 0));
    let b = Icon::from_image(&solid(0, 255, 0));
    let (m1, m2, m3) = euc_metric(&a, &b);
    assert!(m1 > 0.0 && m2 > 0.0 && m3 > 0.0);
}

#[test]
fn diff_stays_within_unit_range() {
    let pairs = [((255, 0, 0), (0, 255, 0)), ((0, 0, 0), (255, 255, 255)), ((10, 200, 30), (240, 15, 220))];
    for (c1, c2) in pairs {
        let diff =
            calculate_diff(&Icon::from_image(&solid(c1.0, c1.1, c1.2)), &Icon::from_image(&solid(c2.0, c2.1, c2.2)));
        assert!((0.0..=1.0).contains(&diff), "diff {diff} out of range for {c1:?} vs {c2:?}");
    }
}
