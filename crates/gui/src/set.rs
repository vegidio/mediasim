//! The set the "Find similar in a set" card builds: the files and folders the user added, what each one contributes,
//! and the distinct media files across all of them.
//!
//! [`Set`] is a plain model: adding classifies paths, folders start out pending, and a finished listing is committed
//! only if its source still has the generation it was started for, so a folder removed or rescanned while it was being
//! listed drops the stale result. Every change bumps the set's revision, which the frontend uses to apply only views
//! newer than the one it shows. The commands in [`commands`] add the locking and the off-thread listing.

pub mod commands;

use std::collections::{BTreeSet, HashSet};
use std::path::{Path, PathBuf};

use mediasim::{LoadOptions, Media, MediaType};
use serde::Serialize;

use crate::thumbs::commands::file_name;

/// The sources the user added, in the order they were added.
#[derive(Debug, Default)]
pub struct Set {
    sources: Vec<Source>,
    /// Bumped on every change, so views can be ordered by the state they show.
    revision: u64,
    /// The generation the next listing gets.
    next_generation: u64,
}

/// One added file or folder.
#[derive(Debug)]
struct Source {
    path: PathBuf,
    /// Which listing of this source is current; a listing started for an older one is dropped.
    generation: u64,
    kind: SourceKind,
}

#[derive(Debug)]
enum SourceKind {
    Folder(Listing),
    File(FileInfo),
}

/// What an added file is: its media type and size in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileInfo {
    pub media_type: MediaType,
    pub size: u64,
}

/// A folder's media files, as far as they are known.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Listing {
    /// Being listed.
    Pending,
    /// Each media file with its size in bytes.
    Listed(Vec<(PathBuf, u64)>),
    /// The folder, or one of the subfolders scanned, could not be read.
    Unreadable,
}

/// What an added path turned out to be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classified {
    Folder,
    File(FileInfo),
}

/// A folder listing to run outside the lock, then hand back to [`Set::commit`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Job {
    pub path: PathBuf,
    pub generation: u64,
    pub recursive: bool,
}

/// The whole set as the frontend shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SetView {
    /// The set's revision when this view was taken.
    pub revision: u64,
    pub sources: Vec<SourceView>,
    /// The number of distinct media files across every source that has been counted.
    pub total: usize,
}

/// One row of the set list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceView {
    /// The path as added, which identifies the source to [`commands::remove_from_set`].
    pub path: String,
    /// The file or folder name.
    pub name: String,
    /// A folder's own path, or a file's parent, with `~` for the home folder on macOS and Linux.
    pub location: String,
    pub kind: ViewKind,
    /// The media files this source contributes on its own, regardless of overlap with other sources.
    pub count: usize,
    /// The total size of those files, in bytes.
    pub size: u64,
    /// A folder that could not be read; it counts 0 files.
    pub unreadable: bool,
    /// A folder still being counted.
    pub pending: bool,
}

/// The icon a row gets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewKind {
    Folder,
    Image,
    Video,
}

/// Classifies an added path: a folder, a file with a supported media extension, or `None` for anything else,
/// including a path that no longer exists.
pub fn classify(path: &Path) -> Option<Classified> {
    let metadata = std::fs::metadata(path).ok()?;

    if metadata.is_dir() {
        return Some(Classified::Folder);
    }

    let media_type = MediaType::from_path(path)?;
    metadata.is_file().then_some(Classified::File(FileInfo { media_type, size: metadata.len() }))
}

/// Lists the media files in `folder`, with their sizes, as a directory load would find them.
///
/// A file that vanishes between the listing and its stat is left out, since it can no longer be loaded.
pub fn list_folder(folder: &Path, recursive: bool) -> Listing {
    match Media::list_dir(folder, &LoadOptions::new().recursive(recursive)) {
        Ok(paths) => Listing::Listed(
            paths
                .into_iter()
                .filter_map(|path| std::fs::metadata(&path).ok().map(|m| (path, m.len())))
                .collect(),
        ),
        Err(_) => Listing::Unreadable,
    }
}

