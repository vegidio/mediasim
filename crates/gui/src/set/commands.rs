//! The Tauri commands over the [`Set`] in managed state.
//!
//! Classifying and listing touch the filesystem, so they run in `spawn_blocking` with the lock released; the lock is
//! held only to read the set or to commit a finished listing. A long scan therefore never blocks
//! [`remove_from_set`], and a listing whose folder was removed or rescanned meanwhile is dropped by [`Set::commit`].

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::State;
use tauri::async_runtime::spawn_blocking;

use super::{Job, Listing, Set, SetView, classify, home, list_folder};
use crate::TaskError;

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

/// Switches "Scan subfolders", relists every folder with it, and returns the set once they are all listed.
///
/// # Errors
///
/// If a listing task fails to finish.
#[tauri::command]
pub async fn rescan_set(state: State<'_, SetState>, recursive: bool) -> Result<SetView, TaskError> {
    rescan(&state, recursive, list_folder).await
}

async fn add<L>(state: &SetState, paths: Vec<PathBuf>, recursive: bool, list: L) -> Result<SetView, TaskError>
where
    L: Fn(&Path, bool) -> Listing + Clone + Send + 'static,
{
    let classified =
        spawn_blocking(move || paths.into_iter().filter_map(|p| classify(&p).map(|c| (p, c))).collect()).await?;
    let jobs = state.lock().add(classified, recursive);

    run(state, jobs, list).await?;
    Ok(state.view())
}

fn remove(state: &SetState, path: &Path) -> SetView {
    state.lock().remove(path);
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

    use rust_sak::fs::mk_temp_dir;
    use tauri::Manager;
    use tauri::async_runtime::block_on;
    use tauri::test::{mock_builder, mock_context, noop_assets};

    use super::*;

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
