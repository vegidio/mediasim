package mediasim

import (
	"fmt"
	"image/color"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	. "github.com/vegidio/go-sak/types"
	"github.com/vitali-fedulov/images4"
)

// feedChannel sends media items through a channel, simulating LoadMediaFromFiles.
func feedChannel(items []Media) <-chan Result[Media] {
	ch := make(chan Result[Media], len(items))
	go func() {
		defer close(ch)
		for _, m := range items {
			ch <- Result[Media]{Data: m}
		}
	}()
	return ch
}

// collectGroups drains the LoadAndGroupMedia update channel and returns the final groups.
func collectGroups(t *testing.T, ch <-chan LoadAndGroupResult) ([][]Media, error) {
	t.Helper()
	for update := range ch {
		if update.Done {
			return update.Groups, update.Err
		}
	}
	return nil, nil
}

// sortGroups sorts groups deterministically for comparison.
func sortGroups(groups [][]Media) {
	for _, g := range groups {
		sort.Slice(g, func(i, j int) bool { return g[i].Name < g[j].Name })
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i][0].Name < groups[j][0].Name })
}

func TestLoadAndGroupMedia(t *testing.T) {
	whiteImg := createSolidImage(color.White, 100, 100)
	blackImg := createSolidImage(color.Black, 100, 100)
	whiteIcon := iconFromImage(whiteImg)
	blackIcon := iconFromImage(blackImg)

	t.Run("produces same groups as GroupMedia", func(t *testing.T) {
		media := []Media{
			{Name: "a.jpg", Type: "image", Width: 100, Height: 100, Size: 1000, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "b.jpg", Type: "image", Width: 100, Height: 100, Size: 500, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "c.jpg", Type: "image", Width: 100, Height: 100, Size: 800, frames: frames{framesOriginal: []images4.IconT{blackIcon}}},
		}

		// Two-pass result
		expected := GroupMedia(media, 0.9)

		// Single-pass result
		ch := feedChannel(media)
		updateCh := LoadAndGroupMedia(ch, len(media), 0.9, false)
		actual, err := collectGroups(t, updateCh)

		assert.NoError(t, err)
		sortGroups(expected)
		sortGroups(actual)
		assert.Equal(t, expected, actual)
	})

	t.Run("empty input returns empty groups", func(t *testing.T) {
		ch := feedChannel([]Media{})
		updateCh := LoadAndGroupMedia(ch, 0, 0.9, false)
		groups, err := collectGroups(t, updateCh)

		assert.NoError(t, err)
		assert.Empty(t, groups)
	})

	t.Run("single item returns no groups", func(t *testing.T) {
		media := []Media{
			{Name: "alone.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
		}

		ch := feedChannel(media)
		updateCh := LoadAndGroupMedia(ch, 1, 0.9, false)
		groups, err := collectGroups(t, updateCh)

		assert.NoError(t, err)
		assert.Empty(t, groups)
	})

	t.Run("error with ignoreErrors=false terminates early", func(t *testing.T) {
		inputCh := make(chan Result[Media], 3)
		go func() {
			defer close(inputCh)
			inputCh <- Result[Media]{Data: Media{Name: "a.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}}
			inputCh <- Result[Media]{Err: fmt.Errorf("bad file")}
			inputCh <- Result[Media]{Data: Media{Name: "b.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}}
		}()

		updateCh := LoadAndGroupMedia(inputCh, 3, 0.9, false)
		groups, err := collectGroups(t, updateCh)

		assert.Error(t, err)
		assert.Nil(t, groups)
	})

	t.Run("error with ignoreErrors=true skips bad items", func(t *testing.T) {
		inputCh := make(chan Result[Media], 3)
		go func() {
			defer close(inputCh)
			inputCh <- Result[Media]{Data: Media{Name: "a.jpg", Type: "image", Width: 100, Height: 100, Size: 1000, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}}
			inputCh <- Result[Media]{Err: fmt.Errorf("bad file")}
			inputCh <- Result[Media]{Data: Media{Name: "b.jpg", Type: "image", Width: 100, Height: 100, Size: 500, frames: frames{framesOriginal: []images4.IconT{whiteIcon}}}}
		}()

		updateCh := LoadAndGroupMedia(inputCh, 3, 0.9, true)
		groups, err := collectGroups(t, updateCh)

		assert.NoError(t, err)
		assert.Len(t, groups, 1)
		assert.Len(t, groups[0], 2)
	})

	t.Run("threshold 0 groups everything together", func(t *testing.T) {
		media := []Media{
			{Name: "white.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "black.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{blackIcon}}},
		}

		ch := feedChannel(media)
		updateCh := LoadAndGroupMedia(ch, len(media), 0.0, false)
		groups, err := collectGroups(t, updateCh)

		assert.NoError(t, err)
		assert.Len(t, groups, 1)
		assert.Len(t, groups[0], 2)
	})

	t.Run("progress updates are sent for each loaded item", func(t *testing.T) {
		media := []Media{
			{Name: "a.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "b.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{whiteIcon}}},
			{Name: "c.jpg", Type: "image", frames: frames{framesOriginal: []images4.IconT{blackIcon}}},
		}

		ch := feedChannel(media)
		updateCh := LoadAndGroupMedia(ch, len(media), 0.9, false)

		loadedCounts := []int{}
		for update := range updateCh {
			if !update.Done && update.Err == nil {
				loadedCounts = append(loadedCounts, update.Loaded)
			}
		}

		assert.Equal(t, []int{1, 2, 3}, loadedCounts)
	})
}
