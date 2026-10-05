//! Grouping loaded [`Media`] by similarity, with each group's members ordered by path.

use std::collections::HashMap;

use rayon::prelude::*;

use super::dsu::Dsu;
use crate::{CompareOptions, Media};

/// Groups media whose similarity reaches a threshold, one media at a time.
///
/// Each media [`push`](Self::push)ed is compared with every earlier media of the same [`MediaType`](crate::MediaType),
/// so grouping can run while files are still loading. Two media join the same group when their
/// [`similarity_with`](Media::similarity_with) under the grouper's [`CompareOptions`] is at least the threshold, and
/// grouping is transitive: if A matches B and B matches C, all three end up in one group. An image and a video are
/// never compared, so they are never grouped together and mixing them is not an error.
///
/// [`finish`](Self::finish) orders each group's members by path. It does not rank them by duration, resolution or
/// file size; that is left to the caller.
///
/// ```no_run
/// use mediasim::{Grouper, Media};
///
/// let mut grouper = Grouper::new(0.8);
/// for media in Media::from_files(vec!["a.png", "b.png", "c.mp4"]) {
///     grouper.push(media?);
/// }
/// for group in grouper.finish() {
///     println!("first: {}", group[0].path.display());
/// }
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Debug)]
pub struct Grouper {
    threshold: f64,
    options: CompareOptions,
    media: Vec<Media>,
    dsu: Dsu,
}

impl Grouper {
    /// Creates an empty grouper that groups media scoring at least `threshold` against each other, under the default
    /// [`CompareOptions`].
    ///
    /// # Panics
    ///
    /// Panics unless `threshold` is a number in the closed range `[0, 1]`.
    #[must_use]
    pub fn new(threshold: f64) -> Self {
        Self::with_options(threshold, CompareOptions::default())
    }

    /// Creates an empty grouper that groups media scoring at least `threshold` against each other under `options`,
    /// as [`similarity_with`](Media::similarity_with) scores them.
    ///
    /// Each comparison stops at the first orientation that reaches the threshold, starting with the original, so a
    /// matching pair often costs no more than without options. A pair that does not match tries every orientation,
    /// up to 8 times the cost of [`new`](Self::new).
    ///
    /// # Panics
    ///
    /// Panics unless `threshold` is a number in the closed range `[0, 1]`.
    #[must_use]
    pub fn with_options(threshold: f64, options: CompareOptions) -> Self {
        assert!((0.0..=1.0).contains(&threshold), "the threshold must be between 0 and 1, got {threshold}");
        Self { threshold, options, media: Vec::new(), dsu: Dsu::default() }
    }

    /// Adds `media`, comparing it in parallel with the earlier media of the same type and merging it into the
    /// group of each one it matches.
    ///
    /// Since grouping is transitive, the comparisons against an existing group stop at its first match.
    pub fn push(&mut self, media: Media) {
        let mut groups: HashMap<usize, Vec<&Media>> = HashMap::new();
        for (i, earlier) in self.media.iter().enumerate() {
            if earlier.media_type == media.media_type {
                groups.entry(self.dsu.find(i)).or_default().push(earlier);
            }
        }

        let (threshold, options) = (self.threshold, self.options);
        let is_match = |earlier: &&Media| earlier.matches(&media, options, threshold);
        let matched: Vec<usize> = groups
            .into_par_iter()
            .filter(|(_, members)| members.par_iter().any(is_match))
            .map(|(root, _)| root)
            .collect();

        let index = self.dsu.push();
        for root in matched {
            self.dsu.union(root, index);
        }
        self.media.push(media);
    }

    /// Returns the groups of two or more media, leaving out media that matched nothing.
    ///
    /// Each group's members are ordered by path, and the groups by the path of their first member, so the result does
    /// not depend on the order the media were added in. The members are not ranked by quality: a caller that wants
    /// them ranked sorts each group itself.
    #[must_use]
    pub fn finish(mut self) -> Vec<Vec<Media>> {
        let roots: Vec<usize> = (0..self.media.len()).map(|i| self.dsu.find(i)).collect();

        let mut by_root: HashMap<usize, Vec<Media>> = HashMap::new();
        for (media, root) in self.media.into_iter().zip(roots) {
            by_root.entry(root).or_default().push(media);
        }

        let mut groups: Vec<Vec<Media>> = by_root.into_values().filter(|group| group.len() >= 2).collect();
        for group in &mut groups {
            group.sort_by(|a, b| a.path.cmp(&b.path));
        }
        groups.sort_by(|a, b| a[0].path.cmp(&b[0].path));
        groups
    }
}

