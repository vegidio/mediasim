//! Media loading: turns image and video files into [`Media`] values with their file metadata and per-frame
//! [`Icon`] signatures for similarity comparison.

mod image;
mod kind;
mod options;
mod video;

use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, mpsc};
use std::time::{Duration, SystemTime};

use rayon::prelude::*;
use rust_sak::fs::ListOptions;

use crate::{Icon, MediaError};

pub use options::LoadOptions;

/// Whether a [`Media`] is a still image or a video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MediaType {
    /// A still image, loaded as one frame.
    Image,
    /// A video, loaded as one frame per second of playback.
    Video,
}

/// A loaded media file: its metadata plus its frames as [`Icon`] signatures.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Media {
    /// The file this media was loaded from.
    pub path: PathBuf,
    /// The file size, in bytes.
    pub size: u64,
    /// When the file was created, if the platform and filesystem record it.
    pub created: Option<SystemTime>,
    /// When the file was last modified, if the platform and filesystem record it.
    pub modified: Option<SystemTime>,
    /// Whether this is an image or a video.
    pub media_type: MediaType,
    /// Width in pixels (for a video, of its first video stream).
    pub width: u32,
    /// Height in pixels (for a video, of its first video stream).
    pub height: u32,
    /// The playback duration; `None` for images.
    pub duration: Option<Duration>,
    /// The frames as icon signatures: one for an image, one per second for a video.
    pub(crate) frames: Vec<Icon>,
}

/// What a loader extracts from the file's contents.
#[derive(Debug)]
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

/// Videos are decoded on their own pool with this fraction of the logical CPUs, because each video decoder is
/// already multithreaded; one video per core would oversubscribe the CPU and hold many decoders in memory.
const VIDEO_WORKER_DIVISOR: usize = 4;

/// The process-wide pool that decodes videos, created on first use.
fn video_pool() -> &'static rayon::ThreadPool {
    static POOL: OnceLock<rayon::ThreadPool> = OnceLock::new();

    POOL.get_or_init(|| {
        let cpus = std::thread::available_parallelism().map_or(1, NonZeroUsize::get);
        rayon::ThreadPoolBuilder::new()
            .num_threads((cpus / VIDEO_WORKER_DIVISOR).max(1))
            .thread_name(|i| format!("mediasim-video-{i}"))
            .build()
            .expect("failed to spawn the video decoding threads")
    })
}

impl Media {
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
        let path = path.as_ref();
        let media_type = MediaType::from_path(path).ok_or_else(|| MediaError::Unsupported { path: path.into() })?;
        let info = FileInfo::read(path)?;

        let decoded = match media_type {
            MediaType::Image => image::load(path)?,
            MediaType::Video => video::load(path)?,
        };

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
    /// Images are decoded on Rayon's global pool, one per logical CPU. Videos are decoded on a smaller dedicated
    /// pool, since each video decoder already spreads across several threads. Results arrive in completion order, not
    /// input order, with exactly one per path; a failure in one file does not stop the others, and each error names
    /// its file. Dropping the iterator stops any file that has not started loading yet.
    #[must_use = "dropping the stream stops the batch"]
    pub fn from_files<P>(paths: Vec<P>) -> MediaStream
    where
        P: AsRef<Path> + Send + 'static,
    {
        let (videos, others): (Vec<P>, Vec<P>) =
            paths.into_iter().partition(|p| MediaType::from_path(p) == Some(MediaType::Video));
        let (tx, rx) = mpsc::channel();

        // Both pools are driven from a spawned task so neither blocks the caller, which consumes `rx` as results
        // stream in. A failed send means the caller dropped the iterator, which ends the batch.
        if !videos.is_empty() {
            let tx = tx.clone();
            video_pool().spawn(move || {
                let _ = videos.into_par_iter().try_for_each_with(tx, |tx, path| tx.send(Self::from_file(path)));
            });
        }

        rayon::spawn(move || {
            let _ = others.into_par_iter().try_for_each_with(tx, |tx, path| tx.send(Self::from_file(path)));
        });

        MediaStream(rx.into_iter())
    }

    /// Loads every supported media file in `dir` in parallel, as [`from_files`](Self::from_files) does.
    ///
    /// [`LoadOptions`] chooses whether subdirectories are scanned and whether images, videos or both are loaded.
    /// Files of any other type are skipped without producing a result. Symbolic links are not followed into
    /// directories.
    ///
    /// # Errors
    ///
    /// Returns [`MediaError::Io`] naming `dir` before anything is loaded if `dir`, or any subdirectory scanned, cannot
    /// be read, so a partial listing is never mistaken for a complete one.
    pub fn from_dir(dir: impl AsRef<Path>, options: &LoadOptions) -> Result<MediaStream, MediaError> {
        Ok(Self::from_files(list_media(dir.as_ref(), options)?))
    }
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

/// Lists the media files in `dir` that `options` selects, sorted by name within each directory.
fn list_media(dir: &Path, options: &LoadOptions) -> Result<Vec<PathBuf>, MediaError> {
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
    fn zero_media_data(src: &Path, dst: &Path) {
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
    /// files are empty: [`list_media`] classifies by name and never opens them.
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
    fn list_media_root_only_by_default() {
        let dir = make_tree();

        let paths = list_media(dir.path(), &LoadOptions::new()).unwrap();

        assert_eq!(relative(dir.path(), &paths), ["a.png", "clip.mp4"]);
    }

    #[test]
    fn list_media_recursive_includes_subdirectories() {
        let dir = make_tree();

        let paths = list_media(dir.path(), &LoadOptions::new().recursive(true)).unwrap();

        assert_eq!(relative(dir.path(), &paths), ["a.png", "clip.mp4", "sub/b.png", "sub/c.mp4"]);
    }

    #[test]
    fn list_media_images_only() {
        let dir = make_tree();

        let paths = list_media(dir.path(), &LoadOptions::new().recursive(true).videos(false)).unwrap();

        assert_eq!(relative(dir.path(), &paths), ["a.png", "sub/b.png"]);
    }

    #[test]
    fn list_media_videos_only() {
        let dir = make_tree();

        let paths = list_media(dir.path(), &LoadOptions::new().recursive(true).images(false)).unwrap();

        assert_eq!(relative(dir.path(), &paths), ["clip.mp4", "sub/c.mp4"]);
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
