package services

import (
	"context"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"

	"shared"

	"github.com/disintegration/imaging"
	ffmpeg "github.com/u2takey/ffmpeg-go"
	"github.com/vegidio/go-sak/crypto"
	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/singleflight"
)

// browserNativeFormats are image formats that modern browsers can decode natively.
var browserNativeFormats = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".webp": true,
	".gif":  true,
	".bmp":  true,
	".avif": true,
}

// thumbSem limits concurrent thumbnail generation to avoid CPU/memory overload.
var thumbSem = make(chan struct{}, 4)

type ThumbnailService struct {
	mu         sync.Mutex
	cacheDir   string
	ffmpegPath string
	group      singleflight.Group
}

// ServiceStartup creates a temp directory for cached thumbnails and resolves the FFmpeg binary path.
func (t *ThumbnailService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	cacheDir, err := os.MkdirTemp("", "mediasim-thumb-*")
	if err != nil {
		return fmt.Errorf("failed to create thumbnail cache directory: %w", err)
	}

	t.cacheDir = cacheDir
	t.ffmpegPath = shared.GetFFmpegPath("mediasim")
	return nil
}

// ServiceShutdown removes the thumbnail cache directory.
func (t *ThumbnailService) ServiceShutdown() error {
	if t.cacheDir != "" {
		os.RemoveAll(t.cacheDir)
	}
	return nil
}

// GetDimensions returns the original width and height of an image or video without fully decoding it.
func (t *ThumbnailService) GetDimensions(filePath string) (int, int, error) {
	if isVideoFile(filePath) {
		// For videos, extract a frame then read its dimensions.
		framePath, err := t.ensureVideoFrame(filePath)
		if err != nil {
			return 0, 0, err
		}

		f, err := os.Open(framePath)
		if err != nil {
			return 0, 0, fmt.Errorf("error opening video frame: %w", err)
		}
		defer f.Close()

		cfg, _, err := image.DecodeConfig(f)
		if err != nil {
			return 0, 0, fmt.Errorf("error reading video frame dimensions: %w", err)
		}

		return cfg.Width, cfg.Height, nil
	}

	f, err := os.Open(filePath)
	if err != nil {
		return 0, 0, fmt.Errorf("error opening image: %w", err)
	}
	defer f.Close()

	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, fmt.Errorf("error reading image dimensions: %w", err)
	}

	return cfg.Width, cfg.Height, nil
}

// ensureThumbnail returns the filesystem path to a servable image file.
// For browser-native formats with maxSize=0, it returns the original file path (zero processing).
// Otherwise, it generates and caches a resized JPEG thumbnail.
func (t *ThumbnailService) ensureThumbnail(filePath string, maxSize int) (string, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	isNative := browserNativeFormats[ext]
	isVideo := isVideoFile(filePath)

	// Full-size browser-native image: serve original directly.
	if maxSize == 0 && isNative && !isVideo {
		return filePath, nil
	}

	// Build cache key.
	cacheKey := filePath + ":" + strconv.Itoa(maxSize)
	hash, err := crypto.Xxh3String(cacheKey)
	if err != nil {
		return "", fmt.Errorf("error hashing cache key: %w", err)
	}
	cachedPath := filepath.Join(t.cacheDir, hash+".jpg")

	// Cache hit: return immediately.
	if _, err := os.Stat(cachedPath); err == nil {
		return cachedPath, nil
	}

	// Deduplicate concurrent generation for the same file+size.
	result, err, _ := t.group.Do(cacheKey, func() (any, error) {
		thumbSem <- struct{}{}
		defer func() { <-thumbSem }()

		return t.generateThumbnail(filePath, maxSize, cachedPath, isVideo)
	})

	if err != nil {
		return "", err
	}

	return result.(string), nil
}

// generateThumbnail decodes, optionally resizes, and writes a JPEG to cachedPath.
func (t *ThumbnailService) generateThumbnail(filePath string, maxSize int, cachedPath string, isVideo bool) (string, error) {
	var img image.Image
	var err error

	if isVideo {
		framePath, frameErr := t.ensureVideoFrame(filePath)
		if frameErr != nil {
			return "", frameErr
		}
		img, err = imaging.Open(framePath)
	} else {
		img, err = imaging.Open(filePath)
	}

	if err != nil {
		return "", fmt.Errorf("error opening media: %w", err)
	}

	if maxSize > 0 {
		bounds := img.Bounds()
		w, h := bounds.Dx(), bounds.Dy()
		if w >= h {
			img = imaging.Resize(img, maxSize, 0, imaging.Lanczos)
		} else {
			img = imaging.Resize(img, 0, maxSize, imaging.Lanczos)
		}
	}

	f, err := os.Create(cachedPath)
	if err != nil {
		return "", fmt.Errorf("error creating cached thumbnail: %w", err)
	}
	defer f.Close()

	if err = jpeg.Encode(f, img, &jpeg.Options{Quality: 90}); err != nil {
		os.Remove(cachedPath)
		return "", fmt.Errorf("error encoding thumbnail: %w", err)
	}

	return cachedPath, nil
}

// ensureVideoFrame extracts the first frame of a video and caches it on disk.
func (t *ThumbnailService) ensureVideoFrame(videoPath string) (string, error) {
	hash, err := crypto.Xxh3String(videoPath)
	if err != nil {
		return "", fmt.Errorf("error hashing video path: %w", err)
	}
	framePath := filepath.Join(t.cacheDir, "frame-"+hash+".jpg")

	// Cache hit.
	if _, err := os.Stat(framePath); err == nil {
		return framePath, nil
	}

	cmd := ffmpeg.Input(videoPath).
		Output(framePath, ffmpeg.KwArgs{"vframes": 1}).
		Silent(true)

	if t.ffmpegPath != "" {
		cmd = cmd.SetFfmpegPath(t.ffmpegPath)
	}

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("error extracting frame from '%s': %w", videoPath, err)
	}

	return framePath, nil
}

// isVideoFile checks if the file has a video extension.
func isVideoFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return slices.Contains(shared.ValidVideoTypes, ext)
}

// NewThumbMiddleware returns a Wails asset middleware that serves thumbnails via /thumb endpoint.
func NewThumbMiddleware(t *ThumbnailService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/thumb" {
				next.ServeHTTP(w, r)
				return
			}

			filePath, err := url.QueryUnescape(r.URL.Query().Get("path"))
			if err != nil || filePath == "" {
				http.Error(w, "missing or invalid path parameter", http.StatusBadRequest)
				return
			}

			maxSizeStr := r.URL.Query().Get("maxSize")
			maxSize := 0
			if maxSizeStr != "" {
				maxSize, err = strconv.Atoi(maxSizeStr)
				if err != nil {
					http.Error(w, "invalid maxSize parameter", http.StatusBadRequest)
					return
				}
			}

			cachedPath, err := t.ensureThumbnail(filePath, maxSize)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			http.ServeFile(w, r, cachedPath)
		})
	}
}
