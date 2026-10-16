//! How an image's stored pixels must be turned to stand upright, as its file declares: an EXIF orientation for JPEG,
//! PNG and TIFF, or the `irot`/`imir` transforms of an AVIF's primary item.
//!
//! The decoders behind `rust_sak::image` return pixels as stored and leave this to the caller.

use std::io::Cursor;

use image::ImageReader;
use image::metadata::Orientation;
use rust_sak::image::ImageFormat;

/// How the image encoded in `bytes` must be turned to stand upright, or [`Orientation::NoTransforms`] when its file
/// declares nothing or can't be read.
///
/// HEIF is decoded upright by libheif already, and BMP, GIF and WebP are taken as stored.
pub(super) fn orientation(bytes: &[u8]) -> Orientation {
    match ImageFormat::from_magic(bytes) {
        Some(ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::Tiff) => exif_orientation(bytes),
        Some(ImageFormat::Avif) => heif_transforms(bytes).unwrap_or(Orientation::NoTransforms),
        _ => Orientation::NoTransforms,
    }
}

/// The EXIF orientation the `image` crate reads from `bytes`, which only parses the headers.
fn exif_orientation(bytes: &[u8]) -> Orientation {
    ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|reader| reader.into_decoder().ok())
        .and_then(|mut decoder| image::ImageDecoder::orientation(&mut decoder).ok())
        .unwrap_or(Orientation::NoTransforms)
}

/// The `irot` and `imir` properties of the primary item of the ISO-BMFF file in `bytes`, composed in the order its
/// `ipma` lists them, or `None` if the boxes that say so are missing or malformed.
fn heif_transforms(bytes: &[u8]) -> Option<Orientation> {
    let meta = full_box_payload(find_box(bytes, *b"meta")?)?;
    let primary = primary_item(find_box(meta, *b"pitm")?)?;
    let iprp = find_box(meta, *b"iprp")?;
    let properties: Vec<_> = boxes(find_box(iprp, *b"ipco")?).collect();
    let indices = associations(find_box(iprp, *b"ipma")?, primary)?;

    let mut turn = Turn::default();
    for index in indices {
        // Indices count from 1; 0 means no property.
        let Some(&(kind, payload)) = index.checked_sub(1).and_then(|i| properties.get(i)) else {
            continue;
        };
        match &kind {
            // The angle is in anticlockwise quarter turns.
            b"irot" => turn = turn.rotate_cw(4 - (*payload.first()? & 0b11)),
            // Axis 0 mirrors about the vertical axis, a left-right flip; axis 1 about the horizontal one.
            b"imir" => turn = if payload.first()? & 1 == 0 { turn.flip_h() } else { turn.flip_v() },
            _ => {}
        }
    }

    Some(turn.into())
}

/// The ID `pitm` names as the primary item.
fn primary_item(pitm: &[u8]) -> Option<u32> {
    let version = *pitm.first()?;
    let id = pitm.get(4..)?;

    if version == 0 { read_u16(id).map(u32::from) } else { read_u32(id) }
}

/// The property indices `ipma` associates with `item`, in the order it lists them.
fn associations(ipma: &[u8], item: u32) -> Option<Vec<usize>> {
    let version = *ipma.first()?;
    let wide_index = ipma.get(3)? & 1 == 1;
    let mut rest = ipma.get(4..)?;
    let count = read_u32(rest)?;
    rest = rest.get(4..)?;

    for _ in 0..count {
        let (id, after) = if version < 1 {
            (u32::from(read_u16(rest)?), rest.get(2..)?)
        } else {
            (read_u32(rest)?, rest.get(4..)?)
        };
        let associated = usize::from(*after.first()?);
        let width = if wide_index { 2 } else { 1 };
        let entries = after.get(1..1 + associated * width)?;
        rest = after.get(1 + associated * width..)?;

        if id == item {
            // The top bit of each entry marks the property essential; the rest is its index.
            let indices = entries
                .chunks_exact(width)
                .map(|entry| match *entry {
                    [high, low] => usize::from(u16::from_be_bytes([high, low]) & 0x7FFF),
                    [byte] => usize::from(byte & 0x7F),
                    _ => 0,
                })
                .collect();
            return Some(indices);
        }
    }

    Some(Vec::new())
}

