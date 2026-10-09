//! A cheap lower bound of [`calculate_diff`](super::diff::calculate_diff), so grouping can rule out a pair of images
//! without comparing their pixels.

use super::consts::NUM_PIX;
use super::diff::combine;
use super::icon::Icon;
use super::metric::scaled;

/// The sum of each channel of an [`Icon`].
///
/// Every orientation only moves pixels within their channel, so an icon has the same sums in all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ChannelSums([u32; 3]);

impl ChannelSums {
    /// The sums of `icon`'s three channels.
    pub(crate) fn of(icon: &Icon) -> Self {
        // 121 values of at most 65025 add up to under 2^23, so a `u32` holds any sum.
        let sum = |ch: usize| icon.pixels()[ch * NUM_PIX..(ch + 1) * NUM_PIX].iter().map(|&v| u32::from(v)).sum();
        Self([sum(0), sum(1), sum(2)])
    }

    /// A value that [`calculate_diff`](super::diff::calculate_diff) of an icon with these sums and one with `other`
    /// never goes below, as computed, whatever their pixels and orientations.
    ///
    /// For one channel, with `d` the pixel differences and `N` = [`NUM_PIX`], Cauchy–Schwarz gives
    /// `N · Σ d² ≥ (Σ d)²`, and `Σ d` is the difference of the two sums. Everything there is an integer, so the sum of
    /// squares that [`euc_metric`](super::metric::euc_metric) computes exactly is at least `⌈(Σ d)² / N⌉`. That bound
    /// then goes through the same floating-point steps as the real sum, [`scaled`] and [`combine`], each of which
    /// never decreases as its input grows, so the result is at most the computed difference.
    pub(crate) fn min_diff(self, other: Self) -> f64 {
        let lower = |ch: usize| {
            // At most 121 · 65025 apart, so the square stays below 2^46.
            let d = u64::from(self.0[ch].abs_diff(other.0[ch]));
            (d * d).div_ceil(NUM_PIX as u64)
        };

        combine(scaled(lower(0)), scaled(lower(1)), scaled(lower(2)))
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
    use crate::core::diff::calculate_diff;
    use crate::core::orientation::Orientation;

    #[test]
    fn sums_are_the_same_in_every_orientation() {
        let icon = Icon::textured(9);

        for orientation in Orientation::ALL {
            assert_eq!(ChannelSums::of(&orientation.apply(&icon)), ChannelSums::of(&icon), "{orientation:?}");
        }
    }

    #[test]
    fn solid_icons_reach_their_bound_exactly() {
        // With every difference equal, Cauchy–Schwarz is an equality.
        let (a, b) = (Icon::solid(1_000, 30_000, 64_000), Icon::solid(50_000, 2_000, 60_000));

        let bound = ChannelSums::of(&a).min_diff(ChannelSums::of(&b));

        assert_eq!(bound.to_bits(), calculate_diff(&a, &b).to_bits());
    }

    #[test]
    fn the_bound_never_exceeds_the_difference() {
        let icons: Vec<Icon> = (0..40)
            .map(Icon::textured)
            .chain([0, 1, 32_640, 65_024, 65_025].map(|v| Icon::solid(v, v, 65_025 - v)))
            .collect();

        for a in &icons {
            for b in &icons {
                let bound = ChannelSums::of(a).min_diff(ChannelSums::of(b));
                for orientation in Orientation::ALL {
                    let diff = calculate_diff(a, &orientation.apply(b));
                    assert!(bound <= diff, "bound {bound} > diff {diff} under {orientation:?}");
                }
            }
        }
    }

    #[test]
    fn identical_sums_bound_nothing() {
        let icon = Icon::textured(3);
        let sums = ChannelSums::of(&icon);

        assert_eq!(sums.min_diff(sums), 0.0);
    }
}
