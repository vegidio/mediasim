use crate::{euc_metric, Icon};
use crate::core::consts::MAX_EUC_DIFF;

/// Computes the visual difference between two [`Icon`]s.
///
/// Combines the three per-channel squared distances returned by [`euc_metric`] into a single scalar: the luma channel
/// (`m1`) is weighted fully since it's the one with the greatest impact on visual perception, while the two chroma
/// channels (`m2`, `m3`) are each halved before summation. The square root is then taken to produce a final distance
/// value.
///
/// Smaller values indicate more similar images; a value of `0.0` means the icons are identical.
pub fn calculate_diff(icon1: Icon, icon2: Icon) -> f64 {
    let (m1, m2, m3) = euc_metric(&icon1, &icon2);
    (m1 + m2/2.0 + m3/2.0).sqrt() / MAX_EUC_DIFF
}