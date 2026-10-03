//! Core algorithms: icon signatures, the [`euc_metric`] distance between them, and the similarity of two
//! [`Media`](crate::Media) values built on top.
//!
//! The icon pipeline is: decode → nearest-neighbour resize → average to a large RGB icon → box-blur down to an 11×11
//! YCbCr icon → per-channel histogram normalization → squared Euclidean distance. Videos are then compared frame by
//! frame with Dynamic Time Warping, and [`Grouper`] merges media that score above a threshold into groups.

mod consts;
pub mod diff;
mod dsu;
mod dtw;
mod group;
pub mod icon;
pub mod metric;
mod similarity;

pub use group::Grouper;
pub use icon::Icon;
pub use metric::euc_metric;
