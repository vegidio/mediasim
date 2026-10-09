//! The per-directory cache of decoded media, so a directory load that was interrupted or aborted can resume without
//! decoding again the files it had already finished.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rust_sak::memo::{CacheOpts, KeyBuilder, Memo, MemoError};

use super::{Decoded, FileInfo, Media, MediaStream, MediaType, decode_with};
use crate::{CancelToken, MediaError};

/// The directory, inside the cached one, that holds the cache.
const CACHE_DIR: &str = ".mediasim";

/// The database file inside [`CACHE_DIR`].
const CACHE_FILE: &str = "cache.redb";

/// How long an entry lives.
const TTL: Duration = Duration::from_hours(30 * 24);

/// Leads every key. Bump it when [`Decoded`] or the icon pipeline changes meaning, so old entries are never read.
const KEY_VERSION: &str = "v1";

/// How long [`DirCache::finish`] keeps retrying to delete a database that is still open (Windows only).
const DELETE_RETRY: Duration = Duration::from_secs(1);

/// The pause between two of those attempts.
const DELETE_RETRY_STEP: Duration = Duration::from_millis(20);

/// A directory's cache of decoded media, kept in `<dir>/.mediasim/cache.redb` while the directory is being loaded.
///
/// Load through it with [`Media::from_files_cached`]: a file whose entry still matches (same path relative to the
/// directory, same size, same modification time) is served without being decoded, and every other file is decoded
/// and stored. Entries live for 30 days. Files that fail to load are never stored.
///
/// The run's outcome decides what happens to the cache:
///
/// - **Every file finished loading**: call [`finish`](Self::finish), which deletes the cache.
/// - **Anything else** (the user gave up, or a load error ended the run): drop the handle. Every entry written so far
///   is made durable, and the next run opened on the same directory resumes from it.
///
/// [`Media::from_dir`] stays uncached: a stream cannot tell "every file finished" from "the caller gave up".
///
/// ```no_run
/// use mediasim::{DirCache, LoadOptions, Media};
///
/// let paths = Media::list_dir("photos", &LoadOptions::new())?;
/// let cache = DirCache::open("photos");
/// let stream = match &cache {
///     Some(cache) => Media::from_files_cached(paths, cache),
///     None => Media::from_files(paths),
/// };
///
/// let media = stream.collect::<Result<Vec<_>, _>>()?;
/// // Only reached when every file loaded. On an error, `?` drops the cache, which keeps it for the next run.
/// if let Some(cache) = cache {
///     cache.finish();
/// }
/// # Ok::<(), mediasim::MediaError>(())
/// ```
#[derive(Debug)]
pub struct DirCache {
    /// The cached directory, exactly as the caller gave it, so it prefixes the paths [`Media::list_dir`] lists.
    root: PathBuf,
    memo: Memo,
}

impl DirCache {
    /// A write is made durable at least every this many writes...
    pub const FLUSH_EVERY: u32 = 64;

    /// ...or once this long has passed since the last durable one. Losing the last second's writes on a crash only
    /// costs decoding those files again.
    pub const FLUSH_INTERVAL: Duration = Duration::from_secs(1);

    /// Opens the cache of `dir`, creating `dir/.mediasim/cache.redb` if it does not exist.
    ///
    /// Returns `None` when no cache is available: for example when `dir` is read-only, when `.mediasim` is not a
    /// directory, when the database is corrupt (it is then left as it is), or when another process holds it. Load
    /// without a cache then.
    ///
    /// The cache is keyed on paths relative to `dir`, so open it on the directory the paths were listed from. One
    /// cache serves its subdirectories too.
    #[must_use]
    pub fn open(dir: impl AsRef<Path>) -> Option<Self> {
        let root = dir.as_ref().to_path_buf();
        let opts = CacheOpts::new().flush_every(Self::FLUSH_EVERY).flush_interval(Self::FLUSH_INTERVAL);
        let memo = Memo::disk_file(root.join(CACHE_DIR).join(CACHE_FILE), opts).ok()?;

        Some(Self { root, memo })
    }

