//! The 8 orientations of a square, applied to an [`Icon`] by moving its pixels.
//!
//! Every step of the icon pipeline is symmetric under these moves, so orienting an icon gives close to the icon of the
//! oriented image, without decoding or resizing anything again.

use super::consts::ICON_SIZE;
use super::icon::{Icon, arr_index};

/// One of the 8 symmetries of a square: the identity, two flips, three rotations and two diagonal mirrors.
///
/// Rotations are clockwise, as `image::imageops::rotate90` turns an image. With `x` to the right and `y` down, each
/// one moves the pixel at `(x, y)` of an `n × n` icon to:
///
/// | orientation     | target                 |
/// |-----------------|------------------------|
/// | `Identity`      | `(x, y)`               |
/// | `FlipH`         | `(n-1-x, y)`           |
/// | `FlipV`         | `(x, n-1-y)`           |
/// | `Rotate90`      | `(n-1-y, x)`           |
/// | `Rotate180`     | `(n-1-x, n-1-y)`       |
/// | `Rotate270`     | `(y, n-1-x)`           |
/// | `Transpose`     | `(y, x)`               |
/// | `AntiTranspose` | `(n-1-y, n-1-x)`       |
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Orientation {
    Identity,
    FlipH,
    FlipV,
    Rotate90,
    Rotate180,
    Rotate270,
    /// The mirror across the main diagonal, `FlipH` followed by `Rotate270`.
    Transpose,
    /// The mirror across the anti-diagonal, `FlipH` followed by `Rotate90`.
    AntiTranspose,
}

impl Orientation {
    /// All 8 orientations, the identity first.
    pub(crate) const ALL: [Orientation; 8] = [
        Orientation::Identity,
        Orientation::FlipH,
        Orientation::FlipV,
        Orientation::Rotate90,
        Orientation::Rotate180,
        Orientation::Rotate270,
        Orientation::Transpose,
        Orientation::AntiTranspose,
    ];

    /// Where this orientation moves the pixel at `(x, y)`.
    const fn target(self, x: usize, y: usize) -> (usize, usize) {
        const LAST: usize = ICON_SIZE - 1;
        match self {
            Self::Identity => (x, y),
            Self::FlipH => (LAST - x, y),
            Self::FlipV => (x, LAST - y),
            Self::Rotate90 => (LAST - y, x),
            Self::Rotate180 => (LAST - x, LAST - y),
            Self::Rotate270 => (y, LAST - x),
            Self::Transpose => (y, x),
            Self::AntiTranspose => (LAST - y, LAST - x),
        }
    }

    /// Returns `icon` in this orientation.
    #[cfg(test)]
    pub(crate) fn apply(self, icon: &Icon) -> Icon {
        let mut oriented = icon.clone();
        self.apply_into(icon, &mut oriented);
        oriented
    }

