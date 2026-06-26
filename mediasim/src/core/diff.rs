use crate::{euc_metric, Icon};
use crate::core::consts::MAX_EUC_DIST;

/// Computes the normalized visual difference between two [`Icon`]s.
///
/// Combines the three per-channel squared distances returned by [`euc_metric`] into a single scalar: the luma channel
/// (`m1`) is weighted fully since it's the one with the greatest impact on visual perception, while the two chroma
/// channels (`m2`, `m3`) are each halved before summation. The root of that weighted sum is then divided by the
/// maximum single-channel Euclidean distance ([`MAX_EUC_DIST`]) and clamped, yielding a value in `[0, 1]`.
///
/// Smaller values indicate more similar images: `0.0` means identical. A single channel (or luma-only contrast such
/// as solid black vs solid white) at full range maps to `1.0`; the rare all-three-channel extreme reaches `~sqrt(2)`
/// and is clamped to `1.0`.
pub fn calculate_diff(icon1: Icon, icon2: Icon) -> f64 {
    let (m1, m2, m3) = euc_metric(&icon1, &icon2);
    // `.min(1.0)` clamps the rare all-three-channel extreme (which reaches ~sqrt(2)) back into [0, 1].
    ((m1 + m2 / 2.0 + m3 / 2.0).sqrt() / MAX_EUC_DIST).min(1.0)
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
    use crate::core::consts::NUM_PIX;

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
    fn identical_icons_have_zero_diff() {
        let a = icon(40_000, 20_000, 10_000);
        assert_eq!(calculate_diff(a.clone(), a), 0.0);
    }

    #[test]
    fn black_vs_white_is_luma_only_contrast() {
        // Solid black vs solid white differ only in luma (shared, centred chroma) at full range. A single channel
        // at full contrast is the normalizer ([`MAX_EUC_DIST`]), so the diff lands at 1.0.
        let diff = calculate_diff(icon(0, 32_640, 32_640), icon(65_025, 32_640, 32_640));
        assert!((diff - 1.0).abs() < 1e-6, "expected ~1.0, got {diff}");
    }

    #[test]
    fn full_contrast_on_all_channels_is_one() {
        // Every pixel differing by the full range on all three channels reaches ~sqrt(2) before the clamp,
        // so the reported diff saturates at 1.0.
        let diff = calculate_diff(icon(0, 0, 0), icon(65_025, 65_025, 65_025));
        assert!((diff - 1.0).abs() < 1e-6, "expected ~1.0, got {diff}");
    }

    #[test]
    fn never_exceeds_one() {
        // Arbitrary extreme icons must stay within [0, 1].
        for (a, b) in [
            (icon(0, 0, 0), icon(65_025, 65_025, 65_025)),
            (icon(10_000, 5_000, 50_000), icon(55_000, 60_000, 2_000)),
            (icon(65_025, 0, 65_025), icon(0, 65_025, 0)),
        ] {
            let diff = calculate_diff(a, b);
            assert!((0.0..=1.0).contains(&diff), "diff {diff} out of range");
        }
    }

    #[test]
    fn diff_is_symmetric() {
        let a = icon(5_000, 12_000, 40_000);
        let b = icon(60_000, 1_000, 25_000);
        assert_eq!(calculate_diff(a.clone(), b.clone()), calculate_diff(b, a));
    }

    #[test]
    fn larger_difference_yields_larger_diff() {
        let base = icon(0, 0, 0);
        let near = calculate_diff(base.clone(), icon(10_000, 0, 0));
        let far = calculate_diff(base.clone(), icon(40_000, 0, 0));
        assert!(far > near && near > 0.0);
    }

    #[test]
    fn chroma_is_down_weighted_relative_to_luma() {
        // The same raw channel delta counts double in luma vs. either chroma channel.
        let base = icon(0, 0, 0);
        let luma = calculate_diff(base.clone(), icon(20_000, 0, 0));
        let chroma = calculate_diff(base.clone(), icon(0, 20_000, 0));
        // diff ∝ sqrt(weight): luma weight 1, chroma weight 1/2 -> ratio sqrt(2).
        assert!((luma / chroma - 2.0_f64.sqrt()).abs() < 1e-9);
    }
}