    /// Deletes the cache: its database file, and then `.mediasim/` if that leaves it empty.
    ///
    /// Call it only once every stream loading through this cache has been exhausted, after a load that counts as
    /// complete. It is best-effort: a file that cannot be deleted is left behind silently, and remains a valid cache
    /// for the next run.
    pub fn finish(self) {
        let dir = self.root.join(CACHE_DIR);
        drop(self);

        remove_file(&dir.join(CACHE_FILE));
        let _ = std::fs::remove_dir(dir);
    }

    /// The decoder that loads through this cache. It holds the cache's store rather than borrowing the handle.
    pub(crate) fn decoder(&self) -> CachedDecoder {
        CachedDecoder { root: self.root.clone(), memo: self.memo.clone() }
    }
}

/// What loads through a [`DirCache`]: the cache's entry for a file if one matches, and otherwise a fresh decode,
/// stored.
#[derive(Debug, Clone)]
pub(crate) struct CachedDecoder {
    root: PathBuf,
    memo: Memo,
}

impl CachedDecoder {
    /// Extracts the contents of `path`, of type `media_type` and with the metadata `info`, from the cache or by
    /// decoding it, stopping with [`MediaError::Cancelled`] once `cancel`, if given, is cancelled. Only a successful
    /// decode is stored, so a cancelled one never is.
    fn decode(
        &self,
        path: &Path,
        media_type: MediaType,
        info: &FileInfo,
        cancel: Option<&CancelToken>,
    ) -> Result<Decoded, MediaError> {
        let Some(key) = key(&self.root, path, info.size, info.modified) else {
            return decode_with(path, media_type, cancel);
        };

        // `memo` hands a failed computation back as an opaque `Compute`, so the original error waits here.
        let mut failure = None;
        let cached = self.memo.get_or_compute(&key, TTL, || {
            decode_with(path, media_type, cancel).map_err(|err| {
                failure = Some(err);
                DecodeFailed
            })
        });

        match (cached, failure) {
            (Ok(decoded), _) => Ok(decoded),
            (Err(MemoError::Compute(_)), Some(err)) => Err(err),
            // Anything else is the cache's own failure, which is never the reason a file fails.
            (Err(_), _) => decode_with(path, media_type, cancel),
        }
    }
}

impl Drop for DirCache {
    /// Makes every deferred write durable, so the next run resumes from it. Workers of an abandoned stream may still
    /// hold the store, and the process may exit before they release it.
    fn drop(&mut self) {
        let _ = self.memo.flush();
    }
}

impl Media {
    /// Loads every path in parallel through `cache`, as [`from_files`](Self::from_files) does.
    ///
    /// A file whose cache entry still matches is served from it without being decoded. Every other file is decoded
    /// and, if it loads, stored. A file's metadata (path, size, timestamps) is always read from the file. The results
    /// equal those of an uncached load.
    ///
    /// A path that is not inside the cached directory, or whose modification time the filesystem does not provide,
    /// is loaded without the cache.
    #[must_use = "dropping the stream stops the batch"]
    pub fn from_files_cached<P>(paths: Vec<P>, cache: &DirCache) -> MediaStream
    where
        P: AsRef<Path> + Send + 'static,
    {
        Self::from_files_cached_cancellable(paths, cache.decoder(), &CancelToken::new())
    }

    /// Loads every path in parallel through `decoder`, as [`from_files_cached`](Self::from_files_cached) does,
    /// stopping once `cancel` is cancelled as [`from_files_cancellable`](Self::from_files_cancellable) does.
    pub(crate) fn from_files_cached_cancellable<P>(
        paths: Vec<P>,
        decoder: CachedDecoder,
        cancel: &CancelToken,
    ) -> MediaStream
    where
        P: AsRef<Path> + Send + 'static,
    {
        let token = cancel.clone();
        Self::load_all(paths, cancel.clone(), move |path| {
            Self::load(path, |path, media_type, info| decoder.decode(path, media_type, info, Some(&token)))
        })
    }
}

