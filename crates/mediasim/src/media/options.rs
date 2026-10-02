//! Options for [`Media::from_dir`](super::Media::from_dir).

/// How [`Media::from_dir`](super::Media::from_dir) scans a directory.
///
/// The default loads **images and videos, one level deep**. Methods consume and return `self`:
///
/// ```
/// use mediasim::media::LoadOptions;
///
/// let videos_everywhere = LoadOptions::new().recursive(true).images(false);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadOptions {
    pub(super) recursive: bool,
    pub(super) images: bool,
    pub(super) videos: bool,
}

impl LoadOptions {
    /// Creates the default options: root directory only, images and videos.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Descends into subdirectories (default `false`).
    #[must_use]
    pub fn recursive(mut self, recursive: bool) -> Self {
        self.recursive = recursive;
        self
    }

    /// Loads image files (default `true`).
    #[must_use]
    pub fn images(mut self, include: bool) -> Self {
        self.images = include;
        self
    }

    /// Loads video files (default `true`).
    #[must_use]
    pub fn videos(mut self, include: bool) -> Self {
        self.videos = include;
        self
    }
}

impl Default for LoadOptions {
    fn default() -> Self {
        Self { recursive: false, images: true, videos: true }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_root_only_with_both_types() {
        let opts = LoadOptions::new();

        assert!(!opts.recursive);
        assert!(opts.images);
        assert!(opts.videos);
        assert_eq!(opts, LoadOptions::default());
    }

    #[test]
    fn builder_methods_chain() {
        let opts = LoadOptions::new().recursive(true).images(false).videos(true);

        assert!(opts.recursive);
        assert!(!opts.images);
        assert!(opts.videos);
    }
}
