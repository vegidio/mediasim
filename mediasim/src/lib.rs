//! `mediasim` — image similarity primitives.
//!
//! Provides [`euc_metric`]: the per-channel squared Euclidean distance between two image [`Icon`]s
//! (compact 11×11 visual signatures).
//!
//! ```no_run
//! use mediasim::{Icon, euc_metric};
//!
//! let a = Icon::from_path("a.jpg")?;
//! let b = Icon::from_path("b.jpg")?;
//! let (m1, m2, m3) = euc_metric(&a, &b);
//! println!("m1 = {m1}, m2 = {m2}, m3 = {m3}");
//! # Ok::<(), mediasim::IconError>(())
//! ```

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]

pub mod core;

pub use core::{Icon, IconError, euc_metric};
