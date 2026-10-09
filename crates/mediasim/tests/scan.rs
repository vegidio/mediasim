//! The grouping scan, run over copies of the fixtures.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use common::fixture;
use mediasim::{CancelToken, Grouper, Media, MediaError, OnError, Scan, ScanError, ScanEvent, ScanProgress, Scanned};
use rust_sak::fs::{TempDir, mk_temp_dir};

/// A threshold that two copies of one fixture reach and two different fixtures don't.
const THRESHOLD: f64 = 0.99;

/// What a scan reported, with each processed path owned.
#[derive(Debug, Clone, PartialEq)]
enum Event {
    Processing(PathBuf),
    Progress(ScanProgress),
}

/// A temporary directory holding a copy of each `(fixture, name)` pair.
fn directory(files: &[(&str, &str)]) -> TempDir {
    let dir = mk_temp_dir("mediasim").unwrap();
    for (fixture_name, name) in files {
        std::fs::copy(fixture(fixture_name), dir.path().join(name)).unwrap();
    }
    dir
}

/// `a.png` and `b.png`, which match, and `c.png` and `d.png`, which match nothing.
fn four_images() -> TempDir {
    let dir = directory(&[("test1.avif", "a.png"), ("test1.avif", "b.png"), ("test2.avif", "c.png")]);
    image::RgbImage::from_pixel(64, 48, image::Rgb([200, 30, 90]))
        .save(dir.path().join("d.png"))
        .unwrap();
    dir
}

fn paths(dir: &Path, names: &[&str]) -> Vec<PathBuf> {
    names.iter().map(|name| dir.join(name)).collect()
}

/// Runs `scan`, recording every event.
fn run(scan: Scan) -> (Result<Scanned, ScanError>, Vec<Event>) {
    let mut events = Vec::new();
    let result = scan.run(|event| {
        events.push(match event {
            ScanEvent::Processing(path) => Event::Processing(path.to_path_buf()),
            ScanEvent::Progress(progress) => Event::Progress(progress),
        });
    });
    (result, events)
}

fn progress(events: &[Event]) -> Vec<ScanProgress> {
    events
        .iter()
        .filter_map(|event| match event {
            Event::Progress(progress) => Some(*progress),
            Event::Processing(_) => None,
        })
        .collect()
}

fn group_paths(groups: &[Vec<Media>]) -> Vec<Vec<PathBuf>> {
    groups.iter().map(|group| group.iter().map(|media| media.path.clone()).collect()).collect()
}

#[test]
fn groups_equal_those_of_pushing_one_at_a_time() {
    let dir = four_images();
    let paths = paths(dir.path(), &["a.png", "b.png", "c.png", "d.png"]);

    let scanned = Scan::new(paths.clone(), THRESHOLD).run(|_| {}).unwrap();

    let mut grouper = Grouper::new(THRESHOLD);
    for path in &paths {
        grouper.push(Media::from_file(path).unwrap());
    }
    assert_eq!(scanned.groups, grouper.finish());
    assert_eq!(group_paths(&scanned.groups), [[dir.path().join("a.png"), dir.path().join("b.png")]]);
    assert!(scanned.skipped.is_empty());
}

#[test]
fn every_file_reports_progress_ending_at_the_total_with_no_time_left() {
    let dir = four_images();
    std::fs::copy(fixture("test2.avif"), dir.path().join("e.png")).unwrap();
    let paths = paths(dir.path(), &["a.png", "b.png", "c.png", "d.png", "e.png"]);

    let (result, events) = run(Scan::new(paths, THRESHOLD));

    result.unwrap();
    let progress = progress(&events);
    assert_eq!(progress.iter().map(|p| p.done).collect::<Vec<_>>(), [1, 2, 3, 4, 5]);
    assert!(progress.iter().all(|p| p.total == 5 && p.skipped == 0), "{progress:?}");
    assert_eq!(progress.last().unwrap().eta, Some(Duration::ZERO));
}

#[test]
fn processing_is_reported_as_each_file_starts() {
    let dir = four_images();
    let paths = paths(dir.path(), &["a.png", "c.png", "d.png"]);

    let (result, events) = run(Scan::new(paths.clone(), THRESHOLD));

    result.unwrap();
    // Every file is reported once, as it starts loading: before the `Progress` that counts it done.
    let mut started = 0;
    for event in &events {
        match event {
            Event::Processing(_) => started += 1,
            Event::Progress(progress) => assert!(progress.done <= started, "{events:?}"),
        }
    }
    let mut processed: Vec<_> = events
        .iter()
        .filter_map(|event| match event {
            Event::Processing(path) => Some(path.clone()),
            Event::Progress(_) => None,
        })
        .collect();
    processed.sort();
    assert_eq!(processed, paths);
    assert_eq!(events.len(), 2 * paths.len(), "{events:?}");
}

