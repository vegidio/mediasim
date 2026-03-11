package mediasim

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAddImageType(t *testing.T) {
	t.Run("adds new image type", func(t *testing.T) {
		original := make([]string, len(validImageTypes))
		copy(original, validImageTypes)

		AddImageType(".avif")
		assert.Contains(t, validImageTypes, ".avif")

		// Restore original state
		validImageTypes = original
	})

	t.Run("converts to lowercase", func(t *testing.T) {
		original := make([]string, len(validImageTypes))
		copy(original, validImageTypes)

		AddImageType(".HEIC")
		assert.Contains(t, validImageTypes, ".heic")

		validImageTypes = original
	})

	t.Run("adds multiple types at once", func(t *testing.T) {
		original := make([]string, len(validImageTypes))
		copy(original, validImageTypes)

		AddImageType(".avif", ".heic", ".jxl")
		assert.Contains(t, validImageTypes, ".avif")
		assert.Contains(t, validImageTypes, ".heic")
		assert.Contains(t, validImageTypes, ".jxl")

		validImageTypes = original
	})
}

func TestAddVideoType(t *testing.T) {
	t.Run("adds new video type", func(t *testing.T) {
		original := make([]string, len(validVideoTypes))
		copy(original, validVideoTypes)

		AddVideoType(".flv")
		assert.Contains(t, validVideoTypes, ".flv")

		validVideoTypes = original
	})

	t.Run("converts to lowercase", func(t *testing.T) {
		original := make([]string, len(validVideoTypes))
		copy(original, validVideoTypes)

		AddVideoType(".FLV")
		assert.Contains(t, validVideoTypes, ".flv")

		validVideoTypes = original
	})

	t.Run("adds multiple types at once", func(t *testing.T) {
		original := make([]string, len(validVideoTypes))
		copy(original, validVideoTypes)

		AddVideoType(".flv", ".wmv", ".ts")
		assert.Contains(t, validVideoTypes, ".flv")
		assert.Contains(t, validVideoTypes, ".wmv")
		assert.Contains(t, validVideoTypes, ".ts")

		validVideoTypes = original
	})
}
