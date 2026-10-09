//! A scan: loading a list of files and grouping them in one run, with progress, cancellation and a choice on errors.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

#[cfg(feature = "cache")]
use crate::DirCache;
use crate::cancel::CancelOnDrop;
use crate::core::check_threshold;
#[cfg(feature = "cache")]
use crate::media::CachedDecoder;
use crate::media::Loading;
use crate::{CancelToken, CompareOptions, Eta, Grouper, Media, MediaError, MediaStream};

/// What a [`Scan`] does with a file that can't be loaded.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OnError {
    /// The first such file ends the scan with its error: files not yet started are not loaded, and those loading stop
    /// as they would on a cancel.
    #[default]
    Stop,
    /// The file is counted as done and as skipped, and the scan goes on. Its error is returned in
    /// [`Scanned::skipped`].
    Skip,
}

/// What a [`Scan`] reports to its caller while it runs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ScanEvent<'a> {
    /// A file has started loading, to be compared with the earlier ones once loaded. Several files load at once, so
    /// this is the one started most recently. A file cancelled before it starts is never reported.
    Processing(&'a Path),
    /// A file was loaded and compared, or skipped.
    Progress(ScanProgress),
}

/// How far a [`Scan`] has got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanProgress {
    /// The files done, skipped ones included. It reaches `total` exactly when every file is done.
    pub done: usize,
    /// The number of files scanned.
    pub total: usize,
    /// The files skipped because they couldn't be loaded.
    pub skipped: usize,
    /// The estimated time left, as [`Eta`] gives it: `None` before the first file is done, and zero once all are.
    pub eta: Option<Duration>,
}

/// What a finished [`Scan`] returns.
#[derive(Debug)]
pub struct Scanned {
    /// The groups of similar media, ordered by the earliest position of their members among the paths given. Each
    /// group's members are ordered by path, as [`Grouper::finish`] orders them.
    pub groups: Vec<Vec<Media>>,
    /// The errors of the files skipped under [`OnError::Skip`], in the order their paths were given.
    pub skipped: Vec<MediaError>,
}

/// Why a [`Scan`] ended without a result.
#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    /// The scan's [`CancelToken`] was cancelled.
    #[error("the scan was cancelled")]
    Cancelled,

    /// A file couldn't be loaded, under [`OnError::Stop`].
    #[error(transparent)]
    Load(MediaError),
}

/// Loads a list of files and groups them in one run, reporting its progress as it goes.
///
/// The files load in parallel, as [`Media::from_files`] loads them, and each is pushed to a [`Grouper`] as it
/// arrives, so the groups are the same as pushing each loaded file one at a time. [`run`](Self::run) blocks, calling
/// its callback on the calling thread:
///
/// - [`ScanEvent::Processing`] before a loaded file is compared;
/// - [`ScanEvent::Progress`] after each file is compared or skipped.
///
/// A [`CancelToken`] given with [`cancel`](Self::cancel) stops the scan from another thread: loads in flight stop as
/// [`Media::from_file_cancellable`] does, files not started are not loaded, no new comparison starts, no further event
/// is reported, and `run` returns [`ScanError::Cancelled`]. A comparison already under way finishes first. A scan that
/// ends early for any other reason stops its loads in flight the same way, without cancelling the token.
///
/// ```no_run
/// use mediasim::{OnError, Scan, ScanEvent};
///
/// let scanned = Scan::new(vec!["a.png", "b.png", "c.png"], 0.9)
///     .on_error(OnError::Skip)
///     .run(|event| {
///         if let ScanEvent::Progress(progress) = event {
///             println!("{}/{}", progress.done, progress.total);
///         }
///     })?;
/// println!("{} groups, {} skipped", scanned.groups.len(), scanned.skipped.len());
/// # Ok::<(), mediasim::ScanError>(())
/// ```
#[derive(Debug)]
#[must_use = "a scan does nothing until it is run"]
pub struct Scan {
    paths: Vec<PathBuf>,
    threshold: f64,
    options: CompareOptions,
    cancel: CancelToken,
    on_error: OnError,
    #[cfg(feature = "cache")]
    cache: Option<CachedDecoder>,
}

