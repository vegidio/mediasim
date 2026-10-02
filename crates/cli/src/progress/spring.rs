//! A damped spring that eases the bar toward its target.

/// The angular frequency, in radians per second.
const FREQUENCY: f64 = 18.0;
/// The damping ratio; `1` is critically damped, so the spring settles without oscillating.
const DAMPING: f64 = 1.0;
/// The time step: one frame at 60 fps.
const STEP: f64 = 1.0 / 60.0;

/// Within these distances of the target and of rest, the spring snaps to the target.
const POSITION_EPSILON: f64 = 0.001;
const VELOCITY_EPSILON: f64 = 0.01;

#[derive(Debug, Default)]
pub struct Spring {
    pub position: f64,
    velocity: f64,
    pub target: f64,
}

impl Spring {
    /// Advances the spring by one frame, with semi-implicit Euler.
    pub fn step(&mut self) {
        if self.is_settled() {
            return;
        }

        let acceleration =
            -FREQUENCY * FREQUENCY * (self.position - self.target) - 2.0 * DAMPING * FREQUENCY * self.velocity;
        self.velocity += acceleration * STEP;
        self.position += self.velocity * STEP;

        if (self.target - self.position).abs() < POSITION_EPSILON && self.velocity.abs() < VELOCITY_EPSILON {
            self.snap();
        }
    }

    /// Whether the spring rests on its target.
    #[allow(clippy::float_cmp, reason = "`snap` copies the target exactly, so equality is exact")]
    pub fn is_settled(&self) -> bool {
        self.position == self.target && self.velocity == 0.0
    }

    /// Moves the spring onto its target at rest.
    pub fn snap(&mut self) {
        self.position = self.target;
        self.velocity = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spring_to(target: f64) -> Spring {
        Spring { target, ..Spring::default() }
    }

    #[test]
    fn reaches_the_target() {
        let mut spring = spring_to(0.5);

        for _ in 0..600 {
            spring.step();
        }

        assert!(spring.is_settled());
        assert!((spring.position - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn never_overshoots() {
        let mut spring = spring_to(1.0);

        for _ in 0..600 {
            spring.step();
            assert!(spring.position <= 1.0, "overshot to {}", spring.position);
        }
    }

    #[test]
    fn settles_from_zero_to_one_within_a_second() {
        let mut spring = spring_to(1.0);

        let steps = (1..=60).find(|_| {
            spring.step();
            spring.is_settled()
        });

        assert!(steps.is_some(), "not settled after 60 steps, at {}", spring.position);
    }

    #[test]
    fn a_settled_spring_stays_put() {
        let mut spring = spring_to(0.0);

        spring.step();

        assert!(spring.is_settled());
        assert!(spring.position.abs() < f64::EPSILON);
    }
}
