//! The Tauri commands behind the scan screen: a scan of the gallery's files, streamed to the window, and its cancel.
//!
//! At most one scan runs at a time. Starting one cancels any earlier one still running, so its loads stop and it
//! resolves as cancelled, and [`cancel_scan`] stops the one in flight when the user cancels.
//!
//! Progress reaches the window over the [`Channel`] the scan was started with, so a cancelled scan's late messages
//! can't reach a newer scan's listener. Messages are throttled to about ten a second, whatever the set's size.

use std::ops::Deref;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use mediasim::{CompareOptions, Media, OnError, Scan, ScanError, ScanEvent, ScanProgress, Scanned};
use serde::Serialize;
use tauri::State;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;

use crate::run::RunSlot;
use crate::set::display_home;

/// How often each kind of [`ScanMessage`] may reach the window.
const INTERVAL: Duration = Duration::from_millis(100);

/// What a running scan tells the window, tagged by `kind`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ScanMessage {
    /// The file whose comparisons are starting.
    Processing {
        /// The file, exactly.
        path: String,
        /// The file as the set list shows it.
        display: String,
    },
    /// How far the scan has got.
    Progress {
        /// The files done, skipped ones included.
        done: usize,
        /// The files scanned.
        total: usize,
        /// The files that couldn't be read.
        skipped: usize,
        /// The estimated time left, in seconds; absent before there is one.
        #[serde(skip_serializing_if = "Option::is_none")]
        eta_seconds: Option<f64>,
    },
}

impl ScanMessage {
    /// The index of this message's kind, for the throttle.
    fn kind(&self) -> usize {
        match self {
            Self::Processing { .. } => 0,
            Self::Progress { .. } => 1,
        }
    }

    /// Whether this is the progress of a scan with every file done.
    fn is_final(&self) -> bool {
        matches!(self, Self::Progress { done, total, .. } if done == total)
    }
}

impl From<ScanEvent<'_>> for ScanMessage {
    fn from(event: ScanEvent<'_>) -> Self {
        match event {
            ScanEvent::Processing(path) => {
                Self::Processing { path: path.to_string_lossy().into_owned(), display: display_home(path) }
            }
            ScanEvent::Progress(ScanProgress { done, total, skipped, eta }) => {
                Self::Progress { done, total, skipped, eta_seconds: eta.map(|eta| eta.as_secs_f64()) }
            }
        }
    }
}

/// A file the scan skipped because it couldn't be read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SkippedFile {
    path: String,
    /// What went wrong, naming the file.
    message: String,
}

/// A group of similar files.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScanGroup {
    /// The files, with their metadata, in path order.
    files: Vec<Media>,
}

/// What a finished scan returns to the window.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScanResult {
    /// The groups of similar files, in the order of the paths given.
    groups: Vec<ScanGroup>,
    /// The files that couldn't be read, in the order they were given.
    skipped: Vec<SkippedFile>,
}

impl ScanResult {
    fn new(scanned: Scanned) -> Self {
        Self {
            groups: scanned.groups.into_iter().map(|files| ScanGroup { files }).collect(),
            skipped: scanned
                .skipped
                .iter()
                .map(|err| SkippedFile { path: err.path().to_string_lossy().into_owned(), message: err.to_string() })
                .collect(),
        }
    }
}

/// Why a scan ended without a result, as the window sees it: an object tagged by `kind`.
#[derive(Debug, PartialEq, Eq, thiserror::Error, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ScanFailure {
    /// The scan was cancelled, or replaced by a newer one, before it finished.
    #[error("the comparison was cancelled")]
    Cancelled,
    /// The scan couldn't run: a bad request, or a blocking task that panicked or was cancelled by the runtime.
    #[error("{message}")]
    Task {
        /// What went wrong.
        message: String,
    },
}

impl From<ScanError> for ScanFailure {
    fn from(err: ScanError) -> Self {
        match err {
            ScanError::Cancelled => Self::Cancelled,
            // A scan that skips unreadable files never ends with one, but a message is better than a panic.
            ScanError::Load(err) => Self::Task { message: err.to_string() },
        }
    }
}

impl From<tauri::Error> for ScanFailure {
    fn from(err: tauri::Error) -> Self {
        Self::Task { message: crate::task_message(&err) }
    }
}

/// The scan in flight, as Tauri managed state.
#[derive(Debug, Default)]
pub struct ScanState(RunSlot);

impl Deref for ScanState {
    type Target = RunSlot;

    fn deref(&self) -> &RunSlot {
        &self.0
    }
}

/// What to scan: the files, the threshold from `0` to `1`, and whether to also try each frame rotated and flipped.
#[derive(Debug, Clone)]
struct Request {
    paths: Vec<PathBuf>,
    threshold: f64,
    rotate: bool,
    flip: bool,
}

