//! End-to-end checks for the public `euc_metric` API.
//!
//! These build deterministic, solid-colour images in memory so they don't depend on any sample files on
//! disk. A flat image collapses the whole decode → resize → blur → normalize pipeline to a single,
//! hand-computable value per channel, which makes the expected metrics exact.

use image::{DynamicImage, Rgb, RgbImage};
use mediasim::{Icon, euc_metric};

/// A solid-colour opaque RGB image.
fn solid(r: u8, g: u8, b: u8) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_pixel(32, 32, Rgb([r, g, b])))
}

#[test]
fn identical_images_have_zero_distance() {
    let a = Icon::from_image(&solid(73, 145, 211));
    let b = Icon::from_image(&solid(73, 145, 211));
    assert_eq!(euc_metric(&a, &b), (0.0, 0.0, 0.0));
}

#[test]
fn black_vs_white_is_pure_luma_contrast() {
    let black = Icon::from_image(&solid(0, 0, 0));
    let white = Icon::from_image(&solid(255, 255, 255));

    let (m1, m2, m3) = euc_metric(&black, &white);

    // Both are neutral greys, so chroma is essentially unchanged — the only real difference is luma.
    // (m3 carries a negligible residual from a 1-LSB float rounding on the Cr channel.)
    assert_eq!(m2, 0.0);
    assert!(m3 < 1e-2, "m3 = {m3} should be negligible");
    // Every one of the 121 pixels differs by the full premultiplied range (65025).
    let expected = 121.0 * 65025.0;
    assert!((m1 - expected).abs() / expected < 1e-9, "m1 = {m1}, expected ~{expected}");
}

#[test]
fn metric_is_symmetric() {
    let a = Icon::from_image(&solid(200, 30, 90));
    let b = Icon::from_image(&solid(20, 180, 240));
    assert_eq!(euc_metric(&a, &b), euc_metric(&b, &a));
}

#[test]
fn different_colours_have_positive_distance() {
    let a = Icon::from_image(&solid(255, 0, 0));
    let b = Icon::from_image(&solid(0, 255, 0));
    let (m1, m2, m3) = euc_metric(&a, &b);
    assert!(m1 > 0.0 && m2 > 0.0 && m3 > 0.0);
}

#[test]
fn icon_preserves_source_dimensions() {
    let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(120, 90, Rgb([1, 2, 3])));
    assert_eq!(Icon::from_image(&img).img_size(), (120, 90));
}

#[test]
fn from_path_reports_missing_files() {
    let err = Icon::from_path("does-not-exist.jpg").unwrap_err();
    assert!(err.to_string().starts_with("failed to load image"));
}
