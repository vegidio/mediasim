//! Euclidean similarity metric.

use super::consts::{NUM_PIX, ONE_255TH2};
use super::icon::Icon;

/// Returns the squared Euclidean distances between two icons, one per YCbCr channel `(m1, m2, m3)`.
///
/// The distances are left squared (no `sqrt`), and each term is scaled by `1 / 65025` to undo the icons'
/// 255-premultiplication. Smaller values mean more similar images; `m1` corresponds to luma (most sensitive).
#[must_use]
pub fn euc_metric(a: &Icon, b: &Icon) -> (f64, f64, f64) {
    let channel = |ch: usize| {
        let range = ch * NUM_PIX..(ch + 1) * NUM_PIX;
        a.pixels()[range.clone()].iter().zip(&b.pixels()[range]).fold(0.0, |sum, (&pa, &pb)| {
            let d = f64::from(pa) - f64::from(pb);
            sum + d * ONE_255TH2 * d
        })
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
}