/// Scans `paths`, grouping the files scoring at least `threshold` against each other, with rotated frames tried if
/// `rotate` and flipped ones if `flip`. Files that can't be read are skipped and returned with the groups.
///
/// Sends [`ScanMessage`]s to `on_event` while it runs, at most one of each kind every 100 ms, always the latest, plus
/// the final progress. Cancels any scan still running first.
///
/// # Errors
///
/// - `cancelled` if this scan was cancelled or replaced before it finished.
/// - `task` if `threshold` is not between 0 and 1, or the blocking task fails to finish.
#[tauri::command]
pub async fn start_scan(
    state: State<'_, ScanState>,
    paths: Vec<PathBuf>,
    threshold: f64,
    rotate: bool,
    flip: bool,
    on_event: Channel<ScanMessage>,
) -> Result<ScanResult, ScanFailure> {
    let send = move |message| {
        // A window that has gone away no longer wants the progress; the scan still finishes or is cancelled.
        let _ = on_event.send(message);
    };
    scan(&state, Request { paths, threshold, rotate, flip }, send).await
}

/// Cancels the scan in flight, which then resolves as `cancelled`. Does nothing if none is running.
#[tauri::command]
#[allow(clippy::needless_pass_by_value, reason = "Tauri passes command arguments by value")]
pub fn cancel_scan(state: State<'_, ScanState>) {
    state.cancel();
}

async fn scan<S>(state: &ScanState, request: Request, send: S) -> Result<ScanResult, ScanFailure>
where
    S: Fn(ScanMessage) + Send + Sync + 'static,
{
    let Request { paths, threshold, rotate, flip } = request;
    if !(0.0..=1.0).contains(&threshold) {
        return Err(ScanFailure::Task { message: format!("the threshold must be between 0 and 1, got {threshold}") });
    }

    let (id, token) = state.start();
    let options = CompareOptions::new().rotate(rotate).flip(flip);
    let scan = Scan::new(paths, threshold).options(options).cancel(token).on_error(OnError::Skip);
    let result = spawn_blocking(move || run_throttled(scan, &send)).await;
    state.finish(id);

    result?
}

/// Runs `scan`, sending its events through a [`Throttle`]. A flusher thread sends the messages it held back once they are due, so the window catches
/// up even while one comparison takes long.
fn run_throttled(scan: Scan, send: &(impl Fn(ScanMessage) + Sync)) -> Result<ScanResult, ScanFailure> {
    let throttle = Mutex::new(Throttle::default());
    // Sending under the lock keeps the messages in order.
    let throttled = |messages: Vec<ScanMessage>| messages.into_iter().for_each(send);
    let (stop, stopped) = mpsc::channel::<()>();

    std::thread::scope(|scope| {
        let (throttle, throttled) = (&throttle, &throttled);
        scope.spawn(move || {
            while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(INTERVAL) {
                let mut throttle = throttle.lock().unwrap_or_else(PoisonError::into_inner);
                throttled(throttle.release(Instant::now(), false));
            }
        });

        let offer = |message: ScanMessage| {
            let mut throttle = throttle.lock().unwrap_or_else(PoisonError::into_inner);
            throttled(throttle.offer(message, Instant::now()));
        };
        let result = scan.run(|event| offer(event.into())).map(ScanResult::new).map_err(ScanFailure::from);
        drop(stop);
        result
    })
}

/// Lets each kind of [`ScanMessage`] through at most once every [`INTERVAL`], holding back the latest one that came
/// too soon until it is due. The time is passed in, so it can be tested without a clock.
#[derive(Debug, Default)]
struct Throttle {
    /// When each kind was last let through.
    sent: [Option<Instant>; 2],
    /// The latest message of each kind held back.
    pending: [Option<ScanMessage>; 2],
}

impl Throttle {
    /// The messages to send now that `message` has come, at `now`: it, if its kind is due, and otherwise none, with
    /// `message` held back in place of any older one of its kind. A final progress always goes at once, after the
    /// messages held back, and replaces any of its kind held back.
    fn offer(&mut self, message: ScanMessage, now: Instant) -> Vec<ScanMessage> {
        let kind = message.kind();

        if message.is_final() {
            self.pending[kind] = None;
            let mut messages = self.release(now, true);
            self.sent[kind] = Some(now);
            messages.push(message);
            return messages;
        }

        if self.is_due(kind, now) {
            self.pending[kind] = None;
            self.sent[kind] = Some(now);
            vec![message]
        } else {
            self.pending[kind] = Some(message);
            Vec::new()
        }
    }

