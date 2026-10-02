//! The estimated time left, and its text.

use std::time::Duration;

/// How often the estimate may change, so it doesn't flicker.
const THROTTLE: Duration = Duration::from_secs(1);

/// The estimated time left, from the average time per loaded file.
///
/// Times are passed in as the elapsed time since loading started, so the estimate needs no clock of its own.
#[derive(Debug, Default)]
pub struct Eta {
    value: Option<Duration>,
    updated_at: Duration,
}

impl Eta {
    /// The current estimate; `None` until the first file has loaded.
    pub fn value(&self) -> Option<Duration> {
        self.value
    }

    /// Recalculates the estimate. The first estimate and the final `0` apply at once; any other change waits until
    /// a second has passed since the last one.
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

/// Formats an estimate the way Go prints a duration: `--` when there is none, tenths of a second below 10 s (`4.2s`),
/// whole seconds above that (`12s`, `1m5s`, `1h2m3s`).
pub fn format_eta(eta: Option<Duration>) -> String {
    let Some(eta) = eta else { return "--".to_owned() };

    if eta < Duration::from_secs(10) {
        let tenths = eta.as_millis() / 100;
        return match tenths % 10 {
            0 => format!("{}s", tenths / 10),
            fraction => format!("{}.{fraction}s", tenths / 10),
        };
    }

    let secs = eta.as_secs();
    let (hours, minutes, seconds) = (secs / 3600, secs / 60 % 60, secs % 60);
    match (hours, minutes) {
        (0, 0) => format!("{seconds}s"),
        (0, _) => format!("{minutes}m{seconds}s"),
        _ => format!("{hours}h{minutes}m{seconds}s"),
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

    #[test]
    fn text_format() {
        assert_eq!(format_eta(None), "--");
        assert_eq!(format_eta(Some(Duration::ZERO)), "0s");
        assert_eq!(format_eta(Some(secs(4.25))), "4.2s");
        assert_eq!(format_eta(Some(secs(4.0))), "4s");
        assert_eq!(format_eta(Some(secs(12.7))), "12s");
        assert_eq!(format_eta(Some(secs(65.0))), "1m5s");
        assert_eq!(format_eta(Some(secs(3723.0))), "1h2m3s");
    }
}
