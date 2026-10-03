//! Grouping loaded [`Media`] by similarity, with the best member of each group first.

use std::cmp::Ordering;
use std::collections::HashMap;

use rayon::prelude::*;

use super::dsu::Dsu;
use crate::{CompareError, Media};

/// Groups media whose similarity reaches a threshold, one media at a time.
///
/// Each media [`push`](Self::push)ed is compared with every earlier media of the same [`MediaType`](crate::MediaType),
/// so grouping can run while files are still loading. Two media join the same group when their
/// [`similarity`](Media::similarity) is at least the threshold, and grouping is transitive: if A matches B and B
/// matches C, all three end up in one group. An image and a video are never compared, so they are never grouped
/// together and mixing them is not an error.
///
/// ```no_run
/// use mediasim::{Grouper, Media};
///
/// let mut grouper = Grouper::new(0.8);
/// for media in Media::from_files(vec!["a.png", "b.png", "c.mp4"]) {
///     grouper.push(media?);
/// }
/// for group in grouper.finish() {
///     println!("best: {}", group[0].path.display());
/// }
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
#[derive(Debug)]
pub struct Grouper {
    threshold: f64,
    media: Vec<Media>,
    dsu: Dsu,
}

impl Grouper {
    /// Creates an empty grouper that groups media scoring at least `threshold` against each other.
    ///
    /// # Panics
    ///
    /// Panics unless `threshold` is a number in the closed range `[0, 1]`.
    #[must_use]
    pub fn new(threshold: f64) -> Self {
        assert!((0.0..=1.0).contains(&threshold), "the threshold must be between 0 and 1, got {threshold}");
        Self { threshold, media: Vec::new(), dsu: Dsu::default() }
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

        let threshold = self.threshold;
        let is_match = |earlier: &&Media| match earlier.similarity(&media) {
            Ok(score) => score >= threshold,
            Err(err @ CompareError::MediaTypeMismatch { .. }) => {
                unreachable!("only media of the same type are compared: {err}")
            }
        };
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
    /// Each group is ordered best first: longest duration (an image counts as zero), then most pixels, then largest
    /// file, then path. The groups are ordered by the path of their best member, so the result does not depend on the
    /// order the media were added in.
    #[must_use]
    pub fn finish(mut self) -> Vec<Vec<Media>> {
        let roots: Vec<usize> = (0..self.media.len()).map(|i| self.dsu.find(i)).collect();

        let mut by_root: HashMap<usize, Vec<Media>> = HashMap::new();
        for (media, root) in self.media.into_iter().zip(roots) {
            by_root.entry(root).or_default().push(media);
        }

        let mut groups: Vec<Vec<Media>> = by_root.into_values().filter(|group| group.len() >= 2).collect();
        for group in &mut groups {
            group.sort_by(best_first);
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

/// Orders media best first: longer duration, then more pixels, then larger file, with the path as the tie-break.
fn best_first(a: &Media, b: &Media) -> Ordering {
    b.duration
        .unwrap_or_default()
        .cmp(&a.duration.unwrap_or_default())
        .then_with(|| b.pixels().cmp(&a.pixels()))
        .then_with(|| b.size.cmp(&a.size))
        .then_with(|| a.path.cmp(&b.path))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Duration;

    use super::*;
    use crate::core::icon::GREY;
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
    fn resolution_decides() {
        let small = Media { width: 500, height: 500, ..image("a.png", 0) };
        let large = Media { width: 1000, height: 1000, ..image("b.png", 0) };

        let groups = group(0.9, [small, large]);

        assert_eq!(paths(&groups), [[PathBuf::from("b.png"), PathBuf::from("a.png")]]);
    }

    #[test]
    fn duration_decides_before_resolution() {
        let long = Media { width: 1280, height: 720, ..video("a.mp4", 0, 60) };
        let sharp = Media { width: 1920, height: 1080, ..video("b.mp4", 0, 30) };

        let groups = group(0.9, [sharp, long]);

        assert_eq!(paths(&groups), [[PathBuf::from("a.mp4"), PathBuf::from("b.mp4")]]);
    }

    #[test]
    fn file_size_breaks_a_tie() {
        let small = Media { width: 200, height: 50, size: 10, ..image("a.png", 0) };
        let big = Media { width: 100, height: 100, size: 20, ..image("b.png", 0) };

        let groups = group(0.9, [small, big]);

        assert_eq!(paths(&groups), [[PathBuf::from("b.png"), PathBuf::from("a.png")]]);
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
                vec![PathBuf::from("v2.mp4"), PathBuf::from("v1.mp4")],
                vec![PathBuf::from("x1.png"), PathBuf::from("x2.png")],
                vec![PathBuf::from("y1.png"), PathBuf::from("y2.png")],
            ]
        );
    }
}
