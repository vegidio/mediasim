//! When the main window becomes visible.
//!
//! The window ships hidden (`visible: false` in `tauri.conf.json`) and is shown from here once the frontend reports
//! that it has rendered, so the user never sees an empty webview while the bundle parses. [`window_ready`] is that
//! report; [`reveal_when_late`] shows the window after a grace period regardless, so a frontend that throws at module
//! scope still leaves a usable window.
//!
//! On Windows, `maximized: true` makes `tao` show the window despite `visible: false`; there `backgroundColor` is what
//! keeps the empty frame dark, and [`reveal`] arrives at a window that is already up.

use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// How long the window may stay hidden waiting for a frontend that might never report.
const GRACE: Duration = Duration::from_secs(5);

/// The label `tauri.conf.json` gives the main window.
const MAIN_WINDOW: &str = "main";

/// The two window operations [`reveal`] needs, so its show-once logic can be tested without a real window.
trait Revealable {
    fn is_visible(&self) -> tauri::Result<bool>;
    fn show(&self) -> tauri::Result<()>;
}

impl<R: Runtime> Revealable for WebviewWindow<R> {
    fn is_visible(&self) -> tauri::Result<bool> {
        WebviewWindow::is_visible(self)
    }

    fn show(&self) -> tauri::Result<()> {
        WebviewWindow::show(self)
    }
}

/// The frontend has rendered; show the window it was called from.
///
/// Called from a mount effect in `frontend/main.tsx`. A reload calls it again against a window that is already up,
/// which [`reveal`] answers by doing nothing.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri injects the calling window by value")]
pub fn window_ready<R: Runtime>(window: WebviewWindow<R>) {
    reveal(&window);
}

/// Start the timer that shows the main window whether or not the frontend ever reports.
pub fn reveal_when_late<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(GRACE);

        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            reveal(&window);
        }
    });
}

/// Show the window unless it is already visible.
///
/// Asked rather than tracked, because the command and the grace timer race by design.
fn reveal(window: &impl Revealable) {
    if window.is_visible().unwrap_or(false) {
        return;
    }

    if let Err(error) = window.show() {
        eprintln!("could not show the main window: {error}");
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use tauri::test::{mock_builder, mock_context, noop_assets};

    use super::*;

    /// A window that records how often it was shown.
    #[derive(Default)]
    struct FakeWindow {
        visible: Cell<bool>,
        shows: Cell<u32>,
    }

    impl Revealable for FakeWindow {
        fn is_visible(&self) -> tauri::Result<bool> {
            Ok(self.visible.get())
        }

        fn show(&self) -> tauri::Result<()> {
            self.visible.set(true);
            self.shows.set(self.shows.get() + 1);
            Ok(())
        }
    }

    #[test]
    fn reveal_shows_a_hidden_window() {
        let window = FakeWindow::default();

        reveal(&window);

        assert!(window.visible.get());
        assert_eq!(window.shows.get(), 1);
    }

    #[test]
    fn reveal_shows_only_once() {
        let window = FakeWindow::default();

        reveal(&window);
        reveal(&window);

        assert_eq!(window.shows.get(), 1);
    }

    #[test]
    fn reveal_leaves_a_visible_window_alone() {
        let window = FakeWindow { visible: Cell::new(true), ..FakeWindow::default() };

        reveal(&window);

        assert_eq!(window.shows.get(), 0);
    }

    /// Arming the timer needs no window, so an app shutting down during the grace period cannot panic.
    #[test]
    fn arming_the_timer_needs_no_window() {
        let app = mock_builder().build(mock_context(noop_assets())).expect("the mock app should build");

        reveal_when_late(app.handle());
    }
}
