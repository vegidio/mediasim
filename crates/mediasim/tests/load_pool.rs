//! Checks that `Media::from_files` decodes on the library's own pools, leaving rayon's global pool to the caller.
//!
//! It parks every global-pool worker, so it lives in its own test binary, where that cannot slow down other tests.

mod common;

use std::sync::{Arc, RwLock, mpsc};
use std::thread;
use std::time::Duration;

use common::fixture;
use mediasim::Media;

#[test]
fn from_files_completes_while_the_global_pool_is_busy() {
    // Park every global-pool worker behind `gate`, standing in for caller work that keeps them all busy.
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
        let results: Vec<_> = Media::from_files(vec![fixture("test1.png"), fixture("test3.mp4")]).collect();
        done_tx.send(results).unwrap();
    });

    let results = done_rx.recv_timeout(Duration::from_secs(60));
    drop(closed);

    let results = results.expect("loading waited for the global pool");
    assert_eq!(results.len(), 2);
    assert!(results.iter().all(Result::is_ok), "{results:?}");
}
