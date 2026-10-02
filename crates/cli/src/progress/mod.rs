//! The one-line loading display: `Loading   [1/2]  ██████░░░░░░  50.0%   ETA 4.2s`.
//!
//! It is drawn with ratatui in an inline viewport, so it stays in the normal scrollback instead of taking over the
//! screen, and remains visible after loading ends.

mod bar;
mod eta;
mod spring;

use std::io::{Write, stdout};
use std::sync::mpsc::{self, TryRecvError};
use std::time::{Duration, Instant};

use mediasim::{Media, MediaError, MediaStream};
use ratatui::buffer::Buffer;
use ratatui::crossterm::cursor::{MoveTo, Show};
use ratatui::crossterm::event::{self, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use ratatui::crossterm::execute;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style, Stylize};
use ratatui::text::{Line, Span};
use ratatui::widgets::Widget;
use ratatui::{DefaultTerminal, TerminalOptions, Viewport};

use crate::error::CliError;
use crate::output::{GRAY, GREEN, MAGENTA};
use bar::GradientBar;
use eta::{Eta, format_eta};
use spring::Spring;

const FRAME: Duration = Duration::from_nanos(1_000_000_000 / 60);

/// Once every file has loaded, the bar gets at most this long to finish its animation.
const SETTLE_CAP: Duration = Duration::from_secs(1);

const MAX_BAR_WIDTH: u16 = 50;
const MIN_BAR_WIDTH: u16 = 10;

/// Shows the loading display while `stream` yields `total` results, and returns the loaded media.
///
/// The first error ends loading at once, and Ctrl+C ends it with [`CliError::Interrupted`]. The terminal is
/// restored on every way out, with the display left on screen and the cursor on the line below it.
pub fn run(stream: MediaStream, total: usize, color: bool) -> Result<Vec<Media>, CliError> {
    // `MediaStream` blocks, so a thread forwards it to a channel the frame loop can poll. Once the receiver is dropped,
    // the forwarder's next send fails, which drops the stream and stops any file that has not started loading.
    let (tx, rx) = mpsc::channel::<Result<Media, MediaError>>();
    std::thread::spawn(move || {
        for result in stream {
            if tx.send(result).is_err() {
                break;
            }
        }
    });

    println!();
    let mut session = Session::start()?;
    let started = Instant::now();
    let mut media = Vec::with_capacity(total);
    let mut spring = Spring::default();
    let mut eta = Eta::default();
    let mut finished_at = None;

    loop {
        let frame_started = Instant::now();

        let mut disconnected = false;
        loop {
            match rx.try_recv() {
                Ok(result) => media.push(result?),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            }
        }

        let completed = media.len();
        let finished = disconnected || completed >= total;
        spring.target = if finished { 1.0 } else { fraction(completed, total) };
        spring.step();
        eta.update(if finished { total } else { completed }, total, started.elapsed());

        let finished_at = finished.then(|| *finished_at.get_or_insert_with(Instant::now));
        let done = finished_at.is_some_and(|at| spring.is_settled() || at.elapsed() >= SETTLE_CAP);
        if done {
            spring.snap();
        }

        let line = ProgressLine {
            completed: if finished { total } else { completed },
            total,
            position: spring.position,
            eta: eta.value(),
            color,
        };
        session.draw(line)?;

        if done {
            return Ok(media);
        }

        if event::poll(FRAME.saturating_sub(frame_started.elapsed()))? && is_ctrl_c(&event::read()?) {
            return Err(CliError::Interrupted);
        }
    }
}

fn fraction(completed: usize, total: usize) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    if total == 0 { 1.0 } else { completed as f64 / total as f64 }
}

/// Raw mode turns Ctrl+C into a key press instead of SIGINT, on every platform.
fn is_ctrl_c(event: &Event) -> bool {
    matches!(
        event,
        Event::Key(KeyEvent { code: KeyCode::Char('c'), modifiers, kind: KeyEventKind::Press, .. })
            if modifiers.contains(KeyModifiers::CONTROL)
    )
}

/// The terminal in raw mode with a one-line inline viewport. Dropping it restores the terminal.
struct Session {
    terminal: DefaultTerminal,
    row: Option<u16>,
}

impl Session {
    fn start() -> std::io::Result<Self> {
        let terminal = ratatui::try_init_with_options(TerminalOptions { viewport: Viewport::Inline(1) })?;
        Ok(Self { terminal, row: None })
    }

    fn draw(&mut self, line: ProgressLine) -> std::io::Result<()> {
        // `CompletedFrame::area` is the whole terminal; the frame's own area is the inline viewport.
        self.terminal.draw(|frame| {
            self.row = Some(frame.area().y);
            frame.render_widget(line, frame.area());
        })?;
        Ok(())
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        ratatui::restore();

        // Leave the cursor on the line below the display, so it stays visible above whatever is printed next.
        let mut out = stdout();
        if let Some(row) = self.row {
            let _ = execute!(out, MoveTo(0, row));
        }
        let _ = execute!(out, Show);
        let _ = writeln!(out);
    }
}