/// The marker error a failed decode hands to the cache, while the real one is kept aside.
#[derive(Debug, thiserror::Error)]
#[error("the file could not be decoded")]
struct DecodeFailed;

/// The cache key of the file at `path` under `root`: the key version, the relative path, the size and the
/// modification time. `None` when the path is outside `root`, or the modification time is missing or before 1970.
///
/// The path is keyed as its components' raw bytes joined by `/`, so a non-Unicode name still gets a key of its own,
/// and a valid Unicode one gets the same key on every platform.
fn key(root: &Path, path: &Path, size: u64, modified: Option<SystemTime>) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let since_epoch = modified?.duration_since(UNIX_EPOCH).ok()?;

    let mut bytes = Vec::new();
    for (i, component) in relative.components().enumerate() {
        if i > 0 {
            bytes.push(b'/');
        }
        bytes.extend_from_slice(component.as_os_str().as_encoded_bytes());
    }

    Some(
        KeyBuilder::new()
            .part(KEY_VERSION)
            .part(&bytes)
            .part(&size)
            .part(&(since_epoch.as_secs(), since_epoch.subsec_nanos()))
            .finish(),
    )
}

/// Deletes `path`, ignoring failure. Windows cannot delete a file that is still open, and the store's background
/// sweep may hold it a moment longer than the last handle, so there it retries for up to [`DELETE_RETRY`].
fn remove_file(path: &Path) {
    let deadline = Instant::now() + DELETE_RETRY;

    while let Err(err) = std::fs::remove_file(path) {
        if !cfg!(windows) || err.kind() == std::io::ErrorKind::NotFound || Instant::now() >= deadline {
            return;
        }
        std::thread::sleep(DELETE_RETRY_STEP);
    }
}

#[cfg(test)]
mod tests {
    use std::fs::File;

    use rust_sak::fs::{TempDir, mk_temp_dir};

    use super::*;
    use crate::media::tests::fixture;

    /// A temporary directory holding a copy of each `(fixture, name)` pair.
    fn directory(files: &[(&str, &str)]) -> TempDir {
        let dir = mk_temp_dir("mediasim").unwrap();
        for (fixture_name, name) in files {
            std::fs::copy(fixture(fixture_name), dir.path().join(name)).unwrap();
        }
        dir
    }

    fn cache_file(dir: &Path) -> PathBuf {
        dir.join(CACHE_DIR).join(CACHE_FILE)
    }

    /// Every result of loading `paths` through a cache opened on `dir`, which is then dropped.
    fn load_cached(dir: &Path, paths: Vec<PathBuf>) -> Vec<Result<Media, MediaError>> {
        let cache = DirCache::open(dir).expect("a cache in a writable directory");
        Media::from_files_cached(paths, &cache).collect()
    }

    /// Every loaded media, sorted by path, failing on any error.
    fn sorted(results: Vec<Result<Media, MediaError>>) -> Vec<Media> {
        let mut media: Vec<_> = results.into_iter().map(Result::unwrap).collect();
        media.sort_by(|a, b| a.path.cmp(&b.path));
        media
    }

    fn modified(path: &Path) -> SystemTime {
        std::fs::metadata(path).unwrap().modified().unwrap()
    }

    /// Replaces the contents of `path` with as many undecodable bytes, then sets its modification time to `mtime`.
    fn overwrite_with_garbage(path: &Path, mtime: SystemTime) {
        let len = std::fs::metadata(path).unwrap().len();
        std::fs::write(path, vec![0xAB; usize::try_from(len).unwrap()]).unwrap();
        File::options().write(true).open(path).unwrap().set_modified(mtime).unwrap();
    }

    // DirCache::open

    #[test]
    fn first_open_creates_the_database() {
        let dir = mk_temp_dir("mediasim").unwrap();

        let cache = DirCache::open(dir.path());

        assert!(cache.is_some());
        assert!(cache_file(dir.path()).is_file());
    }

    #[test]
    fn a_cache_dir_that_is_a_file_gives_no_cache() {
        let dir = mk_temp_dir("mediasim").unwrap();
        std::fs::write(dir.path().join(CACHE_DIR), b"not a directory").unwrap();

        assert!(DirCache::open(dir.path()).is_none());
    }

