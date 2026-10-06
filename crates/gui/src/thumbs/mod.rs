//! Thumbnails: which files the window may see, and how small pictures of them reach it.
//!
//! The window admits files with [`commands::admit_media`] (or [`commands::describe_media`]) and gets back an
//! *identity* for each: a hash of the file's path, size and modification time. It then loads
//! `thumb://localhost/<identity>?size=<bound>` in an `<img>`, which [`serve`] answers with a rendition from [`cache`],
//! rendered by [`preview`]. A request names an identity, never a path, so the window can only reach files that were
//! admitted.

mod cache;
pub mod commands;
mod preview;
mod serve;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use mediasim::MediaType;

use cache::Renditions;
pub use serve::serve;
pub(crate) use serve::{Refusal, locate};

// Must stay in sync with `tauri.conf.json`'s `img-src`, which needs both platform forms of it.
/// The URI scheme thumbnails are served over. Registered in `src/lib.rs`.
pub const SCHEME: &str = "thumb";

/// What was recorded about a file when it was admitted, to tell later whether it has changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Admitted {
    /// The path as admitted, which is what is read to render it.
    pub(crate) path: PathBuf,
    /// The size in bytes as admitted, which [`locate`] checks the file still has.
    pub(crate) size: u64,
    modified: SystemTime,
}

/// The admitted files and the rendition cache, as Tauri managed state.
///
/// The registry is never cleared during a run: an entry is about 100 bytes, and an identity handed to the window must
/// stay valid until the application exits.
#[derive(Debug, Default)]
pub struct ThumbState {
    admitted: Mutex<HashMap<String, Admitted>>,
    /// Set once by [`ThumbState::open_cache`], off the main thread; requests wait for it.
    renditions: OnceLock<Renditions>,
}

impl ThumbState {
    fn admitted(&self) -> MutexGuard<'_, HashMap<String, Admitted>> {
        // Entries are inserted whole, so a panic elsewhere can't leave one half-written.
        self.admitted.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn admit(&self, entries: impl IntoIterator<Item = (String, Admitted)>) {
        let mut admitted = self.admitted();
        for (identity, entry) in entries {
            // Re-admitting a file keeps its first entry, which describes the same file.
            admitted.entry(identity).or_insert(entry);
        }
    }

    pub(crate) fn lookup(&self, identity: &str) -> Option<Admitted> {
        self.admitted().get(identity).cloned()
    }

    /// Opens the rendition cache under `dir`, or in memory alone when `dir` is `None` or can't be used. Only the first
    /// call has an effect.
    ///
    /// Must never panic or fail: every thumbnail request blocks in [`renditions`](Self::renditions) until this has
    /// run, so a `setup` thread that died before it would leave them waiting forever.
    pub fn open_cache(&self, dir: Option<&Path>) {
        let _ = self.renditions.set(Renditions::open(dir));
    }

    /// The rendition cache, waiting for [`open_cache`](Self::open_cache) if it hasn't finished.
    fn renditions(&self) -> &Renditions {
        self.renditions.wait()
    }
}

/// Stats `path` and returns its identity, what was recorded and its media type, or `None` when it is not an existing
/// file of a supported media type. The file is never opened: one that exists and won't decode is admitted, and its
/// requests are answered as gone.
pub(crate) fn admit_one(path: &Path) -> Option<(String, Admitted, MediaType)> {
    let media_type = MediaType::from_path(path)?;
    // `media-rs` takes a video's input as `&str`, so a video whose path isn't Unicode could never be rendered.
    if media_type == MediaType::Video && path.to_str().is_none() {
        return None;
    }

    let (identity, admitted) = stat(path)?;

    Some((identity, admitted, media_type))
}

/// The identity `path` would be admitted under now, or `None` when it is not an existing file. Comparing it with an
/// earlier identity tells whether the file is still the one that was admitted.
pub(crate) fn current_identity(path: &Path) -> Option<String> {
    stat(path).map(|(identity, _)| identity)
}

/// Stats `path` and returns its identity and what is recorded about it, or `None` when it is not an existing file.
fn stat(path: &Path) -> Option<(String, Admitted)> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }

    let modified = metadata.modified().ok()?;
    let identity = identity(&std::fs::canonicalize(path).ok()?, metadata.len(), modified);

    Some((identity, Admitted { path: path.to_path_buf(), size: metadata.len(), modified }))
}

/// XXH3-64 of the canonical path's bytes, the size and the modification time in nanoseconds since the Unix epoch,
/// as 16 lowercase hex characters.
///
/// Not a hash of the contents: admitting a set of tens of thousands of files must not read every byte of them. A
/// rewritten file almost always changes its size or modification time, and so gets a new identity, which is also
/// what keeps the disk cache from ever serving a stale picture.
fn identity(canonical: &Path, size: u64, modified: SystemTime) -> String {
    let mut bytes = canonical.as_os_str().as_encoded_bytes().to_vec();
    bytes.extend_from_slice(&size.to_le_bytes());
    bytes.extend_from_slice(&nanos_since_epoch(modified).to_le_bytes());

    rust_sak::crypto::xxh3_bytes(&bytes)
}

