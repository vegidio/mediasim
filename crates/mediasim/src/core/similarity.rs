//! Similarity between two loaded [`Media`] values.

use super::diff::calculate_diff;
use super::dtw;
use crate::{CompareError, Media, MediaType};

impl Media {
    /// Scores how alike `self` and `other` look, from `0` (completely different) to `1` (identical).
    ///
    /// Two images are compared by their single frames. Two videos are compared by aligning their per-second frames
    /// with Dynamic Time Warping, so a trimmed or padded copy still scores high; the score is the average frame
    /// similarity along the best alignment. The result is the same whichever of the two it is called on.
    ///
    /// # Errors
    ///
    /// Returns [`CompareError::MediaTypeMismatch`] if one is an image and the other a video.
    pub fn similarity(&self, other: &Media) -> Result<f64, CompareError> {
        let diff = match (self.media_type, other.media_type) {
            (MediaType::Image, MediaType::Image) => calculate_diff(&self.frames[0], &other.frames[0]),
            (MediaType::Video, MediaType::Video) => dtw::mean_cost(self.frames.len(), other.frames.len(), |i, j| {
                calculate_diff(&self.frames[i], &other.frames[j])
            }),
            (left_type, right_type) => {
                return Err(CompareError::MediaTypeMismatch {
                    left: self.path.clone(),
                    left_type,
                    right: other.path.clone(),
                    right_type,
                });
            }
        };

        Ok((1.0 - diff).clamp(0.0, 1.0))
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
    use crate::Icon;
    use crate::core::consts::NUM_PIX;

    /// Neutral chroma: the midpoint of the premultiplied range.
    const GREY: u16 = 32_640;

    /// Icon whose three channels are filled with the given constant values.
    fn icon(y: u16, cb: u16, cr: u16) -> Icon {
        let mut px = vec![0u16; NUM_PIX * 3];
        px[..NUM_PIX].fill(y);
        px[NUM_PIX..2 * NUM_PIX].fill(cb);
        px[2 * NUM_PIX..].fill(cr);
        Icon::from_raw(px, (1, 1))
    }

    fn media(path: &str, media_type: MediaType, frames: Vec<Icon>) -> Media {
        Media {
            path: path.into(),
            size: 0,
            created: None,
            modified: None,
            media_type,
            width: 1,
            height: 1,
            duration: None,
            frames,
        }
    }

    fn image(path: &str, frame: Icon) -> Media {
        media(path, MediaType::Image, vec![frame])
    }

    fn video(path: &str, frames: Vec<Icon>) -> Media {
        media(path, MediaType::Video, frames)
    }

    /// A video that fades from black to white over five frames.
    fn fade() -> Vec<Icon> {
        [0, 16_000, 32_000, 48_000, 65_025].into_iter().map(|y| icon(y, GREY, GREY)).collect()
    }

    #[test]
    fn self_comparison_is_one() {
        let img = image("a.png", icon(12_000, 40_000, 9_000));
        let vid = video("a.mp4", fade());

        assert_eq!(img.similarity(&img).unwrap(), 1.0);
        assert_eq!(vid.similarity(&vid).unwrap(), 1.0);
    }

    #[test]
    fn black_vs_white_rounds_to_zero() {
        let black = image("black.png", icon(0, GREY, GREY));
        let white = image("white.png", icon(65_025, GREY, GREY));

        let score = black.similarity(&white).unwrap();

        assert!((0.0..=1.0).contains(&score));
        assert!(score < 0.000_005, "score {score} does not round to 0");
    }

    #[test]
    fn similar_images_score_higher_than_different_ones() {
        let base = image("a.png", icon(30_000, GREY, GREY));
        let near = image("b.png", icon(31_000, GREY, GREY));
        let far = image("c.png", icon(60_000, 5_000, 60_000));

        assert!(base.similarity(&near).unwrap() > base.similarity(&far).unwrap());
    }

    #[test]
    fn results_are_symmetric() {
        let a = image("a.png", icon(5_000, 12_000, 40_000));
        let b = image("b.png", icon(60_000, 1_000, 25_000));
        assert_eq!(a.similarity(&b).unwrap().to_bits(), b.similarity(&a).unwrap().to_bits());

        let a = video("a.mp4", fade());
        let b = video("b.mp4", vec![icon(9_000, 30_000, 2_000), icon(50_000, GREY, 60_000), icon(20_000, 0, GREY)]);
        assert_eq!(a.similarity(&b).unwrap().to_bits(), b.similarity(&a).unwrap().to_bits());
    }

    #[test]
    fn image_vs_video_is_a_type_mismatch() {
        let img = image("a.png", icon(0, GREY, GREY));
        let vid = video("b.mp4", fade());

        let err = img.similarity(&vid).unwrap_err();
        let CompareError::MediaTypeMismatch { left, left_type, right, right_type } = err;
        assert_eq!((left.to_str(), left_type), (Some("a.png"), MediaType::Image));
        assert_eq!((right.to_str(), right_type), (Some("b.mp4"), MediaType::Video));
    }

    #[test]
    fn video_vs_image_is_a_type_mismatch() {
        let img = image("a.png", icon(0, GREY, GREY));
        let vid = video("b.mp4", fade());

        let err = vid.similarity(&img).unwrap_err();
        let CompareError::MediaTypeMismatch { left_type, right_type, .. } = err;
        assert_eq!((left_type, right_type), (MediaType::Video, MediaType::Image));
    }

    #[test]
    fn single_frame_videos_equal_their_frame_similarity() {
        let (f1, f2) = (icon(10_000, 20_000, 30_000), icon(40_000, 25_000, 5_000));
        let frames = image("a.png", f1.clone()).similarity(&image("b.png", f2.clone())).unwrap();

        let videos = video("a.mp4", vec![f1]).similarity(&video("b.mp4", vec![f2])).unwrap();

        assert_eq!(videos, frames);
    }

    #[test]
    fn truncated_video_scores_higher_than_unrelated_one() {
        let original = video("a.mp4", fade());
        let truncated = video("b.mp4", fade().into_iter().take(3).collect());
        let unrelated = video("c.mp4", [65_025, 50_000, 20_000].into_iter().map(|y| icon(y, 0, 65_025)).collect());

        let trimmed = original.similarity(&truncated).unwrap();
        let other = original.similarity(&unrelated).unwrap();

        assert!((0.0..=1.0).contains(&trimmed) && (0.0..=1.0).contains(&other));
        assert!(trimmed > other, "trimmed {trimmed} <= unrelated {other}");
    }
}