    #[test]
    fn a_corrupt_database_gives_no_cache_and_is_left_alone() {
        let dir = mk_temp_dir("mediasim").unwrap();
        std::fs::create_dir(dir.path().join(CACHE_DIR)).unwrap();
        let garbage: Vec<u8> = (0..4096u32).map(|i| (i * 7 % 251) as u8).collect();
        std::fs::write(cache_file(dir.path()), &garbage).unwrap();

        assert!(DirCache::open(dir.path()).is_none());
        assert_eq!(std::fs::read(cache_file(dir.path())).unwrap(), garbage);
    }

    /// Tells [`hold_cache`] which directory's cache to hold.
    const HOLD_IN: &str = "MEDIASIM_TEST_HOLD_CACHE_IN";

    /// What [`hold_cache`] prints once it holds the cache.
    const HELD: &str = "mediasim-test-cache-held";

    /// Not a test on its own: the other process of [`a_cache_held_by_another_process_gives_no_cache`], which runs this
    /// test binary again with [`HOLD_IN`] set. It holds that directory's cache until its stdin closes.
    #[test]
    #[ignore = "run by a_cache_held_by_another_process_gives_no_cache"]
    fn hold_cache() {
        use std::io::{Read, Write};

        let Some(dir) = std::env::var_os(HOLD_IN) else { return };
        let _cache = DirCache::open(dir).expect("a cache in a writable directory");

        println!("{HELD}");
        std::io::stdout().flush().unwrap();
        let _ = std::io::stdin().read(&mut [0]);
    }

