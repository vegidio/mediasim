package mediasim

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMedia_String(t *testing.T) {
	media := Media{
		Name:   "test.jpg",
		Type:   "image",
		Width:  1920,
		Height: 1080,
		Size:   12345,
		Length: 0,
	}

	result := media.String()
	assert.Contains(t, result, "test.jpg")
	assert.Contains(t, result, "image")
	assert.Contains(t, result, "1920")
	assert.Contains(t, result, "1080")
	assert.Contains(t, result, "12345")
}

func TestMedia_Equal(t *testing.T) {
	base := Media{
		Name:   "test.jpg",
		Type:   "image",
		Width:  1920,
		Height: 1080,
		Size:   12345,
		Length: 0,
	}

	t.Run("identical media are equal", func(t *testing.T) {
		other := base
		assert.True(t, base.Equal(other))
	})

	t.Run("different name", func(t *testing.T) {
		other := base
		other.Name = "other.jpg"
		assert.False(t, base.Equal(other))
	})

	t.Run("different type", func(t *testing.T) {
		other := base
		other.Type = "video"
		assert.False(t, base.Equal(other))
	})

	t.Run("different width", func(t *testing.T) {
		other := base
		other.Width = 1280
		assert.False(t, base.Equal(other))
	})

	t.Run("different height", func(t *testing.T) {
		other := base
		other.Height = 720
		assert.False(t, base.Equal(other))
	})

	t.Run("different size", func(t *testing.T) {
		other := base
		other.Size = 99999
		assert.False(t, base.Equal(other))
	})

	t.Run("different length", func(t *testing.T) {
		other := base
		other.Length = 60
		assert.False(t, base.Equal(other))
	})
}
