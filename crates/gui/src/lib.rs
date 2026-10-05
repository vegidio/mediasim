//! The Tauri 2 desktop application for `MediaSim`.
//!
//! Only GUI plumbing lives here: Tauri setup, commands and events, and window state. Everything the
//! GUI and the CLI both need belongs in `mediasim`.

#![warn(clippy::pedantic)]

mod formats;
mod set;
mod window;

/// Build and run the application. Blocks until it exits.
///
/// # Panics
///
/// If the Tauri application cannot be built or started.
pub fn run() {
    tauri::Builder::default()
        // Injects the platform into the webview so the frontend can read it synchronously at first render.
        .plugin(tauri_plugin_os::init())
        // The native file and folder pickers behind the "Add to set" menu.
        .plugin(tauri_plugin_dialog::init())
        .manage(set::commands::SetState::default())
        .setup(|app| {
            // The window ships hidden and is shown by `window_ready`; this shows it anyway if the frontend never reports.
            window::reveal_when_late(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window::window_ready,
            formats::supported_formats,
            set::commands::add_to_set,
            set::commands::remove_from_set,
            set::commands::rescan_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the MediaSim application");
}
