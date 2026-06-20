//! Icon generation: decode an image, nearest-neighbour resize it, average it down to a large RGB icon,
//! then box-blur to the final 11×11 YCbCr signature.
//!
//! An [`Icon`] is a compact 11×11 visual signature stored as `u16` values in three channels (Y, Cb, Cr),
//! each value 255-premultiplied (range `[0, 65025]`).

// The pipeline relies on intentional truncating/lossy casts to reproduce the reference's fixed-point
// arithmetic exactly.
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss
)]

use std::fmt;
use std::path::Path;

use image::DynamicImage;

use super::consts::{
    ICON_SIZE, INV_SAMPLE_PIXELS2, LARGE_ICON_SIZE, NUM_PIX, ONE_255TH, ONE_NINTH, RESIZED_IMG_SIZE, SAMPLES, SQ255,
};

/// A square image signature.
///
/// Pixels are laid out channel-major: channel `ch` of point `(x, y)` lives at index
/// `size * (ch * size + y) + x`. Channels are YCbCr (not RGB), each value premultiplied by 255 to preserve
/// colour relationships from the source image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Icon {
    pixels: Vec<u16>,
    img_size: (u32, u32),
}

impl Icon {
    /// Generates a normalized icon from an already-decoded image.
    ///
    /// Builds the non-normalized icon, then stretches each channel's histogram for maximum contrast.
    #[must_use]
    pub fn from_image(img: &DynamicImage) -> Self {
        let mut icon = icon_nn(img);
        normalize(&mut icon.pixels);
        icon
    }

    /// Opens, decodes, and converts an image file into an [`Icon`].
    ///
    /// # Errors
    ///
    /// Returns an [`IconError`] if the file cannot be read or decoded.
    pub fn from_path(path: impl AsRef<Path>) -> Result<Self, IconError> {
        let img = image::open(path)?;
        Ok(Self::from_image(&img))
    }

    /// The original (pre-resize) image dimensions as `(width, height)`.
    #[must_use]
    pub fn img_size(&self) -> (u32, u32) {
        self.img_size
    }

    /// The raw channel-major pixel buffer (`3 * ICON_SIZE * ICON_SIZE` values).
    pub(crate) fn pixels(&self) -> &[u16] {
        &self.pixels
    }

    /// Builds an [`Icon`] directly from a raw channel-major pixel buffer.
    ///
    /// Test-only: lets the metric/diff unit tests construct icons with exact, hand-picked pixel values
    /// without going through the full decode pipeline.
    #[cfg(test)]
    pub(crate) fn from_raw(pixels: Vec<u16>, img_size: (u32, u32)) -> Self {
        assert_eq!(pixels.len(), NUM_PIX * 3, "icon buffer must hold 3 channels of NUM_PIX values");
        Self { pixels, img_size }
    }
}

/// Error returned when an image cannot be loaded into an [`Icon`].
#[derive(Debug)]
pub struct IconError(image::ImageError);

impl fmt::Display for IconError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "failed to load image: {}", self.0)
    }
}

impl std::error::Error for IconError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
    }
}

impl From<image::ImageError> for IconError {
    fn from(err: image::ImageError) -> Self {
        Self(err)
    }
}

/// Maps a 2D point and channel to a 1D index in the channel-major pixel buffer.
const fn arr_index(x: usize, y: usize, size: usize, ch: usize) -> usize {
    size * (ch * size + y) + x
}

/// Writes the three channel values at `(x, y)`, encoding floats as 255-premultiplied `u16`
/// (`(c * 255) as u16`, truncating toward zero).
fn set(pixels: &mut [u16], size: usize, x: usize, y: usize, c1: f64, c2: f64, c3: f64) {
    pixels[arr_index(x, y, size, 0)] = (c1 * 255.0) as u16;
    pixels[arr_index(x, y, size, 1)] = (c2 * 255.0) as u16;
    pixels[arr_index(x, y, size, 2)] = (c3 * 255.0) as u16;
}

