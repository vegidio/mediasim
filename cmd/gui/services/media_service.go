package services

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"shared"

	"github.com/disintegration/imaging"
	ffmpeg "github.com/u2takey/ffmpeg-go"

	"github.com/vegidio/go-sak/crypto"
	"github.com/vegidio/go-sak/fs"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var validImageTypes = []string{".bmp", ".gif", ".jpg", ".jpeg", ".png", ".tiff", ".webp", ".avif", ".heic"}
var validVideoTypes = []string{".avi", ".m4v", ".mp4", ".mkv", ".mov", ".webm", ".wmv"}
var validMediaTypes = append(validImageTypes, validVideoTypes...)

// thumbnailSem limits concurrent thumbnail generation to avoid CPU/memory overload.
var thumbnailSem = make(chan struct{}, 4)

type MediaInfo struct {
	Path     string `json:"path"`
	ModTime  int64  `json:"modTime"`
	FileSize int64  `json:"fileSize"`
}

type MediaService struct {
	tempDir    string
	ffmpegPath string
}

// ServiceStartup creates a temp directory for video frame extraction and resolves the FFmpeg binary path.
func (m *MediaService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	tempDir, err := os.MkdirTemp("", "mediasim-gui-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}

	m.tempDir = tempDir
	m.ffmpegPath = shared.GetFFmpegPath("mediasim")
	return nil
}

// ServiceShutdown removes the temp directory created during startup.
func (m *MediaService) ServiceShutdown() error {
	if m.tempDir != "" {
		os.RemoveAll(m.tempDir)
	}
	return nil
}

// ListMedia returns metadata for all image and video files in the given directory (non-recursive).
func (m *MediaService) ListMedia(directory string) ([]MediaInfo, error) {
	filePaths, err := fs.ListPath(directory, fs.LpFile, validMediaTypes)
	if err != nil {
		return nil, fmt.Errorf("error listing directory: %w", err)
	}

	mediaInfos := make([]MediaInfo, len(filePaths))
	var wg sync.WaitGroup

	for i, p := range filePaths {
		wg.Add(1)
		go func(idx int, filePath string) {
			defer wg.Done()
			info, err := os.Stat(filePath)
			if err != nil {
				return
			}
			mediaInfos[idx] = MediaInfo{
				Path:     filePath,
				ModTime:  info.ModTime().Unix(),
				FileSize: info.Size(),
			}
		}(i, p)
	}

	wg.Wait()

	// Filter out entries where os.Stat failed
	result := make([]MediaInfo, 0, len(mediaInfos))
	for _, info := range mediaInfos {
		if info.Path != "" {
			result = append(result, info)
		}
	}

	return result, nil
}

// GetThumbnail loads an image or extracts the first frame of a video, resizes it to fit within maxSize
// pixels on the longest dimension, encodes it as JPEG, and returns the bytes along with the resulting
// width and height.
func (m *MediaService) GetThumbnail(filePath string, maxSize int) ([]byte, int, int, error) {
	thumbnailSem <- struct{}{}
	defer func() { <-thumbnailSem }()

	var img, err = m.openMedia(filePath)
	if err != nil {
		return nil, 0, 0, err
	}

	// Capture original dimensions before resizing
	origBounds := img.Bounds()
	origWidth, origHeight := origBounds.Dx(), origBounds.Dy()

	if maxSize > 0 {
		if origWidth >= origHeight {
			img = imaging.Resize(img, maxSize, 0, imaging.Lanczos)
		} else {
			img = imaging.Resize(img, 0, maxSize, imaging.Lanczos)
		}
	}

	var buf bytes.Buffer
	if err = jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		return nil, 0, 0, fmt.Errorf("error encoding thumbnail: %w", err)
	}

	return buf.Bytes(), origWidth, origHeight, nil
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
	hash, err := crypto.Xxh3String(videoPath)
	if err != nil {
		return nil, fmt.Errorf("error hashing video path: %w", err)
	}
	framePath := filepath.Join(m.tempDir, hash+".jpg")

	// Cache hit: frame already extracted
	if _, err := os.Stat(framePath); err == nil {
		return imaging.Open(framePath)
	}

	// Extract first frame
	cmd := ffmpeg.Input(videoPath).
		Output(framePath, ffmpeg.KwArgs{"vframes": 1}).
		Silent(true)

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
