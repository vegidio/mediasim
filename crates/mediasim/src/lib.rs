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
//! [`Scan`] does both in one run: it loads a list of files in parallel and groups each as it arrives, reporting the
//! file it is processing and its progress ([`ScanEvent`]) with an estimate of the time left. It can be stopped with a
//! [`CancelToken`], and [`OnError`] chooses whether a file that can't be loaded ends it or is skipped. [`Eta`] is that
//! estimate on its own, for any batch.
//! [`Media::probe`] reads a file's metadata ([`MediaInfo`]) from its header without decoding any frames, to show a
//! file's details before or while it loads; it also reports an image's format and color profile and a video's frame
//! rate.
//! [`Media::list_dir`] tells up front which files a directory load will yield, for a progress total or a stable
//! display order. [`MediaFormat::all`] lists every format that loads, with its [`MediaType`] and extensions, for a
//! file picker's filter or a list of supported formats; it always agrees with [`MediaType::from_path`].
//!
//! A long load can be stopped from another thread: [`Media::from_file_cancellable`] takes a [`CancelToken`], and fails
//! with [`MediaError::Cancelled`] once the token is cancelled. A video stops before its next sampled frame; an image,
//! whose decode can't be interrupted, before decoding starts or as soon as it returns. One token can stop several loads.
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
//!
//! # Features
//!
//! - `serde`: makes [`Media`], [`MediaInfo`], [`MediaType`] and [`MediaFormat`] serializable, for front ends that print or send media as data.
//! - `cache`: adds `DirCache`, a directory's cache of decoded media in `<dir>/.mediasim/cache.redb`, and
//!   `Media::from_files_cached`, which loads through it, as does `Scan::cache`. A load that was interrupted or aborted then resumes without
//!   decoding again the files it had already finished. Call `DirCache::finish` once every file has finished loading
//!   (and its stream is exhausted) to delete the cache; drop the handle instead to keep it for the next run.
//!   [`Media::from_dir`] stays uncached. This feature does not make [`Media`] serializable.

#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]

mod cancel;
mod core;
mod error;
mod eta;
mod media;
mod pool;
mod scan;

pub use cancel::CancelToken;
pub use core::{CompareOptions, Grouper, Icon, calculate_diff, euc_metric};
pub use error::{CompareError, MediaError};
pub use eta::Eta;
#[cfg(feature = "cache")]
pub use media::DirCache;
pub use media::{LoadOptions, Media, MediaFormat, MediaInfo, MediaStream, MediaType};
pub use scan::{OnError, Scan, ScanError, ScanEvent, ScanProgress, Scanned};
