//! Core algorithm needed to compute [`euc_metric`].
//!
//! The pipeline is: decode → nearest-neighbour resize → average to a large RGB icon → box-blur down to an 11×11 YCbCr
//! icon → per-channel histogram normalization → squared Euclidean distance.

mod consts;
pub mod icon;
pub mod metric;
pub mod diff;

pub use icon::{Icon, IconError};
pub use metric::euc_metric;