impl Extend<Media> for Grouper {
    fn extend<I: IntoIterator<Item = Media>>(&mut self, iter: I) {
        for media in iter {
            self.push(media);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use super::*;
    use crate::core::icon::GREY;
    use crate::core::orientation::Orientation;
    use crate::media::tests::media;
    use crate::{Icon, MediaType};

    /// An icon with constant luma `y` and neutral chroma. Two such icons score `1 - |y1 - y2| / 65025`.
    fn icon(y: u16) -> Icon {
        Icon::solid(y, GREY, GREY)
    }

    fn image(path: &str, y: u16) -> Media {
        media(path, MediaType::Image, vec![icon(y)])
    }

    fn video(path: &str, y: u16, secs: u64) -> Media {
        Media { duration: Some(Duration::from_secs(secs)), ..media(path, MediaType::Video, vec![icon(y); 3]) }
    }

    fn group(threshold: f64, media: impl IntoIterator<Item = Media>) -> Vec<Vec<Media>> {
        let mut grouper = Grouper::new(threshold);
        grouper.extend(media);
        grouper.finish()
    }

    fn group_with(threshold: f64, options: CompareOptions, media: impl IntoIterator<Item = Media>) -> Vec<Vec<Media>> {
        let mut grouper = Grouper::with_options(threshold, options);
        grouper.extend(media);
        grouper.finish()
    }

    /// A textured image and a copy of it with its frame in `orientation`.
    fn original_and_copy(orientation: Orientation) -> [Media; 2] {
        let frame = Icon::textured(42);
        let copy = orientation.apply(&frame);
        [media("a.png", MediaType::Image, vec![frame]), media("b.png", MediaType::Image, vec![copy])]
    }

    fn paths(groups: &[Vec<Media>]) -> Vec<Vec<PathBuf>> {
        groups.iter().map(|g| g.iter().map(|m| m.path.clone()).collect()).collect()
    }

    #[test]
    fn matching_media_are_grouped() {
        let groups = group(0.8, [image("a.png", 30_000), image("b.png", 31_000), image("c.png", 60_000)]);

        assert_eq!(paths(&groups), [[PathBuf::from("a.png"), PathBuf::from("b.png")]]);
    }

    #[test]
    fn score_equal_to_the_threshold_matches() {
        let (a, b) = (image("a.png", 10_000), image("b.png", 40_000));
        let score = a.similarity(&b).unwrap();

        let groups = group(score, [a, b]);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 2);
    }

    #[test]
    fn matches_are_transitive() {
        // a-b and b-c score ~0.69, a-c ~0.38.
        let (a, b, c) = (image("a.png", 0), image("b.png", 20_000), image("c.png", 40_000));
        assert!(a.similarity(&c).unwrap() < 0.6);

        let groups = group(0.6, [a, c, b]);

        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].len(), 3);
    }

    #[test]
    fn nothing_matching_gives_no_groups() {
        let groups = group(0.9, [image("a.png", 0), image("b.png", 30_000), image("c.png", 60_000)]);

        assert!(groups.is_empty());
    }

    #[test]
    fn images_and_videos_are_never_grouped() {
        let groups = group(0.0, [image("a.png", 5_000), video("v.mp4", 5_000, 3), image("b.png", 5_000)]);

        assert_eq!(paths(&groups), [[PathBuf::from("a.png"), PathBuf::from("b.png")]]);
    }

    #[test]
    #[should_panic(expected = "between 0 and 1")]
    fn threshold_above_one_panics() {
        let _ = Grouper::new(1.5);
    }

    #[test]
    #[should_panic(expected = "between 0 and 1")]
    fn nan_threshold_panics() {
        let _ = Grouper::new(f64::NAN);
    }

    #[test]
    fn path_decides_not_resolution() {
        let large = Media { width: 1000, height: 1000, ..image("b.png", 0) };
        let small = Media { width: 500, height: 500, ..image("a.png", 0) };

        let groups = group(0.9, [large, small]);

        assert_eq!(paths(&groups), [[PathBuf::from("a.png"), PathBuf::from("b.png")]]);
    }

    #[test]
    fn path_decides_not_duration() {
        let long = video("b.mp4", 0, 60);
        let short = video("a.mp4", 0, 30);

        let groups = group(0.9, [long, short]);

        assert_eq!(paths(&groups), [[PathBuf::from("a.mp4"), PathBuf::from("b.mp4")]]);
    }

    #[test]
    fn path_decides_not_file_size() {
        let big = Media { width: 100, height: 100, size: 20, ..image("b.png", 0) };
        let small = Media { width: 200, height: 50, size: 10, ..image("a.png", 0) };

        let groups = group(0.9, [big, small]);

        assert_eq!(paths(&groups), [[PathBuf::from("a.png"), PathBuf::from("b.png")]]);
    }

    #[test]
    fn groups_are_ordered_by_their_first_path() {
        let media = [
            image("x1.png", 30_000),
            image("x2.png", 30_000),
            image("y1.png", 60_000),
            image("c.png", 60_000),
        ];

        let groups = group(0.95, media);

        assert_eq!(
            paths(&groups),
            [
                [PathBuf::from("c.png"), PathBuf::from("y1.png")],
                [PathBuf::from("x1.png"), PathBuf::from("x2.png")],
            ]
        );
    }

    #[test]
    fn arrival_order_does_not_change_the_result() {
        let media = vec![
            image("x2.png", 30_000),
            image("y1.png", 60_000),
            Media { size: 500, ..image("x1.png", 30_100) },
            video("v1.mp4", 1_000, 10),
            image("y2.png", 60_500),
            video("v2.mp4", 1_200, 20),
            image("lonely.png", 0),
        ];

        let forward = group(0.95, media.clone());
        let backward = group(0.95, media.into_iter().rev());

        assert_eq!(forward, backward);
        assert_eq!(
            paths(&forward),
            [
                vec![PathBuf::from("v1.mp4"), PathBuf::from("v2.mp4")],
                vec![PathBuf::from("x1.png"), PathBuf::from("x2.png")],
                vec![PathBuf::from("y1.png"), PathBuf::from("y2.png")],
            ]
        );
    }

    #[test]
    fn a_mirrored_copy_is_grouped_with_flip() {
        let groups = group_with(0.9, CompareOptions::new().flip(true), original_and_copy(Orientation::FlipH));

        assert_eq!(paths(&groups), [[PathBuf::from("a.png"), PathBuf::from("b.png")]]);
    }

    #[test]
    fn a_mirrored_copy_stays_apart_without_options() {
        assert!(group(0.9, original_and_copy(Orientation::FlipH)).is_empty());
        assert!(group_with(0.9, CompareOptions::new().rotate(true), original_and_copy(Orientation::FlipH)).is_empty());
    }

    #[test]
    fn a_rotated_copy_is_grouped_with_rotate() {
        let groups = group_with(0.9, CompareOptions::new().rotate(true), original_and_copy(Orientation::Rotate90));

        assert_eq!(paths(&groups), [[PathBuf::from("a.png"), PathBuf::from("b.png")]]);
    }

    #[test]
    fn default_options_group_as_before() {
        let media = vec![
            image("x2.png", 30_000),
            image("y1.png", 60_000),
            image("x1.png", 30_100),
            video("v1.mp4", 1_000, 10),
            image("y2.png", 60_500),
            video("v2.mp4", 1_200, 20),
            image("lonely.png", 0),
        ];

        assert_eq!(group_with(0.95, CompareOptions::default(), media.clone()), group(0.95, media));
    }

    #[test]
    #[should_panic(expected = "between 0 and 1")]
    fn with_options_checks_the_threshold() {
        let _ = Grouper::with_options(-0.1, CompareOptions::new().flip(true));
    }
}