/// Reads the three channel values at `(x, y)`, decoding the 255-premultiplied storage back to floats.
fn get(pixels: &[u16], size: usize, x: usize, y: usize) -> (f64, f64, f64) {
    (
        f64::from(pixels[arr_index(x, y, size, 0)]) * ONE_255TH,
        f64::from(pixels[arr_index(x, y, size, 1)]) * ONE_255TH,
        f64::from(pixels[arr_index(x, y, size, 2)]) * ONE_255TH,
    )
}

/// High-precision RGB→YCbCr transform operating on floats.
fn y_cbcr(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let yc = 0.299_000 * r + 0.587_000 * g + 0.114_000 * b;
    let cb = 128.0 - 0.168_736 * r - 0.331_264 * g + 0.500_000 * b;
    let cr = 128.0 + 0.500_000 * r - 0.418_688 * g - 0.081_312 * b;
    (yc, cb, cr)
}

/// Converts a straight-alpha 8-bit channel value to its alpha-premultiplied 8-bit form:
/// `((c | c << 8) * a) / 255`, then `>> 8`. For opaque pixels (`a == 255`) this is the identity, returning
/// `c` unchanged.
const fn rgba_8bit(c: u8, a: u8) -> u32 {
    let mut v = c as u32;
    v |= v << 8;
    v *= a as u32;
    v /= 0xff;
    v >> 8
}

/// Builds the non-normalized icon.
fn icon_nn(img: &DynamicImage) -> Icon {
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    // --- Nearest-neighbour resize to RESIZED_IMG_SIZE². ---
    // Stored row-major as 8-bit (premultiplied) RGB; a second premultiplied read would be the identity on
    // these opaque 8-bit values, so it is folded away here.
    let x_scale = f64::from(width) / RESIZED_IMG_SIZE as f64;
    let y_scale = f64::from(height) / RESIZED_IMG_SIZE as f64;
    let mut resized = vec![[0u8; 3]; RESIZED_IMG_SIZE * RESIZED_IMG_SIZE];
    for y in 0..RESIZED_IMG_SIZE {
        let sy = (y as f64 * y_scale) as u32;
        for x in 0..RESIZED_IMG_SIZE {
            let sx = (x as f64 * x_scale) as u32;
            let px = rgba.get_pixel(sx, sy).0;
            let a = px[3];
            resized[y * RESIZED_IMG_SIZE + x] = [
                rgba_8bit(px[0], a) as u8,
                rgba_8bit(px[1], a) as u8,
                rgba_8bit(px[2], a) as u8,
            ];
        }
    }

    // --- Large icon: average each SAMPLES×SAMPLES block (still RGB). ---
    let mut large = vec![0u16; LARGE_ICON_SIZE * LARGE_ICON_SIZE * 3];
    for x in 0..LARGE_ICON_SIZE {
        for y in 0..LARGE_ICON_SIZE {
            let (mut sum_r, mut sum_g, mut sum_b) = (0u32, 0u32, 0u32);
            for m in 0..SAMPLES {
                for n in 0..SAMPLES {
                    let col = x * SAMPLES + m;
                    let row = y * SAMPLES + n;
                    let px = resized[row * RESIZED_IMG_SIZE + col];
                    sum_r += u32::from(px[0]);
                    sum_g += u32::from(px[1]);
                    sum_b += u32::from(px[2]);
                }
            }
            set(
                &mut large,
                LARGE_ICON_SIZE,
                x,
                y,
                f64::from(sum_r) * INV_SAMPLE_PIXELS2,
                f64::from(sum_g) * INV_SAMPLE_PIXELS2,
                f64::from(sum_b) * INV_SAMPLE_PIXELS2,
            );
        }
    }

    // --- Box blur (3×3, stride 2) down to the final icon, converting to YCbCr. ---
    let mut pixels = vec![0u16; NUM_PIX * 3];
    for x in (1..LARGE_ICON_SIZE - 1).step_by(2) {
        let xd = x / 2;
        for y in (1..LARGE_ICON_SIZE - 1).step_by(2) {
            let yd = y / 2;
            let (mut s1, mut s2, mut s3) = (0.0, 0.0, 0.0);
            // 3×3 neighbourhood; `n`/`m` range 0..3 map to offsets -1, 0, +1 on x/y respectively
            // (x, y >= 1, so no underflow).
            for n in 0..3 {
                for m in 0..3 {
                    let (c1, c2, c3) = get(&large, LARGE_ICON_SIZE, x - 1 + n, y - 1 + m);
                    s1 += c1;
                    s2 += c2;
                    s3 += c3;
                }
            }
            let (yc, cb, cr) = y_cbcr(s1 * ONE_NINTH, s2 * ONE_NINTH, s3 * ONE_NINTH);
            set(&mut pixels, ICON_SIZE, xd, yd, yc, cb, cr);
        }
    }

    Icon {
        pixels,
        img_size: (width, height),
    }
}

