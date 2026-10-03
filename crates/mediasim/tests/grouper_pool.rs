//! Checks that `Grouper::push` does not depend on rayon's global pool, the pool `Media::from_files` decodes images on.
//!
//! It parks every global-pool worker, so it lives in its own test binary, where that cannot slow down other tests.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock, mpsc};
use std::thread;
use std::time::Duration;

use mediasim::{Grouper, Media};

fn load(name: &str) -> Media {
    let path: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures").join(name);
    Media::from_file(&path).unwrap_or_else(|e| panic!("{e}"))
}

#[test]
fn push_completes_while_the_global_pool_is_busy() {
    // Load first, so loading does not need the global pool once it is parked.
    let media: Vec<Media> = ["test1.png", "test2.png", "test3.mp4", "test4.mp4"].into_iter().map(load).collect();

    // Park every global-pool worker behind `gate`, standing in for a batch load that keeps them all busy.
    let gate = Arc::new(RwLock::new(()));
    let closed = gate.write().unwrap();
    let (parked_tx, parked_rx) = mpsc::channel();
    {
        let gate = Arc::clone(&gate);
        thread::spawn(move || {
            rayon::broadcast(|_| {
                parked_tx.send(()).unwrap();
                drop(gate.read());
            });
        });
    }
    for _ in 0..rayon::current_num_threads() {
        parked_rx.recv().unwrap();
    }

    let (done_tx, done_rx) = mpsc::channel();
    thread::spawn(move || {
        let mut grouper = Grouper::new(0.8);
        grouper.extend(media);
        done_tx.send(grouper.finish()).unwrap();
    });

    let groups = done_rx.recv_timeout(Duration::from_secs(10));
    drop(closed);

    let groups = groups.expect("grouping waited for the global pool");
    let paths: Vec<Vec<&Path>> = groups.iter().map(|g| g.iter().map(|m| m.path.as_path()).collect()).collect();
    assert_eq!(paths.len(), 1, "{paths:?}");
    assert!(paths[0][0].ends_with("test1.png") && paths[0][1].ends_with("test2.png"), "{paths:?}");
}