impl Set {
    /// Adds the classified paths in order, skipping any already in the set, and returns the folder listings to run.
    ///
    /// `recursive` is "Scan subfolders" as the frontend shows it, which the folders added here are listed with.
    pub fn add(&mut self, paths: Vec<(PathBuf, Classified)>, recursive: bool) -> Vec<Job> {
        let mut jobs = Vec::new();

        for (path, classified) in paths {
            if self.contains(&path) {
                continue;
            }

            let generation = self.next_generation();
            let kind = match classified {
                Classified::Folder => {
                    jobs.push(Job { path: path.clone(), generation, recursive });
                    SourceKind::Folder(Listing::Pending)
                }
                Classified::File(info) => SourceKind::File(info),
            };

            self.sources.push(Source { path, generation, kind });
            self.revision += 1;
        }

        jobs
    }

    /// Stores a finished listing, unless its source was removed or relisted since the job started.
    ///
    /// Returns whether the listing was applied.
    pub fn commit(&mut self, job: &Job, listing: Listing) -> bool {
        let Some(source) = self.sources.iter_mut().find(|s| s.path == job.path && s.generation == job.generation)
        else {
            return false;
        };

        let SourceKind::Folder(current) = &mut source.kind else {
            return false;
        };

        *current = listing;
        self.revision += 1;
        true
    }

    /// Removes the source added as `path`, if there is one.
    pub fn remove(&mut self, path: &Path) {
        let before = self.sources.len();
        self.sources.retain(|s| s.path != path);

        if self.sources.len() != before {
            self.revision += 1;
        }
    }

    /// Switches "Scan subfolders" and starts relisting every folder with it. Files are unaffected.
    pub fn rescan(&mut self, recursive: bool) -> Vec<Job> {
        self.revision += 1;

        let mut jobs = Vec::new();
        for index in 0..self.sources.len() {
            if !matches!(self.sources[index].kind, SourceKind::Folder(_)) {
                continue;
            }

            let generation = self.next_generation();
            let source = &mut self.sources[index];
            source.generation = generation;
            source.kind = SourceKind::Folder(Listing::Pending);
            jobs.push(Job { path: source.path.clone(), generation, recursive });
        }

        jobs
    }

    /// The number of distinct media files across every counted source.
    ///
    /// Paths compare as given: a file added directly and found inside an added folder match, because `list_dir`
    /// keeps the folder's prefix as it was added.
    pub fn total(&self) -> usize {
        self.paths().collect::<HashSet<_>>().len()
    }

    /// The distinct media files across every counted source, the same paths [`total`](Self::total) counts.
    ///
    /// They are in `Path` order, which compares component by component, so a folder's files stay together.
    pub fn media_paths(&self) -> Vec<PathBuf> {
        self.paths().collect::<BTreeSet<_>>().into_iter().map(Path::to_path_buf).collect()
    }

    /// The set's current revision.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// The set as the frontend shows it, with paths abbreviated against `home`.
    pub fn view(&self, home: Option<&Path>) -> SetView {
        SetView {
            revision: self.revision,
            sources: self.sources.iter().map(|s| s.view(home)).collect(),
            total: self.total(),
        }
    }

    /// Every counted source's media files, with overlaps repeated.
    fn paths(&self) -> impl Iterator<Item = &Path> {
        self.sources.iter().flat_map(|source| {
            let (listed, file) = match &source.kind {
                SourceKind::Folder(Listing::Listed(files)) => (files.as_slice(), None),
                SourceKind::Folder(_) => (&[][..], None),
                SourceKind::File(_) => (&[][..], Some(source.path.as_path())),
            };
            listed.iter().map(|(p, _)| p.as_path()).chain(file)
        })
    }

    fn contains(&self, path: &Path) -> bool {
        self.sources.iter().any(|s| s.path == path)
    }

    fn next_generation(&mut self) -> u64 {
        self.next_generation += 1;
        self.next_generation
    }
}

impl Source {
    fn view(&self, home: Option<&Path>) -> SourceView {
        let name = file_name(&self.path);
        let path = display(&self.path);

        match &self.kind {
            SourceKind::Folder(listing) => {
                let (count, size) = match listing {
                    Listing::Listed(files) => (files.len(), files.iter().map(|(_, size)| size).sum()),
                    Listing::Pending | Listing::Unreadable => (0, 0),
                };

                SourceView {
                    path,
                    name,
                    location: abbreviate(&self.path, home),
                    kind: ViewKind::Folder,
                    count,
                    size,
                    unreadable: *listing == Listing::Unreadable,
                    pending: *listing == Listing::Pending,
                }
            }
            SourceKind::File(FileInfo { media_type, size }) => SourceView {
                path,
                name,
                location: abbreviate(self.path.parent().unwrap_or(&self.path), home),
                kind: match media_type {
                    MediaType::Image => ViewKind::Image,
                    MediaType::Video => ViewKind::Video,
                },
                count: 1,
                size: *size,
                unreadable: false,
                pending: false,
            },
        }
    }
}