impl Scan {
    /// A scan of `paths` that groups the media scoring at least `threshold` against each other, under the default
    /// [`CompareOptions`], stopping on the first error and with no cancel token.
    ///
    /// # Panics
    ///
    /// Panics unless `threshold` is a number in the closed range `[0, 1]`, as [`Grouper::new`] does.
    pub fn new(paths: impl IntoIterator<Item = impl Into<PathBuf>>, threshold: f64) -> Self {
        check_threshold(threshold);

        Self {
            paths: paths.into_iter().map(Into::into).collect(),
            threshold,
            options: CompareOptions::default(),
            cancel: CancelToken::new(),
            on_error: OnError::default(),
            #[cfg(feature = "cache")]
            cache: None,
        }
    }

    /// Groups under `options`, as [`Grouper::with_options`] does.
    pub fn options(mut self, options: CompareOptions) -> Self {
        self.options = options;
        self
    }

    /// Stops the scan once `cancel` is cancelled.
    pub fn cancel(mut self, cancel: CancelToken) -> Self {
        self.cancel = cancel;
        self
    }

    /// Handles a file that can't be loaded as `on_error` says.
    pub fn on_error(mut self, on_error: OnError) -> Self {
        self.on_error = on_error;
        self
    }

    /// Loads through `cache`, as [`Media::from_files_cached`] does. The groups are the same as without it. The scan
    /// does not borrow `cache`, so the caller can [`finish`](DirCache::finish) it once the scan has succeeded.
    #[cfg(feature = "cache")]
    pub fn cache(mut self, cache: &DirCache) -> Self {
        self.cache = Some(cache.decoder());
        self
    }

