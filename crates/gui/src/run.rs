//! The one cancellable run a command allows at a time, shared by the comparison and the scan.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use mediasim::CancelToken;

/// The run in flight: its id and the token that stops it. Starting a run cancels the one it replaces.
#[derive(Debug, Default)]
pub struct RunSlot {
    running: Mutex<Option<(u64, CancelToken)>>,
    next: AtomicU64,
}

impl RunSlot {
    pub(crate) fn lock(&self) -> MutexGuard<'_, Option<(u64, CancelToken)>> {
        // The slot holds a plain value that is never left half-updated, so a poisoned lock is still sound.
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Registers a new run and cancels the one it replaces, if any.
    pub(crate) fn start(&self) -> (u64, CancelToken) {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let token = CancelToken::new();

        if let Some((_, replaced)) = self.lock().replace((id, token.clone())) {
            replaced.cancel();
        }

        (id, token)
    }

    /// Forgets run `id`, unless a newer one has replaced it already.
    pub(crate) fn finish(&self, id: u64) {
        let mut running = self.lock();
        if running.as_ref().is_some_and(|(current, _)| *current == id) {
            *running = None;
        }
    }

    /// Cancels and forgets the run in flight, if any.
    pub(crate) fn cancel(&self) {
        if let Some((_, token)) = self.lock().take() {
            token.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelling_with_nothing_running_does_nothing() {
        let slot = RunSlot::default();

        slot.cancel();

        assert!(slot.lock().is_none());
    }

    #[test]
    fn running_is_cleared_only_by_its_own_run() {
        let slot = RunSlot::default();
        let (first, first_token) = slot.start();
        let (second, _) = slot.start();

        assert!(first_token.is_cancelled());
        slot.finish(first);
        assert_eq!(slot.lock().as_ref().map(|(id, _)| *id), Some(second));
        slot.finish(second);
        assert!(slot.lock().is_none());
    }
}
