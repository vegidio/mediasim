//! Constants used by the icon pipeline and [`euc_metric`](super::euc_metric).

/// Final icon side length in pixels.
pub const ICON_SIZE: usize = 11;

/// Resampling rate: source pixels per large-icon pixel side.
pub const SAMPLES: usize = 12;

/// Number of pixels in a single icon channel.
pub const NUM_PIX: usize = ICON_SIZE * ICON_SIZE;

/// Intermediate large-icon side length.
pub const LARGE_ICON_SIZE: usize = ICON_SIZE * 2 + 1;

/// Intermediate resize target side length.
pub const RESIZED_IMG_SIZE: usize = LARGE_ICON_SIZE * SAMPLES;

/// Reciprocal of a sample block's pixel count, `1 / (SAMPLES * SAMPLES)`.
pub const INV_SAMPLE_PIXELS2: f64 = 1.0 / 144.0;

/// Reciprocal of a 3×3 box.
pub const ONE_NINTH: f64 = 1.0 / 9.0;

/// Reciprocal of 255, used to decode the 255-premultiplied storage.
pub const ONE_255TH: f64 = 1.0 / 255.0;

/// Square of [`ONE_255TH`]; the Euclidean-distance scale factor.
///
/// Defined as the product (not `1 / 65025`) to preserve the exact evaluation order.
pub const ONE_255TH2: f64 = ONE_255TH * ONE_255TH;

/// Maximum premultiplied channel value, i.e. `255 * 255`.
pub const SQ255: f64 = 255.0 * 255.0;

/// Maximum Euclidean distance of a single icon channel, `sqrt(NUM_PIX * SQ255)` (= `11 * 255`).
///
/// [`calculate_diff`](super::diff::calculate_diff) combines the three per-channel squared distances as
/// `m1 + m2/2 + m3/2`, takes the root of that weighted sum, and divides by this single-channel maximum.
/// A single channel (or luma-only contrast such as black vs white) at full range therefore maps to `1.0`;
/// the rare all-three-channel extreme reaches `~sqrt(2)` and is clamped, keeping the result in `[0, 1]`.
///
/// The literal carries a few digits of floating-point dust from its original computation; the exact
/// mathematical value is `2805.0`.
pub const MAX_EUC_DIST: f64 = 2805.0000001658486;

#[cfg(test)]
#[allow(clippy::float_cmp, clippy::cast_precision_loss)]
mod tests {
    use super::*;

    #[test]
    fn derived_sizes_are_consistent() {
        assert_eq!(ICON_SIZE, 11);
        assert_eq!(NUM_PIX, 121);
        assert_eq!(LARGE_ICON_SIZE, 23);
        assert_eq!(RESIZED_IMG_SIZE, 276);
    }

    #[test]
    fn reciprocals_match_their_definitions() {
        assert_eq!(INV_SAMPLE_PIXELS2, 1.0 / (SAMPLES * SAMPLES) as f64);
        assert_eq!(ONE_NINTH, 1.0 / 9.0);
        assert_eq!(ONE_255TH, 1.0 / 255.0);
        assert_eq!(ONE_255TH2, ONE_255TH * ONE_255TH);
        assert_eq!(SQ255, 255.0 * 255.0);
    }

    #[test]
    fn max_euc_dist_is_single_channel_norm() {
        // The Euclidean norm of one channel at full contrast: every one of NUM_PIX pixels differing by the
        // full premultiplied range. The stored literal carries tiny float dust, so compare approximately.
        assert!((MAX_EUC_DIST - (NUM_PIX as f64 * SQ255).sqrt()).abs() < 1e-3);
    }
}
