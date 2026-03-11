package charm

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestCalculateETA(t *testing.T) {
	t.Run("basic calculation", func(t *testing.T) {
		// 10 total, 5 completed in 10 seconds → 5 remaining at 2s each = 10s
		eta := calculateETA(10, 5, 10*time.Second)
		assert.Equal(t, 10*time.Second, eta)
	})

	t.Run("almost done", func(t *testing.T) {
		// 10 total, 9 completed in 9 seconds → 1 remaining at 1s each = 1s
		eta := calculateETA(10, 9, 9*time.Second)
		assert.Equal(t, 1*time.Second, eta)
	})

	t.Run("all completed returns zero", func(t *testing.T) {
		eta := calculateETA(10, 10, 10*time.Second)
		assert.Equal(t, time.Duration(0), eta)
	})

	t.Run("more than total completed returns zero", func(t *testing.T) {
		eta := calculateETA(10, 15, 10*time.Second)
		assert.Equal(t, time.Duration(0), eta)
	})

	t.Run("invalid inputs return max duration", func(t *testing.T) {
		maxDuration := time.Duration(7 * 24 * time.Hour)

		t.Run("zero total", func(t *testing.T) {
			assert.Equal(t, maxDuration, calculateETA(0, 5, 10*time.Second))
		})

		t.Run("negative total", func(t *testing.T) {
			assert.Equal(t, maxDuration, calculateETA(-1, 5, 10*time.Second))
		})

		t.Run("zero completed", func(t *testing.T) {
			assert.Equal(t, maxDuration, calculateETA(10, 0, 10*time.Second))
		})

		t.Run("zero elapsed", func(t *testing.T) {
			assert.Equal(t, maxDuration, calculateETA(10, 5, 0))
		})

		t.Run("negative elapsed", func(t *testing.T) {
			assert.Equal(t, maxDuration, calculateETA(10, 5, -1*time.Second))
		})
	})

	t.Run("proportional scaling", func(t *testing.T) {
		// 100 total, 25 completed in 5 seconds → 75 remaining at 0.2s each = 15s
		eta := calculateETA(100, 25, 5*time.Second)
		assert.Equal(t, 15*time.Second, eta)
	})
}
