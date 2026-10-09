//! Which files the window may name, and whether each is still the file it was shown.
//!
//! The window admits files with [`admit_media`](crate::thumbs::commands::admit_media) (or `describe_media`, or a set
//! listing) and gets back an *identity* for each: a hash of the file's canonical path, size and modification time.
//! Every later request — a thumbnail, a video range, a probe, opening, revealing, moving to the Trash or deleting —
//! names an identity, never a path, so the window can only reach files recorded in [`Admissions`], and only while the
//! file on disk is still the one admitted.
//!
//! Admission itself takes any path the window sends: what it guarantees is that a request acts on a file the window
//! was shown, unchanged, not that the user picked that file. Moving to the Trash and deleting check that as well,
//! against the roots [`roots`](crate::roots) records.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use mediasim::MediaType;

use crate::scheme::Refusal;

/// What was recorded about a file when it was admitted, to tell later whether it has changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Admitted {
    /// The path as admitted, which is what is read to render it.
    pub(crate) path: PathBuf,
    /// `path` canonicalized at admission, which [`locate`] checks it still resolves to.
    canonical: PathBuf,
    /// The size in bytes as admitted, which [`locate`] checks the file still has.
    pub(crate) size: u64,
    modified: SystemTime,
}

/// The admitted files, by identity, as Tauri managed state.
///
/// Never cleared during a run: an entry is about 200 bytes, and an identity handed to the window must stay valid until
/// the application exits.
#[derive(Debug, Default)]
pub struct Admissions(Mutex<HashMap<String, Admitted>>);

impl Admissions {
    fn admitted(&self) -> MutexGuard<'_, HashMap<String, Admitted>> {
        // Entries are inserted whole, so a panic elsewhere can't leave one half-written.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
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

/// The admitted file behind `identity`, if it is still the file that was admitted, as [`still_admitted`] tells.
///
/// What the `video` scheme and commands check before every answer; the `thumb` scheme checks the same in two steps.
/// It runs before the thumbnail cache, so a file that was removed or changed stops being served even while a
/// rendition of it is still cached.
pub(crate) fn locate(registry: &Admissions, identity: &str) -> Result<Admitted, Refusal> {
    let admitted = registry.lookup(identity).ok_or(Refusal::NotFound)?;

    if still_admitted(&admitted) { Ok(admitted) } else { Err(Refusal::Gone) }
}

/// Whether the file at `admitted`'s path still has the size, modification time and canonical path it was admitted
/// with.
pub(crate) fn still_admitted(admitted: &Admitted) -> bool {
    let Ok(metadata) = std::fs::metadata(&admitted.path) else {
        return false;
    };

    // The canonical path last, so the common case of a changed file is told without resolving every component.
    metadata.is_file()
        && metadata.len() == admitted.size
        && metadata.modified().ok() == Some(admitted.modified)
        && std::fs::canonicalize(&admitted.path).is_ok_and(|canonical| canonical == admitted.canonical)
}

/// Why the file at an admitted path is no longer the one admitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mismatch {
    /// Something else is at the path now.
    Changed,
    /// Nothing is at the path now.
    Missing,
}

/// Checks that the file at `path` is still the one admitted as `identity`, just before it is acted on: its identity
/// is rebuilt from the file as it is now, canonical path included.
pub(crate) fn check_admitted(identity: &str, path: &Path) -> Result<(), Mismatch> {
    match current_identity(path) {
        Some(current) if current == identity => Ok(()),
        // A path that is now a folder, or unreadable, is not the file that was admitted either.
        _ if path.try_exists().is_ok_and(|exists| !exists) => Err(Mismatch::Missing),
        _ => Err(Mismatch::Changed),
    }
}