    #[test]
    fn a_cache_held_by_another_process_gives_no_cache() {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let dir = mk_temp_dir("mediasim").unwrap();
        let (_, module) = module_path!().split_once("::").unwrap();
        let mut holder = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", &format!("{module}::hold_cache"), "--ignored", "--nocapture", "--test-threads=1"])
            .env(HOLD_IN, dir.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();

        // The test harness may print the test's name on the same line, before what the test prints.
        let mut lines = BufReader::new(holder.stdout.take().unwrap()).lines().map_while(Result::ok);
        let held = lines.any(|line| line.contains(HELD));
        assert!(held, "the other process never held the cache");

        assert!(DirCache::open(dir.path()).is_none());

        // Read the harness's report to the end, so the other process never writes to a closed pipe.
        drop(holder.stdin.take());
        lines.for_each(drop);
        assert!(holder.wait().unwrap().success());
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_directory_gives_no_cache() {
        use std::os::unix::fs::PermissionsExt;

        let dir = mk_temp_dir("mediasim").unwrap();
        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();

        // Root ignores permissions, so the scenario can't be reproduced there.
        let denied = std::fs::write(dir.path().join("probe"), b"").is_err();
        let cache = DirCache::open(dir.path());

        std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();

        if denied {
            assert!(cache.is_none());
        } else {
            eprintln!("skipped a_read_only_directory_gives_no_cache: permissions are not enforced (running as root?)");
        }
    }

    // key

    fn at(secs: u64, nanos: u32) -> SystemTime {
        UNIX_EPOCH + Duration::new(secs, nanos)
    }

    #[test]
    fn the_same_relative_file_under_two_roots_has_one_key() {
        let a = key(Path::new("/photos"), Path::new("/photos/sub/a.png"), 10, Some(at(5, 1)));
        let b = key(Path::new("moved/here"), Path::new("moved/here/sub/a.png"), 10, Some(at(5, 1)));

        assert!(a.is_some());
        assert_eq!(a, b);
    }

    #[test]
    fn a_changed_size_or_mtime_changes_the_key() {
        let key_of = |size, modified| key(Path::new("d"), Path::new("d/a.png"), size, modified).unwrap();
        let base = key_of(10, Some(at(5, 1)));

        assert_ne!(base, key_of(11, Some(at(5, 1))));
        assert_ne!(base, key_of(10, Some(at(6, 1))));
        assert_ne!(base, key_of(10, Some(at(5, 2))));
    }

    #[cfg(unix)]
    #[test]
    fn names_that_are_not_unicode_have_distinct_keys() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let root = Path::new("d");
        let key_of = |name: &[u8]| key(root, &root.join(OsStr::from_bytes(name)), 10, Some(at(5, 1))).unwrap();

        assert_ne!(key_of(b"a\xff.png"), key_of(b"a\xfe.png"));
    }

    #[test]
    fn a_file_without_a_usable_mtime_or_outside_the_root_has_no_key() {
        assert_eq!(key(Path::new("d"), Path::new("elsewhere/a.png"), 10, Some(at(5, 1))), None);
        assert_eq!(key(Path::new("d"), Path::new("d/a.png"), 10, None), None);
        assert_eq!(
            key(Path::new("d"), Path::new("d/a.png"), 10, UNIX_EPOCH.checked_sub(Duration::from_secs(1))),
            None
        );
    }

    // Media::from_files_cached

    #[test]
    fn a_second_load_is_served_from_the_cache() {
        let dir = directory(&[("test2.png", "a.png")]);
        let path = dir.path().join("a.png");
        let first = sorted(load_cached(dir.path(), vec![path.clone()]));

        overwrite_with_garbage(&path, modified(&path));
        let second = sorted(load_cached(dir.path(), vec![path.clone()]));

        assert_eq!((second[0].width, second[0].height), (first[0].width, first[0].height));
        assert_eq!(second[0].duration, first[0].duration);
        assert_eq!(second[0].frames, first[0].frames);
    }

    #[test]
    fn cached_loads_equal_uncached_ones() {
        let dir = directory(&[
            ("test1.png", "test1.png"),
            ("test2.png", "test2.png"),
            ("test3.mp4", "test3.mp4"),
            ("test4.mp4", "test4.mp4"),
        ]);
        let paths: Vec<_> = ["test1.png", "test2.png", "test3.mp4", "test4.mp4"]
            .iter()
            .map(|name| dir.path().join(name))
            .collect();

        let uncached = sorted(Media::from_files(paths.clone()).collect());
        let stored = sorted(load_cached(dir.path(), paths.clone()));
        let served = sorted(load_cached(dir.path(), paths));

        assert_eq!(stored, uncached);
        assert_eq!(served, uncached);
    }

    #[test]
    fn a_changed_mtime_forces_a_new_decode() {
        let dir = directory(&[("test2.png", "a.png")]);
        let path = dir.path().join("a.png");
        sorted(load_cached(dir.path(), vec![path.clone()]));

        overwrite_with_garbage(&path, modified(&path) + Duration::from_secs(1));
        let results = load_cached(dir.path(), vec![path.clone()]);

        assert!(matches!(&results[..], [Err(MediaError::Image { .. })]), "{results:?}");
    }

    #[test]
    fn a_changed_size_forces_a_new_decode() {
        let dir = directory(&[("test2.png", "a.png")]);
        let path = dir.path().join("a.png");
        sorted(load_cached(dir.path(), vec![path.clone()]));

        let mtime = modified(&path);
        let len = std::fs::metadata(&path).unwrap().len() + 1;
        std::fs::write(&path, vec![0xAB; usize::try_from(len).unwrap()]).unwrap();
        File::options().write(true).open(&path).unwrap().set_modified(mtime).unwrap();
        let results = load_cached(dir.path(), vec![path.clone()]);

        assert!(matches!(&results[..], [Err(MediaError::Image { .. })]), "{results:?}");
    }

    #[test]
    fn a_moved_directory_keeps_its_cache() {
        let parent = mk_temp_dir("mediasim").unwrap();
        let (old, new) = (parent.path().join("old"), parent.path().join("new"));
        std::fs::create_dir(&old).unwrap();
        std::fs::copy(fixture("test2.png"), old.join("a.png")).unwrap();
        let first = sorted(load_cached(&old, vec![old.join("a.png")]));

        std::fs::rename(&old, &new).unwrap();
        let path = new.join("a.png");
        overwrite_with_garbage(&path, modified(&path));
        let second = sorted(load_cached(&new, vec![path]));

        assert_eq!(second[0].frames, first[0].frames);
    }

    #[test]
    fn subdirectories_share_the_cache_of_the_root() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let path = sub.join("a.png");
        std::fs::copy(fixture("test2.png"), &path).unwrap();
        let first = sorted(load_cached(dir.path(), vec![path.clone()]));

        assert!(!sub.join(CACHE_DIR).exists());
        overwrite_with_garbage(&path, modified(&path));
        let second = sorted(load_cached(dir.path(), vec![path]));
        assert_eq!(second[0].frames, first[0].frames);
    }

