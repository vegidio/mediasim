//! Dynamic Time Warping over a frame-cost matrix.
//!
//! Finds the cheapest monotonic alignment between two sequences and reports its average cost per step. Only two rows
//! of the dynamic-programming table are kept, so memory grows with the shorter sequence, not with the matrix.

use rayon::prelude::*;

/// The fewest frame costs a Rayon task computes, so short rows are not split into tasks that cost more to schedule
/// than to run.
const MIN_COSTS_PER_TASK: usize = 64;

/// One cell of the DTW table: the total cost of the cheapest alignment ending here, and how many steps it takes.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Cell {
    cost: f64,
    steps: usize,
}

impl Cell {
    /// Extends the alignment ending at `self` by one step of `cost`.
    fn step(self, cost: f64) -> Self {
        Self { cost: self.cost + cost, steps: self.steps + 1 }
    }

    /// The better of two alignments: the lower cost, and on an exact cost tie the one with more steps.
    ///
    /// Choosing by value rather than by direction makes the choice independent of the order of the arguments, which is
    /// what keeps the result bit-identical when the matrix is transposed.
    // The tie-break applies only to exact ties; a tolerance would make the choice depend on the order of comparisons.
    #[allow(clippy::float_cmp)]
    fn better(self, other: Self) -> Self {
        if other.cost < self.cost || (other.cost == self.cost && other.steps > self.steps) {
            other
        } else {
            self
        }
    }
}

/// Returns the average cost per step of the cheapest alignment of a `rows × cols` matrix, where `cost(i, j)` is the
/// cost of matching row item `i` with column item `j`.
///
/// Each row's costs are computed in parallel; the alignment itself runs sequentially.
///
/// # Panics
///
/// Panics if `rows` or `cols` is zero.
pub(crate) fn mean_cost(rows: usize, cols: usize, cost: impl Fn(usize, usize) -> f64 + Sync) -> f64 {
    let best = align(rows, cols, cost);
    // Step counts are bounded by the frame counts, far below the 2^53 where `f64` loses precision.
    #[allow(clippy::cast_precision_loss)]
    let steps = best.steps as f64;
    best.cost / steps
}

/// Returns the cheapest alignment of a `rows × cols` matrix, putting the shorter side on the columns.
fn align(rows: usize, cols: usize, cost: impl Fn(usize, usize) -> f64 + Sync) -> Cell {
    assert!(rows > 0 && cols > 0, "DTW needs at least one item on each side");

    if cols > rows {
        align_rows(cols, rows, &|i, j| cost(j, i))
    } else {
        align_rows(rows, cols, &cost)
    }
}