/// The home folder that paths are shown relative to: the user's on macOS and Linux, none on Windows, where paths are
/// shown in full.
pub fn home() -> Option<PathBuf> {
    if cfg!(windows) { None } else { std::env::home_dir() }
}

/// Writes `path` with a leading `home` replaced by `~`.
fn abbreviate(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|home| path.strip_prefix(home).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".to_owned(),
        Some(rest) => display(&Path::new("~").join(rest)),
        None => display(path),
    }
}

/// Paths reach the set from the frontend as strings, so this conversion is exact for every source path.
fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use rust_sak::fs::{TempDir, mk_temp_dir};

    use super::*;

    /// A fixture folder holding `files`, each `len` bytes, at the given relative paths.
    fn fixture(files: &[(&str, usize)]) -> TempDir {
        let dir = mk_temp_dir("mediasim-set-").unwrap();
        for (name, len) in files {
            let path = dir.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, vec![0_u8; *len]).unwrap();
        }
        dir
    }

    /// Classifies and adds `paths`, then runs and commits every listing, as the commands do.
    fn add(set: &mut Set, paths: &[PathBuf], recursive: bool) {
        let classified = paths.iter().filter_map(|p| classify(p).map(|c| (p.clone(), c))).collect();
        let jobs = set.add(classified, recursive);
        run(set, &jobs);
    }

    fn run(set: &mut Set, jobs: &[Job]) {
        for job in jobs {
            set.commit(job, list_folder(&job.path, job.recursive));
        }
    }

    fn rows(set: &Set) -> Vec<SourceView> {
        set.view(None).sources
    }

    // --- What can be added ---

    #[test]
    fn a_folder_and_a_media_file_are_added_and_other_files_skipped() {
        let dir = fixture(&[("photo.jpg", 3), ("notes.txt", 3), ("album/a.png", 1)]);
        let mut set = Set::default();

        add(
            &mut set,
            &[dir.path().join("notes.txt"), dir.path().join("photo.jpg"), dir.path().join("album")],
            true,
        );

        let names: Vec<_> = rows(&set).into_iter().map(|r| r.name).collect();
        assert_eq!(names, ["photo.jpg", "album"]);
    }

    #[test]
    fn a_missing_path_is_skipped() {
        let dir = fixture(&[]);

        assert_eq!(classify(&dir.path().join("gone.jpg")), None);
    }

    #[test]
    fn a_folder_without_media_is_added_with_zero_files() {
        let dir = fixture(&[("empty/notes.txt", 1)]);
        let mut set = Set::default();

        add(&mut set, &[dir.path().join("empty")], true);

        let row = &rows(&set)[0];
        assert_eq!((row.kind, row.count, row.unreadable, row.pending), (ViewKind::Folder, 0, false, false));
    }

    #[test]
    fn adding_a_path_twice_lists_it_once() {
        let dir = fixture(&[("a.png", 1)]);
        let mut set = Set::default();

        add(&mut set, &[dir.path().to_path_buf()], true);
        let revision = set.view(None).revision;
        add(&mut set, &[dir.path().to_path_buf(), dir.path().to_path_buf()], true);

        assert_eq!(rows(&set).len(), 1);
        assert_eq!(set.view(None).revision, revision, "a no-op add should not bump the revision");
    }

    // --- Set list ---

    #[test]
    fn rows_keep_the_order_they_were_added_in() {
        let dir = fixture(&[("b.png", 1), ("a.png", 1)]);
        let mut set = Set::default();

        add(&mut set, &[dir.path().join("b.png"), dir.path().join("a.png")], true);

        let names: Vec<_> = rows(&set).into_iter().map(|r| r.name).collect();
        assert_eq!(names, ["b.png", "a.png"]);
    }

    #[test]
    fn a_folder_row_shows_its_path_count_and_size() {
        let dir = fixture(&[("Holiday 2025/a.jpg", 100), ("Holiday 2025/b.mp4", 50), ("Holiday 2025/c.txt", 7)]);
        let folder = dir.path().join("Holiday 2025");
        let mut set = Set::default();

        add(&mut set, std::slice::from_ref(&folder), true);

        let row = &rows(&set)[0];
        assert_eq!(row.name, "Holiday 2025");
        assert_eq!(row.location, display(&folder));
        assert_eq!((row.kind, row.count, row.size), (ViewKind::Folder, 2, 150));
    }

    #[test]
    fn a_file_row_shows_its_folder_size_and_type() {
        let dir = fixture(&[("IMG_9921.HEIC", 31), ("clip.MOV", 5)]);
        let mut set = Set::default();

        add(&mut set, &[dir.path().join("IMG_9921.HEIC"), dir.path().join("clip.MOV")], true);

        let rows = rows(&set);
        assert_eq!(rows[0].name, "IMG_9921.HEIC");
        assert_eq!(rows[0].location, display(dir.path()));
        assert_eq!((rows[0].kind, rows[0].count, rows[0].size), (ViewKind::Image, 1, 31));
        assert_eq!(rows[1].kind, ViewKind::Video);
    }

    #[test]
    fn a_folder_is_pending_until_its_listing_is_committed() {
        let dir = fixture(&[("a.png", 1)]);
        let mut set = Set::default();

        let jobs = set.add(vec![(dir.path().to_path_buf(), Classified::Folder)], true);

        let row = &rows(&set)[0];
        assert!(row.pending);
        assert_eq!(row.count, 0);

        run(&mut set, &jobs);
        assert!(!rows(&set)[0].pending);
        assert_eq!(rows(&set)[0].count, 1);
    }

    #[test]
    fn an_unreadable_folder_counts_zero_files() {
        let dir = fixture(&[("gone/a.png", 1)]);
        let folder = dir.path().join("gone");
        let mut set = Set::default();

        let jobs = set.add(vec![(folder.clone(), classify(&folder).unwrap())], true);
        std::fs::remove_dir_all(&folder).unwrap();
        run(&mut set, &jobs);

        let row = &rows(&set)[0];
        assert!(row.unreadable);
        assert_eq!(row.count, 0);
        assert_eq!(set.total(), 0);
    }

    #[test]
    fn paths_under_home_start_with_a_tilde() {
        let home = Path::new("/Users/me");

        assert_eq!(abbreviate(Path::new("/Users/me/Pictures/Holiday 2025"), Some(home)), "~/Pictures/Holiday 2025");
        assert_eq!(abbreviate(home, Some(home)), "~");
        assert_eq!(abbreviate(Path::new("/Volumes/Photos"), Some(home)), "/Volumes/Photos");
        assert_eq!(abbreviate(Path::new("/Users/me/Pictures"), None), "/Users/me/Pictures");
    }

    #[test]
    fn home_is_never_used_on_windows() {
        if cfg!(windows) {
            assert_eq!(home(), None);
        }
    }

    // --- Removing a source ---

    #[test]
    fn removing_a_folder_leaves_the_rest_and_updates_the_count() {
        let dir = fixture(&[("album/a.png", 1), ("album/b.png", 1), ("c.png", 1)]);
        let mut set = Set::default();
        add(&mut set, &[dir.path().join("album"), dir.path().join("c.png")], true);
        assert_eq!(set.total(), 3);

        set.remove(&dir.path().join("album"));

        let names: Vec<_> = rows(&set).into_iter().map(|r| r.name).collect();
        assert_eq!(names, ["c.png"]);
        assert_eq!(set.total(), 1);
    }

    #[test]
    fn removing_the_last_source_empties_the_set() {
        let dir = fixture(&[("a.png", 1)]);
        let mut set = Set::default();
        add(&mut set, &[dir.path().join("a.png")], true);

        set.remove(&dir.path().join("a.png"));

        assert!(rows(&set).is_empty());
        assert_eq!(set.total(), 0);
    }

    #[test]
    fn a_listing_for_a_removed_folder_is_dropped() {
        let dir = fixture(&[("a.png", 1)]);
        let mut set = Set::default();
        let jobs = set.add(vec![(dir.path().to_path_buf(), Classified::Folder)], true);

        set.remove(dir.path());

        assert!(!set.commit(&jobs[0], list_folder(dir.path(), true)));
        assert!(rows(&set).is_empty());
    }

    #[test]
    fn a_listing_for_a_folder_removed_and_added_again_is_dropped() {
        let dir = fixture(&[("a.png", 1)]);
        let mut set = Set::default();
        let stale = set.add(vec![(dir.path().to_path_buf(), Classified::Folder)], true);
        set.remove(dir.path());
        let fresh = set.add(vec![(dir.path().to_path_buf(), Classified::Folder)], true);

        assert!(!set.commit(&stale[0], Listing::Listed(Vec::new())));
        assert!(rows(&set)[0].pending);
        assert!(set.commit(&fresh[0], list_folder(dir.path(), true)));
        assert_eq!(rows(&set)[0].count, 1);
    }

    // --- Counting distinct files ---

    #[test]
    fn a_file_inside_an_added_folder_is_counted_once() {
        let names: Vec<String> = (0..10).map(|i| format!("{i}.png")).collect();
        let files: Vec<_> = names.iter().map(|n| (n.as_str(), 1)).collect();
        let dir = fixture(&files);
        let mut set = Set::default();

        add(&mut set, &[dir.path().to_path_buf(), dir.path().join("3.png")], true);

        assert_eq!(set.total(), 10);
    }

    #[test]
    fn nested_folders_count_their_files_once_and_keep_their_own_counts() {
        let mut files: Vec<String> = (0..6).map(|i| format!("{i}.png")).collect();
        files.extend((0..4).map(|i| format!("sub/{i}.png")));
        let dir = fixture(&files.iter().map(|n| (n.as_str(), 1)).collect::<Vec<_>>());
        let mut set = Set::default();

        add(&mut set, &[dir.path().to_path_buf(), dir.path().join("sub")], true);

        assert_eq!(set.total(), 10);
        let counts: Vec<_> = rows(&set).into_iter().map(|r| r.count).collect();
        assert_eq!(counts, [10, 4]);
    }

    #[test]
    fn a_pending_folder_adds_nothing_to_the_total() {
        let dir = fixture(&[("a.png", 1)]);
        let mut set = Set::default();

        set.add(vec![(dir.path().to_path_buf(), Classified::Folder)], true);

        assert_eq!(set.total(), 0);
    }

    // --- Media paths ---

    #[test]
    fn a_file_added_directly_and_inside_an_added_folder_is_listed_once() {
        let dir = fixture(&[("a.png", 1), ("b.png", 1)]);
        let mut set = Set::default();

        add(&mut set, &[dir.path().to_path_buf(), dir.path().join("a.png")], true);

        assert_eq!(set.media_paths(), [dir.path().join("a.png"), dir.path().join("b.png")]);
    }

    #[test]
    fn nested_folders_list_each_file_once() {
        let dir = fixture(&[("a.png", 1), ("sub/b.png", 1), ("sub/c.png", 1)]);
        let mut set = Set::default();

        add(&mut set, &[dir.path().to_path_buf(), dir.path().join("sub")], true);

        assert_eq!(
            set.media_paths(),
            [dir.path().join("a.png"), dir.path().join("sub/b.png"), dir.path().join("sub/c.png")]
        );
    }

    #[test]
    fn media_paths_are_ordered_component_by_component() {
        let dir = fixture(&[("a b/x.png", 1), ("a/y.png", 1), ("a/x.png", 1)]);
        let mut set = Set::default();

        add(&mut set, &[dir.path().join("a b"), dir.path().join("a")], true);

        assert_eq!(
            set.media_paths(),
            [dir.path().join("a/x.png"), dir.path().join("a/y.png"), dir.path().join("a b/x.png")]
        );
    }

    #[test]
    fn a_pending_folder_lists_no_media_paths() {
        let dir = fixture(&[("a.png", 1), ("b.png", 1)]);
        let mut set = Set::default();

        set.add(vec![(dir.path().to_path_buf(), Classified::Folder)], true);
        add(&mut set, &[dir.path().join("b.png")], true);

        assert_eq!(set.media_paths(), [dir.path().join("b.png")]);
    }

    #[test]
    fn media_paths_always_match_the_total() {
        let dir = fixture(&[("a.png", 1), ("sub/b.png", 1), ("sub/c.mp4", 1), ("gone/d.png", 1)]);
        let mut set = Set::default();
        let gone = dir.path().join("gone");
        let jobs = set.add(vec![(gone.clone(), Classified::Folder)], true);
        std::fs::remove_dir_all(&gone).unwrap();
        run(&mut set, &jobs);
        assert_eq!(set.media_paths().len(), set.total());

        add(&mut set, &[dir.path().to_path_buf(), dir.path().join("sub"), dir.path().join("a.png")], true);
        assert_eq!(set.media_paths().len(), set.total());
        assert_eq!(set.total(), 3);

        let jobs = set.rescan(false);
        assert_eq!(set.media_paths().len(), set.total());
        run(&mut set, &jobs);
        assert_eq!(set.media_paths().len(), set.total());
        assert_eq!(set.total(), 3);
    }

    // --- Scan subfolders recounts ---

    #[test]
    fn unchecking_scan_subfolders_recounts_without_subfolders() {
        let mut files: Vec<String> = (0..5).map(|i| format!("{i}.png")).collect();
        files.extend((0..20).map(|i| format!("sub/deeper/{i}.png")));
        let dir = fixture(&files.iter().map(|n| (n.as_str(), 1)).collect::<Vec<_>>());
        let mut set = Set::default();
        add(&mut set, &[dir.path().to_path_buf()], true);
        assert_eq!(rows(&set)[0].count, 25);

        let jobs = set.rescan(false);
        assert!(rows(&set)[0].pending);
        assert!(jobs.iter().all(|job| !job.recursive));
        run(&mut set, &jobs);

        assert_eq!(rows(&set)[0].count, 5);
        assert_eq!(set.total(), 5);
    }

    #[test]
    fn a_listing_started_before_a_rescan_is_dropped() {
        let dir = fixture(&[("a.png", 1), ("sub/b.png", 1)]);
        let mut set = Set::default();
        let before = set.add(vec![(dir.path().to_path_buf(), Classified::Folder)], true);

        let after = set.rescan(false);

        assert!(!set.commit(&before[0], list_folder(dir.path(), true)));
        assert!(set.commit(&after[0], list_folder(dir.path(), false)));
        assert_eq!(rows(&set)[0].count, 1);
    }

    #[test]
    fn a_rescan_leaves_files_alone() {
        let dir = fixture(&[("a.png", 1)]);
        let mut set = Set::default();
        add(&mut set, &[dir.path().join("a.png")], true);

        assert!(set.rescan(false).is_empty());
        assert_eq!(set.total(), 1);
    }

    // --- Revision ---

    #[test]
    fn every_change_bumps_the_revision() {
        let dir = fixture(&[("a.png", 1)]);
        let mut set = Set::default();
        let mut last = set.view(None).revision;
        let mut bumped = |set: &Set| {
            let revision = set.view(None).revision;
            let grew = revision > last;
            last = revision;
            grew
        };

        let jobs = set.add(vec![(dir.path().to_path_buf(), Classified::Folder)], true);
        assert!(bumped(&set), "add");
        run(&mut set, &jobs);
        assert!(bumped(&set), "commit");
        let jobs = set.rescan(false);
        assert!(bumped(&set), "rescan");
        run(&mut set, &jobs);
        assert!(bumped(&set), "commit after rescan");
        set.remove(dir.path());
        assert!(bumped(&set), "remove");
        set.remove(dir.path());
        assert!(!bumped(&set), "removing a missing path");
    }

    #[test]
    fn the_view_serializes_as_the_frontend_reads_it() {
        let dir = fixture(&[("a.png", 4)]);
        let mut set = Set::default();
        add(&mut set, &[dir.path().join("a.png")], true);

        let json = serde_json::to_value(set.view(None)).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "revision": 1,
                "sources": [{
                    "path": display(&dir.path().join("a.png")),
                    "name": "a.png",
                    "location": display(dir.path()),
                    "kind": "image",
                    "count": 1,
                    "size": 4,
                    "unreadable": false,
                    "pending": false,
                }],
                "total": 1,
            })
        );
    }
}
