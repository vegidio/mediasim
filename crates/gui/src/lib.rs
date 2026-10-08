//! The Tauri 2 desktop application for `MediaSim`.
//!
//! Only GUI plumbing lives here: Tauri setup, commands and events, and window state. Everything the
//! GUI and the CLI both need belongs in `mediasim`.

#![warn(clippy::pedantic)]

mod formats;
mod open;
mod pair;
mod scan;
mod set;
mod thumbs;
mod trash;
mod video;
mod window;

use serde::{Serialize, Serializer};
use tauri::Manager;

/// A command failed for a reason other than its input, which commands report per item instead: its blocking task
/// panicked or was cancelled. Crosses to the window as its message.
#[derive(Debug, thiserror::Error)]
pub enum TaskError {
    #[error("the background task did not finish: {0}")]
    Task(#[from] tauri::Error),
}

impl Serialize for TaskError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

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
        .manage(scan::ScanState::default())
        .manage(<trash::TrashState>::default())
        .manage(video::SessionState::default())
        .manage(video::Segments::default())
        .manage(video::Encoders::default())
        // Thumbnails for admitted files only, never by path; see `thumbs`.
        .register_asynchronous_uri_scheme_protocol(thumbs::SCHEME, thumbs::serve)
        // Byte ranges of admitted videos, by identity like `thumb`; see `video`.
        .register_asynchronous_uri_scheme_protocol(video::SCHEME, video::serve)
        .setup(|app| {
            // Off the main thread so a slow cache open never delays the window; thumbnail requests wait for it.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let dir = handle.path().app_cache_dir().ok().map(|dir| dir.join("thumbnails"));
                handle.state::<thumbs::ThumbState>().open_cache(dir.as_deref());
            });
            // Tests the hardware encoders off the main thread; a transcode opened before it finishes waits for it.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                handle.state::<video::Encoders>().current();
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
            set::commands::clear_set,
            set::commands::rescan_set,
            set::commands::list_set_media,
            set::commands::display_path,
            thumbs::commands::admit_media,
            thumbs::commands::describe_media,
            pair::probe_media,
            pair::compare_pair,
            pair::cancel_comparison,
            scan::start_scan,
            scan::cancel_scan,
            open::open_media,
            open::reveal_media,
            trash::trash_media,
            trash::restore_media,
            trash::delete_media,
            video::probe::probe_video,
            video::sessions::video_open,
            video::sessions::video_next,
            video::sessions::video_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the MediaSim application");
}
