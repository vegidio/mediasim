//! A growable disjoint-set union (union-find), used to merge similar media into groups.

/// Disjoint sets over the indices `0..len`, with path halving in [`find`](Self::find) and union by rank.
#[derive(Debug, Default)]
pub(crate) struct Dsu {
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl Dsu {
    /// Adds a new singleton set and returns its index.
    pub(crate) fn push(&mut self) -> usize {
        let index = self.parent.len();
        self.parent.push(index);
        self.rank.push(0);
        index
    }

    /// The representative of the set containing `x`. Every node visited is pointed at its grandparent on the way.
    pub(crate) fn find(&mut self, mut x: usize) -> usize {
        while self.parent[x] != x {
            self.parent[x] = self.parent[self.parent[x]];
            x = self.parent[x];
        }
        x
    }

    /// Merges the sets containing `a` and `b`, hanging the lower-ranked root under the other.
    pub(crate) fn union(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        if a == b {
            return;
        }

        match self.rank[a].cmp(&self.rank[b]) {
            std::cmp::Ordering::Less => self.parent[a] = b,
            std::cmp::Ordering::Greater => self.parent[b] = a,
            std::cmp::Ordering::Equal => {
                self.parent[b] = a;
                self.rank[a] += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_sets(n: usize) -> Dsu {
        let mut dsu = Dsu::default();
        for i in 0..n {
            assert_eq!(dsu.push(), i);
        }
        dsu
    }

    #[test]
    fn new_sets_are_separate() {
        let mut dsu = with_sets(3);

        assert_eq!((dsu.find(0), dsu.find(1), dsu.find(2)), (0, 1, 2));
    }

    #[test]
    fn union_merges_two_sets() {
        let mut dsu = with_sets(3);

        dsu.union(0, 1);

        assert_eq!(dsu.find(0), dsu.find(1));
        assert_ne!(dsu.find(0), dsu.find(2));
    }

    #[test]
    fn merges_are_transitive() {
        let mut dsu = with_sets(4);

        dsu.union(0, 1);
        dsu.union(1, 2);

        assert_eq!(dsu.find(0), dsu.find(2));
        assert_ne!(dsu.find(0), dsu.find(3));
    }

    #[test]
    fn repeated_union_is_a_no_op() {
        let mut dsu = with_sets(2);
        dsu.union(0, 1);
        let (root, rank) = (dsu.find(0), dsu.rank.clone());

        dsu.union(0, 1);
        dsu.union(1, 0);

        assert_eq!(dsu.find(1), root);
        assert_eq!(dsu.rank, rank);
    }

    #[test]
    fn long_chain_keeps_find_correct() {
        let n = 10_000;
        let mut dsu = with_sets(n);

        for i in 1..n {
            dsu.union(i - 1, i);
        }

        let root = dsu.find(0);
        assert!((0..n).all(|i| dsu.find(i) == root));
    }
}