/// `Loading   [n/total]  <bar>  xx.x%   ETA …`, with the bar as wide as fits, between 10 and 50 cells.
struct ProgressLine {
    completed: usize,
    total: usize,
    position: f64,
    eta: Option<Duration>,
    color: bool,
}

impl ProgressLine {
    fn style(&self, (r, g, b): (u8, u8, u8)) -> Style {
        if self.color { Style::new().fg(Color::Rgb(r, g, b)) } else { Style::new() }
    }
}

impl Widget for ProgressLine {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let digits = self.total.to_string().len();
        let gray = self.style(GRAY);

        let left = Line::from(vec![
            Span::raw("Loading   "),
            Span::styled("[", gray),
            Span::raw(format!("{:0digits$}", self.completed)).bold(),
            Span::styled("/", gray),
            Span::raw(self.total.to_string()).bold(),
            Span::styled("]", gray),
            Span::raw("  "),
        ]);
        let percent = (fraction(self.completed, self.total) * 1000.0).floor() / 10.0;
        let right = Line::from(vec![
            Span::raw("  "),
            Span::styled(format!("{percent:5.1}%"), self.style(GREEN)),
            Span::raw("   "),
            Span::styled(format!("ETA {}", format_eta(self.eta)), self.style(MAGENTA)),
        ]);

        let left_width = u16::try_from(left.width()).unwrap_or(u16::MAX);
        let right_width = u16::try_from(right.width()).unwrap_or(u16::MAX);
        let bar_width = area
            .width
            .saturating_sub(left_width.saturating_add(right_width))
            .clamp(MIN_BAR_WIDTH, MAX_BAR_WIDTH);

        // Each piece is clipped to `area`, so on a terminal too narrow for the whole line the end is cut off.
        let bar_x = area.x.saturating_add(left_width);
        let right_x = bar_x.saturating_add(bar_width);
        left.render(Rect::new(area.x, area.y, left_width, 1).intersection(area), buf);
        GradientBar { position: self.position, color: self.color }
            .render(Rect::new(bar_x, area.y, bar_width, 1).intersection(area), buf);
        right.render(Rect::new(right_x, area.y, right_width, 1).intersection(area), buf);
    }
}

#[cfg(test)]
mod tests {
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    use super::*;

    fn draw(width: u16, line: ProgressLine) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, 1)).unwrap();
        terminal.draw(|frame| frame.render_widget(line, frame.area())).unwrap();
        terminal.backend().buffer().content().iter().map(ratatui::buffer::Cell::symbol).collect()
    }

    fn half_loaded() -> ProgressLine {
        ProgressLine { completed: 1, total: 2, position: 0.5, eta: Some(Duration::from_millis(4200)), color: true }
    }

    fn bar_cells(text: &str) -> usize {
        text.chars().filter(|c| matches!(c, '█' | '░')).count()
    }

    #[test]
    fn wide_terminal_gets_the_full_bar() {
        let text = draw(120, half_loaded());

        assert_eq!(bar_cells(&text), 50);
        assert!(text.starts_with("Loading   [1/2]  █"), "{text}");
        assert!(text.trim_end().ends_with("░   50.0%   ETA 4.2s"), "{text}");
    }

    #[test]
    fn narrow_terminal_gets_the_minimum_bar() {
        let text = draw(40, half_loaded());

        assert_eq!(bar_cells(&text), 10);
        assert!(text.starts_with("Loading   [1/2]  █████░░░░░  "), "{text}");
    }

    #[test]
    fn bar_shrinks_to_fit_the_terminal() {
        // The fixed text takes 36 columns here, leaving 24 for the bar.
        let text = draw(60, half_loaded());

        assert_eq!(bar_cells(&text), 24);
        assert!(text.ends_with("ETA 4.2s"), "{text}");
    }

    #[test]
    fn nothing_loaded_shows_no_estimate() {
        let line = ProgressLine { completed: 0, total: 2, position: 0.0, eta: None, color: false };

        let text = draw(120, line);

        assert!(text.contains("[0/2]"), "{text}");
        assert!(text.contains("  0.0%   ETA --"), "{text}");
    }

    #[test]
    fn count_is_padded_to_the_width_of_the_total() {
        let line = ProgressLine { completed: 3, total: 12, position: 0.25, eta: None, color: false };

        assert!(draw(120, line).contains("[03/12]"));
    }

    #[test]
    fn ctrl_c_is_recognised() {
        let ctrl_c = Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
        let plain_c = Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::NONE));

        assert!(is_ctrl_c(&ctrl_c));
        assert!(!is_ctrl_c(&plain_c));
    }
}
