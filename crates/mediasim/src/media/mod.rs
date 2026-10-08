//! Media loading: turns image and video files into [`Media`] values with their file metadata and per-frame
//! [`Icon`] signatures for similarity comparison.

#[cfg(feature = "cache")]
mod cache;
mod image;
mod kind;
mod options;
mod probe;
#[cfg(feature = "serde")]
mod ser;
mod video;

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, SystemTime};

use rayon::ThreadPool;
use rayon::prelude::*;
use rust_sak::fs::ListOptions;

use crate::pool::{image_pool, video_pool};
use crate::{CancelToken, Icon, MediaError};

#[cfg(feature = "cache")]
pub(crate) use cache::CachedDecoder;
#[cfg(feature = "cache")]
pub use cache::DirCache;
pub use kind::MediaFormat;
pub use options::LoadOptions;
pub use probe::MediaInfo;

/// Whether a [`Media`] is a still image or a video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize), serde(rename_all = "lowercase"))]
pub enum MediaType {
    /// A still image, loaded as one frame.
    Image,
    /// A video, loaded as one frame per second of playback.
    Video,
}

/// A loaded media file: its metadata plus its frames as [`Icon`] signatures.
///
/// With the `serde` feature it serializes its metadata in field order, without the frames: `path` as a string (lossy
/// if it isn't Unicode), `type` in lowercase, `duration` in seconds, and `created`/`modified` as RFC 3339 in UTC.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize))]
pub struct Media {
    /// The file this media was loaded from.
    #[cfg_attr(feature = "serde", serde(serialize_with = "ser::path"))]
    pub path: PathBuf,
    /// Whether this is an image or a video.
    #[cfg_attr(feature = "serde", serde(rename = "type"))]
    pub media_type: MediaType,
    /// Width in pixels (for a video, of its first video stream).
    pub width: u32,
    /// Height in pixels (for a video, of its first video stream).
    pub height: u32,
    /// The file size, in bytes.
    pub size: u64,
    /// The playback duration; `None` for images.
    #[cfg_attr(feature = "serde", serde(serialize_with = "ser::seconds"))]
    pub duration: Option<Duration>,
    /// When the file was created, if the platform and filesystem record it.
    #[cfg_attr(feature = "serde", serde(serialize_with = "ser::timestamp"))]
    pub created: Option<SystemTime>,
    /// When the file was last modified, if the platform and filesystem record it.
    #[cfg_attr(feature = "serde", serde(serialize_with = "ser::timestamp"))]
    pub modified: Option<SystemTime>,
    /// The frames as icon signatures: one for an image, one per second for a video.
    #[cfg_attr(feature = "serde", serde(skip))]
    pub(crate) frames: Vec<Icon>,
}

/// What a loader extracts from the file's contents.
#[derive(Debug)]
#[cfg_attr(feature = "cache", derive(serde::Serialize, serde::Deserialize))]
struct Decoded {
    width: u32,
    height: u32,
    duration: Option<Duration>,
    frames: Vec<Icon>,
}

/// What the filesystem reports about a file.
#[derive(Debug)]
struct FileInfo {
    size: u64,
    created: Option<SystemTime>,
    modified: Option<SystemTime>,
}

impl FileInfo {
    /// Reads the size and timestamps of `path`. A timestamp the platform does not provide is `None`, not an error.
    fn read(path: &Path) -> Result<Self, MediaError> {
        let meta = std::fs::metadata(path).map_err(|e| MediaError::io(path, e))?;

        Ok(Self { size: meta.len(), created: meta.created().ok(), modified: meta.modified().ok() })
    }
}

impl Media {
    /// The number of pixels in one frame, `width * height`.
    #[must_use]
    pub fn pixels(&self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }

