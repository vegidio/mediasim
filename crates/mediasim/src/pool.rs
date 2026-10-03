//! The thread pools that decode media, owned by the library so a batch load never occupies the caller's pool.

use std::num::NonZeroUsize;
use std::sync::OnceLock;

use rayon::ThreadPool;

/// Videos are decoded on their own pool with this fraction of the logical CPUs, because each video decoder is
/// already multithreaded; one video per core would oversubscribe the CPU and hold many decoders in memory.
const VIDEO_WORKER_DIVISOR: usize = 4;

/// The process-wide pool that decodes images, one thread per logical CPU, created on first use.
pub(crate) fn image_pool() -> &'static ThreadPool {
    static POOL: OnceLock<ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| build("image", cpus()))
}

/// The process-wide pool that decodes videos, created on first use.
pub(crate) fn video_pool() -> &'static ThreadPool {
    static POOL: OnceLock<ThreadPool> = OnceLock::new();
    POOL.get_or_init(|| build("video", (cpus() / VIDEO_WORKER_DIVISOR).max(1)))
}

fn cpus() -> usize {
    std::thread::available_parallelism().map_or(1, NonZeroUsize::get)
}

fn build(kind: &'static str, threads: usize) -> ThreadPool {
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(move |i| format!("mediasim-{kind}-{i}"))
        .build()
        .unwrap_or_else(|e| panic!("failed to spawn the {kind} decoding threads: {e}"))
}
