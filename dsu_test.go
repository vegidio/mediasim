package mediasim

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewDSU(t *testing.T) {
	t.Run("each element is its own parent", func(t *testing.T) {
		dsu := NewDSU(5)
		for i := 0; i < 5; i++ {
			assert.Equal(t, i, dsu.Find(i))
		}
	})

	t.Run("single element", func(t *testing.T) {
		dsu := NewDSU(1)
		assert.Equal(t, 0, dsu.Find(0))
	})
}

func TestDSU_Find(t *testing.T) {
	t.Run("find with path compression", func(t *testing.T) {
		dsu := NewDSU(5)
		dsu.Union(0, 1)
		dsu.Union(1, 2)

		root := dsu.Find(2)
		assert.Equal(t, dsu.Find(0), root)
		assert.Equal(t, dsu.Find(1), root)
		// After path compression, parent should point directly to root
		assert.Equal(t, root, dsu.Find(2))
	})
}

func TestDSU_Union(t *testing.T) {
	t.Run("union two disjoint elements", func(t *testing.T) {
		dsu := NewDSU(4)
		dsu.Union(0, 1)
		assert.Equal(t, dsu.Find(0), dsu.Find(1))
		assert.NotEqual(t, dsu.Find(0), dsu.Find(2))
	})

	t.Run("union same set is no-op", func(t *testing.T) {
		dsu := NewDSU(3)
		dsu.Union(0, 1)
		root := dsu.Find(0)
		dsu.Union(0, 1)
		assert.Equal(t, root, dsu.Find(0))
	})

	t.Run("union by rank merges smaller into larger", func(t *testing.T) {
		dsu := NewDSU(6)
		// Build a larger tree on 0
		dsu.Union(0, 1)
		dsu.Union(0, 2)
		dsu.Union(0, 3)
		// Build a smaller tree on 4
		dsu.Union(4, 5)

		dsu.Union(0, 4)
		root := dsu.Find(0)
		for i := 0; i < 6; i++ {
			assert.Equal(t, root, dsu.Find(i))
		}
	})

	t.Run("multiple disjoint sets remain separate", func(t *testing.T) {
		dsu := NewDSU(6)
		dsu.Union(0, 1)
		dsu.Union(2, 3)
		dsu.Union(4, 5)

		assert.Equal(t, dsu.Find(0), dsu.Find(1))
		assert.Equal(t, dsu.Find(2), dsu.Find(3))
		assert.Equal(t, dsu.Find(4), dsu.Find(5))
		assert.NotEqual(t, dsu.Find(0), dsu.Find(2))
		assert.NotEqual(t, dsu.Find(0), dsu.Find(4))
		assert.NotEqual(t, dsu.Find(2), dsu.Find(4))
	})
}
