//! Similarity between two loaded [`Media`] values.

use super::diff::calculate_diff;
use super::dtw;
use super::orientation::Orientation;
use crate::{CompareError, CompareOptions, Icon, Media, MediaType};

impl Media {
    /// Scores how alike `self` and `other` look, from `0` (completely different) to `1` (identical).
    ///
    /// Two images are compared by their single frames. Two videos are compared by aligning their per-second frames
    /// with Dynamic Time Warping, so a trimmed or padded copy still scores high; the score is the average frame
    /// similarity along the best alignment. The result is the same whichever of the two it is called on.
    ///
    /// This is [`similarity_with`](Self::similarity_with) under the default [`CompareOptions`].
    ///
    /// # Errors
    ///
    /// Returns [`CompareError::MediaTypeMismatch`] if one is an image and the other a video.
    pub fn similarity(&self, other: &Media) -> Result<f64, CompareError> {
        self.similarity_with(other, CompareOptions::default())
    }

    /// Scores how alike `self` and `other` look, as [`similarity`](Self::similarity) does, also trying the
    /// orientations that `options` enables and returning the best score.
    ///
    /// A video is compared under one orientation at a time, applied to all of its frames. The score is never lower than
    /// without options, and is the same whichever of the two it is called on. Each orientation costs one more
    /// comparison, so this is up to 8 times as slow as [`similarity`](Self::similarity); see [`CompareOptions`].
    ///
    /// # Errors
    ///
    /// Returns [`CompareError::MediaTypeMismatch`] if one is an image and the other a video.
    pub fn similarity_with(&self, other: &Media, options: CompareOptions) -> Result<f64, CompareError> {
        Ok(self.scores(other, options)?.fold(0.0, f64::max))
    }

    /// Whether `self` and `other` score at least `threshold` under `options`, stopping at the first orientation that
    /// does.
    pub(crate) fn matches(&self, other: &Media, options: CompareOptions, threshold: f64) -> Result<bool, CompareError> {
        Ok(self.scores(other, options)?.any(|score| score >= threshold))
    }

