package mediasim

import (
	"shared"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAddImageType(t *testing.T) {
	t.Run("adds new image type", func(t *testing.T) {
		original := make([]string, len(shared.ValidImageTypes))
		copy(original, shared.ValidImageTypes)

		AddImageType(".avif")
		assert.Contains(t, shared.ValidImageTypes, ".avif")

		// Restore original state
		shared.ValidImageTypes = original
	})

	t.Run("converts to lowercase", func(t *testing.T) {
		original := make([]string, len(shared.ValidImageTypes))
		copy(original, shared.ValidImageTypes)

		AddImageType(".HEIC")
		assert.Contains(t, shared.ValidImageTypes, ".heic")

		shared.ValidImageTypes = original
	})

	t.Run("adds multiple types at once", func(t *testing.T) {
		original := make([]string, len(shared.ValidImageTypes))
		copy(original, shared.ValidImageTypes)

		AddImageType(".avif", ".heic", ".jxl")
		assert.Contains(t, shared.ValidImageTypes, ".avif")
		assert.Contains(t, shared.ValidImageTypes, ".heic")
		assert.Contains(t, shared.ValidImageTypes, ".jxl")

		shared.ValidImageTypes = original
	})
}

func TestAddVideoType(t *testing.T) {
	t.Run("adds new video type", func(t *testing.T) {
		original := make([]string, len(shared.ValidVideoTypes))
		copy(original, shared.ValidVideoTypes)

		AddVideoType(".flv")
		assert.Contains(t, shared.ValidVideoTypes, ".flv")

		shared.ValidVideoTypes = original
	})

	t.Run("converts to lowercase", func(t *testing.T) {
		original := make([]string, len(shared.ValidVideoTypes))
		copy(original, shared.ValidVideoTypes)

		AddVideoType(".FLV")
		assert.Contains(t, shared.ValidVideoTypes, ".flv")

		shared.ValidVideoTypes = original
	})

	t.Run("adds multiple types at once", func(t *testing.T) {
		original := make([]string, len(shared.ValidVideoTypes))
		copy(original, shared.ValidVideoTypes)

		AddVideoType(".flv", ".wmv", ".ts")
		assert.Contains(t, shared.ValidVideoTypes, ".flv")
		assert.Contains(t, shared.ValidVideoTypes, ".wmv")
		assert.Contains(t, shared.ValidVideoTypes, ".ts")

		shared.ValidVideoTypes = original
	})
}
