package mediasim

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFilesOptions_SetDefaults(t *testing.T) {
	t.Run("sets parallel to 5 when zero", func(t *testing.T) {
		opts := FilesOptions{}
		opts.SetDefaults()
		assert.Equal(t, 5, opts.Parallel)
	})

	t.Run("preserves non-zero parallel", func(t *testing.T) {
		opts := FilesOptions{Parallel: 10}
		opts.SetDefaults()
		assert.Equal(t, 10, opts.Parallel)
	})

	t.Run("does not modify other fields", func(t *testing.T) {
		opts := FilesOptions{FrameOptions: FrameOptions{FrameFlip: true, FrameRotate: true}}
		opts.SetDefaults()
		assert.True(t, opts.FrameFlip)
		assert.True(t, opts.FrameRotate)
	})
}

func TestDirectoryOptions_SetDefaults(t *testing.T) {
	t.Run("enables both image and video when neither set", func(t *testing.T) {
		opts := DirectoryOptions{}
		opts.SetDefaults()
		assert.True(t, opts.IncludeImages)
		assert.True(t, opts.IncludeVideos)
	})

	t.Run("preserves images-only setting", func(t *testing.T) {
		opts := DirectoryOptions{IncludeImages: true}
		opts.SetDefaults()
		assert.True(t, opts.IncludeImages)
		assert.False(t, opts.IncludeVideos)
	})

	t.Run("preserves videos-only setting", func(t *testing.T) {
		opts := DirectoryOptions{IncludeVideos: true}
		opts.SetDefaults()
		assert.False(t, opts.IncludeImages)
		assert.True(t, opts.IncludeVideos)
	})

	t.Run("sets parallel to 5 when zero", func(t *testing.T) {
		opts := DirectoryOptions{}
		opts.SetDefaults()
		assert.Equal(t, 5, opts.Parallel)
	})

	t.Run("preserves non-zero parallel", func(t *testing.T) {
		opts := DirectoryOptions{Parallel: 3}
		opts.SetDefaults()
		assert.Equal(t, 3, opts.Parallel)
	})
}
