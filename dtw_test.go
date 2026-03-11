package mediasim

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMin3(t *testing.T) {
	t.Run("first is smallest", func(t *testing.T) {
		assert.Equal(t, 1.0, min3(1.0, 2.0, 3.0))
	})

	t.Run("second is smallest", func(t *testing.T) {
		assert.Equal(t, 1.0, min3(2.0, 1.0, 3.0))
	})

	t.Run("third is smallest", func(t *testing.T) {
		assert.Equal(t, 1.0, min3(3.0, 2.0, 1.0))
	})

	t.Run("all equal", func(t *testing.T) {
		assert.Equal(t, 5.0, min3(5.0, 5.0, 5.0))
	})

	t.Run("two equal smallest", func(t *testing.T) {
		assert.Equal(t, 1.0, min3(1.0, 1.0, 3.0))
	})

	t.Run("negative values", func(t *testing.T) {
		assert.Equal(t, -3.0, min3(-1.0, -2.0, -3.0))
	})
}

func TestDTW(t *testing.T) {
	t.Run("empty input", func(t *testing.T) {
		distance, path := dtw([][]float64{})
		assert.Equal(t, 0.0, distance)
		assert.Nil(t, path)
	})

	t.Run("single element", func(t *testing.T) {
		input := [][]float64{{0.5}}
		distance, path := dtw(input)
		assert.Equal(t, 0.5, distance)
		assert.Equal(t, []Pair{{0, 0}}, path)
	})

	t.Run("identical sequences produce zero distance", func(t *testing.T) {
		// A diagonal of zeros means perfect match
		input := [][]float64{
			{0, 1, 1},
			{1, 0, 1},
			{1, 1, 0},
		}
		distance, path := dtw(input)
		assert.Equal(t, 0.0, distance)
		// Path should follow the diagonal
		assert.Equal(t, []Pair{{0, 0}, {1, 1}, {2, 2}}, path)
	})

	t.Run("symmetric distance matrix", func(t *testing.T) {
		input := [][]float64{
			{0.0, 0.5, 1.0},
			{0.5, 0.0, 0.5},
			{1.0, 0.5, 0.0},
		}
		distance, path := dtw(input)
		assert.Equal(t, 0.0, distance)
		assert.Equal(t, []Pair{{0, 0}, {1, 1}, {2, 2}}, path)
	})

	t.Run("non-square matrix", func(t *testing.T) {
		input := [][]float64{
			{0.1, 0.2},
			{0.3, 0.1},
			{0.2, 0.1},
		}
		distance, path := dtw(input)
		assert.Greater(t, distance, 0.0)
		// Path should start at (0,0) and end at (2,1)
		assert.Equal(t, Pair{0, 0}, path[0])
		assert.Equal(t, Pair{2, 1}, path[len(path)-1])
	})

	t.Run("path is monotonically increasing", func(t *testing.T) {
		input := [][]float64{
			{0.1, 0.5, 0.9},
			{0.4, 0.1, 0.5},
			{0.8, 0.4, 0.1},
			{0.9, 0.7, 0.3},
		}
		_, path := dtw(input)

		for i := 1; i < len(path); i++ {
			assert.GreaterOrEqual(t, path[i].I, path[i-1].I)
			assert.GreaterOrEqual(t, path[i].J, path[i-1].J)
		}
	})
}
