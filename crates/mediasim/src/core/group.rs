//! Grouping loaded [`Media`] by similarity, with each group's members ordered by path.

use std::collections::HashMap;

use rayon::prelude::*;

use super::bound::ChannelSums;
use super::dsu::Dsu;
use super::similarity::falls_short;
use crate::{CancelToken, CompareOptions, Media, MediaType};

/// Groups media whose similarity reaches a threshold, one media at a time.
///
/// Each media [`push`](Self::push)ed is compared with every earlier media of the same [`MediaType`](crate::MediaType),
/// so grouping can run while files are still loading. Two media join the same group when their
/// [`similarity_with`](Media::similarity_with) under the grouper's [`CompareOptions`] is at least the threshold, and
/// grouping is transitive: if A matches B and B matches C, all three end up in one group. An image and a video are
/// never compared, so they are never grouped together and mixing them is not an error. A media without frames matches
/// nothing.
///
/// [`finish`](Self::finish) orders each group's members by path. It does not rank them by duration, resolution or
/// file size; that is left to the caller, for example with [`Media::best_first`].
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
    /// The channel sums of each image's frame, by index into `media`, for [`ChannelSums::min_diff`]; `None` for a
    /// video or a media without frames.
    sums: Vec<Option<ChannelSums>>,
    dsu: Dsu,
    /// The members of every group, by media type and then by the group's root in `dsu`, kept up to date as groups
    /// merge so a push never has to rebuild them.
    groups: HashMap<MediaType, HashMap<usize, Vec<usize>>>,
}

/// Panics unless `threshold` is a number in the closed range `[0, 1]`, the check every grouping entry point makes.
pub(crate) fn check_threshold(threshold: f64) {
    assert!((0.0..=1.0).contains(&threshold), "the threshold must be between 0 and 1, got {threshold}");
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
        check_threshold(threshold);
        Self {
            threshold,
            options,
            media: Vec::new(),
            sums: Vec::new(),
            dsu: Dsu::default(),
            groups: HashMap::new(),
        }
    }

    /// Adds `media`, comparing it in parallel with the earlier media of the same type and merging it into the
    /// group of each one it matches.
    ///
    /// Since grouping is transitive, the comparisons against an existing group stop at its first match.
    pub fn push(&mut self, media: Media) {
        self.push_cancellable(media, &CancelToken::new());
    }

    /// Adds `media` as [`push`](Self::push) does, unless `cancel` is cancelled first. Once it is, no new comparison
    /// starts, and if it is cancelled by the time the comparisons end, `media` is not added. Returns whether `media`
    /// was added.
    pub(crate) fn push_cancellable(&mut self, media: Media, cancel: &CancelToken) -> bool {
        let sums = image_sums(&media);
        let matched = self.matched_groups(&media, sums, cancel);
        if cancel.is_cancelled() {
            return false;
        }

        self.add(media, sums, &matched);
        true
    }

    /// The roots of the groups `media`, whose image sums are `sums`, matches, comparing it in parallel with the
    /// earlier media of its type. Once `cancel` is cancelled, the comparisons not yet started count as no match.
    ///
    /// `media` is oriented once here rather than once per comparison, and an image whose [`ChannelSums`] already
    /// rule a pair out is not compared at all: [`ChannelSums::min_diff`] never exceeds the difference that would be
    /// computed, so it only skips pairs that would not have matched, and the groups are the same as without it.
    fn matched_groups(&self, media: &Media, sums: Option<ChannelSums>, cancel: &CancelToken) -> Vec<usize> {
        let Some(groups) = self.groups.get(&media.media_type) else { return Vec::new() };

        let threshold = self.threshold;
        let oriented = media.oriented(self.options);
        let ruled_out = |earlier: usize| match (sums, self.sums[earlier]) {
            (Some(new), Some(old)) => falls_short(new.min_diff(old), threshold),
            _ => false,
        };
        let is_match = |&earlier: &usize| {
            !cancel.is_cancelled() && !ruled_out(earlier) && self.media[earlier].matches_oriented(&oriented, threshold)
        };

        groups
            .par_iter()
            .filter(|(_, members)| members.par_iter().any(is_match))
            .map(|(&root, _)| root)
            .collect()
    }

    /// Adds `media`, whose image sums are `sums`, to the grouper, merged into the groups of `matched`.
    ///
    /// The merged group keeps the largest of the member lists and takes in the others, so over a run each media is
    /// moved only a logarithmic number of times.
    fn add(&mut self, media: Media, sums: Option<ChannelSums>, matched: &[usize]) {
        let index = self.dsu.push();
        for &root in matched {
            self.dsu.union(root, index);
        }

        let groups = self.groups.entry(media.media_type).or_default();
        let mut lists: Vec<Vec<usize>> = matched.iter().filter_map(|root| groups.remove(root)).collect();
        let largest = (0..lists.len()).max_by_key(|&i| lists[i].len());
        let mut members = largest.map(|i| lists.swap_remove(i)).unwrap_or_default();
        for list in lists {
            members.extend(list);
        }
        members.push(index);
        groups.insert(self.dsu.find(index), members);

        self.media.push(media);
        self.sums.push(sums);
    }

    /// Returns the groups of two or more media, leaving out media that matched nothing.
    ///
    /// Each group's members are ordered by path, and the groups by the path of their first member, so the result does
    /// not depend on the order the media were added in. The members are not ranked by quality: a caller that wants
    /// them ranked sorts each group itself, for example with [`Media::best_first`].
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