/// The payload of the first box of `kind` among those that make up `bytes`.
fn find_box(bytes: &[u8], kind: [u8; 4]) -> Option<&[u8]> {
    boxes(bytes).find(|(found, _)| *found == kind).map(|(_, payload)| payload)
}

/// A full box's payload past its version and flags.
fn full_box_payload(payload: &[u8]) -> Option<&[u8]> {
    payload.get(4..)
}

/// The boxes that make up `bytes`, as each one's type and payload, up to the first that is malformed.
fn boxes(mut bytes: &[u8]) -> impl Iterator<Item = ([u8; 4], &[u8])> {
    std::iter::from_fn(move || {
        let size = read_u32(bytes)?;
        let kind: [u8; 4] = bytes.get(4..8)?.try_into().ok()?;
        let (header, size) = match size {
            // Extends to the end of the enclosing data.
            0 => (8, bytes.len()),
            // The real size follows the type, as 64 bits.
            1 => (16, usize::try_from(u64::from_be_bytes(bytes.get(8..16)?.try_into().ok()?)).ok()?),
            size => (8, usize::try_from(size).ok()?),
        };
        let payload = bytes.get(header..size)?;
        bytes = &bytes[size..];

        Some((kind, payload))
    })
}

fn read_u16(bytes: &[u8]) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(..2)?.try_into().ok()?))
}

fn read_u32(bytes: &[u8]) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(..4)?.try_into().ok()?))
}

/// One of the 8 orientations, as `image` applies them: turned clockwise by `quarters`, then flipped left to right
/// if `flipped`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct Turn {
    quarters: u8,
    flipped: bool,
}

impl Turn {
    /// This, then a clockwise turn by `quarters`. Turning a flipped picture clockwise is turning the unflipped one
    /// anticlockwise before the flip.
    fn rotate_cw(self, quarters: u8) -> Self {
        let quarters = if self.flipped { self.quarters + 4 - quarters % 4 } else { self.quarters + quarters };
        Self { quarters: quarters % 4, ..self }
    }

    /// This, then a left-right flip.
    fn flip_h(self) -> Self {
        Self { flipped: !self.flipped, ..self }
    }

    /// This, then a top-bottom flip: a half turn and a left-right flip, which commute.
    fn flip_v(self) -> Self {
        Self { quarters: (self.quarters + 2) % 4, flipped: !self.flipped }
    }
}