    /// Writes `icon` in this orientation into `out`, reusing its buffer.
    pub(crate) fn apply_into(self, icon: &Icon, out: &mut Icon) {
        let (src, dst) = (icon.pixels(), out.pixels_mut());
        for ch in 0..3 {
            for y in 0..ICON_SIZE {
                for x in 0..ICON_SIZE {
                    let (tx, ty) = self.target(x, y);
                    dst[arr_index(tx, ty, ICON_SIZE, ch)] = src[arr_index(x, y, ICON_SIZE, ch)];
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::consts::NUM_PIX;

    /// An icon that is `0` everywhere except at `(x, y)`, which holds `1`, `2` and `3` in the three channels.
    fn marked(x: usize, y: usize) -> Icon {
        let mut pixels = vec![0u16; NUM_PIX * 3];
        for ch in 0..3 {
            pixels[arr_index(x, y, ICON_SIZE, ch)] = u16::try_from(ch + 1).unwrap();
        }
        Icon::from_raw(pixels)
    }

    /// An icon with a different value in every pixel of every channel, so no orientation but the identity keeps it.
    fn asymmetric() -> Icon {
        Icon::from_raw((0..NUM_PIX * 3).map(|i| u16::try_from(i).unwrap()).collect())
    }

    fn inverse(o: Orientation) -> Orientation {
        match o {
            Orientation::Rotate90 => Orientation::Rotate270,
            Orientation::Rotate270 => Orientation::Rotate90,
            other => other,
        }
    }

    #[test]
    fn each_orientation_moves_a_marked_pixel_in_every_channel() {
        // (2, 1) on an 11×11 icon; the last index is 10.
        for (o, (tx, ty)) in [
            (Orientation::Identity, (2, 1)),
            (Orientation::FlipH, (8, 1)),
            (Orientation::FlipV, (2, 9)),
            (Orientation::Rotate90, (9, 2)),
            (Orientation::Rotate180, (8, 9)),
            (Orientation::Rotate270, (1, 8)),
            (Orientation::Transpose, (1, 2)),
            (Orientation::AntiTranspose, (9, 8)),
        ] {
            assert_eq!(o.apply(&marked(2, 1)), marked(tx, ty), "{o:?}");
        }
    }

    #[test]
    fn only_the_identity_keeps_an_asymmetric_icon() {
        let icon = asymmetric();
        for o in Orientation::ALL {
            assert_eq!(o.apply(&icon) == icon, o == Orientation::Identity, "{o:?}");
        }
    }

    #[test]
    fn every_orientation_undone_by_its_inverse_is_the_identity() {
        let icon = asymmetric();
        for o in Orientation::ALL {
            assert_eq!(inverse(o).apply(&o.apply(&icon)), icon, "{o:?}");
        }
    }

    #[test]
    fn flip_then_rotate_is_a_diagonal_mirror() {
        let icon = asymmetric();
        let flipped_then_rotated = Orientation::Rotate90.apply(&Orientation::FlipH.apply(&icon));

        assert_eq!(flipped_then_rotated, Orientation::AntiTranspose.apply(&icon));
        assert_eq!(
            Orientation::Rotate270.apply(&Orientation::FlipH.apply(&icon)),
            Orientation::Transpose.apply(&icon)
        );
    }

    #[test]
    fn oriented_icon_is_close_to_the_icon_of_the_oriented_image() {
        use image::imageops;

        use crate::core::diff::calculate_diff;
        use crate::media::tests::fixture;

        // A non-square fixture, so the rotations also check that squashing to a square commutes with them.
        let img = rust_sak::image::decode_file(fixture("test1.avif")).unwrap().to_rgba8();
        let icon = Icon::from_image(&img);

        let mut worst = 0.0_f64;
        for o in Orientation::ALL {
            let oriented_img = match o {
                Orientation::Identity => img.clone(),
                Orientation::FlipH => imageops::flip_horizontal(&img),
                Orientation::FlipV => imageops::flip_vertical(&img),
                Orientation::Rotate90 => imageops::rotate90(&img),
                Orientation::Rotate180 => imageops::rotate180(&img),
                Orientation::Rotate270 => imageops::rotate270(&img),
                Orientation::Transpose => imageops::rotate270(&imageops::flip_horizontal(&img)),
                Orientation::AntiTranspose => imageops::rotate90(&imageops::flip_horizontal(&img)),
            };

            worst = worst.max(calculate_diff(&Icon::from_image(&oriented_img), &o.apply(&icon)));
        }

        // The centred resample is symmetric except where a sample falls on a pixel boundary, which only happens along
        // the image's width here. Observed: 0 for `Identity`, `FlipV`, `Rotate90` and `Transpose`, and a maximum of
        // 0.000617 for `FlipH`, `Rotate180`, `Rotate270` and `AntiTranspose`.
        assert!(worst < 0.002, "worst diff {worst}");
    }

    #[test]
    fn apply_into_overwrites_a_reused_buffer() {
        let icon = asymmetric();
        let mut out = marked(0, 0);
        for o in Orientation::ALL {
            o.apply_into(&icon, &mut out);
            assert_eq!(out, o.apply(&icon), "{o:?}");
        }
    }
}
