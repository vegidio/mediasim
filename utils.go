package mediasim

import (
	"fmt"
	"github.com/disintegration/imaging"
	"github.com/samber/lo"
	ffmpeg "github.com/u2takey/ffmpeg-go"
	_ "github.com/vegidio/avif-go"
	downloader "github.com/vegidio/ffmpeg-downloader"
	"github.com/vitali-fedulov/images4"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
)

var ValidImageTypes = []string{".avif", ".bmp", ".gif", ".jpg", ".jpeg", ".png", ".tiff", ".webp"}
var ValidVideoTypes = []string{".avi", ".mp4", ".mkv", ".mov", ".webm"}
var FFmpegPath = getFFmpegPath("mediasim")

// LoadMediaFromImages creates a Media object from the given image or video.
//
// Parameters:
//   - name: The name of the media.
//   - images: The images to be converted into a Media object.
//   - options: The configuration options for loading frames.
//
// Returns:
//   - A Media object containing the name, type and frames of the media.
func LoadMediaFromImages(name string, images []image.Image, options FrameOptions) Media {
	mediaType := "image"
	if len(images) > 1 {
		mediaType = "video"
	}

	frames := lo.Map(images, func(img image.Image, _ int) images4.IconT {
		return images4.Icon(img)
	})

	if mediaType == "image" {
		if options.FrameFlip {
			frames = append(frames, []images4.IconT{
				images4.Icon(imaging.FlipH(images[0])),
				images4.Icon(imaging.FlipV(images[0])),
			}...)
		}

		if options.FrameRotate {
			frames = append(frames, []images4.IconT{
				images4.Icon(imaging.Rotate90(images[0])),
				images4.Icon(imaging.Rotate180(images[0])),
				images4.Icon(imaging.Rotate270(images[0])),
			}...)
		}
	}

	return Media{
		Name:   name,
		Type:   mediaType,
		Frames: frames,
	}
}

// LoadMediaFromFile loads a Media object from the given file path.
//
// Parameters:
//   - filePath: The path to the image or video file.
//   - options: The configuration options for loading frames.
//
// Returns:
//   - A pointer to a Media object containing the name and the converted image.
//   - An error if there is an issue opening or decoding the file.
func LoadMediaFromFile(filePath string, options FrameOptions) (*Media, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("error opening file '%s': %w", filePath, err)
	}

	defer file.Close()

	ext := strings.ToLower(filepath.Ext(file.Name()))
	images := make([]image.Image, 0)

	if slices.Contains(ValidImageTypes, ext) {
		img, _, imgErr := image.Decode(file)
		if imgErr != nil {
			return nil, imgErr
		}

		images = append(images, img)

	} else if slices.Contains(ValidVideoTypes, ext) {
		videos, vidErr := extractFrames(file.Name())
		if vidErr != nil {
			return nil, vidErr
		}

		images = append(images, videos...)
	}

	if len(images) == 0 {
		return nil, fmt.Errorf("no valid images found in file '%s'", filePath)
	}

	media := LoadMediaFromImages(filePath, images, options)
	return &media, nil
}

// LoadMediaFromFiles loads Media objects from an array of file paths.
//
// Parameters:
//   - filePaths: An array of strings containing the paths to the image or video files.
//   - options: The configuration options for loading multiple files.
//
// Returns:
//   - A channel that will receive Media objects for each valid file processed.
//   - An error if there is an issue opening or decoding any of the files.
func LoadMediaFromFiles(filePaths []string, options FilesOptions) <-chan Result[Media] {
	options.SetDefaults()
	result := make(chan Result[Media])

	go func() {
		defer close(result)

		var wg sync.WaitGroup
		sem := make(chan struct{}, options.Parallel)

		for _, file := range filePaths {
			wg.Add(1)
			sem <- struct{}{}

			go func(filePath string) {
				defer wg.Done()
				defer func() { <-sem }()

				media, mediaErr := LoadMediaFromFile(filePath, FrameOptions{
					FrameFlip:   options.FrameFlip,
					FrameRotate: options.FrameRotate,
				})

				if mediaErr == nil {
					result <- Result[Media]{Data: *media}
				} else {
					result <- Result[Media]{Err: mediaErr}
				}
			}(file)
		}

		wg.Wait()
		close(sem)
	}()

	return result
}

// LoadMediaFromDirectory loads Media objects from a specified directory based on the provided options.
//
// Parameters:
//   - directory: The path to the directory containing media files.
//   - options: A DirectoryOptions struct specifying the configuration for loading media.
//
// Returns:
//   - A channel that will receive Media objects for each valid file processed.
//   - An error if there is an issue accessing the directory or processing the files.
func LoadMediaFromDirectory(directory string, options DirectoryOptions) <-chan Result[Media] {
	options.SetDefaults()
	filePaths := make([]string, 0)

	err := filepath.Walk(directory, func(path string, file os.FileInfo, err error) error {
		if err != nil {
			return fmt.Errorf("error walking directory '%s': %w", directory, err)
		}

		if file.IsDir() {
			return nil
		} else if !options.IsRecursive {
			if fileDir := filepath.Dir(path); fileDir != directory {
				return nil
			}
		}

		ext := strings.ToLower(filepath.Ext(path))
		includeImages := options.IncludeImages && slices.Contains(ValidImageTypes, ext)
		includeVideos := options.IncludeVideos && slices.Contains(ValidVideoTypes, ext)

		if includeImages || includeVideos {
			filePaths = append(filePaths, path)
		}

		return nil
	})

	if err != nil {
		result := make(chan Result[Media], 1)
		defer close(result)

		result <- Result[Media]{Err: err}
		return result
	}

	return LoadMediaFromFiles(filePaths, FilesOptions{
		FrameFlip:   options.FrameFlip,
		FrameRotate: options.FrameRotate,
		Parallel:    options.Parallel,
	})
}

// region - Private functions

func getFFmpegPath(configName string) string {
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

func loadFrames(directory string) ([]image.Image, error) {
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

			img, _, imgErr := image.Decode(f)
			if imgErr != nil {
				return images, imgErr
			}

			f.Close()
			images = append(images, img)
		}
	}

	return images, nil
}

func extractFrames(filePath string) ([]image.Image, error) {
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

	if FFmpegPath == "" {
		_ = command.Run()
	} else {
		_ = command.SetFfmpegPath(FFmpegPath).Run()
	}

	images, _ = loadFrames(tempDir)
	if len(images) > 0 {
		return images, nil
	}

	// Failed to export multiple frames, so let's try to export a single frame
	path = filepath.Join(tempDir, "frame.jpg")
	command = ffmpeg.Input(filePath).
		Output(path, ffmpeg.KwArgs{"vframes": 1}).
		Silent(true)

	if FFmpegPath == "" {
		err = command.Run()
	} else {
		err = command.SetFfmpegPath(FFmpegPath).Run()
	}

	if err != nil {
		return images, fmt.Errorf("error exporting video frames from '%s': %w", filePath, err)
	}

	images, err = loadFrames(tempDir)
	if err != nil {
		return images, fmt.Errorf("error loading videos frames from '%s': %w", filePath, err)
	}

	return images, nil
}

// endregion
