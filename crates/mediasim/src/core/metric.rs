//! Euclidean similarity metric.

use super::consts::{NUM_PIX, ONE_255TH2};
use super::icon::Icon;

/// Returns the squared Euclidean distances between two icons, one per YCbCr channel `(m1, m2, m3)`.
///
/// The distances are left squared (no `sqrt`) and scaled by `1 / 65025` to undo the icons' 255-premultiplication.
/// Smaller values mean more similar images; `m1` corresponds to luma (most sensitive).
///
/// Each channel's squares are summed exactly as integers and scaled once, so the result does not depend on the
/// order the pixels are visited in.
#[must_use]
pub fn euc_metric(a: &Icon, b: &Icon) -> (f64, f64, f64) {
    let channel = |ch: usize| {
        let range = ch * NUM_PIX..(ch + 1) * NUM_PIX;
        // |d| <= 65025, so 121 squares stay below 2^39: the sum fits a `u64` and converts to `f64` exactly.
        let sum: u64 = a.pixels()[range.clone()]
            .iter()
            .zip(&b.pixels()[range])
            .map(|(&pa, &pb)| u64::from(pa.abs_diff(pb)).pow(2))
            .sum();
        #[allow(clippy::cast_precision_loss)]
        let sum = sum as f64;
        sum * ONE_255TH2
    };

    (channel(0), channel(1), channel(2))
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    #[test]
    fn identical_icons_have_zero_distance() {
        let a = Icon::solid(10_000, 20_000, 30_000);
        assert_eq!(euc_metric(&a, &a), (0.0, 0.0, 0.0));
    }

    #[test]
    fn single_channel_difference_is_isolated() {
        // A difference of 65025 in one channel contributes 65025^2 * (1/65025) ~= 65025 per pixel,
        // and the other two channels stay at exactly 0.
        let base = Icon::solid(0, 0, 0);

        let (m1, m2, m3) = euc_metric(&base, &Icon::solid(65025, 0, 0));
        assert!((m1 - 121.0 * 65025.0).abs() / (121.0 * 65025.0) < 1e-9);
        assert_eq!((m2, m3), (0.0, 0.0));

        let (m1, m2, m3) = euc_metric(&base, &Icon::solid(0, 65025, 0));
        assert_eq!(m1, 0.0);
        assert!((m2 - 121.0 * 65025.0).abs() / (121.0 * 65025.0) < 1e-9);
        assert_eq!(m3, 0.0);

        let (m1, m2, m3) = euc_metric(&base, &Icon::solid(0, 0, 65025));
        assert_eq!((m1, m2), (0.0, 0.0));
        assert!((m3 - 121.0 * 65025.0).abs() / (121.0 * 65025.0) < 1e-9);
    }

    #[test]
    fn is_symmetric() {
        let a = Icon::solid(5_000, 12_000, 40_000);
        let b = Icon::solid(60_000, 1_000, 25_000);
        assert_eq!(euc_metric(&a, &b), euc_metric(&b, &a));
    }

    #[test]
    fn single_pixel_difference() {
        let mut a = vec![0u16; NUM_PIX * 3];
        let b = vec![0u16; NUM_PIX * 3];
        a[0] = 255; // one pixel, one channel: 255^2 / 65025 == 1.0.
        let (m1, m2, m3) = euc_metric(&Icon::from_raw(a), &Icon::from_raw(b));
        assert!((m1 - 1.0).abs() < 1e-12);
        assert_eq!((m2, m3), (0.0, 0.0));
    }

    #[test]
    fn permuting_both_icons_alike_leaves_the_result_unchanged() {
        // Values spread over the full range, so a float sum in a different order would round differently.
        #[allow(clippy::cast_possible_truncation)]
        let pixels = |seed: usize| (0..NUM_PIX * 3).map(|i| ((i * 7_919 + seed) % 65_026) as u16).collect::<Vec<_>>();
        let (a, b) = (pixels(1), pixels(30_011));
        // Reverse each channel, a permutation that visits every pixel in a different order.
        let permute = |px: &[u16]| px.chunks(NUM_PIX).flat_map(|ch| ch.iter().rev().copied()).collect::<Vec<_>>();

        let original = euc_metric(&Icon::from_raw(a.clone()), &Icon::from_raw(b.clone()));
        let permuted = euc_metric(&Icon::from_raw(permute(&a)), &Icon::from_raw(permute(&b)));

        assert_eq!(original.0.to_bits(), permuted.0.to_bits());
        assert_eq!(original.1.to_bits(), permuted.1.to_bits());
        assert_eq!(original.2.to_bits(), permuted.2.to_bits());
    }
}