impl From<Turn> for Orientation {
    fn from(turn: Turn) -> Self {
        match (turn.quarters, turn.flipped) {
            (1, false) => Orientation::Rotate90,
            (2, false) => Orientation::Rotate180,
            (3, false) => Orientation::Rotate270,
            (0, true) => Orientation::FlipHorizontal,
            (1, true) => Orientation::Rotate90FlipH,
            (2, true) => Orientation::FlipVertical,
            (3, true) => Orientation::Rotate270FlipH,
            _ => Orientation::NoTransforms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A box of `kind` around `payload`.
    fn bmff(kind: [u8; 4], payload: &[u8]) -> Vec<u8> {
        let size = u32::try_from(8 + payload.len()).unwrap();
        [&size.to_be_bytes()[..], &kind, payload].concat()
    }

    /// A full box of `kind`, version 0 with no flags, around `payload`.
    fn full(kind: [u8; 4], payload: &[u8]) -> Vec<u8> {
        bmff(kind, &[&[0, 0, 0, 0][..], payload].concat())
    }

    /// An AVIF header whose primary item is 1, with `properties` in `ipco` and item `item` associated with the
    /// 1-based `indices` among them.
    fn avif(properties: &[Vec<u8>], item: u16, indices: &[u8]) -> Vec<u8> {
        let ipco = bmff(*b"ipco", &properties.concat());
        let ipma_entry = [&item.to_be_bytes()[..], &[u8::try_from(indices.len()).unwrap()], indices].concat();
        let ipma = full(*b"ipma", &[&1u32.to_be_bytes()[..], &ipma_entry].concat());
        let iprp = bmff(*b"iprp", &[ipco, ipma].concat());
        let pitm = full(*b"pitm", &1u16.to_be_bytes());
        let meta = full(*b"meta", &[pitm, iprp].concat());
        let ftyp = bmff(*b"ftyp", b"avif\0\0\0\0avifmif1");

        [ftyp, meta].concat()
    }

    fn irot(angle: u8) -> Vec<u8> {
        bmff(*b"irot", &[angle])
    }

    fn imir(axis: u8) -> Vec<u8> {
        bmff(*b"imir", &[axis])
    }

    fn ispe() -> Vec<u8> {
        full(*b"ispe", &[0, 0, 0, 10, 0, 0, 0, 20])
    }

    #[test]
    fn an_avif_without_transforms_needs_none() {
        assert_eq!(orientation(&avif(&[ispe()], 1, &[1])), Orientation::NoTransforms);
    }

    #[test]
    fn irot_turns_anticlockwise() {
        let cases = [
            (0, Orientation::NoTransforms),
            (1, Orientation::Rotate270),
            (2, Orientation::Rotate180),
            (3, Orientation::Rotate90),
        ];
        for (angle, expected) in cases {
            assert_eq!(orientation(&avif(&[ispe(), irot(angle)], 1, &[1, 2])), expected, "irot {angle}");
        }
    }

    #[test]
    fn imir_flips_about_its_axis() {
        assert_eq!(orientation(&avif(&[imir(0)], 1, &[1])), Orientation::FlipHorizontal);
        assert_eq!(orientation(&avif(&[imir(1)], 1, &[1])), Orientation::FlipVertical);
    }

    #[test]
    fn irot_then_imir_compose_in_ipma_order() {
        // A clockwise quarter turn, then a left-right flip.
        assert_eq!(orientation(&avif(&[irot(3), imir(0)], 1, &[1, 2])), Orientation::Rotate90FlipH);
        // A left-right flip, then a clockwise quarter turn: the same as an anticlockwise turn, then the flip.
        assert_eq!(orientation(&avif(&[irot(3), imir(0)], 1, &[2, 1])), Orientation::Rotate270FlipH);
        // A clockwise quarter turn, then a top-bottom flip.
        assert_eq!(orientation(&avif(&[irot(3), imir(1)], 1, &[1, 2])), Orientation::Rotate270FlipH);
    }

    #[test]
    fn an_essential_marker_does_not_change_the_index() {
        assert_eq!(orientation(&avif(&[ispe(), irot(3)], 1, &[1, 0x82])), Orientation::Rotate90);
    }

    #[test]
    fn properties_of_another_item_are_ignored() {
        assert_eq!(orientation(&avif(&[irot(3)], 2, &[1])), Orientation::NoTransforms);
    }

    #[test]
    fn truncated_or_garbage_input_needs_no_transforms() {
        let whole = avif(&[ispe(), irot(3)], 1, &[1, 2]);
        for len in 0..whole.len() {
            // Must not panic, whatever it answers.
            let _ = orientation(&whole[..len]);
        }
        assert_eq!(orientation(b"not an image"), Orientation::NoTransforms);
    }

    /// A step of [`Turn`]'s, named, with the `image` transform it should match.
    type Step = (&'static str, fn(Turn) -> Turn, fn(&image::DynamicImage) -> image::DynamicImage);

    #[test]
    fn every_turn_maps_to_the_orientation_that_applies_it() {
        // Turning a 3×2 picture and comparing pixels checks the composition against `image`'s own transforms.
        let source = image::DynamicImage::ImageLuma8(image::GrayImage::from_raw(3, 2, vec![1, 2, 3, 4, 5, 6]).unwrap());
        let steps: [Step; 3] = [
            ("rotate", |t| t.rotate_cw(1), image::DynamicImage::rotate90),
            ("flip_h", Turn::flip_h, image::DynamicImage::fliph),
            ("flip_v", Turn::flip_v, image::DynamicImage::flipv),
        ];

        for quarters in 0..4 {
            for flipped in [false, true] {
                let turn = Turn { quarters, flipped };
                let mut start = source.clone();
                start.apply_orientation(turn.into());

                for (name, step, apply) in steps {
                    let mut expected = source.clone();
                    expected.apply_orientation(step(turn).into());
                    assert_eq!(apply(&start), expected, "{turn:?} then {name}");
                }
            }
        }
    }
}
