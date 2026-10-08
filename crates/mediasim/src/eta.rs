//! The estimated time left of a batch.

use std::time::Duration;

/// How often the estimate may change, so it doesn't flicker.
const THROTTLE: Duration = Duration::from_secs(1);

/// The estimated time a batch has left: the average time per finished item, times the items remaining.
///
/// Times are passed in as the elapsed time since the batch started, so the estimate needs no clock of its own and can
/// be tested without a timer. It changes at most once a second, so a display of it doesn't flicker.
#[derive(Debug, Default)]
pub struct Eta {
    value: Option<Duration>,
    updated_at: Duration,
}

impl Eta {
    /// The current estimate; `None` until the first item has finished.
    #[must_use]
    pub fn value(&self) -> Option<Duration> {
        self.value
    }

    /// Recalculates the estimate from `completed` of `total` items finished after `elapsed`. The first estimate and
    /// the final `0` apply at once; any other change waits until a second has passed since the last one.
    pub fn update(&mut self, completed: usize, total: usize, elapsed: Duration) {
        if completed >= total {
            self.value = Some(Duration::ZERO);
        } else if completed == 0 {
            self.value = None;
        } else if self.value.is_none() || elapsed.saturating_sub(self.updated_at) >= THROTTLE {
            let remaining = u32::try_from(total - completed).unwrap_or(u32::MAX);
            let completed = u32::try_from(completed).unwrap_or(u32::MAX);
            self.value = Some(elapsed / completed * remaining);
        } else {
            return;
        }

        self.updated_at = elapsed;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(s: f64) -> Duration {
        Duration::from_secs_f64(s)
    }

    #[test]
    fn nothing_loaded_has_no_estimate() {
        let mut eta = Eta::default();

        eta.update(0, 2, secs(3.0));

        assert_eq!(eta.value(), None);
    }

    #[test]
    fn first_file_gives_an_estimate_at_once() {
        let mut eta = Eta::default();
        eta.update(0, 2, secs(0.5));

        eta.update(1, 2, secs(4.0));

        assert_eq!(eta.value(), Some(secs(4.0)));
    }

    #[test]
    fn estimate_is_throttled_to_once_a_second() {
        let mut eta = Eta::default();
        eta.update(1, 4, secs(2.0));

        eta.update(2, 4, secs(2.5));
        assert_eq!(eta.value(), Some(secs(6.0)), "changed within a second");

        eta.update(2, 4, secs(3.0));
        assert_eq!(eta.value(), Some(secs(3.0)));
    }

    #[test]
    fn all_done_is_zero_at_once() {
        let mut eta = Eta::default();
        eta.update(1, 2, secs(4.0));

        eta.update(2, 2, secs(4.1));

        assert_eq!(eta.value(), Some(Duration::ZERO));
    }
}
