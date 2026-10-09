//! The Tauri commands behind the native file and folder pickers.
//!
//! The pickers are opened from Rust rather than through the dialog plugin's JS API, so Rust sees what the user chose
//! and records it in [`AllowedRoots`] before the window gets the paths. The plugin is registered for its Rust API
//! only; the window has no permission to call it.

use std::path::PathBuf;

use serde::Deserialize;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, State, Window};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};
use tokio::sync::oneshot;

use crate::TaskError;
use crate::roots::{AllowedRoots, canonical_roots};

/// A picker filter, as the window sends it: a name and the extensions it lists, without the dot.
#[derive(Debug, Clone, Deserialize)]
pub struct Filter {
    name: String,
    extensions: Vec<String>,
}

/// Lets the user pick media files, several at once, records them as chosen and returns them. Returns nothing when the
/// picker is cancelled.
///
/// # Errors
///
/// If the blocking task that records the files fails to finish.
#[tauri::command]
pub async fn pick_files(
    app: AppHandle,
    window: Window,
    roots: State<'_, AllowedRoots>,
    filters: Vec<Filter>,
) -> Result<Vec<PathBuf>, TaskError> {
    let (tx, rx) = oneshot::channel();
    builder(&app, &window, &filters).pick_files(move |picked| {
        let _ = tx.send(picked);
    });

    record(&roots, paths(rx.await.ok().flatten().unwrap_or_default())).await
}

/// Lets the user pick one media file, records it as chosen and returns it. Returns `None` when the picker is
/// cancelled.
///
/// # Errors
///
/// If the blocking task that records the file fails to finish.
#[tauri::command]
pub async fn pick_file(
    app: AppHandle,
    window: Window,
    roots: State<'_, AllowedRoots>,
    filters: Vec<Filter>,
) -> Result<Option<PathBuf>, TaskError> {
    let (tx, rx) = oneshot::channel();
    builder(&app, &window, &filters).pick_file(move |picked| {
        let _ = tx.send(picked);
    });

    let picked = record(&roots, paths(rx.await.ok().flatten())).await?;
    Ok(picked.into_iter().next())
}

/// Lets the user pick folders, several at once, records them as chosen and returns them. Returns nothing when the
/// picker is cancelled.
///
/// # Errors
///
/// If the blocking task that records the folders fails to finish.
#[tauri::command]
pub async fn pick_folders(
    app: AppHandle,
    window: Window,
    roots: State<'_, AllowedRoots>,
) -> Result<Vec<PathBuf>, TaskError> {
    let (tx, rx) = oneshot::channel();
    builder(&app, &window, &[]).pick_folders(move |picked| {
        let _ = tx.send(picked);
    });

    record(&roots, paths(rx.await.ok().flatten().unwrap_or_default())).await
}

/// A picker with `filters`, in front of `window` where the platform supports it, as the plugin's own `open` does.
///
/// The picker is shown from the main thread and answers through a callback on a thread of its own, so awaiting the
/// answer never blocks the main thread or a runtime worker. A picker that could not be shown drops its callback,
/// which reads as cancelled.
fn builder(app: &AppHandle, window: &Window, filters: &[Filter]) -> FileDialogBuilder<tauri::Wry> {
    let mut builder = app.dialog().file();
    #[cfg(any(windows, target_os = "macos"))]
    {
        builder = builder.set_parent(window);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = window;

    for Filter { name, extensions } in filters {
        let extensions: Vec<_> = extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(name, &extensions);
    }
    builder
}

/// The local paths among `picked`; on desktop the pickers only ever answer with paths.
fn paths(picked: impl IntoIterator<Item = FilePath>) -> Vec<PathBuf> {
    picked.into_iter().filter_map(|path| path.into_path().ok()).collect()
}

/// Records `picked` as chosen, resolving them on the blocking pool, and hands them back.
async fn record(roots: &AllowedRoots, picked: Vec<PathBuf>) -> Result<Vec<PathBuf>, TaskError> {
    if picked.is_empty() {
        return Ok(picked);
    }

    let (picked, canonical) = spawn_blocking(move || {
        let canonical = canonical_roots(&picked);
        (picked, canonical)
    })
    .await?;
    roots.insert(canonical);

    Ok(picked)
}
