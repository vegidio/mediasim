//! Options for [`Media::similarity_with`](crate::Media::similarity_with) and
//! [`Grouper::with_options`](crate::Grouper::with_options).

use super::orientation::Orientation;

/// Which orientations of the frames a comparison also tries, keeping the best score.
///
/// | `flip` | `rotate` | orientations compared                                        |
/// |--------|----------|--------------------------------------------------------------|
/// | off    | off      | the original                                                 |
/// | on     | off      | the original, flipped horizontally and flipped vertically    |
/// | off    | on       | the original, rotated by 90°, 180° and 270°                  |
/// | on     | on       | all 8 orientations of a square, adding both diagonal mirrors |
///
/// The orientations are applied to the frames' compact [`Icon`](crate::Icon) signatures when comparing, so they cost
/// nothing at load time. Each orientation costs one more comparison, so a comparison is up to 3, 4 or 8 times as slow,
/// which matters most for long videos, where each orientation aligns all the frames again. A video is always compared
/// under one orientation at a time, applied to every frame.
///
/// The default compares the frames **as they are**. Methods consume and return `self`:
///
/// ```
/// use mediasim::CompareOptions;
///
/// let mirrored_or_turned = CompareOptions::new().flip(true).rotate(true);
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CompareOptions {
    pub(crate) flip: bool,
    pub(crate) rotate: bool,
}

impl CompareOptions {
    /// Creates the default options: the original orientation only.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Also compares the frames flipped horizontally and vertically (default `false`).
    #[must_use]
    pub fn flip(mut self, flip: bool) -> Self {
        self.flip = flip;
        self
    }

    /// Also compares the frames rotated by 90°, 180° and 270° (default `false`).
    #[must_use]
    pub fn rotate(mut self, rotate: bool) -> Self {
        self.rotate = rotate;
        self
    }

    /// The orientations to compare, the identity first. With both options on, these are all 8 orientations of a
    /// square, including the two diagonal mirrors that a flip combined with a quarter turn gives.
    pub(crate) fn orientations(self) -> &'static [Orientation] {
        use Orientation::{FlipH, FlipV, Identity, Rotate90, Rotate180, Rotate270};

        match (self.flip, self.rotate) {
            (false, false) => &[Identity],
            (true, false) => &[Identity, FlipH, FlipV],
            (false, true) => &[Identity, Rotate90, Rotate180, Rotate270],
            (true, true) => &Orientation::ALL,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn defaults_compare_the_original_orientation_only() {
        let opts = CompareOptions::new();

        assert!(!opts.flip);
        assert!(!opts.rotate);
        assert_eq!(opts, CompareOptions::default());
    }

    #[test]
    fn builder_methods_chain() {
        let opts = CompareOptions::new().flip(true).rotate(true).flip(false);

        assert!(!opts.flip);
        assert!(opts.rotate);
    }

    #[test]
    fn each_combination_has_its_orientations_identity_first() {
        for (flip, rotate, count) in [(false, false, 1), (true, false, 3), (false, true, 4), (true, true, 8)] {
            let set = CompareOptions::new().flip(flip).rotate(rotate).orientations();

            assert_eq!(set.len(), count, "flip {flip}, rotate {rotate}");
            assert_eq!(set[0], Orientation::Identity, "flip {flip}, rotate {rotate}");
            assert_eq!(set.iter().collect::<HashSet<_>>().len(), count, "duplicates for flip {flip}, rotate {rotate}");
        }
    }

    #[test]
    fn flip_and_rotate_sets_are_what_they_say() {
        use Orientation::{FlipH, FlipV, Identity, Rotate90, Rotate180, Rotate270};

        assert_eq!(CompareOptions::new().flip(true).orientations(), [Identity, FlipH, FlipV]);
        assert_eq!(CompareOptions::new().rotate(true).orientations(), [Identity, Rotate90, Rotate180, Rotate270]);
    }
}