    /// Loads one image or video file.
    ///
    /// An image yields one frame; a video yields one frame per second of playback, starting at the beginning.
    ///
    /// # Errors
    ///
    /// - [`MediaError::Unsupported`] if the extension is neither a supported image nor video.
    /// - [`MediaError::Io`] if the file's metadata cannot be read (for example, it does not exist).
    /// - [`MediaError::Image`] or [`MediaError::Video`] if the file cannot be decoded.
    /// - [`MediaError::NoFrames`] if a video yields no frames.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, MediaError> {
        Self::load(path.as_ref(), |path, media_type, _| decode(path, media_type))
    }

    /// Loads one image or video file as [`from_file`](Self::from_file) does, stopping early once `cancel` is
    /// cancelled.
    ///
    /// Until `cancel` is cancelled, the result is the same as [`from_file`](Self::from_file)'s. A video stops before
    /// decoding its next sampled frame. An image's decode can't be interrupted, so it stops before decoding starts or
    /// as soon as decoding returns. A token cancelled before the call decodes nothing. One token may be shared by
    /// several loads, and cancelling it stops them all.
    ///
    /// # Errors
    ///
    /// - [`MediaError::Cancelled`] if `cancel` was cancelled before the load finished, whatever else went wrong.
    /// - Otherwise, the errors of [`from_file`](Self::from_file).
    pub fn from_file_cancellable(path: impl AsRef<Path>, cancel: &CancelToken) -> Result<Self, MediaError> {
        Self::load(path.as_ref(), |path, media_type, _| decode_with(path, media_type, Some(cancel)))
    }

    /// A media with the given metadata, no frames and no file behind it, so a front end's unit tests can build one
    /// without decoding anything. Its size is `0` and it has no timestamps. It cannot be compared.
    #[cfg(feature = "test-support")]
    #[doc(hidden)]
    #[must_use]
    pub fn stub(
        path: impl Into<PathBuf>,
        media_type: MediaType,
        width: u32,
        height: u32,
        duration: Option<Duration>,
    ) -> Self {
        Self {
            path: path.into(),
            media_type,
            width,
            height,
            size: 0,
            duration,
            created: None,
            modified: None,
            frames: Vec::new(),
        }
    }

    /// Loads `path` as [`from_file`](Self::from_file) does, with `decode` extracting its contents once its type is
    /// known and its metadata read.
    fn load<D>(path: &Path, decode: D) -> Result<Self, MediaError>
    where
        D: FnOnce(&Path, MediaType, &FileInfo) -> Result<Decoded, MediaError>,
    {
        let media_type = MediaType::from_path(path).ok_or_else(|| MediaError::Unsupported { path: path.into() })?;
        let info = FileInfo::read(path)?;
        let decoded = decode(path, media_type, &info)?;

        Ok(Self {
            path: path.to_path_buf(),
            size: info.size,
            created: info.created,
            modified: info.modified,
            media_type,
            width: decoded.width,
            height: decoded.height,
            duration: decoded.duration,
            frames: decoded.frames,
        })
    }

    /// Loads every path in parallel, yielding each result as soon as it is ready.
    ///
    /// Images are decoded on a dedicated pool, one per logical CPU. Videos are decoded on a smaller one, since each
    /// video decoder already spreads across several threads. Neither is Rayon's global pool, which stays free for the
    /// caller, for example to group the media as they arrive. Results arrive in completion order, not
    /// input order, with exactly one per path; a failure in one file does not stop the others, and each error names
    /// its file. Dropping the iterator stops any file that has not started loading yet.
    #[must_use = "dropping the stream stops the batch"]
    pub fn from_files<P>(paths: Vec<P>) -> MediaStream
    where
        P: AsRef<Path> + Send + 'static,
    {
        Self::load_all(paths, None, |path| Self::from_file(path))
    }

    /// Loads every path in parallel as [`from_files`](Self::from_files) does, stopping once `cancel` is cancelled.
    ///
    /// Each file loads as [`from_file_cancellable`](Self::from_file_cancellable) does, and a file not started by the
    /// time `cancel` is cancelled yields [`MediaError::Cancelled`] at once, without being read.
    pub(crate) fn from_files_cancellable<P>(paths: Vec<P>, cancel: &CancelToken) -> MediaStream
    where
        P: AsRef<Path> + Send + 'static,
    {
        let token = cancel.clone();
        Self::load_all(paths, Some(cancel.clone()), move |path| Self::from_file_cancellable(path, &token))
    }

    /// Loads every path with `load`, as [`from_files`](Self::from_files) describes. Once `cancel`, if given, is
    /// cancelled, a file not yet started yields [`MediaError::Cancelled`] instead of being loaded.
    fn load_all<P, L>(paths: Vec<P>, cancel: Option<CancelToken>, load: L) -> MediaStream
    where
        P: AsRef<Path> + Send + 'static,
        L: Fn(&Path) -> Result<Self, MediaError> + Clone + Send + Sync + 'static,
    {
        let (videos, others): (Vec<P>, Vec<P>) =
            paths.into_iter().partition(|p| MediaType::from_path(p) == Some(MediaType::Video));
        let (tx, rx) = mpsc::channel();

        // Both pools are driven from a spawned task so neither blocks the caller, which consumes `rx` as results
        // stream in.
        if !videos.is_empty() {
            spawn_batch(video_pool(), videos, tx.clone(), cancel.clone(), load.clone());
        }
        spawn_batch(image_pool(), others, tx, cancel, load);

        MediaStream(rx.into_iter())
    }

    /// Lists the media files that [`from_dir`](Self::from_dir) would load, without loading them.
    ///
    /// [`LoadOptions`] chooses whether subdirectories are scanned and whether images, videos or both are listed.
    /// Files of any other type are skipped. Symbolic links are not followed into directories. The listing is sorted by
    /// name within each directory, and every path keeps `dir`, as given, as its prefix.
    ///
    /// # Errors
    ///
    /// Returns [`MediaError::Io`] naming `dir` if `dir` does not exist, is not a directory, or cannot be read, or if
    /// any subdirectory scanned cannot be read, so a partial listing is never mistaken for a complete one.
    pub fn list_dir(dir: impl AsRef<Path>, options: &LoadOptions) -> Result<Vec<PathBuf>, MediaError> {
        let dir = dir.as_ref();
        let listing = ListOptions::new().recursive(options.recursive);
        let paths = rust_sak::fs::list_path(dir, &listing).map_err(|e| MediaError::fs(dir, e))?;

        Ok(paths
            .into_iter()
            .filter(|path| match MediaType::from_path(path) {
                Some(MediaType::Image) => options.images,
                Some(MediaType::Video) => options.videos,
                None => false,
            })
            .collect())
    }

    /// Loads every file that [`list_dir`](Self::list_dir) lists, in parallel, as [`from_files`](Self::from_files)
    /// does.
    ///
    /// # Errors
    ///
    /// Fails before anything is loaded in the same cases as [`list_dir`](Self::list_dir).
    pub fn from_dir(dir: impl AsRef<Path>, options: &LoadOptions) -> Result<MediaStream, MediaError> {
        Ok(Self::from_files(Self::list_dir(dir, options)?))
    }
}