    /// Runs the scan to its end, calling `on_event` on this thread as it goes, and returns its groups.
    ///
    /// # Errors
    ///
    /// - [`ScanError::Cancelled`] once the cancel token is cancelled, even if a file's load failed with it.
    /// - [`ScanError::Load`] with the first file that can't be loaded, under [`OnError::Stop`].
    pub fn run<F>(self, mut on_event: F) -> Result<Scanned, ScanError>
    where
        F: FnMut(ScanEvent<'_>),
    {
        let cancel = self.cancel.clone();
        let cancelled = || cancel.is_cancelled();
        if cancelled() {
            return Err(ScanError::Cancelled);
        }

        let total = self.paths.len();
        // A path given twice keeps its last position; its errors share the key, so the stable sort keeps them together.
        // The groups are ordered by it too, so they don't depend on the order the files finished loading in.
        let positions: HashMap<PathBuf, usize> =
            self.paths.iter().enumerate().map(|(i, path)| (path.clone(), i)).collect();
        let mut grouper = Grouper::with_options(self.threshold, self.options);
        let on_error = self.on_error;
        // The loads answer to a token of the scan's own, cancelled on every way out of `run`, so a scan that ends
        // early (on an error, say) also stops the decodes already under way instead of leaving them running on the
        // shared pools. It is declared before `stream`, so the stream is dropped first.
        let loads = self.cancel.child();
        let _stop_loads = CancelOnDrop(loads.clone());
        let mut stream = self.stream(&loads);

        let started = Instant::now();
        let mut eta = Eta::default();
        let (mut done, mut skipped) = (0, Vec::new());

        // Returning drops `stream`, which stops every file not yet started, and `_stop_loads`, which stops the rest.
        while let Some(loading) = stream.next_loading() {
            if cancelled() {
                return Err(ScanError::Cancelled);
            }

            // Loading takes most of a file's time, so the file is reported as it starts, not once it is compared.
            let result = match loading {
                Loading::Started(path) => {
                    on_event(ScanEvent::Processing(&path));
                    continue;
                }
                Loading::Done(result) => result,
            };

            match result {
                Ok(media) => {
                    if !grouper.push_cancellable(media, &cancel) {
                        return Err(ScanError::Cancelled);
                    }
                }
                Err(MediaError::Cancelled { .. }) => return Err(ScanError::Cancelled),
                Err(err) => match on_error {
                    OnError::Stop => return Err(ScanError::Load(err)),
                    OnError::Skip => skipped.push(err),
                },
            }

            if cancelled() {
                return Err(ScanError::Cancelled);
            }
            done += 1;
            eta.update(done, total, started.elapsed());
            on_event(ScanEvent::Progress(ScanProgress { done, total, skipped: skipped.len(), eta: eta.value() }));
        }

        if cancelled() {
            return Err(ScanError::Cancelled);
        }
        let position = |path: &Path| positions.get(path).copied().unwrap_or(usize::MAX);
        skipped.sort_by_key(|err: &MediaError| position(err.path()));
        let mut groups = grouper.finish();
        groups.sort_by_cached_key(|group| group.iter().map(|media| position(&media.path)).min());
        Ok(Scanned { groups, skipped })
    }

    /// Starts loading the files, through the cache if there is one, stopping once `cancel` is cancelled.
    fn stream(self, cancel: &CancelToken) -> MediaStream {
        #[cfg(feature = "cache")]
        if let Some(decoder) = self.cache {
            return Media::from_files_cached_cancellable(self.paths, decoder, cancel);
        }

        Media::from_files_cancellable(self.paths, cancel)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[should_panic(expected = "between 0 and 1")]
    fn a_threshold_out_of_range_panics() {
        let _ = Scan::new(Vec::<PathBuf>::new(), 1.5);
    }

    #[test]
    fn an_empty_scan_reports_nothing_and_finds_nothing() {
        let mut events = 0;

        let scanned = Scan::new(Vec::<PathBuf>::new(), 0.9).run(|_| events += 1).unwrap();

        assert_eq!(events, 0);
        assert!(scanned.groups.is_empty());
        assert!(scanned.skipped.is_empty());
    }

    #[test]
    fn errors_display_their_cause() {
        let load = ScanError::Load(MediaError::Unsupported { path: "notes.txt".into() });

        assert_eq!(ScanError::Cancelled.to_string(), "the scan was cancelled");
        assert_eq!(load.to_string(), "unsupported file notes.txt");
    }

    #[cfg(feature = "cache")]
    #[test]
    fn a_scan_stopped_by_an_error_stops_the_loads_under_way() {
        use std::fs::File;

        use crate::media::tests::fixture;

        let dir = rust_sak::fs::mk_temp_dir("mediasim").unwrap();
        let videos = [dir.path().join("a.mp4"), dir.path().join("b.mp4")];
        std::fs::copy(fixture("test3.mp4"), &videos[0]).unwrap();
        std::fs::copy(fixture("test4.mp4"), &videos[1]).unwrap();
        let broken = dir.path().join("broken.png");
        std::fs::write(&broken, b"not a png").unwrap();
        let cache = DirCache::open(dir.path()).unwrap();

        // The broken image fails at once, long before either video could finish decoding.
        let result = Scan::new([broken, videos[0].clone(), videos[1].clone()], 0.9).cache(&cache).run(|_| {});
        assert!(matches!(result, Err(ScanError::Load(MediaError::Image { .. }))), "{result:?}");

        // Every video worker runs this only once the decode it had under way has ended, stored or not.
        crate::pool::video_pool().broadcast(|_| ());

        // A stopped load stores nothing, so the videos are decoded again: as garbage, with the same size and mtime.
        for path in &videos {
            let mtime = std::fs::metadata(path).unwrap().modified().unwrap();
            let len = usize::try_from(std::fs::metadata(path).unwrap().len()).unwrap();
            std::fs::write(path, vec![0xAB; len]).unwrap();
            File::options().write(true).open(path).unwrap().set_modified(mtime).unwrap();
        }
        let results: Vec<_> = Media::from_files_cached(videos.to_vec(), &cache).collect();
        assert!(results.iter().all(|r| matches!(r, Err(MediaError::Video { .. }))), "{results:?}");
    }
}
