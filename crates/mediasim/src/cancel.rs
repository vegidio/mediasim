//! A token that stops a load from another thread.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// A flag that asks a load to stop, set from any thread.
///
/// Clones share the flag, so cancelling one clone stops every load that holds any of them. A token cannot be reset:
/// once cancelled, it stays cancelled. Pass it to [`Media::from_file_cancellable`](crate::Media::from_file_cancellable).
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<Flag>);

/// The state clones of a [`CancelToken`] share.
#[derive(Debug, Default)]
struct Flag {
    cancelled: AtomicBool,
    /// The token this one was made from with [`CancelToken::child`], whose cancellation it also reports.
    parent: Option<CancelToken>,
}

impl CancelToken {
    /// A token that is not cancelled.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A new token that is cancelled once either it or `self` is. Cancelling it leaves `self` alone, so a run can
    /// stop its own work without stopping everything else its caller's token governs.
    pub(crate) fn child(&self) -> Self {
        Self(Arc::new(Flag { cancelled: AtomicBool::new(false), parent: Some(self.clone()) }))
    }

    /// Cancels the token, and every clone of it.
    pub fn cancel(&self) {
        self.0.cancelled.store(true, Ordering::Release);
    }

    /// Whether the token, or any clone of it, has been cancelled.
    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.cancelled.load(Ordering::Acquire) || self.0.parent.as_ref().is_some_and(Self::is_cancelled)
    }
}

/// Cancels its token when dropped, so every way out of a scope, early returns and panics included, stops the work
/// the token governs.
#[derive(Debug)]
pub(crate) struct CancelOnDrop(pub(crate) CancelToken);

impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        self.0.cancel();
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

    #[test]
    fn a_child_is_cancelled_with_its_parent() {
        let parent = CancelToken::new();
        let child = parent.child();

        parent.cancel();

        assert!(child.is_cancelled());
    }

    #[test]
    fn cancelling_a_child_leaves_its_parent_alone() {
        let parent = CancelToken::new();
        let child = parent.child();
        let sibling = parent.child();

        child.clone().cancel();

        assert!(child.is_cancelled());
        assert!(!parent.is_cancelled());
        assert!(!sibling.is_cancelled());
    }

    #[test]
    fn a_dropped_guard_cancels_its_token() {
        let token = CancelToken::new();

        drop(CancelOnDrop(token.clone()));

        assert!(token.is_cancelled());
    }
}
