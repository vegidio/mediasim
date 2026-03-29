package ffmpeg

import (
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"

	ffmpeg "github.com/u2takey/ffmpeg-go"
	downloader "github.com/vegidio/ffmpeg-downloader"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// GetFFmpegPath returns the path to the FFmpeg binary. It checks for a system installation first, then a static
// installation, and finally downloads FFmpeg if neither is found.
func GetFFmpegPath(configName string) string {
	installed := downloader.IsSystemInstalled()
	if installed {
		return ""
	}

	path, installed := downloader.IsStaticallyInstalled(configName)
	if installed {
		return path
	}

	path, err := downloader.Download(configName)
	if err != nil {
		return ""
	}

	return path
}

// LoadFrames loads all image files from the given directory and returns them as a slice of image.Image.
func LoadFrames(directory string) ([]image.Image, error) {
	images := make([]image.Image, 0)

	files, err := os.ReadDir(directory)
	if err != nil {
		return images, err
	}

	for _, file := range files {
		if !file.IsDir() {
			fullPath := filepath.Join(directory, file.Name())

			f, fErr := os.Open(fullPath)
			if fErr != nil {
				return images, fErr
			}

			defer f.Close()

			img, _, imgErr := image.Decode(f)
			if imgErr != nil {
				return images, imgErr
			}

			images = append(images, img)
		}
	}

	return images, nil
}

// ExtractFrames extracts frames from a video file using FFmpeg and returns them as a slice of image.Image.
func ExtractFrames(filePath string, ffmpegPath string) ([]image.Image, error) {
	images := make([]image.Image, 0)

	tempDir, err := os.MkdirTemp("", "mediasim-*")
	if err != nil {
		return images, fmt.Errorf("error creating temp directory: %w", err)
	}

	defer os.RemoveAll(tempDir)

	// Export 1 frame per second
	path := filepath.Join(tempDir, "frame_%04d.jpg")
	command := ffmpeg.Input(filePath).
		Filter("fps", ffmpeg.Args{"1"}).
		Output(path).
		Silent(true)

	if ffmpegPath == "" {
		_ = command.Run()
	} else {
		_ = command.SetFfmpegPath(ffmpegPath).Run()
	}

	images, _ = LoadFrames(tempDir)
	if len(images) > 0 {
		return images, nil
	}

	// Failed to export multiple frames, so let's try to export a single frame
	path = filepath.Join(tempDir, "frame.jpg")
	command = ffmpeg.Input(filePath).
		Output(path, ffmpeg.KwArgs{"vframes": 1}).
		Silent(true)

	if ffmpegPath == "" {
		err = command.Run()
	} else {
		err = command.SetFfmpegPath(ffmpegPath).Run()
	}

	if err != nil {
		return images, fmt.Errorf("error exporting video frames from '%s': %w", filePath, err)
	}

	images, err = LoadFrames(tempDir)
	if err != nil {
		return images, fmt.Errorf("error loading videos frames from '%s': %w", filePath, err)
	}

	return images, nil
}