/// Extracts the contents of the file at `path`, which is of type `media_type`.
fn decode(path: &Path, media_type: MediaType) -> Result<Decoded, MediaError> {
    decode_with(path, media_type, None)
}

/// Extracts the contents of the file at `path` as [`decode`] does, stopping with [`MediaError::Cancelled`] once
/// `cancel`, if given, is cancelled.
fn decode_with(path: &Path, media_type: MediaType, cancel: Option<&CancelToken>) -> Result<Decoded, MediaError> {
    match media_type {
        MediaType::Image => image::load(path, cancel),
        MediaType::Video => video::load(path, cancel),
    }
}

/// Fails with [`MediaError::Cancelled`] naming `path` if `cancel` is given and cancelled.
fn check(path: &Path, cancel: Option<&CancelToken>) -> Result<(), MediaError> {
    if cancel.is_some_and(CancelToken::is_cancelled) {
        Err(MediaError::Cancelled { path: path.into() })
    } else {
        Ok(())
    }
}

/// Loads `paths` with `load` on `pool`, from a spawned task, sending each result to `tx`. A failed send means the
/// caller dropped the stream, which ends the batch. Once `cancel`, if given, is cancelled, each file not yet started
/// sends [`MediaError::Cancelled`] without being loaded.
fn spawn_batch<P, L>(
    pool: &ThreadPool,
    paths: Vec<P>,
    tx: mpsc::Sender<Result<Media, MediaError>>,
    cancel: Option<CancelToken>,
    load: L,
) where
    P: AsRef<Path> + Send + 'static,
    L: Fn(&Path) -> Result<Media, MediaError> + Send + Sync + 'static,
{
    pool.spawn(move || {
        let _ = paths.into_par_iter().try_for_each_with(tx.clone(), |tx, path| {
            let path = path.as_ref();
            tx.send(check(path, cancel.as_ref()).and_then(|()| load(path)))
        });
        // `load` goes before the last sender, so whatever it holds (such as a cache handle) is released by the time
        // the stream ends.
        drop(load);
        drop(tx);
    });
}

