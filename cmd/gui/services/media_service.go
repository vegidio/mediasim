package services

import (
	"bytes"
	"fmt"
	"image/jpeg"

	"github.com/disintegration/imaging"
	"github.com/vegidio/go-sak/fs"
)

var validImageTypes = []string{".bmp", ".gif", ".jpg", ".jpeg", ".png", ".tiff", ".webp", ".avif", ".heic"}

type MediaService struct{}

// ListImages returns all image file paths in the given directory (non-recursive).
func (m *MediaService) ListImages(directory string) ([]string, error) {
	filePaths, err := fs.ListPath(directory, fs.LpFile, validImageTypes)
	if err != nil {
		return nil, fmt.Errorf("error listing directory: %w", err)
	}

	return filePaths, nil
}

// GetThumbnail loads an image, resizes it to fit within maxSize pixels on the longest dimension,
// encodes it as JPEG, and returns the bytes along with the resulting width and height.
func (m *MediaService) GetThumbnail(filePath string, maxSize int) ([]byte, int, int, error) {
	img, err := imaging.Open(filePath)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("error opening image: %w", err)
	}

	if maxSize > 0 {
		bounds := img.Bounds()
		if bounds.Dx() >= bounds.Dy() {
			img = imaging.Resize(img, maxSize, 0, imaging.Lanczos)
		} else {
			img = imaging.Resize(img, 0, maxSize, imaging.Lanczos)
		}
	}

	var buf bytes.Buffer
	if err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		return nil, 0, 0, fmt.Errorf("error encoding thumbnail: %w", err)
	}

	bounds := img.Bounds()
	return buf.Bytes(), bounds.Dx(), bounds.Dy(), nil
}
