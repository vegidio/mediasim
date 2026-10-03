//! Helpers shared by the unit tests.

use std::path::Path;
use std::time::Duration;

use mediasim::{Media, MediaType};

/// A loaded fixture image with its path, size and type replaced, since `Media` cannot be built from parts outside
/// `mediasim`.
pub fn media(path: &str, width: u32, height: u32, seconds: Option<u64>) -> Media {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/test1.png");
    let mut media = Media::from_file(fixture).unwrap();
    media.path = path.into();
    (media.width, media.height) = (width, height);
    media.duration = seconds.map(Duration::from_secs);
    media.media_type = if seconds.is_some() { MediaType::Video } else { MediaType::Image };
    media
}
