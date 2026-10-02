//! `mediasim` — how similar are two images, or two videos?
//!
//! Load files with [`Media::from_file`] (or many at once with [`Media::from_files`] and [`Media::from_dir`]), then
//! score a pair with [`Media::similarity`]: `1` means identical and `0` completely different. Images compare their
//! single frames; videos compare their per-second frames, aligned in time so trimmed or padded copies still match.
//! Comparing an image with a video is a [`CompareError`].
//!
//! ```no_run
//! use mediasim::Media;
//!
//! let a = Media::from_file("a.mp4")?;
//! let b = Media::from_file("b.mp4")?;
//! println!("similarity = {}", a.similarity(&b)?);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! The building blocks are public too: [`Icon`] is the compact 11×11 visual signature of one frame, and
//! [`euc_metric`] the per-channel distance between two of them.

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]

pub mod core;
mod error;
pub mod media;

pub use core::{Icon, euc_metric};
pub use error::{CompareError, MediaError};
pub use media::{LoadOptions, Media, MediaStream, MediaType};