    /// The held-back messages whose kind is due at `now`, or all of them if `all`, marked as sent at `now`.
    fn release(&mut self, now: Instant, all: bool) -> Vec<ScanMessage> {
        let mut messages = Vec::new();
        for kind in 0..self.pending.len() {
            if (all || self.is_due(kind, now))
                && let Some(message) = self.pending[kind].take()
            {
                self.sent[kind] = Some(now);
                messages.push(message);
            }
        }
        messages
    }

    fn is_due(&self, kind: usize, now: Instant) -> bool {
        self.sent[kind].is_none_or(|sent| now.saturating_duration_since(sent) >= INTERVAL)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::json;
    use tauri::async_runtime::block_on;

    use super::*;
    use crate::admission::tests::fixture;

    fn processing(path: &str) -> ScanMessage {
        ScanMessage::Processing { path: path.into(), display: path.into() }
    }

    fn progress(done: usize, total: usize) -> ScanMessage {
        ScanMessage::Progress { done, total, skipped: 0, eta_seconds: None }
    }

    fn request(paths: Vec<PathBuf>, threshold: f64) -> Request {
        Request { paths, threshold, rotate: false, flip: false }
    }

    /// Runs a scan, collecting the messages it sends.
    fn collect(state: &ScanState, request: Request) -> (Result<ScanResult, ScanFailure>, Vec<ScanMessage>) {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&messages);
        let result = block_on(scan(state, request, move |message| sink.lock().unwrap().push(message)));
        let messages = messages.lock().unwrap().clone();
        (result, messages)
    }

