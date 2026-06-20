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
