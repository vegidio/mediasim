//! Euclidean similarity metric.

use super::consts::{NUM_PIX, ONE_255TH2};
use super::icon::Icon;

/// Returns the squared Euclidean distances between two icons, one per YCbCr channel `(m1, m2, m3)`.
///
/// The distances are left squared (no `sqrt`), and each term is scaled by `1 / 65025` to undo the icons'
/// 255-premultiplication. Smaller values mean more similar images; `m1` corresponds to luma (most sensitive).
#[must_use]
pub fn euc_metric(a: &Icon, b: &Icon) -> (f64, f64, f64) {
    let (pa, pb) = (a.pixels(), b.pixels());
    let (mut m1, mut m2, mut m3) = (0.0, 0.0, 0.0);

    for i in 0..NUM_PIX {
        // Channel 1 (Y).
        let d = f64::from(pa[i]) - f64::from(pb[i]);
        m1 += d * ONE_255TH2 * d;
        // Channel 2 (Cb).
        let d = f64::from(pa[i + NUM_PIX]) - f64::from(pb[i + NUM_PIX]);
        m2 += d * ONE_255TH2 * d;
        // Channel 3 (Cr).
        let d = f64::from(pa[i + 2 * NUM_PIX]) - f64::from(pb[i + 2 * NUM_PIX]);
        m3 += d * ONE_255TH2 * d;
    }

    (m1, m2, m3)
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    /// Icon whose three channels are filled with the given constant values.
    fn icon(y: u16, cb: u16, cr: u16) -> Icon {
        let mut px = vec![0u16; NUM_PIX * 3];
        for i in 0..NUM_PIX {
            px[i] = y;
            px[i + NUM_PIX] = cb;
            px[i + 2 * NUM_PIX] = cr;
        }
        Icon::from_raw(px, (1, 1))
    }

    #[test]
    fn identical_icons_have_zero_distance() {
        let a = icon(10_000, 20_000, 30_000);
        assert_eq!(euc_metric(&a, &a), (0.0, 0.0, 0.0));
    }

    #[test]
    fn single_channel_difference_is_isolated() {
        // A difference of 65025 in one channel contributes 65025^2 * (1/65025) ~= 65025 per pixel,
        // and the other two channels stay at exactly 0.
        let base = icon(0, 0, 0);

        let (m1, m2, m3) = euc_metric(&base, &icon(65025, 0, 0));
        assert!((m1 - 121.0 * 65025.0).abs() / (121.0 * 65025.0) < 1e-9);
        assert_eq!((m2, m3), (0.0, 0.0));

        let (m1, m2, m3) = euc_metric(&base, &icon(0, 65025, 0));
        assert_eq!(m1, 0.0);
        assert!((m2 - 121.0 * 65025.0).abs() / (121.0 * 65025.0) < 1e-9);
        assert_eq!(m3, 0.0);

        let (m1, m2, m3) = euc_metric(&base, &icon(0, 0, 65025));
        assert_eq!((m1, m2), (0.0, 0.0));
        assert!((m3 - 121.0 * 65025.0).abs() / (121.0 * 65025.0) < 1e-9);
    }

    #[test]
    fn is_symmetric() {
        let a = icon(5_000, 12_000, 40_000);
        let b = icon(60_000, 1_000, 25_000);
        assert_eq!(euc_metric(&a, &b), euc_metric(&b, &a));
    }

    #[test]
    fn single_pixel_difference() {
        let mut a = vec![0u16; NUM_PIX * 3];
        let b = vec![0u16; NUM_PIX * 3];
        a[0] = 255; // one pixel, one channel: 255^2 / 65025 == 1.0.
        let (m1, m2, m3) = euc_metric(&Icon::from_raw(a, (1, 1)), &Icon::from_raw(b, (1, 1)));
        assert!((m1 - 1.0).abs() < 1e-12);
        assert_eq!((m2, m3), (0.0, 0.0));
    }
}
