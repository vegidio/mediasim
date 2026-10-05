//! A token that stops a load from another thread.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// A flag that asks a load to stop, set from any thread.
///
/// Clones share the flag, so cancelling one clone stops every load that holds any of them. A token cannot be reset:
/// once cancelled, it stays cancelled. Pass it to [`Media::from_file_cancellable`](crate::Media::from_file_cancellable).
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    /// A token that is not cancelled.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Cancels the token, and every clone of it.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    /// Whether the token, or any clone of it, has been cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_not_cancelled() {
        assert!(!CancelToken::new().is_cancelled());
    }

    #[test]
    fn cancel_is_seen_by_every_clone() {
        let token = CancelToken::new();
        let clone = token.clone();

        clone.cancel();

        assert!(token.is_cancelled());
        assert!(clone.is_cancelled());
    }

    #[test]
    fn cancel_is_seen_across_threads() {
        let token = CancelToken::new();
        let clone = token.clone();

        std::thread::spawn(move || clone.cancel()).join().unwrap();

        assert!(token.is_cancelled());
    }
}
