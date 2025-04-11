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
//
// Returns:
//   - A Media object containing the name and the converted image.
func LoadMediaFromImages(name string, images []image.Image, imageFlip, imageRotate bool) Media {
	flippedFrames := make([]images4.IconT, 0)
	rotatedFrames := make([]images4.IconT, 0)

	mediaType := "image"
	if len(images) > 1 {
		mediaType = "video"
	}

	frames := lo.Map(images, func(img image.Image, _ int) images4.IconT {
		return images4.Icon(img)
	})

	if mediaType == "image" {
		if imageFlip {
			flippedFrames = []images4.IconT{
				images4.Icon(imaging.FlipH(images[0])),
				images4.Icon(imaging.FlipV(images[0])),
			}
		}

		if imageRotate {
			rotatedFrames = []images4.IconT{
				images4.Icon(imaging.Rotate90(images[0])),
				images4.Icon(imaging.Rotate180(images[0])),
				images4.Icon(imaging.Rotate270(images[0])),
			}
		}
	}

	return Media{
		Name:          name,
		Type:          mediaType,
		Frames:        frames,
		FlippedFrames: flippedFrames,
		RotatedFrames: rotatedFrames,
	}
}

// LoadMediaFromFile loads a Media object from the given file path.
//
// Parameters:
//   - filePath: The path to the image or video file.
//
// Returns:
//   - A pointer to a Media object containing the name and the converted image.
//   - An error if there is an issue opening or decoding the file.
func LoadMediaFromFile(filePath string, imageFlip, imageRotate bool) (*Media, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("error opening file: %w", err)
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
		return nil, fmt.Errorf("no valid images found in file: %s", filePath)
	}

	media := LoadMediaFromImages(filePath, images, imageFlip, imageRotate)
	return &media, nil
}

// LoadMediaFromFiles loads Media objects from an array of file paths.
//
// Parameters:
//   - filePaths: An array of strings containing the paths to the image or video files.
//   - parallel: The number of files to process in parallel.
//
// Returns:
//   - A channel that will receive Media objects for each valid file processed.
//   - An error if there is an issue opening or decoding any of the files.
func LoadMediaFromFiles(filePaths []string, imageFlip, imageRotate bool, parallel int) (<-chan Media, error) {
	result := make(chan Media)

	go func() {
		defer close(result)

		var wg sync.WaitGroup
		sem := make(chan struct{}, parallel)

		for _, file := range filePaths {
			wg.Add(1)
			sem <- struct{}{}

			go func(filePath string) {
				defer wg.Done()
				defer func() { <-sem }()

				media, mediaErr := LoadMediaFromFile(filePath, imageFlip, imageRotate)

				if mediaErr == nil {
					result <- *media
				}
			}(file)
		}

		wg.Wait()
		close(sem)
	}()

	return result, nil
}

// DirectoryOptions represents the configuration options for loading media from a directory.
//
// Fields:
//   - IncludeImages: A flag indicating whether to include image files.
//   - IncludeVideos: A flag indicating whether to include video files.
//   - IsRecursive: A flag indicating whether to search subdirectories recursively.
//   - Parallel: The number of files to process in parallel.
type DirectoryOptions struct {
	IncludeImages bool
	IncludeVideos bool
	ImageFlip     bool
	ImageRotate   bool
	IsRecursive   bool
	Parallel      int
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
func LoadMediaFromDirectory(directory string, options DirectoryOptions) (<-chan Media, error) {
	filePaths := make([]string, 0)

	err := filepath.Walk(directory, func(path string, file os.FileInfo, err error) error {
		if err != nil {
			return err
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
		return nil, err
	}

	return LoadMediaFromFiles(filePaths, options.ImageFlip, options.ImageRotate, options.Parallel)
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

	tempDir, _ := os.MkdirTemp("", "mediasim-*")
	defer os.RemoveAll(tempDir)

	path := filepath.Join(tempDir, "frame_%04d.jpg")
	command := ffmpeg.Input(filePath).
		Filter("fps", ffmpeg.Args{"1"}).
		Output(path).
		Silent(true)

	var err error
	if FFmpegPath == "" {
		err = command.Run()
	} else {
		err = command.SetFfmpegPath(FFmpegPath).Run()
	}

	if err != nil {
		return images, fmt.Errorf("error exporting video frames: %v", err)
	}

	images, err = loadFrames(tempDir)
	if err != nil {
		return images, fmt.Errorf("error loading multiple frames: %v", err)
	}

	if len(images) > 0 {
		return images, nil
	}

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
		return images, fmt.Errorf("error exporting video frame: %v", err)
	}

	images, err = loadFrames(tempDir)
	if err != nil {
		return images, fmt.Errorf("error loading single frame: %v", err)
	}

	return images, nil
}

// endregion
