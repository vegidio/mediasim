//! The one-line progress display: `Loading   [1/2]  ██████░░░░░░  50.0%   ETA 4.2s`, with a caller-chosen label.
//!
//! It is drawn with ratatui in an inline viewport, so it stays in the normal scrollback instead of taking over the
//! screen, and remains visible after loading ends.

mod bar;
mod eta;
mod spring;

use std::io::{Write, stdout};
use std::iter::once;
use std::path::PathBuf;
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

/// What [`load`] returns: the sink, fed with every media that loaded, and the errors of the files it skipped.
pub struct Loaded<C> {
    pub sink: C,
    /// In completion order, and always empty unless errors were ignored.
    pub skipped: Vec<MediaError>,
}

/// Loads `paths` into `sink` and returns it: through the progress display, labelled `label`, when `interactive`,
/// otherwise silently. The first error ends the load, unless `ignore_errors`, in which case files that fail to load
/// are skipped and returned with the sink.
pub fn load<C>(
    paths: &[PathBuf],
    label: &str,
    mut sink: C,
    ignore_errors: bool,
    interactive: bool,
    color: bool,
) -> Result<Loaded<C>, CliError>
where
    C: Extend<Media> + Send + 'static,
{
    let stream = Media::from_files(paths.to_vec());
    if interactive {
        return run(stream, paths.len(), label, sink, ignore_errors, color);
    }

    let mut skipped = Vec::new();
    for result in stream {
        match result {
            Ok(media) => sink.extend(once(media)),
            Err(err) if ignore_errors => skipped.push(err),
            Err(err) => return Err(err.into()),
        }
    }
    Ok(Loaded { sink, skipped })
}

/// Shows the progress display, labelled `label`, while `stream` yields `total` results, feeds each loaded media to
/// `sink`, and returns the sink.
///
/// The sink is fed on a background thread, so slow work it does (such as comparing media) never stalls the display
/// or Ctrl+C; progress advances once the sink has taken each media. The first error ends the run at once, unless
/// `ignore_errors`, in which case a failed file is skipped and counted as done; Ctrl+C ends it with
/// [`CliError::Interrupted`]. The terminal is restored on every way out, with the display left on
/// screen and the cursor on the line below it.
fn run<C>(
    stream: MediaStream,
    total: usize,
    label: &str,
    mut sink: C,
    ignore_errors: bool,
    color: bool,
) -> Result<Loaded<C>, CliError>
where
    C: Extend<Media> + Send + 'static,
{
    // `MediaStream` blocks, so a thread drains it into the sink and ticks a channel the frame loop can poll. Once the
    // receiver is dropped, the forwarder's next send fails, which drops the stream and stops any file that has not
    // started loading.
    let (tx, rx) = mpsc::channel::<Result<(), MediaError>>();
    let forwarder = std::thread::spawn(move || {
        for result in stream {
            let tick = result.map(|media| sink.extend(once(media)));
            let failed = tick.is_err();
            if tx.send(tick).is_err() || (failed && !ignore_errors) {
                break;
            }
        }
        sink
    });

    println!();
    let mut session = Session::start()?;
    let started = Instant::now();
    let mut completed = 0;
    let mut skipped = Vec::new();
    let mut spring = Spring::default();
    let mut eta = Eta::default();
    let mut finished_at = None;

    loop {
        let frame_started = Instant::now();

        let mut disconnected = false;
        loop {
            match rx.try_recv() {
                Ok(Ok(())) => completed += 1,
                Ok(Err(err)) if ignore_errors => {
                    skipped.push(err);
                    completed += 1;
                }
                Ok(Err(err)) => return Err(err.into()),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            }
        }

        let finished = disconnected || completed >= total;
        let shown = if finished { total } else { completed };
        spring.target = if finished { 1.0 } else { fraction(completed, total) };
        spring.step();
        eta.update(shown, total, started.elapsed());

        let finished_at = finished.then(|| *finished_at.get_or_insert_with(Instant::now));
        let done = finished_at.is_some_and(|at| spring.is_settled() || at.elapsed() >= SETTLE_CAP);
        if done {
            spring.snap();
        }

        let line = ProgressLine { label, completed: shown, total, position: spring.position, eta: eta.value(), color };
        session.draw(line)?;

        if done {
            let sink = forwarder.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic));
            return Ok(Loaded { sink, skipped });
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

    fn draw(&mut self, line: ProgressLine<'_>) -> std::io::Result<()> {
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

/// `<label>   [n/total]  <bar>  xx.x%   ETA …`, with the bar as wide as fits, between 10 and 50 cells.
struct ProgressLine<'a> {
    label: &'a str,
    completed: usize,
    total: usize,
    position: f64,
    eta: Option<Duration>,
    color: bool,
}

impl ProgressLine<'_> {
    fn style(&self, (r, g, b): (u8, u8, u8)) -> Style {
        if self.color { Style::new().fg(Color::Rgb(r, g, b)) } else { Style::new() }
    }
}

impl Widget for ProgressLine<'_> {
    fn render(self, area: Rect, buf: &mut Buffer) {
        let digits = self.total.to_string().len();
        let gray = self.style(GRAY);

        let left = Line::from(vec![
            Span::raw(format!("{}   ", self.label)),
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

    fn draw(width: u16, line: ProgressLine<'_>) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, 1)).unwrap();
        terminal.draw(|frame| frame.render_widget(line, frame.area())).unwrap();
        terminal.backend().buffer().content().iter().map(ratatui::buffer::Cell::symbol).collect()
    }

    fn half_loaded() -> ProgressLine<'static> {
        ProgressLine {
            label: "Loading",
            completed: 1,
            total: 2,
            position: 0.5,
            eta: Some(Duration::from_millis(4200)),
            color: true,
        }
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
        let line = ProgressLine { label: "Loading", completed: 0, total: 2, position: 0.0, eta: None, color: false };

        let text = draw(120, line);

        assert!(text.contains("[0/2]"), "{text}");
        assert!(text.contains("  0.0%   ETA --"), "{text}");
    }

    #[test]
    fn count_is_padded_to_the_width_of_the_total() {
        let line = ProgressLine { label: "Loading", completed: 3, total: 12, position: 0.25, eta: None, color: false };

        assert!(draw(120, line).contains("[03/12]"));
    }

    #[test]
    fn label_is_shown() {
        let line = ProgressLine { label: "Processing", ..half_loaded() };

        let text = draw(120, line);

        assert!(text.starts_with("Processing   [1/2]  █"), "{text}");
        assert!(text.trim_end().ends_with("░   50.0%   ETA 4.2s"), "{text}");
    }

    #[test]
    fn ctrl_c_is_recognised() {
        let ctrl_c = Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
        let plain_c = Event::Key(KeyEvent::new(KeyCode::Char('c'), KeyModifiers::NONE));

        assert!(is_ctrl_c(&ctrl_c));
        assert!(!is_ctrl_c(&plain_c));
    }
}
