//! The Tauri commands over the [`Set`] in managed state.
//!
//! Classifying and listing touch the filesystem, so they run in `spawn_blocking` with the lock released; the lock is
//! held only to read the set or to commit a finished listing. A long scan therefore never blocks
//! [`remove_from_set`] or [`clear_set`], and a listing whose folder was removed, cleared or rescanned meanwhile is
//! dropped by [`Set::commit`]. An add reads the set's clear epoch before classifying, so one still classifying when
//! the set is cleared adds nothing.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::State;
use tauri::async_runtime::spawn_blocking;

use super::{Job, Listing, Set, SetView, classify, display_home, home, list_folder};
use crate::TaskError;
use crate::thumbs::ThumbState;
use crate::thumbs::commands::{MediaFile, describe};

/// The set, as Tauri managed state.
#[derive(Debug, Default)]
pub struct SetState(Mutex<Set>);

impl SetState {
    fn lock(&self) -> MutexGuard<'_, Set> {
        // A panic mid-update leaves at worst a stale row, which is better than a set that can no longer be used.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn view(&self) -> SetView {
        self.lock().view(home().as_deref())
    }
}

/// Adds files and folders to the set, skipping unsupported, missing and already-added paths, and returns the set once
/// every folder added here has been listed.
///
/// `recursive` is the "Scan subfolders" checkbox as the frontend shows it.
///
/// # Errors
///
/// If a classification or listing task fails to finish.
#[tauri::command]
pub async fn add_to_set(
    state: State<'_, SetState>,
    paths: Vec<PathBuf>,
    recursive: bool,
) -> Result<SetView, TaskError> {
    add(&state, paths, recursive, list_folder).await
}

/// Removes the source added as `path` and returns the set.
///
/// Async like the other set commands, so building the view never runs on the main thread.
///
/// # Errors
///
/// Never; Tauri requires an async command that borrows its state to return a `Result`.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri passes command arguments by value")]
#[allow(clippy::unused_async, reason = "Tauri runs a command off the main thread only if it is async")]
pub async fn remove_from_set(state: State<'_, SetState>, path: PathBuf) -> Result<SetView, TaskError> {
    Ok(remove(&state, &path))
}

/// Removes every source from the set, including folders still being counted, and returns the set.
///
/// # Errors
///
/// Never; Tauri requires an async command that borrows its state to return a `Result`.
#[tauri::command]
#[allow(clippy::unused_async, reason = "Tauri runs a command off the main thread only if it is async")]
pub async fn clear_set(state: State<'_, SetState>) -> Result<SetView, TaskError> {
    Ok(clear(&state))
}

/// Relists every folder with "Scan subfolders" as `recursive`, and returns the set once they are all listed.
///
/// The frontend calls it when the setting changes, and with the same setting when a comparison starts, so files added
/// to or deleted from a folder since it was listed show up or drop out.
///
/// # Errors
///
/// If a listing task fails to finish.
#[tauri::command]
pub async fn rescan_set(state: State<'_, SetState>, recursive: bool) -> Result<SetView, TaskError> {
    rescan(&state, recursive, list_folder).await
}

/// `path` as the set list shows a location: with `~` for the home folder on macOS and Linux, and in full on Windows.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri passes command arguments by value")]
pub fn display_path(path: PathBuf) -> String {
    display_home(&path)
}

/// The set's distinct media files, as the gallery shows them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SetMedia {
    /// The set's revision when its paths were taken.
    pub revision: u64,
    /// Ordered by path; a file that can no longer be admitted is left out.
    pub files: Vec<MediaFile>,
}

/// Admits every distinct media file in the set for thumbnails and returns them in path order, with the set's revision.
///
/// The lock is held only to take the paths; admission runs off it.
///
/// # Errors
///
/// If the blocking admission task fails to finish.
#[tauri::command]
pub async fn list_set_media(set: State<'_, SetState>, thumbs: State<'_, ThumbState>) -> Result<SetMedia, TaskError> {
    list_media(&set, &thumbs).await
}

async fn list_media(set: &SetState, thumbs: &ThumbState) -> Result<SetMedia, TaskError> {
    let (revision, paths) = {
        let set = set.lock();
        (set.revision(), set.media_paths())
    };

    let files = describe(thumbs, paths).await?.into_iter().flatten().collect();

    Ok(SetMedia { revision, files })
}

