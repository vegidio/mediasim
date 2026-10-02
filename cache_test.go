package mediasim

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// writePNG writes a 64x64 image split into a left and right half with the given colors.
func writePNG(t *testing.T, path string, left, right color.Color) {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := range 64 {
		for x := range 64 {
			if x < 32 {
				img.Set(x, y, left)
			} else {
				img.Set(x, y, right)
			}
		}
	}

	f, err := os.Create(path)
	require.NoError(t, err)
	defer f.Close()
	require.NoError(t, png.Encode(f, img))
}

// loadDir loads all media in a directory and returns them sorted by name.
func loadDir(t *testing.T, dir string, options DirectoryOptions) ([]Media, []error) {
	t.Helper()

	ch, _ := LoadMediaFromDirectory(dir, options)

	media := make([]Media, 0)
	errs := make([]error, 0)
	for r := range ch {
		if r.Err != nil {
			errs = append(errs, r.Err)
		} else {
			media = append(media, r.Data)
		}
	}

	sort.Slice(media, func(i, j int) bool { return media[i].Name < media[j].Name })
	return media, errs
}

func setupDir(t *testing.T) string {
	t.Helper()

	dir := t.TempDir()
	white := color.RGBA{R: 255, G: 255, B: 255, A: 255}
	black := color.RGBA{A: 255}

	writePNG(t, filepath.Join(dir, "a.png"), white, black)
	writePNG(t, filepath.Join(dir, "b.png"), black, white)
	writePNG(t, filepath.Join(dir, "c.png"), white, white)

	return dir
}

func TestCache_RoundTrip(t *testing.T) {
	dir := setupDir(t)
	options := DirectoryOptions{UseCache: true, FrameOptions: FrameOptions{FrameFlip: true}}

	first, errs := loadDir(t, dir, options)
	require.Empty(t, errs)
	require.Len(t, first, 3)
	assert.FileExists(t, filepath.Join(dir, CacheFileName))

	// Make the files unreadable without changing size or mtime: a second run must be served entirely from the cache.
	for _, m := range first {
		require.NoError(t, os.Chmod(m.Name, 0))
		t.Cleanup(func() { os.Chmod(m.Name, 0o644) })
	}

	second, errs := loadDir(t, dir, options)
	require.Empty(t, errs)
	require.Len(t, second, 3)

	for i := range first {
		assert.True(t, first[i].Equal(second[i]))
		assert.Equal(t, first[i].frames, second[i].frames)
	}
}

func TestCache_ChangedFileIsReprocessed(t *testing.T) {
	dir := setupDir(t)
	options := DirectoryOptions{UseCache: true}

	_, errs := loadDir(t, dir, options)
	require.Empty(t, errs)

	// Changing the mtime of a.png invalidates its entry; the other files are still served from the cache.
	a := filepath.Join(dir, "a.png")
	require.NoError(t, os.Chtimes(a, time.Now(), time.Now().Add(time.Hour)))
	require.NoError(t, os.Chmod(a, 0))
	t.Cleanup(func() { os.Chmod(a, 0o644) })

	media, errs := loadDir(t, dir, options)
	assert.Len(t, errs, 1)
	assert.Len(t, media, 2)
}

func TestCache_NewAndChangedContent(t *testing.T) {
	dir := setupDir(t)
	options := DirectoryOptions{UseCache: true}

	before, _ := loadDir(t, dir, options)

	// Overwrite c.png with different content and add a new file.
	red := color.RGBA{R: 255, A: 255}
	writePNG(t, filepath.Join(dir, "c.png"), red, red)
	require.NoError(t, os.Chtimes(filepath.Join(dir, "c.png"), time.Now(), time.Now().Add(time.Hour)))
	writePNG(t, filepath.Join(dir, "d.png"), red, red)

	after, errs := loadDir(t, dir, options)
	require.Empty(t, errs)
	require.Len(t, after, 4)

	assert.NotEqual(t, before[2].framesOriginal, after[2].framesOriginal)
	assert.Equal(t, after[2].framesOriginal, after[3].framesOriginal)
}

func TestCache_FrameOptions(t *testing.T) {
	dir := setupDir(t)
	a := filepath.Join(dir, "a.png")

	// Cache built without flip can't serve a run that needs flip.
	_, errs := loadDir(t, dir, DirectoryOptions{UseCache: true})
	require.Empty(t, errs)

	require.NoError(t, os.Chmod(a, 0))
	_, errs = loadDir(t, dir, DirectoryOptions{UseCache: true, FrameOptions: FrameOptions{FrameFlip: true}})
	assert.Len(t, errs, 1)
	require.NoError(t, os.Chmod(a, 0o644))

	// Now everything is cached with flip; a run without flip is served from the cache, with the extra variants hidden.
	_, errs = loadDir(t, dir, DirectoryOptions{UseCache: true, FrameOptions: FrameOptions{FrameFlip: true}})
	require.Empty(t, errs)

	require.NoError(t, os.Chmod(a, 0))
	t.Cleanup(func() { os.Chmod(a, 0o644) })

	media, errs := loadDir(t, dir, DirectoryOptions{UseCache: true})
	require.Empty(t, errs)
	require.Len(t, media, 3)
	assert.Empty(t, media[0].framesFlippedH)
	assert.Empty(t, media[0].framesFlippedV)
}

func TestCache_TruncatedRecord(t *testing.T) {
	dir := setupDir(t)
	options := DirectoryOptions{UseCache: true}

	_, errs := loadDir(t, dir, options)
	require.Empty(t, errs)

	// Simulate a crash in the middle of writing the last record.
	cachePath := filepath.Join(dir, CacheFileName)
	info, err := os.Stat(cachePath)
	require.NoError(t, err)
	require.NoError(t, os.Truncate(cachePath, info.Size()-10))

	c, err := openCache(dir)
	require.NoError(t, err)
	assert.Len(t, c.entries, 2)
	require.NoError(t, c.close())

	media, errs := loadDir(t, dir, options)
	require.Empty(t, errs)
	assert.Len(t, media, 3)

	c, err = openCache(dir)
	require.NoError(t, err)
	assert.Len(t, c.entries, 3)
	require.NoError(t, c.close())
}

func TestCache_CompactionDropsDeletedFiles(t *testing.T) {
	dir := setupDir(t)
	options := DirectoryOptions{UseCache: true}

	_, errs := loadDir(t, dir, options)
	require.Empty(t, errs)

	require.NoError(t, os.Remove(filepath.Join(dir, "b.png")))

	_, errs = loadDir(t, dir, options)
	require.Empty(t, errs)

	c, err := openCache(dir)
	require.NoError(t, err)
	defer c.close()

	assert.Equal(t, 2, c.records)
	assert.NotContains(t, c.entries, "b.png")
}

func TestCache_CancelledContext(t *testing.T) {
	dir := setupDir(t)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	media, errs := loadDir(t, dir, DirectoryOptions{UseCache: true, Context: ctx})
	assert.Empty(t, media)
	assert.Len(t, errs, 3)
}
