//! The Tauri 2 desktop application for `MediaSim`.
//!
//! Only GUI plumbing lives here: Tauri setup, commands and events, and window state. Everything the
//! GUI and the CLI both need belongs in `mediasim`.

#![warn(clippy::pedantic)]

/// Build and run the application. Blocks until it exits.
///
/// # Panics
///
/// If the Tauri application cannot be built or started.
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running the MediaSim application");
}