/// Fills the DTW table one row at a time, keeping only the previous and the current row.
fn align_rows(rows: usize, cols: usize, cost: &(impl Fn(usize, usize) -> f64 + Sync)) -> Cell {
    let mut costs = vec![0.0; cols];
    let mut prev: Vec<Cell> = Vec::with_capacity(cols);
    let mut cur: Vec<Cell> = Vec::with_capacity(cols);

    for i in 0..rows {
        costs
            .par_iter_mut()
            .enumerate()
            .with_min_len(MIN_COSTS_PER_TASK)
            .for_each(|(j, c)| *c = cost(i, j));

        cur.clear();
        for (j, &c) in costs.iter().enumerate() {
            let cell = match (i, j) {
                (0, 0) => Cell { cost: c, steps: 1 },
                (0, _) => cur[j - 1].step(c),
                (_, 0) => prev[0].step(c),
                _ => prev[j - 1].better(prev[j]).better(cur[j - 1]).step(c),
            };
            cur.push(cell);
        }

        std::mem::swap(&mut prev, &mut cur);
    }

    prev[cols - 1]
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    /// Runs [`align`] over a matrix given as rows.
    fn align_matrix(m: &[Vec<f64>]) -> Cell {
        align(m.len(), m[0].len(), |i, j| m[i][j])
    }

    fn transpose(m: &[Vec<f64>]) -> Vec<Vec<f64>> {
        (0..m[0].len()).map(|j| m.iter().map(|row| row[j]).collect()).collect()
    }

    /// A deterministic pseudo-random matrix (xorshift64), so tests need no RNG crate.
    fn random_matrix(rows: usize, cols: usize, seed: u64) -> Vec<Vec<f64>> {
        let mut state = seed;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            // The top 53 bits map exactly onto an `f64` in [0, 1).
            #[allow(clippy::cast_precision_loss)]
            let v = (state >> 11) as f64 / (1u64 << 53) as f64;
            v
        };
        (0..rows).map(|_| (0..cols).map(|_| next()).collect()).collect()
    }

    /// The textbook full-matrix DTW with the same tie-break, computed sequentially, as an independent reference.
    fn reference(m: &[Vec<f64>]) -> Cell {
        let (rows, cols) = (m.len(), m[0].len());
        let unreachable = Cell { cost: f64::INFINITY, steps: 0 };
        let mut table = vec![vec![unreachable; cols]; rows];

        for i in 0..rows {
            for j in 0..cols {
                let mut best = if i == 0 && j == 0 { Cell { cost: 0.0, steps: 0 } } else { unreachable };
                if i > 0 && j > 0 {
                    best = best.better(table[i - 1][j - 1]);
                }
                if i > 0 {
                    best = best.better(table[i - 1][j]);
                }
                if j > 0 {
                    best = best.better(table[i][j - 1]);
                }
                table[i][j] = best.step(m[i][j]);
            }
        }

        table[rows - 1][cols - 1]
    }

    #[test]
    fn single_cell_is_its_own_cost() {
        assert_eq!(align_matrix(&[vec![0.25]]), Cell { cost: 0.25, steps: 1 });
        assert_eq!(mean_cost(1, 1, |_, _| 0.25), 0.25);
    }

    #[test]
    fn square_matrix_matches_hand_computation() {
        // Cheapest path: (0,0) -> (1,1) -> (2,2), cost 1 + 1 + 1.
        let m = [vec![1.0, 3.0, 5.0], vec![2.0, 1.0, 4.0], vec![6.0, 2.0, 1.0]];

        assert_eq!(align_matrix(&m), Cell { cost: 3.0, steps: 3 });
        assert_eq!(mean_cost(3, 3, |i, j| m[i][j]), 1.0);
    }

    #[test]
    fn rectangular_matrix_matches_hand_computation() {
        // Cheapest path: (0,0) -> (0,1) -> (1,2) -> (1,3), all zeros. At (1,1) the diagonal (0, 1 step) and the cell
        // above (0, 2 steps) tie on cost, and the tie-break takes the longer one.
        let m = [vec![0.0, 0.0, 5.0, 5.0], vec![5.0, 5.0, 0.0, 0.0]];

        assert_eq!(align_matrix(&m), Cell { cost: 0.0, steps: 4 });
        assert_eq!(align_matrix(&transpose(&m)), Cell { cost: 0.0, steps: 4 });
    }

    #[test]
    fn all_zero_matrix_takes_the_longest_path() {
        // Every path costs 0, so the tie-break picks the longest one: rows + cols - 1 steps.
        assert_eq!(align(3, 5, |_, _| 0.0), Cell { cost: 0.0, steps: 7 });
        assert_eq!(mean_cost(3, 5, |_, _| 0.0), 0.0);
    }

    #[test]
    fn transposed_input_is_bit_identical() {
        let m = random_matrix(23, 17, 0x9E37_79B9_7F4A_7C15);
        let a = align_matrix(&m);
        let b = align_matrix(&transpose(&m));

        assert_eq!(a.cost.to_bits(), b.cost.to_bits());
        assert_eq!(a.steps, b.steps);
    }

    #[test]
    fn transposed_input_with_ties_is_bit_identical() {
        // Costs drawn from {0, 0.5, 1} create many exact ties between competing predecessors.
        let m: Vec<Vec<f64>> = random_matrix(11, 7, 42)
            .into_iter()
            .map(|row| row.into_iter().map(|v| (v * 3.0).floor() / 2.0).collect())
            .collect();
        let a = align_matrix(&m);
        let b = align_matrix(&transpose(&m));

        assert_eq!(a.cost.to_bits(), b.cost.to_bits());
        assert_eq!(a.steps, b.steps);
    }

    #[test]
    fn parallel_rows_match_sequential_reference() {
        for (rows, cols) in [(50, 37), (37, 50)] {
            let m = random_matrix(rows, cols, 7);
            let got = align_matrix(&m);
            let want = reference(&m);

            assert_eq!(got.cost.to_bits(), want.cost.to_bits(), "{rows}×{cols}");
            assert_eq!(got.steps, want.steps, "{rows}×{cols}");
        }
    }

    #[test]
    fn rows_longer_than_a_task_match_reference() {
        // Wider than `MIN_COSTS_PER_TASK`, so each row really is split across tasks.
        let m = random_matrix(300, 200, 3);
        assert_eq!(align_matrix(&m), reference(&m));
    }

    #[test]
    #[should_panic(expected = "at least one item")]
    fn empty_side_panics() {
        let _ = mean_cost(0, 3, |_, _| 0.0);
    }
}