    #[test]
    fn a_failed_file_keeps_its_error_and_is_retried() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("a.png");
        std::fs::write(&path, b"not a png").unwrap();

        let results = load_cached(dir.path(), vec![path.clone()]);
        let [Err(err @ MediaError::Image { .. })] = &results[..] else {
            panic!("expected an image error: {results:?}")
        };
        assert_eq!(err.path(), path);

        std::fs::copy(fixture("test2.png"), &path).unwrap();
        let results = load_cached(dir.path(), vec![path]);
        assert!(matches!(&results[..], [Ok(_)]), "{results:?}");
    }

    #[test]
    fn a_cancelled_load_stores_no_entry() {
        let dir = directory(&[("test2.png", "a.png")]);
        let path = dir.path().join("a.png");
        let token = CancelToken::new();
        token.cancel();

        let cache = DirCache::open(dir.path()).unwrap();
        let results: Vec<_> =
            Media::from_files_cached_cancellable(vec![path.clone()], cache.decoder(), &token).collect();
        drop(cache);
        assert!(matches!(&results[..], [Err(MediaError::Cancelled { .. })]), "{results:?}");

        overwrite_with_garbage(&path, modified(&path));
        let results = load_cached(dir.path(), vec![path]);
        assert!(matches!(&results[..], [Err(MediaError::Image { .. })]), "{results:?}");
    }

    #[test]
    fn an_uncancelled_cached_load_equals_an_uncached_one() {
        let dir = directory(&[("test1.png", "a.png"), ("test2.png", "b.png")]);
        let paths = vec![dir.path().join("a.png"), dir.path().join("b.png")];

        let cache = DirCache::open(dir.path()).unwrap();
        let cached =
            sorted(Media::from_files_cached_cancellable(paths.clone(), cache.decoder(), &CancelToken::new()).collect());

        assert_eq!(cached, sorted(Media::from_files(paths).collect()));
    }

    // Keeping and finishing

    #[test]
    fn a_dropped_cache_keeps_the_files_that_finished() {
        let names = ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png"];
        let dir = directory(&names.map(|name| ("test2.png", name)));
        let paths: Vec<_> = names.iter().map(|name| dir.path().join(name)).collect();

        let cache = DirCache::open(dir.path()).unwrap();
        let mut stream = Media::from_files_cached(paths, &cache);
        let finished = stream.next().unwrap().unwrap();
        drop(stream);
        drop(cache);

        assert!(cache_file(dir.path()).is_file());
        overwrite_with_garbage(&finished.path, modified(&finished.path));
        let served = sorted(load_cached(dir.path(), vec![finished.path.clone()]));
        assert_eq!(served[0].frames, finished.frames);
    }

    #[test]
    fn finish_after_a_complete_load_removes_the_cache_and_its_directory() {
        let dir = directory(&[("test2.png", "a.png")]);
        let cache = DirCache::open(dir.path()).unwrap();
        sorted(Media::from_files_cached(vec![dir.path().join("a.png")], &cache).collect());

        cache.finish();

        assert!(!dir.path().join(CACHE_DIR).exists());
    }

    #[test]
    fn finish_keeps_a_cache_dir_with_other_content() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let cache = DirCache::open(dir.path()).unwrap();
        let foreign = dir.path().join(CACHE_DIR).join("notes.txt");
        std::fs::write(&foreign, b"mine").unwrap();

        cache.finish();

        assert!(!cache_file(dir.path()).exists());
        assert!(foreign.is_file());
    }
}