/// The channel sums of `media`'s frame if it is an image with one, for the pre-filter of [`Grouper::matched_groups`].
fn image_sums(media: &Media) -> Option<ChannelSums> {
    match (media.media_type, media.frames.first()) {
        (MediaType::Image, Some(frame)) => Some(ChannelSums::of(frame)),
        _ => None,
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
    fn push_cancellable_with_a_cancelled_token_leaves_the_grouper_unchanged() {
        let mut grouper = Grouper::new(0.8);
        grouper.push(image("a.png", 30_000));
        let token = CancelToken::new();
        token.cancel();

        let added = grouper.push_cancellable(image("b.png", 30_000), &token);

        assert!(!added);
        assert_eq!(grouper.media.len(), 1);
        assert!(grouper.finish().is_empty());
    }

    #[test]
    fn push_cancellable_uncancelled_groups_as_push() {
        let media = [image("a.png", 30_000), image("b.png", 31_000), image("c.png", 60_000)];
        let mut grouper = Grouper::new(0.8);
        let token = CancelToken::new();

        for m in media.clone() {
            assert!(grouper.push_cancellable(m, &token));
        }

        assert_eq!(grouper.finish(), group(0.8, media));
    }

    #[test]
    #[should_panic(expected = "between 0 and 1")]
    fn with_options_checks_the_threshold() {
        let _ = Grouper::with_options(-0.1, CompareOptions::new().flip(true));
    }

    /// `base` with every value moved by up to `amplitude` either way (xorshift64 from `seed`), so copies of one base
    /// score anywhere from identical to unrelated depending on `amplitude`.
    fn noisy(base: &Icon, seed: u64, amplitude: u64) -> Icon {
        let mut next = crate::core::xorshift(seed);
        let pixels = base
            .pixels()
            .iter()
            .map(|&v| {
                let shift = i64::try_from(next() % (2 * amplitude + 1)).unwrap() - i64::try_from(amplitude).unwrap();
                u16::try_from((i64::from(v) + shift).clamp(0, 65_025)).unwrap()
            })
            .collect();
        Icon::from_raw(pixels)
    }

    /// The groups of `media` found the slow way: every pair scored with `similarity_with`, then merged transitively.
    fn reference(threshold: f64, options: CompareOptions, media: &[Media]) -> Vec<Vec<PathBuf>> {
        let mut dsu = Dsu::default();
        for _ in media {
            dsu.push();
        }
        for (i, a) in media.iter().enumerate() {
            for (j, b) in media.iter().enumerate().skip(i + 1) {
                if a.similarity_with(b, options).is_ok_and(|score| score >= threshold) {
                    dsu.union(i, j);
                }
            }
        }

        let mut by_root: HashMap<usize, Vec<PathBuf>> = HashMap::new();
        for (i, m) in media.iter().enumerate() {
            by_root.entry(dsu.find(i)).or_default().push(m.path.clone());
        }
        let mut groups: Vec<Vec<PathBuf>> = by_root.into_values().filter(|g| g.len() >= 2).collect();
        for group in &mut groups {
            group.sort();
        }
        groups.sort();
        groups
    }

    #[test]
    fn grouping_equals_scoring_every_pair() {
        // Images near four bases, some turned or mirrored and some solid, and videos near two, at noise levels that
        // put the scores on both sides of every threshold below.
        let bases: Vec<Icon> = (0..4).map(|seed| Icon::textured(1_000 + seed)).collect();
        let mut all = Vec::new();
        for i in 0..36u64 {
            let base = &bases[usize::try_from(i % 4).unwrap()];
            let mut frame = noisy(base, i + 1, [500, 4_000, 12_000, 30_000][usize::try_from(i % 3).unwrap()]);
            if i % 5 == 0 {
                frame = Orientation::ALL[usize::try_from(i % 8).unwrap()].apply(&frame);
            }
            all.push(media(&format!("i{i:02}.png"), MediaType::Image, vec![frame]));
        }
        for (i, y) in [0, 2_000, 30_000, 31_000, 65_025].into_iter().enumerate() {
            all.push(image(&format!("s{i}.png"), y));
        }
        for i in 0..8u64 {
            let base = &bases[usize::try_from(i % 2).unwrap()];
            let frames = (0..(3 + i % 4))
                .map(|f| noisy(base, 100 + i * 10 + f, [800, 9_000][usize::try_from(i % 2).unwrap()]))
                .collect();
            all.push(media(&format!("v{i}.mp4"), MediaType::Video, frames));
        }

        for options in [
            CompareOptions::new(),
            CompareOptions::new().flip(true),
            CompareOptions::new().flip(true).rotate(true),
        ] {
            for threshold in [0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99, 1.0] {
                let want = reference(threshold, options, &all);

                assert_eq!(paths(&group_with(threshold, options, all.clone())), want, "{options:?} at {threshold}");
                assert_eq!(
                    paths(&group_with(threshold, options, all.iter().rev().cloned())),
                    want,
                    "{options:?} at {threshold}, reversed"
                );
            }
        }
    }

    #[test]
    fn media_without_frames_join_no_group() {
        let empty = Media { frames: Vec::new(), ..image("empty.png", 0) };

        let groups = group(0.0, [image("a.png", 0), empty.clone(), image("b.png", 0), empty]);

        assert_eq!(paths(&groups), [[PathBuf::from("a.png"), PathBuf::from("b.png")]]);
    }

    #[test]
    fn group_members_are_kept_up_to_date_as_groups_merge() {
        // a-b and c-d form two groups; e matches b and c, merging both.
        let mut grouper = Grouper::new(0.6);
        for (path, y) in [("a.png", 0), ("b.png", 20_000), ("c.png", 47_000), ("d.png", 65_025), ("e.png", 33_000)] {
            grouper.push(image(path, y));
        }

        let groups = &grouper.groups[&MediaType::Image];
        assert_eq!(groups.len(), 1, "{groups:?}");
        let (&root, members) = groups.iter().next().unwrap();
        let mut members = members.clone();
        members.sort_unstable();
        assert_eq!(members, [0, 1, 2, 3, 4]);
        assert!((0..5).all(|i| grouper.dsu.find(i) == root));
    }
}
