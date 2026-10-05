//! Helpers shared by the unit tests.

use std::path::PathBuf;
use std::time::Duration;

use mediasim::{Media, MediaType};

/// A media with no file behind it: a video if it has a duration in `seconds`, otherwise an image.
pub fn media(path: &str, width: u32, height: u32, seconds: Option<u64>) -> Media {
    let media_type = if seconds.is_some() { MediaType::Video } else { MediaType::Image };
    Media::stub(path, media_type, width, height, seconds.map(Duration::from_secs))
}

/// The paths named `names`, in order.
pub fn paths(names: &[&str]) -> Vec<PathBuf> {
    names.iter().map(PathBuf::from).collect()
}
