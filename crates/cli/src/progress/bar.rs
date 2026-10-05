//! A progress bar whose filled cells run through a colour gradient.

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::Color;
use ratatui::widgets::Widget;

const GRADIENT_START: (u8, u8, u8) = (0x5a, 0x56, 0xe0);
const GRADIENT_END: (u8, u8, u8) = (0xee, 0x6f, 0xf8);
const EMPTY: Color = Color::Rgb(0x60, 0x60, 0x60);

const FILLED_SYMBOL: &str = "█";
const EMPTY_SYMBOL: &str = "░";

/// Fills `position` (0 to 1) of its area with `█`, coloured from start to end across the full bar width, and the
/// rest with `░`. Without colour, only the symbols show the progress.
#[derive(Debug)]
pub struct GradientBar {
    pub position: f64,
    pub color: bool,
}

impl Widget for GradientBar {
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    fn render(self, area: Rect, buf: &mut Buffer) {
        let width = area.width;
        let filled = (self.position.clamp(0.0, 1.0) * f64::from(width)).round() as u16;

        for i in 0..width {
            let (symbol, color) = if i < filled {
                (FILLED_SYMBOL, gradient(f64::from(i) / f64::from(width.saturating_sub(1).max(1))))
            } else {
                (EMPTY_SYMBOL, EMPTY)
            };
            buf[(area.x + i, area.y)].set_symbol(symbol).set_style(super::fg(color, self.color));
        }
    }
}

/// The gradient colour at `t` (0 to 1), by linear interpolation in RGB.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn gradient(t: f64) -> Color {
    let lerp = |a: u8, b: u8| (f64::from(a) + (f64::from(b) - f64::from(a)) * t).round() as u8;
    let ((r1, g1, b1), (r2, g2, b2)) = (GRADIENT_START, GRADIENT_END);
    Color::Rgb(lerp(r1, r2), lerp(g1, g2), lerp(b1, b2))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WIDTH: u16 = 20;

    fn render(position: f64, color: bool) -> Buffer {
        let area = Rect::new(0, 0, WIDTH, 1);
        let mut buf = Buffer::empty(area);
        GradientBar { position, color }.render(area, &mut buf);
        buf
    }

    fn count(buf: &Buffer, symbol: &str) -> usize {
        buf.content().iter().filter(|cell| cell.symbol() == symbol).count()
    }

    #[test]
    fn filled_and_empty_cells() {
        for (position, filled) in [(0.0, 0), (0.5, 10), (1.0, 20)] {
            let buf = render(position, true);

            assert_eq!(count(&buf, FILLED_SYMBOL), filled, "at {position}");
            assert_eq!(count(&buf, EMPTY_SYMBOL), usize::from(WIDTH) - filled, "at {position}");
        }
    }

    #[test]
    fn gradient_runs_from_start_to_end() {
        let buf = render(1.0, true);

        assert_eq!(buf[(0, 0)].fg, Color::Rgb(0x5a, 0x56, 0xe0));
        assert_eq!(buf[(WIDTH - 1, 0)].fg, Color::Rgb(0xee, 0x6f, 0xf8));
    }

    #[test]
    fn empty_cells_are_gray() {
        let buf = render(0.5, true);

        assert_eq!(buf[(WIDTH - 1, 0)].fg, EMPTY);
    }

    #[test]
    fn without_color_cells_keep_the_default() {
        let buf = render(0.5, false);

        assert!(buf.content().iter().all(|cell| cell.fg == Color::Reset));
    }
}