/// The results of a batch load, yielded in completion order. Returned by [`Media::from_files`] and
/// [`Media::from_dir`].
///
/// It owns its channel rather than borrowing the call's arguments, so it can outlive them. Dropping it stops any file
/// that has not started loading yet.
#[derive(Debug)]
pub struct MediaStream(mpsc::IntoIter<Result<Media, MediaError>>);

impl Iterator for MediaStream {
    type Item = Result<Media, MediaError>;

    fn next(&mut self) -> Option<Self::Item> {
        self.0.next()
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::{Arc, RwLock};
    use std::time::Instant;

    use rust_sak::fs::mk_temp_dir;

    use super::*;

    /// The path of a file in the workspace's `fixtures` directory.
    pub(crate) fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name)
    }

    /// A 1×1, zero-byte media built from its frames, without a file behind it.
    pub(crate) fn media(path: &str, media_type: MediaType, frames: Vec<Icon>) -> Media {
        Media {
            path: path.into(),
            size: 0,
            created: None,
            modified: None,
            media_type,
            width: 1,
            height: 1,
            duration: None,
            frames,
        }
    }

    #[cfg(feature = "serde")]
    mod serialize {
        use super::*;

        fn time(rfc3339: &str) -> SystemTime {
            rfc3339.parse::<jiff::Timestamp>().unwrap().into()
        }

        fn json(media: &Media) -> serde_json::Value {
            serde_json::to_value(media).unwrap()
        }

        #[test]
        fn image_has_the_metadata_fields_in_order() {
            let media = Media {
                width: 640,
                height: 480,
                size: 12345,
                modified: Some(time("2026-10-04T12:34:56Z")),
                ..media("a.png", MediaType::Image, vec![])
            };

            assert_eq!(
                serde_json::to_string(&media).unwrap(),
                r#"{"path":"a.png","type":"image","width":640,"height":480,"size":12345,"duration":null,"created":null,"modified":"2026-10-04T12:34:56Z"}"#
            );
        }

        #[test]
        fn video_duration_is_fractional_seconds() {
            let media =
                Media { duration: Some(Duration::from_millis(12_480)), ..media("a.mp4", MediaType::Video, vec![]) };

            let value = json(&media);

            assert_eq!(value["type"], "video");
            assert_eq!(value["duration"].to_string(), "12.48");
        }

        #[test]
        fn sub_second_timestamps_keep_the_fraction() {
            let media =
                Media { created: Some(time("2026-10-04T12:34:56.5Z")), ..media("a.png", MediaType::Image, vec![]) };

            assert_eq!(json(&media)["created"], "2026-10-04T12:34:56.5Z");
        }

        #[test]
        fn absent_times_are_null() {
            let value = json(&media("a.png", MediaType::Image, vec![]));

            assert!(value["created"].is_null());
            assert!(value["modified"].is_null());
        }

        #[cfg(unix)]
        #[test]
        fn a_path_that_is_not_unicode_is_lossy() {
            use std::ffi::OsStr;
            use std::os::unix::ffi::OsStrExt;

            let mut media = media("", MediaType::Image, vec![]);
            media.path = PathBuf::from(OsStr::from_bytes(b"a\xffb.png"));

            assert_eq!(json(&media)["path"], "a\u{FFFD}b.png");
        }
    }

    #[test]
    fn file_info_reads_size_and_timestamps() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("data.bin");
        std::fs::write(&path, [0u8; 1234]).unwrap();

        let info = FileInfo::read(&path).unwrap();

        assert_eq!(info.size, 1234);
        let modified = info.modified.expect("every supported platform records mtime");
        assert!(modified.elapsed().unwrap_or_default() < Duration::from_secs(60));
        // `created` may be `None` on filesystems that don't record it; reading it must simply not fail.
        let _ = info.created;
    }

    #[test]
    fn file_info_missing_file_is_io_error() {
        let err = FileInfo::read(Path::new("definitely-not-a-real-file.png")).unwrap_err();
        assert!(matches!(err, MediaError::Io { .. }));
    }

    #[test]
    fn from_file_loads_image_with_metadata() {
        let path = fixture("test1.png");

        let media = Media::from_file(&path).unwrap();

        assert_eq!(media.path, path);
        assert_eq!(media.media_type, MediaType::Image);
        assert_eq!(media.size, std::fs::metadata(&path).unwrap().len());
        assert_eq!((media.width, media.height), (1440, 3098));
        assert_eq!(media.duration, None);
        assert_eq!(media.frames.len(), 1);
        assert!(media.modified.is_some());
    }

    #[test]
    fn from_file_loads_video_with_metadata() {
        let path = fixture("test3.mp4");

        let media = Media::from_file(&path).unwrap();

        assert_eq!(media.path, path);
        assert_eq!(media.media_type, MediaType::Video);
        assert_eq!(media.size, std::fs::metadata(&path).unwrap().len());
        assert_eq!((media.width, media.height), (1080, 1920));
        assert!(media.duration.is_some_and(|d| d > Duration::ZERO));
        assert!(!media.frames.is_empty());
    }

    #[test]
    fn from_file_cancellable_uncancelled_image_equals_from_file() {
        let path = fixture("test1.png");

        let cancellable = Media::from_file_cancellable(&path, &CancelToken::new()).unwrap();

        assert_eq!(cancellable, Media::from_file(&path).unwrap());
    }

    #[test]
    fn from_file_cancellable_pre_cancelled_image_is_cancelled() {
        let path = fixture("test1.png");
        let token = CancelToken::new();
        token.clone().cancel();

        let err = Media::from_file_cancellable(&path, &token).unwrap_err();

        assert!(matches!(err, MediaError::Cancelled { .. }), "{err}");
        assert_eq!(err.path(), path);
    }

    #[test]
    fn from_file_cancellable_uncancelled_video_equals_from_file() {
        let path = fixture("test3.mp4");

        let cancellable = Media::from_file_cancellable(&path, &CancelToken::new()).unwrap();
        let plain = Media::from_file(&path).unwrap();

        assert_eq!(cancellable.frames.len(), plain.frames.len());
        assert_eq!(cancellable, plain);
    }

    #[test]
    fn from_file_unsupported_extension() {
        let err = Media::from_file("notes.txt").unwrap_err();

        assert!(matches!(err, MediaError::Unsupported { .. }));
        assert_eq!(err.path(), Path::new("notes.txt"));
    }

    #[test]
    fn from_file_missing_file_names_the_path() {
        let err = Media::from_file("definitely-not-a-real-file.jpg").unwrap_err();

        assert_eq!(err.path(), Path::new("definitely-not-a-real-file.jpg"));
        assert!(err.to_string().contains("definitely-not-a-real-file.jpg"));
    }

    #[test]
    fn from_file_corrupt_image_is_image_error() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("corrupt.png");
        std::fs::write(&path, b"not a png").unwrap();

        let err = Media::from_file(&path).unwrap_err();

        assert!(matches!(err, MediaError::Image { .. }));
        assert_eq!(err.path(), path);
    }

    /// Copies `src` to `dst` with the payload of every top-level `mdat` box zeroed: the container still probes, but
    /// none of its packets decode.
    #[allow(clippy::cast_possible_truncation)]
    pub(crate) fn zero_media_data(src: &Path, dst: &Path) {
        let mut data = std::fs::read(src).unwrap();
        let mut pos = 0;

        while pos + 8 <= data.len() {
            let (header, size) = match u32::from_be_bytes(data[pos..pos + 4].try_into().unwrap()) {
                0 => (8, data.len() - pos),
                1 => (16, u64::from_be_bytes(data[pos + 8..pos + 16].try_into().unwrap()) as usize),
                size => (8, size as usize),
            };
            if &data[pos + 4..pos + 8] == b"mdat" {
                data[pos + header..pos + size].fill(0);
            }
            pos += size;
        }

        std::fs::write(dst, data).unwrap();
    }

    #[test]
    fn from_file_corrupt_video_is_video_error() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let path = dir.path().join("corrupt.mp4");
        zero_media_data(&fixture("test3.mp4"), &path);

        let err = Media::from_file(&path).unwrap_err();

        assert!(matches!(err, MediaError::Video { .. }), "{err}");
        assert_eq!(err.path(), path);
    }

    #[test]
    fn from_files_yields_one_result_per_path() {
        let missing = PathBuf::from("definitely-not-a-real-file.jpg");
        let paths = vec![fixture("test1.png"), fixture("test3.mp4"), missing.clone()];

        let results: Vec<_> = Media::from_files(paths).collect();

        assert_eq!(results.len(), 3, "one result per input path");
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 2);
        let errors: Vec<_> = results.iter().filter_map(|r| r.as_ref().err()).collect();
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].path(), missing);
    }

    #[test]
    fn from_files_streams_results_before_the_batch_completes() {
        // Park every video worker behind `gate`, so the video can't start until the image's result has been received.
        let gate = Arc::new(RwLock::new(()));
        let closed = gate.write().unwrap();
        let (parked_tx, parked_rx) = mpsc::channel();
        {
            let gate = Arc::clone(&gate);
            video_pool().spawn_broadcast(move |_| {
                parked_tx.send(()).unwrap();
                drop(gate.read());
            });
        }
        for _ in 0..video_pool().current_num_threads() {
            parked_rx.recv().unwrap();
        }

        let mut stream = Media::from_files(vec![fixture("test3.mp4"), fixture("test1.png")]);
        let first = stream.next().unwrap().unwrap();
        drop(closed);

        assert_eq!(first.media_type, MediaType::Image);
        let rest: Vec<_> = stream.collect();
        assert_eq!(rest.len(), 1);
        assert!(rest[0].as_ref().is_ok_and(|m| m.media_type == MediaType::Video));
    }

    #[test]
    fn from_files_cancellable_with_a_cancelled_token_decodes_nothing() {
        let paths = vec![fixture("test1.png"), fixture("test3.mp4"), fixture("test2.png")];
        let token = CancelToken::new();
        token.cancel();

        let results: Vec<_> = Media::from_files_cancellable(paths, &token).collect();

        assert_eq!(results.len(), 3, "one result per input path");
        assert!(results.iter().all(|r| matches!(r, Err(MediaError::Cancelled { .. }))), "{results:?}");
    }

    #[test]
    fn from_files_cancellable_uncancelled_equals_from_files() {
        let paths = vec![fixture("test1.png"), fixture("test2.png")];
        let sorted = |stream: MediaStream| {
            let mut media: Vec<_> = stream.map(Result::unwrap).collect();
            media.sort_by(|a, b| a.path.cmp(&b.path));
            media
        };

        let cancellable = sorted(Media::from_files_cancellable(paths.clone(), &CancelToken::new()));

        assert_eq!(cancellable, sorted(Media::from_files(paths)));
    }

    #[test]
    fn from_files_empty_batch_yields_nothing() {
        assert_eq!(Media::from_files(Vec::<PathBuf>::new()).count(), 0);
    }

    /// Times the four fixtures as one batch, to sanity-check `VIDEO_WORKER_DIVISOR`.
    /// Run with `cargo test -p mediasim --release -- --ignored --nocapture time_fixtures`.
    #[test]
    #[ignore = "benchmark, not a correctness check"]
    fn time_fixtures() {
        let names = ["test1.png", "test2.png", "test3.mp4", "test4.mp4"];
        let started = Instant::now();

        for result in Media::from_files(names.iter().map(|n| fixture(n)).collect()) {
            let media = result.unwrap();
            eprintln!("{:>8.2?}  {}", started.elapsed(), media.path.display());
        }

        eprintln!("video workers: {}", video_pool().current_num_threads());
    }

    /// Builds `a.png`, `notes.txt` and `clip.mp4` at the root, and `sub/b.png` and `sub/c.mp4` below it. The media
    /// files are empty: [`Media::list_dir`] classifies by name and never opens them.
    fn make_tree() -> rust_sak::fs::TempDir {
        let dir = mk_temp_dir("mediasim").unwrap();
        let sub = dir.path().join("sub");
        std::fs::create_dir(&sub).unwrap();

        for path in [
            dir.path().join("a.png"),
            dir.path().join("notes.txt"),
            dir.path().join("clip.mp4"),
            sub.join("b.png"),
            sub.join("c.mp4"),
        ] {
            std::fs::write(path, b"").unwrap();
        }

        dir
    }

    /// The listed paths relative to `root`, with `/` separators on every platform.
    fn relative(root: &Path, paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .map(|p| {
                let rel = p.strip_prefix(root).unwrap();
                rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
            })
            .collect()
    }

    #[test]
    fn list_dir_root_only_by_default() {
        let dir = make_tree();

        let paths = Media::list_dir(dir.path(), &LoadOptions::new()).unwrap();

        assert_eq!(relative(dir.path(), &paths), ["a.png", "clip.mp4"]);
    }

    #[test]
    fn list_dir_recursive_includes_subdirectories() {
        let dir = make_tree();

        let paths = Media::list_dir(dir.path(), &LoadOptions::new().recursive(true)).unwrap();

        assert_eq!(relative(dir.path(), &paths), ["a.png", "clip.mp4", "sub/b.png", "sub/c.mp4"]);
    }

    #[test]
    fn list_dir_images_only() {
        let dir = make_tree();

        let paths = Media::list_dir(dir.path(), &LoadOptions::new().recursive(true).videos(false)).unwrap();

        assert_eq!(relative(dir.path(), &paths), ["a.png", "sub/b.png"]);
    }

    #[test]
    fn list_dir_videos_only() {
        let dir = make_tree();

        let paths = Media::list_dir(dir.path(), &LoadOptions::new().recursive(true).images(false)).unwrap();

        assert_eq!(relative(dir.path(), &paths), ["clip.mp4", "sub/c.mp4"]);
    }

    #[test]
    fn list_dir_sorts_by_name_and_keeps_the_given_prefix() {
        let dir = mk_temp_dir("mediasim").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        for name in ["b.png", "a.mp4", "notes.txt", "sub/c.png"] {
            std::fs::write(dir.path().join(name), b"").unwrap();
        }

        let flat = Media::list_dir(dir.path(), &LoadOptions::new()).unwrap();
        let images = Media::list_dir(dir.path(), &LoadOptions::new().recursive(true).videos(false)).unwrap();

        assert_eq!(flat, [dir.path().join("a.mp4"), dir.path().join("b.png")]);
        assert_eq!(images, [dir.path().join("b.png"), dir.path().join("sub").join("c.png")]);
    }

    #[test]
    fn from_dir_loads_media_and_skips_other_files() {
        let dir = mk_temp_dir("mediasim").unwrap();
        std::fs::copy(fixture("test1.png"), dir.path().join("a.png")).unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"not media").unwrap();

        let results: Vec<_> = Media::from_dir(dir.path(), &LoadOptions::new()).unwrap().collect();

        assert_eq!(results.len(), 1);
        assert!(results[0].as_ref().is_ok_and(|m| m.path.ends_with("a.png")));
    }

    #[test]
    fn from_dir_missing_directory_is_io_error() {
        let Err(err) = Media::from_dir("definitely-not-a-real-dir", &LoadOptions::new()) else {
            panic!("expected an error for a missing directory");
        };

        assert!(matches!(err, MediaError::Io { .. }));
        assert_eq!(err.path(), Path::new("definitely-not-a-real-dir"));
    }

    #[test]
    fn from_dir_regular_file_is_io_error() {
        let dir = mk_temp_dir("mediasim").unwrap();
        let file = dir.path().join("a.png");
        std::fs::copy(fixture("test1.png"), &file).unwrap();

        let Err(err) = Media::from_dir(&file, &LoadOptions::new()) else {
            panic!("expected an error for a regular file");
        };

        assert!(matches!(err, MediaError::Io { .. }));
        assert_eq!(err.path(), file);
    }

    #[cfg(unix)]
    #[test]
    fn from_dir_unreadable_subdirectory_is_io_error() {
        use std::os::unix::fs::PermissionsExt;

        let dir = make_tree();
        let sub = dir.path().join("sub");
        std::fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o000)).unwrap();

        // Root ignores permissions, so the scenario can't be reproduced there.
        let denied = std::fs::read_dir(&sub).is_err();
        let result = Media::from_dir(dir.path(), &LoadOptions::new().recursive(true));

        std::fs::set_permissions(&sub, std::fs::Permissions::from_mode(0o755)).unwrap();

        if denied {
            assert!(matches!(result, Err(MediaError::Io { .. })));
        } else {
            eprintln!(
                "skipped from_dir_unreadable_subdirectory_is_io_error: permissions are not enforced (running as root?)"
            );
        }
    }
}
