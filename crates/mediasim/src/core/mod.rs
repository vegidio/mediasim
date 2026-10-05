//! Core algorithms: icon signatures, the [`euc_metric`] distance between them, and the similarity of two
//! [`Media`](crate::Media) values built on top.
//!
//! The icon pipeline is: decode → nearest-neighbour resize → average to a large RGB icon → box-blur down to an 11×11
//! YCbCr icon → per-channel histogram normalization → squared Euclidean distance. Videos are then compared frame by
//! frame with Dynamic Time Warping, and [`Grouper`] merges media that score above a threshold into groups.

mod consts;
mod diff;
mod dsu;
mod dtw;
mod group;
mod icon;
mod metric;
mod options;
mod orientation;
mod similarity;

pub use diff::calculate_diff;
pub use group::Grouper;
pub use icon::Icon;
pub use metric::euc_metric;
pub use options::CompareOptions;

/// Test-only: a deterministic xorshift64 generator from `seed`, so tests need no RNG crate. A zero seed is replaced by
/// `1`, since xorshift never leaves zero.
#[cfg(test)]
pub(crate) fn xorshift(seed: u64) -> impl FnMut() -> u64 {
    let mut state = seed.max(1);
    move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    }
}