    /// Waits until a scan is registered in `state`.
    fn wait_until_running(state: &ScanState) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while state.lock().is_none() {
            assert!(Instant::now() < deadline, "the scan never started");
            std::thread::yield_now();
        }
    }

    // Throttle

    #[test]
    fn the_first_message_of_each_kind_goes_at_once() {
        let mut throttle = Throttle::default();
        let now = Instant::now();

        assert_eq!(throttle.offer(processing("a"), now), [processing("a")]);
        assert_eq!(throttle.offer(progress(1, 9), now), [progress(1, 9)]);
    }

    #[test]
    fn messages_that_come_too_soon_keep_only_the_latest_until_it_is_due() {
        let mut throttle = Throttle::default();
        let start = Instant::now();
        throttle.offer(progress(1, 9), start);

        assert!(throttle.offer(progress(2, 9), start + Duration::from_millis(30)).is_empty());
        assert!(throttle.offer(progress(3, 9), start + Duration::from_millis(60)).is_empty());
        assert!(throttle.release(start + Duration::from_millis(90), false).is_empty());

        assert_eq!(throttle.release(start + INTERVAL, false), [progress(3, 9)]);
        assert!(throttle.release(start + INTERVAL * 3, false).is_empty(), "nothing is sent twice");
    }

    #[test]
    fn a_message_once_due_goes_at_once() {
        let mut throttle = Throttle::default();
        let start = Instant::now();
        throttle.offer(processing("a"), start);
        throttle.offer(processing("b"), start + Duration::from_millis(50));

        assert_eq!(throttle.offer(processing("c"), start + INTERVAL), [processing("c")]);
        assert!(throttle.release(start + INTERVAL * 5, false).is_empty(), "the held-back `b` was replaced");
    }

    #[test]
    fn kinds_are_throttled_apart() {
        let mut throttle = Throttle::default();
        let now = Instant::now();
        throttle.offer(processing("a"), now);

        assert_eq!(throttle.offer(progress(1, 9), now), [progress(1, 9)]);
    }

    #[test]
    fn the_final_progress_always_goes_after_the_held_back_processing() {
        let mut throttle = Throttle::default();
        let start = Instant::now();
        throttle.offer(processing("a"), start);
        throttle.offer(progress(1, 3), start);
        let soon = start + Duration::from_millis(10);
        throttle.offer(processing("c"), soon);
        throttle.offer(progress(2, 3), soon);

        assert_eq!(throttle.offer(progress(3, 3), soon), [processing("c"), progress(3, 3)]);
        assert!(throttle.release(start + INTERVAL * 5, false).is_empty(), "the held-back progress was replaced");
    }

    // Serialization

    #[test]
    fn messages_serialize_as_tagged_camel_case_objects() {
        let progress = ScanMessage::Progress { done: 30, total: 48, skipped: 1, eta_seconds: Some(24.5) };
        let estimating = ScanMessage::Progress { done: 0, total: 48, skipped: 0, eta_seconds: None };

        assert_eq!(
            serde_json::to_value(processing("/a/b.png")).unwrap(),
            json!({ "kind": "processing", "path": "/a/b.png", "display": "/a/b.png" })
        );
        assert_eq!(
            serde_json::to_value(progress).unwrap(),
            json!({ "kind": "progress", "done": 30, "total": 48, "skipped": 1, "etaSeconds": 24.5 })
        );
        assert!(serde_json::to_value(estimating).unwrap().get("etaSeconds").is_none());
    }

    #[test]
    fn a_result_serializes_as_files_and_skipped_files() {
        let media = Media::from_file(fixture("test1.png")).unwrap();
        let result = ScanResult {
            groups: vec![ScanGroup { files: vec![media.clone()] }],
            skipped: vec![SkippedFile { path: "/c.png".into(), message: "boom".into() }],
        };

        assert_eq!(
            serde_json::to_value(result).unwrap(),
            json!({
                "groups": [{ "files": [serde_json::to_value(&media).unwrap()] }],
                "skipped": [{ "path": "/c.png", "message": "boom" }],
            })
        );
        let file = serde_json::to_value(&media).unwrap();
        for key in ["path", "type", "width", "height", "size", "duration", "created", "modified"] {
            assert!(file.get(key).is_some(), "{key} is missing from {file}");
        }
    }

    #[test]
    fn failures_serialize_as_tagged_objects() {
        assert_eq!(serde_json::to_value(ScanFailure::Cancelled).unwrap(), json!({ "kind": "cancelled" }));
        assert_eq!(
            serde_json::to_value(ScanFailure::Task { message: "panic".into() }).unwrap(),
            json!({ "kind": "task", "message": "panic" })
        );
    }

    #[test]
    fn a_processing_event_carries_the_display_path() {
        let path = std::env::home_dir().unwrap_or_default().join("Pictures").join("a.png");

        let ScanMessage::Processing { path: exact, display } = ScanEvent::Processing(&path).into() else {
            panic!("expected a processing message");
        };

        assert_eq!(exact, path.to_string_lossy());
        assert_eq!(display, display_home(&path));
    }

    // Commands

    #[test]
    fn a_bad_threshold_is_rejected_as_a_task_failure() {
        for threshold in [-0.1, 1.5, f64::NAN] {
            let (result, messages) = collect(&ScanState::default(), request(vec![fixture("test1.png")], threshold));

            assert!(matches!(result, Err(ScanFailure::Task { .. })), "{threshold}: {result:?}");
            assert!(messages.is_empty());
        }
    }

    #[test]
    fn a_scan_groups_its_files_skips_the_unreadable_and_ends_with_the_final_progress() {
        let (a, b, missing) = (fixture("test1.png"), fixture("test1.png"), fixture("missing.png"));
        let state = ScanState::default();

        let (result, messages) = collect(&state, request(vec![a.clone(), b, missing.clone()], 0.9));

        let result = result.unwrap();
        assert_eq!(result.groups.len(), 1);
        assert_eq!(result.skipped.len(), 1);
        assert_eq!(result.skipped[0].path, missing.to_string_lossy());
        assert!(
            matches!(messages.last(), Some(ScanMessage::Progress { done: 3, total: 3, skipped: 1, .. })),
            "{messages:?}"
        );
        assert!(
            messages.contains(&ScanMessage::Processing {
                path: a.to_string_lossy().into_owned(),
                display: display_home(&a)
            })
        );
        assert!(state.lock().is_none(), "a finished scan is forgotten");
    }

    #[test]
    fn a_group_carries_its_files() {
        // `test2.png` scores about 0.95 against `test1.png`, so it stays out of the group at 0.99.
        let (a, other) = (fixture("test1.png"), fixture("test2.png"));

        let (result, _) = collect(&ScanState::default(), request(vec![a.clone(), a.clone(), other], 0.99));

        let result = result.unwrap();
        let [group] = result.groups.as_slice() else { panic!("expected one group: {result:?}") };
        assert_eq!(group.files.len(), 2);
        assert!(
            group
                .files
                .iter()
                .all(|file| file.path == a && file.width > 0 && file.height > 0 && file.size > 0)
        );
    }

    #[test]
    fn a_new_scan_cancels_the_one_it_replaces() {
        let state = ScanState::default();
        let videos: Vec<_> = (0..8).map(|i| fixture(if i % 2 == 0 { "test3.mp4" } else { "test4.mp4" })).collect();

        let (first, second) = std::thread::scope(|scope| {
            let first = scope.spawn(|| collect(&state, request(videos, 0.9)).0);
            wait_until_running(&state);
            let second = collect(&state, request(vec![fixture("test1.png")], 0.9)).0;
            (first.join().unwrap(), second)
        });

        assert_eq!(first, Err(ScanFailure::Cancelled));
        assert!(second.is_ok_and(|result| result.groups.is_empty()));
    }
}
