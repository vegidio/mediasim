package services

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/disintegration/imaging"
	ffmpeg "github.com/u2takey/ffmpeg-go"
	downloader "github.com/vegidio/ffmpeg-downloader"
	"github.com/vegidio/go-sak/fs"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var validImageTypes = []string{".bmp", ".gif", ".jpg", ".jpeg", ".png", ".tiff", ".webp", ".avif", ".heic"}
var validVideoTypes = []string{".avi", ".m4v", ".mp4", ".mkv", ".mov", ".webm", ".wmv"}
var validMediaTypes = append(validImageTypes, validVideoTypes...)

type MediaService struct {
	tempDir    string
	ffmpegPath string
}

// ServiceStartup creates a temp directory for video frame extraction and resolves the FFmpeg binary path.
func (m *MediaService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	fmt.Println("ServiceStartup")

	tempDir, err := os.MkdirTemp("", "mediasim-gui-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}

	m.tempDir = tempDir
	m.ffmpegPath = getFFmpegPath()
	return nil
}

// ServiceShutdown removes the temp directory created during startup.
func (m *MediaService) ServiceShutdown() error {
	fmt.Println("ServiceShutdown")

	if m.tempDir != "" {
		os.RemoveAll(m.tempDir)
	}
	return nil
}

// ListMedia returns all image and video file paths in the given directory (non-recursive).
func (m *MediaService) ListMedia(directory string) ([]string, error) {
	filePaths, err := fs.ListPath(directory, fs.LpFile, validMediaTypes)
	if err != nil {
		return nil, fmt.Errorf("error listing directory: %w", err)
	}

	return filePaths, nil
}

// GetThumbnail loads an image or extracts the first frame of a video, resizes it to fit within maxSize
// pixels on the longest dimension, encodes it as JPEG, and returns the bytes along with the resulting
// width and height.
func (m *MediaService) GetThumbnail(filePath string, maxSize int) ([]byte, int, int, error) {
	var img, err = m.openMedia(filePath)
	if err != nil {
		return nil, 0, 0, err
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

// openMedia opens an image directly or extracts the first frame of a video.
func (m *MediaService) openMedia(filePath string) (image.Image, error) {
	if isVideoFile(filePath) {
		return m.extractFirstFrame(filePath)
	}

	img, err := imaging.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("error opening image: %w", err)
	}

	return img, nil
}

// extractFirstFrame extracts the first frame of a video file using FFmpeg.
// Frames are cached on disk using a hash of the video path.
func (m *MediaService) extractFirstFrame(videoPath string) (image.Image, error) {
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(videoPath)))
	framePath := filepath.Join(m.tempDir, hash+".jpg")

	// Cache hit: frame already extracted
	if _, err := os.Stat(framePath); err == nil {
		return imaging.Open(framePath)
	}

	// Extract first frame
	cmd := ffmpeg.Input(videoPath).
		Output(framePath, ffmpeg.KwArgs{"vframes": 1}).
		Silent(true)

	var err error
	if m.ffmpegPath == "" {
		err = cmd.Run()
	} else {
		err = cmd.SetFfmpegPath(m.ffmpegPath).Run()
	}

	if err != nil {
		return nil, fmt.Errorf("error extracting frame from '%s': %w", videoPath, err)
	}

	return imaging.Open(framePath)
}

// isVideoFile checks if the file has a video extension.
func isVideoFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return slices.Contains(validVideoTypes, ext)
}

// getFFmpegPath returns the path to the FFmpeg binary.
func getFFmpegPath() string {
	if downloader.IsSystemInstalled() {
		return ""
	}

	path, installed := downloader.IsStaticallyInstalled("mediasim")
	if installed {
		return path
	}

	path, err := downloader.Download("mediasim")
	if err != nil {
		return ""
	}

	return path
}
