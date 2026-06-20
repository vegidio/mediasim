//! Constants used by the icon pipeline and [`euc_metric`](super::euc_metric).

/// Final icon side length in pixels.
pub const ICON_SIZE: usize = 11;

/// Resampling rate: source pixels per large-icon pixel side.
pub const SAMPLES: usize = 12;

/// Number of pixels in a single icon channel.
pub const NUM_PIX: usize = ICON_SIZE * ICON_SIZE;

/// Intermediate large-icon side length.
pub const LARGE_ICON_SIZE: usize = ICON_SIZE * 2 + 1;

/// Intermediate resize target side length.
pub const RESIZED_IMG_SIZE: usize = LARGE_ICON_SIZE * SAMPLES;

/// Reciprocal of a sample block's pixel count, `1 / (SAMPLES * SAMPLES)`.
pub const INV_SAMPLE_PIXELS2: f64 = 1.0 / 144.0;

/// Reciprocal of a 3×3 box.
pub const ONE_NINTH: f64 = 1.0 / 9.0;

/// Reciprocal of 255, used to decode the 255-premultiplied storage.
pub const ONE_255TH: f64 = 1.0 / 255.0;

/// Square of [`ONE_255TH`]; the Euclidean-distance scale factor.
///
/// Defined as the product (not `1 / 65025`) to preserve the exact evaluation order.
pub const ONE_255TH2: f64 = ONE_255TH * ONE_255TH;

/// Maximum premultiplied channel value, i.e. `255 * 255`.
pub const SQ255: f64 = 255.0 * 255.0;

/// Maximum Euclidean distance between two icons.
pub const MAX_EUC_DIFF: f64 = 2805.0000001658486;
