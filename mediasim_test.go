package mediasim

import (
	"image"
	"image/color"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/vitali-fedulov/images4"
)

// createSolidImage creates a uniform solid-color image for testing.
func createSolidImage(c color.Color, w, h int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, c)
		}
	}
	return img
}

// iconFromImage converts an image.Image to an images4.IconT for testing.
func iconFromImage(img image.Image) images4.IconT {
	return images4.Icon(img)
}

func TestCalculateSimilarity(t *testing.T) {
	whiteImg := createSolidImage(color.White, 100, 100)
	blackImg := createSolidImage(color.Black, 100, 100)
	whiteIcon := iconFromImage(whiteImg)
	blackIcon := iconFromImage(blackImg)

	t.Run("identical images have similarity of 1", func(t *testing.T) {
		m1 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}
		m2 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}

		score := CalculateSimilarity(m1, m2)
		assert.Equal(t, 1.0, score)
	})

	t.Run("very different images have low similarity", func(t *testing.T) {
		m1 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}
		m2 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{blackIcon}}}

		score := CalculateSimilarity(m1, m2)
		assert.Less(t, score, 0.5)
	})

	t.Run("similarity is between 0 and 1", func(t *testing.T) {
		m1 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}
		m2 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{blackIcon}}}

		score := CalculateSimilarity(m1, m2)
		assert.GreaterOrEqual(t, score, 0.0)
		assert.LessOrEqual(t, score, 1.0)
	})

	t.Run("mixed types return zero similarity", func(t *testing.T) {
		m1 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}
		m2 := Media{Type: "video", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}

		score := CalculateSimilarity(m1, m2)
		assert.Equal(t, 0.0, score)
	})

	t.Run("identical video frames have high similarity", func(t *testing.T) {
		icons := []images4.IconT{whiteIcon, whiteIcon, whiteIcon}
		m1 := Media{Type: "video", frames: frames{framesOriginal: icons}}
		m2 := Media{Type: "video", frames: frames{framesOriginal: icons}}

		score := CalculateSimilarity(m1, m2)
		assert.Equal(t, 1.0, score)
	})

	t.Run("uses flipped frames for higher similarity", func(t *testing.T) {
		grayImg := createSolidImage(color.Gray{Y: 128}, 100, 100)
		grayIcon := iconFromImage(grayImg)

		m1 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}
		m2 := Media{Type: "image", frames: frames{
			framesOriginal: []images4.IconT{blackIcon},
			framesFlippedH: []images4.IconT{grayIcon},
		}}

		scoreWithFlip := CalculateSimilarity(m1, m2)

		m3 := Media{Type: "image", frames: frames{framesOriginal: []images4.IconT{blackIcon}}}
		scoreWithout := CalculateSimilarity(m1, m3)

		// The flipped version (gray) should be closer to white than black
		assert.GreaterOrEqual(t, scoreWithFlip, scoreWithout)
	})
}

func TestGroupMedia(t *testing.T) {
	whiteImg := createSolidImage(color.White, 100, 100)
	blackImg := createSolidImage(color.Black, 100, 100)
	whiteIcon := iconFromImage(whiteImg)
	blackIcon := iconFromImage(blackImg)

	t.Run("identical media are grouped together", func(t *testing.T) {
		media := []Media{
			{Name: "a.jpg", Type: "image", Width: 100, Height: 100, Size: 1000, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "b.jpg", Type: "image", Width: 100, Height: 100, Size: 500, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
		}

		groups := GroupMedia(media, 0.9)
		assert.Len(t, groups, 1)
		assert.Len(t, groups[0], 2)
	})

	t.Run("dissimilar media are not grouped", func(t *testing.T) {
		media := []Media{
			{Name: "white.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "black.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{blackIcon}}},
		}

		groups := GroupMedia(media, 0.9)
		assert.Empty(t, groups)
	})

	t.Run("groups are sorted by quality - resolution", func(t *testing.T) {
		media := []Media{
			{Name: "small.jpg", Type: "image", Width: 100, Height: 100, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "large.jpg", Type: "image", Width: 1920, Height: 1080, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
		}

		groups := GroupMedia(media, 0.9)
		assert.Len(t, groups, 1)
		assert.Equal(t, "large.jpg", groups[0][0].Name)
	})

	t.Run("groups are sorted by quality - file size as tiebreaker", func(t *testing.T) {
		media := []Media{
			{Name: "small.jpg", Type: "image", Width: 100, Height: 100, Size: 500, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "big.jpg", Type: "image", Width: 100, Height: 100, Size: 5000, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
		}

		groups := GroupMedia(media, 0.9)
		assert.Len(t, groups, 1)
		assert.Equal(t, "big.jpg", groups[0][0].Name)
	})

	t.Run("single item is not returned as a group", func(t *testing.T) {
		media := []Media{
			{Name: "alone.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
		}

		groups := GroupMedia(media, 0.5)
		assert.Empty(t, groups)
	})

	t.Run("empty input returns empty groups", func(t *testing.T) {
		groups := GroupMedia([]Media{}, 0.5)
		assert.Empty(t, groups)
	})

	t.Run("threshold of 0 groups everything together", func(t *testing.T) {
		media := []Media{
			{Name: "white.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "black.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{blackIcon}}},
		}

		groups := GroupMedia(media, 0.0)
		assert.Len(t, groups, 1)
		assert.Len(t, groups[0], 2)
	})
}