    /// The score of `self` against each orientation of `other` that `options` enables, in order and computed lazily.
    ///
    /// Only `other` is oriented. The orientation sets are closed under inverses and [`euc_metric`](crate::euc_metric)
    /// does not depend on pixel order, so the best score is bit-identical in either order.
    fn scores<'a>(
        &'a self,
        other: &'a Media,
        options: CompareOptions,
    ) -> Result<impl Iterator<Item = f64> + 'a, CompareError> {
        if self.media_type != other.media_type {
            return Err(CompareError::MediaTypeMismatch {
                left: self.path.clone(),
                left_type: self.media_type,
                right: other.path.clone(),
                right_type: other.media_type,
            });
        }

        // Reused by every orientation; only allocated once one other than the identity is reached.
        let mut oriented: Vec<Icon> = Vec::new();

        Ok(options.orientations().iter().map(move |&orientation| {
            if orientation == Orientation::Identity {
                return self.score(&other.frames);
            }
            if oriented.is_empty() {
                oriented.clone_from(&other.frames);
            }
            for (frame, out) in other.frames.iter().zip(&mut oriented) {
                orientation.apply_into(frame, out);
            }
            self.score(&oriented)
        }))
    }

    /// Scores `self`'s frames against `frames`, which belong to media of the same type.
    fn score(&self, frames: &[Icon]) -> f64 {
        let diff = match self.media_type {
            MediaType::Image => calculate_diff(&self.frames[0], &frames[0]),
            MediaType::Video => {
                dtw::mean_cost(self.frames.len(), frames.len(), |i, j| calculate_diff(&self.frames[i], &frames[j]))
            }
        };

        (1.0 - diff).clamp(0.0, 1.0)
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
    use crate::Icon;
    use crate::core::icon::GREY;
    use crate::media::tests::media;

    fn image(path: &str, frame: Icon) -> Media {
        media(path, MediaType::Image, vec![frame])
    }

    fn video(path: &str, frames: Vec<Icon>) -> Media {
        media(path, MediaType::Video, frames)
    }

    /// A video that fades from black to white over five frames.
    fn fade() -> Vec<Icon> {
        [0, 16_000, 32_000, 48_000, 65_025].into_iter().map(|y| Icon::solid(y, GREY, GREY)).collect()
    }

    #[test]
    fn self_comparison_is_one() {
        let img = image("a.png", Icon::solid(12_000, 40_000, 9_000));
        let vid = video("a.mp4", fade());

        assert_eq!(img.similarity(&img).unwrap(), 1.0);
        assert_eq!(vid.similarity(&vid).unwrap(), 1.0);
    }

    #[test]
    fn black_vs_white_rounds_to_zero() {
        let black = image("black.png", Icon::solid(0, GREY, GREY));
        let white = image("white.png", Icon::solid(65_025, GREY, GREY));

        let score = black.similarity(&white).unwrap();

        assert!((0.0..=1.0).contains(&score));
        assert!(score < 0.000_005, "score {score} does not round to 0");
    }

    #[test]
    fn similar_images_score_higher_than_different_ones() {
        let base = image("a.png", Icon::solid(30_000, GREY, GREY));
        let near = image("b.png", Icon::solid(31_000, GREY, GREY));
        let far = image("c.png", Icon::solid(60_000, 5_000, 60_000));

        assert!(base.similarity(&near).unwrap() > base.similarity(&far).unwrap());
    }

    #[test]
    fn results_are_symmetric() {
        let a = image("a.png", Icon::solid(5_000, 12_000, 40_000));
        let b = image("b.png", Icon::solid(60_000, 1_000, 25_000));
        assert_eq!(a.similarity(&b).unwrap().to_bits(), b.similarity(&a).unwrap().to_bits());

        let a = video("a.mp4", fade());
        let b = video(
            "b.mp4",
            vec![
                Icon::solid(9_000, 30_000, 2_000),
                Icon::solid(50_000, GREY, 60_000),
                Icon::solid(20_000, 0, GREY),
            ],
        );
        assert_eq!(a.similarity(&b).unwrap().to_bits(), b.similarity(&a).unwrap().to_bits());
    }

    #[test]
    fn image_vs_video_is_a_type_mismatch() {
        let img = image("a.png", Icon::solid(0, GREY, GREY));
        let vid = video("b.mp4", fade());

        let err = img.similarity(&vid).unwrap_err();
        let CompareError::MediaTypeMismatch { left, left_type, right, right_type } = err;
        assert_eq!((left.to_str(), left_type), (Some("a.png"), MediaType::Image));
        assert_eq!((right.to_str(), right_type), (Some("b.mp4"), MediaType::Video));
    }

    #[test]
    fn video_vs_image_is_a_type_mismatch() {
        let img = image("a.png", Icon::solid(0, GREY, GREY));
        let vid = video("b.mp4", fade());

        let err = vid.similarity(&img).unwrap_err();
        let CompareError::MediaTypeMismatch { left_type, right_type, .. } = err;
        assert_eq!((left_type, right_type), (MediaType::Video, MediaType::Image));
    }

    #[test]
    fn single_frame_videos_equal_their_frame_similarity() {
        let (f1, f2) = (Icon::solid(10_000, 20_000, 30_000), Icon::solid(40_000, 25_000, 5_000));
        let frames = image("a.png", f1.clone()).similarity(&image("b.png", f2.clone())).unwrap();

        let videos = video("a.mp4", vec![f1]).similarity(&video("b.mp4", vec![f2])).unwrap();

        assert_eq!(videos, frames);
    }

    #[test]
    fn truncated_video_scores_higher_than_unrelated_one() {
        let original = video("a.mp4", fade());
        let truncated = video("b.mp4", fade().into_iter().take(3).collect());
        let unrelated =
            video("c.mp4", [65_025, 50_000, 20_000].into_iter().map(|y| Icon::solid(y, 0, 65_025)).collect());

        let trimmed = original.similarity(&truncated).unwrap();
        let other = original.similarity(&unrelated).unwrap();

        assert!((0.0..=1.0).contains(&trimmed) && (0.0..=1.0).contains(&other));
        assert!(trimmed > other, "trimmed {trimmed} <= unrelated {other}");
    }

    const ALL_ORIENTATIONS: [Orientation; 8] = [
        Orientation::Identity,
        Orientation::FlipH,
        Orientation::FlipV,
        Orientation::Rotate90,
        Orientation::Rotate180,
        Orientation::Rotate270,
        Orientation::Transpose,
        Orientation::AntiTranspose,
    ];

    /// The four combinations of the two options.
    fn all_options() -> [CompareOptions; 4] {
        let opts = CompareOptions::new();
        [opts, opts.flip(true), opts.rotate(true), opts.flip(true).rotate(true)]
    }

    fn textured_video(path: &str, seed: u64, len: u64) -> Media {
        video(path, (0..len).map(|i| Icon::textured(seed + i)).collect())
    }

    /// `media` with every frame in `orientation`.
    fn oriented(media: &Media, orientation: Orientation) -> Media {
        Media { frames: media.frames.iter().map(|f| orientation.apply(f)).collect(), ..media.clone() }
    }

    #[test]
    fn default_options_equal_the_plain_comparison() {
        let pairs = [
            (image("a.png", Icon::textured(1)), image("b.png", Icon::textured(2))),
            (textured_video("a.mp4", 1, 4), textured_video("b.mp4", 9, 3)),
        ];

        for (a, b) in pairs {
            let plain = a.similarity(&b).unwrap();
            let with = a.similarity_with(&b, CompareOptions::default()).unwrap();
            assert_eq!(plain.to_bits(), with.to_bits());
        }
    }

    #[test]
    fn an_oriented_copy_scores_one_only_with_an_option_that_covers_it() {
        let original = image("a.png", Icon::textured(7));

        for orientation in ALL_ORIENTATIONS {
            let copy = oriented(&original, orientation);
            for options in all_options() {
                let score = original.similarity_with(&copy, options).unwrap();
                let covered = options.orientations().contains(&orientation);

                assert_eq!(score == 1.0, covered, "{orientation:?} with {options:?} scored {score}");
                if !covered {
                    assert!(score < 0.9, "{orientation:?} with {options:?} scored {score}");
                }
            }
        }
    }

    #[test]
    fn both_options_cover_a_mirrored_rotation() {
        let original = image("a.png", Icon::textured(3));
        let copy = oriented(&oriented(&original, Orientation::FlipH), Orientation::Rotate90);
        let both = CompareOptions::new().flip(true).rotate(true);

        assert_eq!(original.similarity_with(&copy, both).unwrap(), 1.0);
        assert!(original.similarity_with(&copy, CompareOptions::new().flip(true)).unwrap() < 1.0);
        assert!(original.similarity_with(&copy, CompareOptions::new().rotate(true)).unwrap() < 1.0);
    }

    #[test]
    fn options_never_lower_a_score() {
        let pairs = [
            (image("a.png", Icon::textured(11)), image("b.png", Icon::textured(12))),
            (
                image("a.png", Icon::solid(5_000, 12_000, 40_000)),
                image("b.png", Icon::solid(60_000, 1_000, 25_000)),
            ),
            (textured_video("a.mp4", 20, 5), textured_video("b.mp4", 40, 3)),
            (video("a.mp4", fade()), textured_video("b.mp4", 50, 2)),
        ];

        for (a, b) in pairs {
            let plain = a.similarity(&b).unwrap();
            for options in all_options() {
                let score = a.similarity_with(&b, options).unwrap();
                assert!((0.0..=1.0).contains(&score), "{score} with {options:?}");
                assert!(score >= plain, "{score} < {plain} with {options:?}");
            }
        }
    }

    #[test]
    fn swapped_order_is_bit_identical_under_every_option() {
        let pairs = [
            (image("a.png", Icon::textured(21)), image("b.png", Icon::textured(22))),
            (
                image("a.png", Icon::textured(23)),
                oriented(&image("b.png", Icon::textured(23)), Orientation::Rotate90),
            ),
            (textured_video("a.mp4", 30, 5), textured_video("b.mp4", 60, 3)),
            (
                textured_video("a.mp4", 70, 4),
                oriented(&textured_video("b.mp4", 70, 2), Orientation::Rotate270),
            ),
        ];

        for (a, b) in pairs {
            for options in all_options() {
                let ab = a.similarity_with(&b, options).unwrap();
                let ba = b.similarity_with(&a, options).unwrap();
                assert_eq!(ab.to_bits(), ba.to_bits(), "{ab} != {ba} for {} with {options:?}", b.path.display());
            }
        }
    }

    #[test]
    fn a_rotated_video_scores_one_with_rotate() {
        let original = textured_video("a.mp4", 80, 4);
        let rotated = oriented(&original, Orientation::Rotate90);

        assert!(original.similarity(&rotated).unwrap() < 0.9);
        assert_eq!(original.similarity_with(&rotated, CompareOptions::new().rotate(true)).unwrap(), 1.0);
    }

    #[test]
    fn a_video_is_oriented_as_a_whole() {
        // Each frame of the copy is turned a different way, so no single orientation restores all of them.
        let original = textured_video("a.mp4", 90, 3);
        let mixed = video(
            "b.mp4",
            vec![
                Orientation::FlipH.apply(&original.frames[0]),
                Orientation::Rotate90.apply(&original.frames[1]),
                original.frames[2].clone(),
            ],
        );
        let both = CompareOptions::new().flip(true).rotate(true);

        let score = original.similarity_with(&mixed, both).unwrap();

        let best_whole_video = ALL_ORIENTATIONS
            .into_iter()
            .map(|o| original.similarity(&oriented(&mixed, o)).unwrap())
            .fold(0.0, f64::max);
        assert_eq!(score.to_bits(), best_whole_video.to_bits());
        assert!(score < 1.0, "{score}");
    }

    #[test]
    fn matches_agrees_with_the_best_score() {
        let original = image("a.png", Icon::textured(100));
        let pairs = [
            (original.clone(), oriented(&original, Orientation::FlipV)),
            (original.clone(), image("b.png", Icon::textured(101))),
            (
                textured_video("a.mp4", 110, 3),
                oriented(&textured_video("b.mp4", 110, 3), Orientation::Rotate180),
            ),
        ];

        for (a, b) in pairs {
            for options in all_options() {
                let score = a.similarity_with(&b, options).unwrap();
                for threshold in [0.0, score / 2.0, score, score.midpoint(1.0), 1.0] {
                    assert_eq!(
                        a.matches(&b, options, threshold).unwrap(),
                        score >= threshold,
                        "{options:?} at {threshold}"
                    );
                }
            }
        }
    }

    #[test]
    fn options_do_not_allow_mixed_media_types() {
        let img = image("a.png", Icon::textured(1));
        let vid = textured_video("b.mp4", 2, 3);

        for options in all_options() {
            assert!(matches!(img.similarity_with(&vid, options), Err(CompareError::MediaTypeMismatch { .. })));
            assert!(matches!(vid.similarity_with(&img, options), Err(CompareError::MediaTypeMismatch { .. })));
        }
    }
}