/// Stats `path` and returns its identity and what is recorded about it, or `None` when it is not an existing file.
fn stat(path: &Path) -> Option<(String, Admitted)> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }

    let modified = metadata.modified().ok()?;
    let canonical = std::fs::canonicalize(path).ok()?;
    let identity = identity(&canonical, metadata.len(), modified);

    Some((identity, Admitted { path: path.to_path_buf(), canonical, size: metadata.len(), modified }))
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

    /// Sets the modification time of `path`, so a test can tell a rewrite from the original on any filesystem.
    pub(crate) fn set_modified(path: &Path, time: SystemTime) {
        std::fs::File::options().write(true).open(path).unwrap().set_modified(time).unwrap();
    }

    #[test]
    fn an_identity_is_sixteen_lowercase_hex_characters() {
        let (identity, ..) = admit_one(&fixture("test1.avif")).unwrap();

        assert_eq!(identity.len(), 16);
        assert!(identity.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "{identity}");
    }

    #[test]
    fn the_same_file_gets_the_same_identity() {
        let path = fixture("test1.avif");

        assert_eq!(admit_one(&path).unwrap().0, admit_one(&path).unwrap().0);
    }

    #[test]
    fn two_spellings_of_one_file_share_an_identity() {
        let direct = fixture("test1.avif");
        let roundabout = direct.parent().unwrap().join("..").join("fixtures").join("test1.avif");

        assert_eq!(admit_one(&direct).unwrap().0, admit_one(&roundabout).unwrap().0);
    }

    #[test]
    fn a_rewritten_file_gets_a_new_identity() {
        let dir = mk_temp_dir("mediasim-admission-").unwrap();
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
        let dir = mk_temp_dir("mediasim-admission-").unwrap();
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

        let dir = mk_temp_dir("mediasim-admission-").unwrap();
        let video = dir.path().join(OsStr::from_bytes(b"clip-\xff.mp4"));
        let image = dir.path().join(OsStr::from_bytes(b"photo-\xff.png"));
        // macOS refuses names that aren't UTF-8; only a filesystem that accepts them can test this.
        if std::fs::copy(fixture("test3.mkv"), &video).is_err() {
            return;
        }
        std::fs::copy(fixture("test1.avif"), &image).unwrap();

        assert!(admit_one(&video).is_none());
        assert!(admit_one(&image).is_some());
    }

    #[test]
    fn re_admitting_keeps_the_first_entry() {
        let registry = Admissions::default();
        let (identity, entry, _) = admit_one(&fixture("test1.avif")).unwrap();

        registry.admit([(identity.clone(), entry.clone())]);
        registry.admit([(identity.clone(), Admitted { path: "elsewhere.png".into(), ..entry.clone() })]);

        assert_eq!(registry.lookup(&identity), Some(entry));
    }

    #[test]
    fn an_unchanged_admitted_file_is_located() {
        let registry = Admissions::default();
        let (identity, entry, _) = admit_one(&fixture("test1.avif")).unwrap();
        registry.admit([(identity.clone(), entry.clone())]);

        assert_eq!(locate(&registry, &identity), Ok(entry));
        assert_eq!(locate(&registry, "0123456789abcdef"), Err(Refusal::NotFound));
    }

    /// A path through a symlink that is pointed elsewhere, at an identical copy with the same size and modification
    /// time, resolves to another file, which only the canonical path tells apart.
    #[cfg(unix)]
    #[test]
    fn a_path_that_resolves_to_another_file_is_gone() {
        let dir = mk_temp_dir("mediasim-admission-").unwrap();
        let time = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        for side in ["first", "second"] {
            std::fs::create_dir(dir.path().join(side)).unwrap();
            let copy = dir.path().join(side).join("a.png");
            std::fs::copy(fixture("test1.avif"), &copy).unwrap();
            set_modified(&copy, time);
        }
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(dir.path().join("first"), &link).unwrap();

        let registry = Admissions::default();
        let (identity, entry, _) = admit_one(&link.join("a.png")).unwrap();
        registry.admit([(identity.clone(), entry)]);
        assert!(locate(&registry, &identity).is_ok());

        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(dir.path().join("second"), &link).unwrap();

        assert_eq!(locate(&registry, &identity), Err(Refusal::Gone));
        assert_eq!(check_admitted(&identity, &link.join("a.png")), Err(Mismatch::Changed));
    }
}
