package services

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"shared"

	ffmpeg "github.com/u2takey/ffmpeg-go"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Streamer struct {
	mu         sync.Mutex
	ffmpegPath string
	cache      map[string]string  // videoPath → tmpDir
	activeDir  string             // current stream's temp dir
	cancel     context.CancelFunc // active FFmpeg cancel
}

// ServiceStartup resolves the FFmpeg binary path and initializes the cache map.
func (s *Streamer) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	s.ffmpegPath = shared.GetFFmpegPath("mediasim")
	s.cache = make(map[string]string)
	return nil
}

// ServiceShutdown cancels any active FFmpeg process and removes all cached temp directories.
func (s *Streamer) ServiceShutdown() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}

	for _, dir := range s.cache {
		os.RemoveAll(dir)
	}

	s.cache = nil
	s.activeDir = ""
	return nil
}

// StartStream transcodes the video at videoPath into HLS segments and returns the middleware URL for the HLS manifest.
// Uses a cache to skip transcoding if the video was already processed.
func (s *Streamer) StartStream(videoPath string) (string, error) {
	s.mu.Lock()

	// Cancel any active FFmpeg process (keep its cached segments).
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}

	// Check cache.
	if dir, ok := s.cache[videoPath]; ok {
		manifest := filepath.Join(dir, "video.m3u8")

		if _, err := os.Stat(manifest); err == nil {
			s.activeDir = dir
			s.mu.Unlock()
			return "/hls/video.m3u8", nil
		}

		// Stale entry — remove it.
		os.RemoveAll(dir)
		delete(s.cache, videoPath)
	}

	// Create temp directory for this transcode
	tmpDir, err := os.MkdirTemp("", "mediasim-hls-*")
	if err != nil {
		s.mu.Unlock()
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}

	s.cache[videoPath] = tmpDir
	s.activeDir = tmpDir

	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel

	// Build FFmpeg command with cancellable context
	outputPath := filepath.Join(tmpDir, "video.m3u8")
	input := ffmpeg.Input(videoPath, ffmpeg.KwArgs{
		"probesize":       "32",
		"analyzeduration": "0",
		"fflags":          "nobuffer",
	})

	cmd := ffmpeg.OutputContext(ctx, []*ffmpeg.Stream{input}, outputPath, ffmpeg.KwArgs{
		"c:v":           "libx264",
		"c:a":           "aac",
		"preset":        "ultrafast",
		"tune":          "zerolatency",
		"vf":            "scale=-2:'min(720,ih)'",
		"f":             "hls",
		"hls_time":      1,
		"hls_list_size": 0,
	}).Silent(true)

	if s.ffmpegPath != "" {
		cmd = cmd.SetFfmpegPath(s.ffmpegPath)
	}

	// Run FFmpeg asynchronously.
	go cmd.Run()

	s.mu.Unlock()

	// Poll for the manifest file to appear (max 10s, 100ms interval).
	manifest := filepath.Join(tmpDir, "video.m3u8")
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(manifest); err == nil {
			return "/hls/video.m3u8", nil
		}
		time.Sleep(100 * time.Millisecond)
	}

	return "", fmt.Errorf("timeout waiting for HLS manifest")
}

// StopStream cancels the active FFmpeg process without deleting cached segments.
func (s *Streamer) StopStream() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}

	s.activeDir = ""
}

// NewHlsMiddleware returns a Wails asset server middleware that serves HLS segments
// from the active stream's temp directory under the /hls/ path prefix.
func NewHlsMiddleware(s *Streamer) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasPrefix(r.URL.Path, "/hls/") {
				next.ServeHTTP(w, r)
				return
			}

			s.mu.Lock()
			dir := s.activeDir
			s.mu.Unlock()

			if dir == "" {
				http.NotFound(w, r)
				return
			}

			// Strip the /hls/ prefix and serve the file from the active directory.
			name := strings.TrimPrefix(r.URL.Path, "/hls/")
			http.ServeFile(w, r, filepath.Join(dir, name))
		})
	}
}