#[test]
fn skip_counts_an_unreadable_file_and_returns_its_error() {
    let dir = four_images();
    let paths = paths(dir.path(), &["a.png", "missing.png", "b.png"]);

    let (result, events) = run(Scan::new(paths, THRESHOLD).on_error(OnError::Skip));

    let scanned = result.unwrap();
    let last = *progress(&events).last().unwrap();
    assert_eq!((last.done, last.total, last.skipped), (3, 3, 1));
    assert_eq!(scanned.skipped.len(), 1);
    assert_eq!(scanned.skipped[0].path(), dir.path().join("missing.png"));
    assert_eq!(group_paths(&scanned.groups), [[dir.path().join("a.png"), dir.path().join("b.png")]]);
    // Reported as it was attempted, like any other file.
    assert!(events.contains(&Event::Processing(dir.path().join("missing.png"))));
}

#[test]
fn skipped_errors_follow_the_order_of_the_paths() {
    let dir = four_images();
    let paths = paths(dir.path(), &["z-missing.png", "a.png", "m-missing.png", "a-missing.png"]);

    let scanned = Scan::new(paths, THRESHOLD).on_error(OnError::Skip).run(|_| {}).unwrap();

    let order: Vec<_> = scanned.skipped.iter().map(MediaError::path).collect();
    assert_eq!(
        order,
        [
            dir.path().join("z-missing.png"),
            dir.path().join("m-missing.png"),
            dir.path().join("a-missing.png")
        ]
    );
}

#[test]
fn stop_ends_the_scan_with_the_unreadable_file() {
    let dir = four_images();
    let paths = paths(dir.path(), &["a.png", "missing.png", "b.png"]);

    let (result, _) = run(Scan::new(paths, THRESHOLD).on_error(OnError::Stop));

    let Err(ScanError::Load(err)) = result else { panic!("expected a load error: {result:?}") };
    assert_eq!(err.path(), dir.path().join("missing.png"));
}

#[test]
fn cancelled_mid_scan_ends_as_cancelled_with_no_further_progress() {
    let names: Vec<String> = (0..40).map(|i| format!("{i:02}.png")).collect();
    let dir = directory(&names.iter().map(|name| ("test2.avif", name.as_str())).collect::<Vec<_>>());
    let token = CancelToken::new();

    let mut events = Vec::new();
    let result = Scan::new(paths(dir.path(), &names.iter().map(String::as_str).collect::<Vec<_>>()), THRESHOLD)
        .cancel(token.clone())
        .run(|event| {
            if let ScanEvent::Progress(progress) = event {
                events.push(progress.done);
                if progress.done == 5 {
                    token.cancel();
                }
            }
        });

    assert!(matches!(result, Err(ScanError::Cancelled)), "{result:?}");
    assert_eq!(events, [1, 2, 3, 4, 5]);
}

#[test]
fn cancelled_before_it_starts_decodes_nothing() {
    let dir = four_images();
    let token = CancelToken::new();
    token.cancel();

    let (result, events) = run(Scan::new(paths(dir.path(), &["a.png", "b.png"]), THRESHOLD).cancel(token));

    assert!(matches!(result, Err(ScanError::Cancelled)), "{result:?}");
    assert!(events.is_empty(), "{events:?}");
}

#[test]
fn a_token_never_cancelled_changes_nothing() {
    let dir = four_images();
    let paths = paths(dir.path(), &["a.png", "b.png", "c.png", "d.png"]);

    let with_token = Scan::new(paths.clone(), THRESHOLD).cancel(CancelToken::new()).run(|_| {}).unwrap();
    let without = Scan::new(paths, THRESHOLD).run(|_| {}).unwrap();

    assert_eq!(with_token.groups, without.groups);
}

#[cfg(feature = "cache")]
#[test]
fn cached_groups_equal_uncached_ones() {
    let dir = four_images();
    let paths = paths(dir.path(), &["a.png", "b.png", "c.png", "d.png"]);
    let uncached = Scan::new(paths.clone(), THRESHOLD).run(|_| {}).unwrap();

    for _ in 0..2 {
        let cache = mediasim::DirCache::open(dir.path()).unwrap();
        let cached = Scan::new(paths.clone(), THRESHOLD).cache(&cache).run(|_| {}).unwrap();
        drop(cache);

        assert_eq!(cached.groups, uncached.groups);
    }
}

#[test]
fn groups_follow_the_earliest_of_their_paths_given() {
    let dir = directory(&[
        ("test1.avif", "x1.png"),
        ("test1.avif", "x2.png"),
        ("test2.avif", "a1.png"),
        ("test2.avif", "a2.png"),
    ]);
    let given = paths(dir.path(), &["x1.png", "a1.png", "x2.png", "a2.png"]);

    let scanned = Scan::new(given, THRESHOLD).run(|_| {}).unwrap();

    let groups: Vec<Vec<PathBuf>> = scanned
        .groups
        .iter()
        .map(|group| group.iter().map(|media| media.path.clone()).collect())
        .collect();
    assert_eq!(groups, [paths(dir.path(), &["x1.png", "x2.png"]), paths(dir.path(), &["a1.png", "a2.png"])]);
}