async fn add<L>(state: &SetState, paths: Vec<PathBuf>, recursive: bool, list: L) -> Result<SetView, TaskError>
where
    L: Fn(&Path, bool) -> Listing + Clone + Send + 'static,
{
    let since_clear = state.lock().clears();
    let classified =
        spawn_blocking(move || paths.into_iter().filter_map(|p| classify(&p).map(|c| (p, c))).collect()).await?;
    let jobs = state.lock().add(classified, recursive, since_clear);

    run(state, jobs, list).await?;
    Ok(state.view())
}

fn remove(state: &SetState, path: &Path) -> SetView {
    state.lock().remove(path);
    state.view()
}

fn clear(state: &SetState) -> SetView {
    state.lock().clear();
    state.view()
}

async fn rescan<L>(state: &SetState, recursive: bool, list: L) -> Result<SetView, TaskError>
where
    L: Fn(&Path, bool) -> Listing + Clone + Send + 'static,
{
    let jobs = state.lock().rescan(recursive);

    run(state, jobs, list).await?;
    Ok(state.view())
}

/// Lists every job's folder in parallel and commits each result as it arrives.
async fn run<L>(state: &SetState, jobs: Vec<Job>, list: L) -> Result<(), TaskError>
where
    L: Fn(&Path, bool) -> Listing + Clone + Send + 'static,
{
    let tasks: Vec<_> = jobs
        .into_iter()
        .map(|job| {
            let list = list.clone();
            spawn_blocking(move || {
                let listing = list(&job.path, job.recursive);
                (job, listing)
            })
        })
        .collect();

    for task in tasks {
        let (job, listing) = task.await?;
        state.lock().commit(&job, listing);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};

    use mediasim::MediaType;
    use rust_sak::fs::mk_temp_dir;
    use tauri::Manager;
    use tauri::async_runtime::block_on;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    use super::*;
    use crate::thumbs::tests::fixture;

    #[test]
    fn a_folder_removed_during_a_slow_listing_stays_removed() {
        let app = mock_builder()
            .manage(SetState::default())
            .build(mock_context(noop_assets()))
            .expect("the mock app should build");
        let dir = mk_temp_dir("mediasim-set-").unwrap();
        std::fs::write(dir.path().join("a.png"), [0_u8]).unwrap();
        let folder = dir.path().to_path_buf();

        // The listing reports that it started, then waits for the test to let it finish.
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let slow = move |path: &Path, recursive: bool| {
            started_tx.send(()).unwrap();
            release_rx.lock().unwrap().recv().unwrap();
            list_folder(path, recursive)
        };

        let handle = app.handle().clone();
        let paths = vec![folder.clone()];
        let adding =
            tauri::async_runtime::spawn(async move { add(&handle.state::<SetState>(), paths, true, slow).await });

        started_rx.recv().unwrap();
        let state = app.state::<SetState>();
        assert!(state.view().sources[0].pending, "the folder should be listed as pending while it is counted");

        let removed = remove(&state, &folder);
        assert!(removed.sources.is_empty());

        release_tx.send(()).unwrap();
        let added = block_on(adding).unwrap().unwrap();

        assert!(added.sources.is_empty(), "the stale listing must not bring the folder back");
        assert!(added.revision >= removed.revision);
        assert!(state.view().sources.is_empty());
    }

    #[test]
    fn a_folder_cleared_during_a_slow_listing_stays_cleared() {
        let app = mock_builder()
            .manage(SetState::default())
            .build(mock_context(noop_assets()))
            .expect("the mock app should build");
        let dir = mk_temp_dir("mediasim-set-").unwrap();
        std::fs::write(dir.path().join("a.png"), [0_u8]).unwrap();
        let state = app.state::<SetState>();
        let before = state.view();

        // The listing reports that it started, then waits for the test to let it finish.
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let slow = move |path: &Path, recursive: bool| {
            started_tx.send(()).unwrap();
            release_rx.lock().unwrap().recv().unwrap();
            list_folder(path, recursive)
        };

        let handle = app.handle().clone();
        let paths = vec![dir.path().to_path_buf()];
        let adding =
            tauri::async_runtime::spawn(async move { add(&handle.state::<SetState>(), paths, true, slow).await });

        started_rx.recv().unwrap();
        let pending = state.view();
        assert!(pending.sources[0].pending, "the folder should be listed as pending while it is counted");

        let cleared = clear(&state);
        assert!(cleared.sources.is_empty());
        assert!(cleared.revision > pending.revision && cleared.revision > before.revision);

        release_tx.send(()).unwrap();
        let added = block_on(adding).unwrap().unwrap();

        assert!(added.sources.is_empty(), "the stale listing must not bring the folder back");
        assert_eq!(added.revision, cleared.revision);
        assert!(state.view().sources.is_empty());
    }

    #[test]
    fn a_folder_added_again_after_a_clear_is_counted() {
        let state = SetState::default();
        let dir = mk_temp_dir("mediasim-set-").unwrap();
        std::fs::write(dir.path().join("a.png"), [0_u8]).unwrap();

        block_on(add(&state, vec![dir.path().to_path_buf()], true, list_folder)).unwrap();
        clear(&state);
        let added = block_on(add(&state, vec![dir.path().to_path_buf()], true, list_folder)).unwrap();

        assert_eq!(added.total, 1);
        assert!(!added.sources[0].pending);
    }

    #[test]
    fn listing_media_returns_the_files_in_display_order_with_the_revision() {
        let state = SetState::default();
        let thumbs = crate::thumbs::tests::state();
        let dir = mk_temp_dir("mediasim-set-").unwrap();
        std::fs::create_dir(dir.path().join("b")).unwrap();
        std::fs::copy(fixture("test3.mp4"), dir.path().join("b/clip.mp4")).unwrap();
        // `c.png` sorts after the subfolder `b` by name, but a folder's own files come before its subfolders.
        std::fs::copy(fixture("test1.png"), dir.path().join("c.png")).unwrap();

        let added =
            block_on(add(&state, vec![dir.path().join("b"), dir.path().join("c.png")], true, list_folder)).unwrap();
        let media = block_on(list_media(&state, &thumbs)).unwrap();

        assert_eq!(media.revision, added.revision);
        let described: Vec<_> = media.files.iter().map(|f| (f.name.as_str(), f.r#type, f.size)).collect();
        assert_eq!(
            described,
            [
                ("c.png", MediaType::Image, std::fs::metadata(fixture("test1.png")).unwrap().len()),
                ("clip.mp4", MediaType::Video, std::fs::metadata(fixture("test3.mp4")).unwrap().len()),
            ]
        );
        for file in &media.files {
            assert!(thumbs.lookup(&file.identity).is_some(), "{} was listed but not admitted", file.name);
        }
    }

    #[test]
    fn a_file_deleted_after_counting_is_left_out() {
        let state = SetState::default();
        let thumbs = crate::thumbs::tests::state();
        let dir = mk_temp_dir("mediasim-set-").unwrap();
        std::fs::copy(fixture("test1.png"), dir.path().join("a.png")).unwrap();
        std::fs::copy(fixture("test1.png"), dir.path().join("b.png")).unwrap();

        let added = block_on(add(&state, vec![dir.path().to_path_buf()], true, list_folder)).unwrap();
        std::fs::remove_file(dir.path().join("a.png")).unwrap();
        let media = block_on(list_media(&state, &thumbs)).unwrap();

        assert_eq!(added.total, 2);
        let names: Vec<_> = media.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["b.png"]);
    }

    #[test]
    fn a_path_under_home_is_shown_with_a_tilde_except_on_windows() {
        let home = std::env::home_dir().expect("the test machine should have a home folder");
        let path = home.join("Pictures").join("a.png");

        let shown = display_path(path.clone());

        if cfg!(windows) {
            assert_eq!(shown, path.to_string_lossy());
        } else {
            assert_eq!(shown, Path::new("~").join("Pictures").join("a.png").to_string_lossy());
        }
    }

    #[test]
    fn rescanning_lists_every_folder_with_the_new_setting() {
        let state = SetState::default();
        let dir = mk_temp_dir("mediasim-set-").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("a.png"), [0_u8]).unwrap();
        std::fs::write(dir.path().join("sub/b.png"), [0_u8]).unwrap();

        let added = block_on(add(&state, vec![dir.path().to_path_buf()], true, list_folder)).unwrap();
        let rescanned = block_on(rescan(&state, false, list_folder)).unwrap();

        assert_eq!(added.total, 2);
        assert_eq!(rescanned.total, 1);
        assert!(rescanned.revision > added.revision);
    }
}