/// `time` as signed nanoseconds since the Unix epoch, so a time before it is a negative value rather than an error.
fn nanos_since_epoch(time: SystemTime) -> i128 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => i128::try_from(after.as_nanos()).unwrap_or(i128::MAX),
        Err(before) => -i128::try_from(before.duration().as_nanos()).unwrap_or(i128::MAX),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::time::Duration;

    use rust_sak::fs::mk_temp_dir;

    use super::*;

    /// The path of a file in the workspace's `fixtures` directory.
    pub(crate) fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)
    }

    /// A state with an in-memory cache, as `setup` leaves it when the cache directory can't be used.
    pub(crate) fn state() -> ThumbState {
        let state = ThumbState::default();
        state.open_cache(None);
        state
    }

    /// Sets the modification time of `path`, so a test can tell a rewrite from the original on any filesystem.
    pub(crate) fn set_modified(path: &Path, time: SystemTime) {
        std::fs::File::options().write(true).open(path).unwrap().set_modified(time).unwrap();
    }

    #[test]
    fn an_identity_is_sixteen_lowercase_hex_characters() {
        let (identity, ..) = admit_one(&fixture("test1.png")).unwrap();

        assert_eq!(identity.len(), 16);
        assert!(identity.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "{identity}");
    }

    #[test]
    fn the_same_file_gets_the_same_identity() {
        let path = fixture("test1.png");

        assert_eq!(admit_one(&path).unwrap().0, admit_one(&path).unwrap().0);
    }

    #[test]
    fn two_spellings_of_one_file_share_an_identity() {
        let direct = fixture("test1.png");
        let roundabout = direct.parent().unwrap().join("..").join("fixtures").join("test1.png");

        assert_eq!(admit_one(&direct).unwrap().0, admit_one(&roundabout).unwrap().0);
    }

    #[test]
    fn a_rewritten_file_gets_a_new_identity() {
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let path = dir.path().join("a.png");
        std::fs::write(&path, b"first").unwrap();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        let before = admit_one(&path).unwrap().0;

        std::fs::write(&path, b"second, longer").unwrap();
        set_modified(&path, UNIX_EPOCH + Duration::from_secs(1_700_000_001));

        assert_ne!(admit_one(&path).unwrap().0, before);
    }

    #[test]
    fn a_change_of_size_or_time_alone_changes_the_identity() {
        let path = Path::new("/a/b.png");
        let time = UNIX_EPOCH + Duration::from_secs(1_700_000_000);

        let base = identity(path, 10, time);

        assert_ne!(identity(path, 11, time), base);
        assert_ne!(identity(path, 10, time + Duration::from_nanos(1)), base);
        assert_ne!(identity(Path::new("/a/c.png"), 10, time), base);
    }

    #[test]
    fn a_time_before_the_epoch_is_negative() {
        assert_eq!(nanos_since_epoch(UNIX_EPOCH - Duration::from_nanos(5)), -5);
        assert_eq!(nanos_since_epoch(UNIX_EPOCH + Duration::from_nanos(5)), 5);
    }

    #[test]
    fn a_missing_file_a_folder_or_a_non_media_file_is_not_admitted() {
        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let notes = dir.path().join("notes.txt");
        std::fs::write(&notes, b"not media").unwrap();
        let folder = dir.path().join("folder.png");
        std::fs::create_dir(&folder).unwrap();

        assert!(admit_one(&dir.path().join("missing.png")).is_none());
        assert!(admit_one(&folder).is_none());
        assert!(admit_one(&notes).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn a_video_whose_path_is_not_unicode_is_not_admitted() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let dir = mk_temp_dir("mediasim-thumbs-").unwrap();
        let video = dir.path().join(OsStr::from_bytes(b"clip-\xff.mp4"));
        let image = dir.path().join(OsStr::from_bytes(b"photo-\xff.png"));
        // macOS refuses names that aren't UTF-8; only a filesystem that accepts them can test this.
        if std::fs::copy(fixture("test3.mp4"), &video).is_err() {
            return;
        }
        std::fs::copy(fixture("test1.png"), &image).unwrap();

        assert!(admit_one(&video).is_none());
        assert!(admit_one(&image).is_some());
    }

    #[test]
    fn tauri_conf_json_lets_the_window_load_the_scheme() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json is JSON");

        for policy in ["csp", "devCsp"] {
            let img_src = conf["app"]["security"][policy]["img-src"].as_str().expect("img-src is set");
            let sources: Vec<_> = img_src.split_whitespace().collect();

            assert!(sources.contains(&format!("{SCHEME}:").as_str()), "{policy} img-src lacks {SCHEME}:");
            assert!(
                sources.contains(&format!("http://{SCHEME}.localhost").as_str()),
                "{policy} img-src lacks http://{SCHEME}.localhost"
            );
        }
    }

    #[test]
    fn re_admitting_keeps_the_first_entry() {
        let state = ThumbState::default();
        let (identity, entry, _) = admit_one(&fixture("test1.png")).unwrap();

        state.admit([(identity.clone(), entry.clone())]);
        state.admit([(identity.clone(), Admitted { path: "elsewhere.png".into(), ..entry.clone() })]);

        assert_eq!(state.lookup(&identity), Some(entry));
    }
}
