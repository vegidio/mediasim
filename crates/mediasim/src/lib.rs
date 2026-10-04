//! `mediasim` — how similar are two images, or two videos?
//!
//! Load files with [`Media::from_file`] (or many at once with [`Media::from_files`] and [`Media::from_dir`]), then
//! score a pair with [`Media::similarity`]: `1` means identical and `0` completely different. Images compare their
//! single frames; videos compare their per-second frames, aligned in time so trimmed or padded copies still match.
//! Comparing an image with a video is a [`CompareError`].
//!
//! A mirrored or rotated copy looks very different frame by frame, so it scores low. [`Media::similarity_with`] takes
//! [`CompareOptions`] that also try the frames flipped, rotated, or both, and keep the best score. They cost nothing at
//! load time, but a comparison costs up to 3, 4 or 8 times as much, which matters most for long videos.
//!
//! To find duplicates among many files, feed them to a [`Grouper`]: it groups the media whose similarity reaches a
//! threshold. [`Grouper::with_options`] groups under [`CompareOptions`].
//! [`Media::list_dir`] tells up front which files a directory load will yield, for a progress total or a stable
//! display order.
//!
//! ```no_run
//! use mediasim::{CompareOptions, Media};
//!
//! let a = Media::from_file("a.mp4")?;
//! let b = Media::from_file("b.mp4")?;
//! println!("similarity = {}", a.similarity(&b)?);
//!
//! // Also catch a mirrored or sideways copy.
//! let options = CompareOptions::new().flip(true).rotate(true);
//! println!("best orientation = {}", a.similarity_with(&b, options)?);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! The building blocks are public too: [`Icon`] is the compact 11×11 visual signature of one frame, and
//! [`euc_metric`] the per-channel distance between two of them, which [`calculate_diff`] folds into one number.

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]

mod core;
mod error;
mod media;
mod pool;

pub use core::{CompareOptions, Grouper, Icon, calculate_diff, euc_metric};
pub use error::{CompareError, MediaError};
pub use media::{LoadOptions, Media, MediaStream, MediaType};