/// Stretches each channel's histogram so its min/max map to `0` / `65025`.
fn normalize(pixels: &mut [u16]) {
    let mut mins = [u16::MAX; 3];
    let mut maxs = [0u16; 3];

    for n in 0..NUM_PIX {
        for ch in 0..3 {
            let v = pixels[n + ch * NUM_PIX];
            if v > maxs[ch] {
                maxs[ch] = v;
            }
            if v < mins[ch] {
                mins[ch] = v;
            }
        }
    }

    for ch in 0..3 {
        if maxs[ch] != mins[ch] {
            let scale = SQ255 / (f64::from(maxs[ch]) - f64::from(mins[ch]));
            let min = f64::from(mins[ch]);
            for n in 0..NUM_PIX {
                let idx = n + ch * NUM_PIX;
                pixels[idx] = ((f64::from(pixels[idx]) - min) * scale) as u16;
            }
        }
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgb, RgbImage, Rgba, RgbaImage};

    /// A solid-colour opaque RGB image. Every pixel is identical, so the whole icon pipeline collapses to a
    /// single, hand-computable value per channel.
    fn solid(r: u8, g: u8, b: u8) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_pixel(32, 32, Rgb([r, g, b])))
    }

    #[test]
    fn arr_index_is_channel_major() {
        // Layout: size * (ch * size + y) + x.
        assert_eq!(arr_index(0, 0, ICON_SIZE, 0), 0);
        assert_eq!(arr_index(1, 0, ICON_SIZE, 0), 1);
        assert_eq!(arr_index(0, 1, ICON_SIZE, 0), ICON_SIZE);
        // Each channel is a NUM_PIX-sized block.
        assert_eq!(arr_index(0, 0, ICON_SIZE, 1), NUM_PIX);
        assert_eq!(arr_index(0, 0, ICON_SIZE, 2), 2 * NUM_PIX);
        assert_eq!(arr_index(ICON_SIZE - 1, ICON_SIZE - 1, ICON_SIZE, 2), 3 * NUM_PIX - 1);
    }

    #[test]
    fn rgba_8bit_is_identity_when_opaque() {
        for c in [0u8, 1, 127, 200, 255] {
            assert_eq!(rgba_8bit(c, 255), u32::from(c));
        }
    }

    #[test]
    fn rgba_8bit_zero_alpha_is_zero() {
        assert_eq!(rgba_8bit(200, 0), 0);
        assert_eq!(rgba_8bit(255, 0), 0);
    }

    #[test]
    fn rgba_8bit_premultiplies() {
        // ((255 | 255<<8) * 128) / 255 >> 8 == 128.
        assert_eq!(rgba_8bit(255, 128), 128);
    }

    #[test]
    fn y_cbcr_known_values() {
        let approx = |a: f64, b: f64| (a - b).abs() < 1e-9;
        // Greyscale maps luma to the input and leaves both chroma channels centred at 128.
        let (y, cb, cr) = y_cbcr(0.0, 0.0, 0.0);
        assert!(approx(y, 0.0) && approx(cb, 128.0) && approx(cr, 128.0));
        let (y, cb, cr) = y_cbcr(255.0, 255.0, 255.0);
        assert!(approx(y, 255.0) && approx(cb, 128.0) && approx(cr, 128.0));
        let (y, cb, cr) = y_cbcr(128.0, 128.0, 128.0);
        assert!(approx(y, 128.0) && approx(cb, 128.0) && approx(cr, 128.0));
    }

    #[test]
    fn set_get_roundtrip_truncates() {
        let mut px = vec![0u16; NUM_PIX * 3];
        set(&mut px, ICON_SIZE, 0, 0, 1.0, 0.5, 0.0);
        // Stored as (c * 255) as u16: 255, 127 (0.5*255=127.5 truncated), 0.
        assert_eq!(px[arr_index(0, 0, ICON_SIZE, 0)], 255);
        assert_eq!(px[arr_index(0, 0, ICON_SIZE, 1)], 127);
        assert_eq!(px[arr_index(0, 0, ICON_SIZE, 2)], 0);

        let (c1, c2, c3) = get(&px, ICON_SIZE, 0, 0);
        assert_eq!(c1, 1.0);
        assert_eq!(c2, 127.0 * ONE_255TH);
        assert_eq!(c3, 0.0);
    }

    #[test]
    fn normalize_stretches_channel_to_full_range() {
        let mut px = vec![0u16; NUM_PIX * 3];
        // Y channel: a 0..1000 spread; min=0, max=1000 -> scale = 65025 / 1000.
        px[0] = 1000;
        px[5] = 500;
        normalize(&mut px);
        assert_eq!(px[0], 65025); // max -> full
        assert_eq!(px[5], 32512); // 500 * 65.025 = 32512.5 -> 32512
        // Cb/Cr channels were uniformly zero (max == min) and must be left untouched.
        assert!(px[NUM_PIX..].iter().all(|&v| v == 0));
    }

    #[test]
    fn normalize_leaves_flat_channel_untouched() {
        let mut px = vec![7u16; NUM_PIX * 3];
        normalize(&mut px);
        assert!(px.iter().all(|&v| v == 7));
    }

    #[test]
    fn from_image_solid_grey_is_uniform() {
        let icon = Icon::from_image(&solid(128, 128, 128));
        // A flat image leaves normalize a no-op, so every pixel within a channel is identical.
        for ch in 0..3 {
            let chan = &icon.pixels()[ch * NUM_PIX..(ch + 1) * NUM_PIX];
            assert!(chan.iter().all(|&v| v == chan[0]), "channel {ch} not uniform");
            // Neutral grey lands on the channel midpoint (~128 * 255), give or take a rounding LSB.
            assert!(chan[0].abs_diff(32640) <= 1, "channel {ch} = {} not near-neutral", chan[0]);
        }
    }

    #[test]
    fn from_image_solid_black_and_white_luma() {
        let black = Icon::from_image(&solid(0, 0, 0));
        let white = Icon::from_image(&solid(255, 255, 255));

        // Y channel: black -> 0, white -> 65025 (255 * 255), exactly.
        assert!(black.pixels()[..NUM_PIX].iter().all(|&v| v == 0));
        assert!(white.pixels()[..NUM_PIX].iter().all(|&v| v == 65025));
        // Both are neutral greys, so chroma stays centred (~32640) for either — the residual ±1 LSB on
        // Cr is the float RGB->YCbCr rounding, not a real colour difference.
        for &v in &black.pixels()[NUM_PIX..] {
            assert!(v.abs_diff(32640) <= 1);
        }
        for &v in &white.pixels()[NUM_PIX..] {
            assert!(v.abs_diff(32640) <= 1);
        }
    }

    #[test]
    fn from_image_preserves_original_dimensions() {
        let img = DynamicImage::ImageRgb8(RgbImage::from_pixel(64, 48, Rgb([10, 20, 30])));
        assert_eq!(Icon::from_image(&img).img_size(), (64, 48));
    }

    #[test]
    fn fully_transparent_pixels_collapse_to_black() {
        // Alpha 0 premultiplies every channel to 0, regardless of the stored RGB.
        let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(32, 32, Rgba([200, 100, 50, 0])));
        let icon = Icon::from_image(&img);
        let black = Icon::from_image(&solid(0, 0, 0));
        assert_eq!(icon.pixels(), black.pixels());
    }

    #[test]
    fn icon_clone_eq() {
        let icon = Icon::from_image(&solid(12, 34, 56));
        assert_eq!(icon, icon.clone());
    }

    #[test]
    fn from_path_missing_file_errors() {
        let err = Icon::from_path("definitely-not-a-real-file.jpg").unwrap_err();
        assert!(err.to_string().starts_with("failed to load image"));
        assert!(std::error::Error::source(&err).is_some());
    }
}
