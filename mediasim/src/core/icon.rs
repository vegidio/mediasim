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
