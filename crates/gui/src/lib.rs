//! The Tauri 2 desktop application for `MediaSim`.
//!
//! Only GUI plumbing lives here: Tauri setup, commands and events, and window state. Everything the
//! GUI and the CLI both need belongs in `mediasim`.

#![warn(clippy::pedantic)]

mod formats;
mod pair;
mod set;
mod thumbs;
mod trash;
mod window;

use tauri::Manager;

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
        .manage(thumbs::ThumbState::default())
        .manage(pair::PairState::default())
        .manage(<trash::TrashState>::default())
        // Thumbnails for admitted files only, never by path; see `thumbs`.
        .register_asynchronous_uri_scheme_protocol(thumbs::SCHEME, thumbs::serve)
        .setup(|app| {
            // Off the main thread so a slow cache open never delays the window; thumbnail requests wait for it.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let dir = handle.path().app_cache_dir().ok().map(|dir| dir.join("thumbnails"));
                handle.state::<thumbs::ThumbState>().open_cache(dir.as_deref());
            });
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
            thumbs::commands::admit_media,
            thumbs::commands::describe_media,
            pair::probe_media,
            pair::compare_pair,
            pair::cancel_comparison,
            trash::trash_media,
            trash::restore_media,
            trash::delete_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the MediaSim application");
}
