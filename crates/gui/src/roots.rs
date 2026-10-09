//! The files and folders the user chose this run, which bound what the window may move to the Trash or delete.
//!
//! [Admission](crate::admission) takes any media file the window names, so on its own it can't tell a file the user
//! picked from one a compromised webview made up. Rust records what the user chose where it sees the choice itself:
//! the native pickers' results ([`dialog`](crate::dialog)), the paths of files dropped on the window, and the sources
//! added to the set. [`trash_media`](crate::trash::trash_media) and [`delete_media`](crate::trash::delete_media)
//! refuse a file whose canonical path is not one of these roots or inside one.
//!
//! Only the destructive commands check: thumbnails, playback, opening and revealing still serve any admitted file.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, DragDropEvent, Manager, Runtime};

/// The canonical paths the user chose this run, as Tauri managed state.
///
/// Never narrowed during a run: removing a source from the set, or clearing it, doesn't take back the user's choice.
#[derive(Debug, Default)]
pub struct AllowedRoots(Mutex<ChosenRoots>);

impl AllowedRoots {
    fn roots(&self) -> MutexGuard<'_, ChosenRoots> {
        // Roots are inserted whole, so a panic elsewhere can't leave one half-written.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records `paths`, canonicalizing each; one that can't be resolved, such as a path that no longer exists, is
    /// skipped. Touches the filesystem, so it belongs off the main thread.
    pub(crate) fn allow<P: AsRef<Path>>(&self, paths: impl IntoIterator<Item = P>) {
        self.insert(canonical_roots(paths));
    }

    /// Records `canonical` paths that [`canonical_roots`] resolved.
    pub(crate) fn insert(&self, canonical: Vec<PathBuf>) {
        if canonical.is_empty() {
            return;
        }

        let mut roots = self.roots();
        // Copied only when a check still holds the previous snapshot.
        Arc::make_mut(&mut roots.0).extend(canonical);
    }

    /// The roots as they are now, for a check that runs off the lock.
    pub(crate) fn snapshot(&self) -> ChosenRoots {
        self.roots().clone()
    }
}

/// A snapshot of [`AllowedRoots`], cheap to clone and to move into a blocking task.
#[derive(Debug, Clone, Default)]
pub(crate) struct ChosenRoots(Arc<HashSet<PathBuf>>);

impl ChosenRoots {
    /// Whether `path` resolves to a chosen root or to something inside one. Containment is decided on whole components
    /// of the canonical path, after symlinks and `..` are resolved, so `/a/bc` is not inside `/a/b`, and a symlink
    /// inside a root that points out of it leads out of it. A path that can't be resolved is never contained.
    pub(crate) fn contains(&self, path: &Path) -> bool {
        std::fs::canonicalize(path).is_ok_and(|canonical| canonical.ancestors().any(|dir| self.0.contains(dir)))
    }
}

/// `paths` canonicalized, leaving out each one that can't be resolved.
pub(crate) fn canonical_roots<P: AsRef<Path>>(paths: impl IntoIterator<Item = P>) -> Vec<PathBuf> {
    paths.into_iter().filter_map(|path| std::fs::canonicalize(path).ok()).collect()
}

/// Records the paths of files dropped on the window. Window events arrive on the main thread, so the paths are
/// resolved on the blocking pool; the window only learns of a drop at the same time, and takes much longer to get
/// to deleting one of its files.
pub(crate) fn record_drop<R: Runtime>(app: &AppHandle<R>, event: &DragDropEvent) {
    if let DragDropEvent::Drop { paths, .. } = event {
        let (app, paths) = (app.clone(), paths.clone());
        tauri::async_runtime::spawn_blocking(move || app.state::<AllowedRoots>().allow(paths));
    }
}

#[cfg(test)]
mod tests {
    use rust_sak::fs::mk_temp_dir;

    use super::*;

    /// Roots allowing each of `paths`.
    fn allowing(paths: &[&Path]) -> ChosenRoots {
        let roots = AllowedRoots::default();
        roots.allow(paths);
        roots.snapshot()
    }

    /// A temp directory with an empty file at each of `files`, creating their folders.
    fn tree(files: &[&str]) -> rust_sak::fs::TempDir {
        let dir = mk_temp_dir("mediasim-roots-").unwrap();
        for file in files {
            let path = dir.path().join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"").unwrap();
        }
        dir
    }

    #[test]
    fn nothing_is_contained_until_something_is_chosen() {
        let dir = tree(&["a.png"]);

        assert!(!AllowedRoots::default().snapshot().contains(&dir.path().join("a.png")));
    }

    #[test]
    fn a_chosen_file_and_everything_under_a_chosen_folder_are_contained() {
        let dir = tree(&["picked.png", "other.png", "folder/a.png", "folder/deep/b.png"]);
        let roots = allowing(&[&dir.path().join("picked.png"), &dir.path().join("folder")]);

        assert!(roots.contains(&dir.path().join("picked.png")));
        assert!(roots.contains(&dir.path().join("folder")));
        assert!(roots.contains(&dir.path().join("folder/a.png")));
        assert!(roots.contains(&dir.path().join("folder/deep/b.png")));
        assert!(!roots.contains(&dir.path().join("other.png")));
        assert!(!roots.contains(dir.path()));
    }

    #[test]
    fn a_sibling_whose_name_extends_a_root_is_not_inside_it() {
        let dir = tree(&["b/a.png", "bc/a.png", "b.png"]);
        let roots = allowing(&[&dir.path().join("b")]);

        assert!(roots.contains(&dir.path().join("b/a.png")));
        assert!(!roots.contains(&dir.path().join("bc/a.png")));
        assert!(!roots.contains(&dir.path().join("b.png")));
    }

    #[test]
    fn dot_dot_is_resolved_before_containment_is_decided() {
        let dir = tree(&["root/a.png", "outside/a.png"]);
        let roots = allowing(&[&dir.path().join("root")]);

        assert!(!roots.contains(&dir.path().join("root/../outside/a.png")));
        assert!(roots.contains(&dir.path().join("outside/../root/a.png")));
    }

    #[test]
    fn a_missing_path_is_neither_recorded_nor_contained() {
        let dir = tree(&[]);
        let roots = AllowedRoots::default();

        roots.allow([dir.path().join("missing")]);

        assert!(roots.snapshot().0.is_empty());
        assert!(!allowing(&[dir.path()]).contains(&dir.path().join("missing.png")));
    }

    #[test]
    fn a_snapshot_keeps_the_roots_it_was_taken_with() {
        let dir = tree(&["a/x.png", "b/x.png"]);
        let roots = AllowedRoots::default();
        roots.allow([dir.path().join("a")]);

        let before = roots.snapshot();
        roots.allow([dir.path().join("b")]);

        assert!(!before.contains(&dir.path().join("b/x.png")));
        assert!(roots.snapshot().contains(&dir.path().join("b/x.png")));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_a_root_leads_out_of_it() {
        let dir = tree(&["root/a.png", "outside/a.png"]);
        std::os::unix::fs::symlink(dir.path().join("outside"), dir.path().join("root/link")).unwrap();
        let roots = allowing(&[&dir.path().join("root")]);

        assert!(!roots.contains(&dir.path().join("root/link/a.png")));
    }

    #[cfg(unix)]
    #[test]
    fn a_root_chosen_through_a_symlink_contains_its_target() {
        let dir = tree(&["real/a.png"]);
        std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("alias")).unwrap();
        let roots = allowing(&[&dir.path().join("alias")]);

        assert!(roots.contains(&dir.path().join("real/a.png")));
        assert!(roots.contains(&dir.path().join("alias/a.png")));
    }
}
