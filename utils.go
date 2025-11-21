package mediasim

import (
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/samber/lo"
	ffmpeg "github.com/u2takey/ffmpeg-go"
	downloader "github.com/vegidio/ffmpeg-downloader"
	"github.com/vegidio/go-sak/async"
	"github.com/vegidio/go-sak/fs"
	. "github.com/vegidio/go-sak/types"
	"github.com/vitali-fedulov/images4"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// Holds the file path to the FFmpeg binary. Defaults to the system-installed path if not explicitly set.
var ffmpegPath = getFFmpegPath("mediasim")

// LoadMediaFromImages creates a Media object from the given image or video.
//
// # Parameters:
//   - name: The name of the media.
//   - images: The images to be converted into a Media object.
//   - options: The configuration options for loading frames.
//
// # Returns:
//   - A Media object containing the name, type and frames of the media.
func LoadMediaFromImages(name string, images []image.Image, options FrameOptions) Media {
	mediaType := "image"
	seconds := 0
	size := len(images)

	if size > 1 {
		mediaType = "video"
		seconds = size
	}

	media := Media{
		Name:   name,
		Type:   mediaType,
		Width:  images[0].Bounds().Dx(),
		Height: images[0].Bounds().Dy(),
		Length: seconds,
	}

	media.FramesOriginal = lo.Map(images, func(img image.Image, _ int) images4.IconT {
		return images4.Icon(img)
	})

	if options.FrameFlip {
		flipped := lo.Map(images, func(img image.Image, _ int) lo.Tuple2[images4.IconT, images4.IconT] {
			return lo.T2(
				images4.Icon(imaging.FlipH(img)),
				images4.Icon(imaging.FlipV(img)),
			)
		})

		media.FramesFlippedH, media.FramesFlippedV = lo.Unzip2(flipped)
	}

	if options.FrameRotate {
		rotated := lo.Map(images, func(img image.Image, _ int) lo.Tuple3[images4.IconT, images4.IconT, images4.IconT] {
			return lo.T3(
				images4.Icon(imaging.Rotate90(img)),
				images4.Icon(imaging.Rotate180(img)),
				images4.Icon(imaging.Rotate270(img)),
			)
		})

		media.FramesRotated90, media.FramesRotated180, media.FramesRotated270 = lo.Unzip3(rotated)
	}

	return media
}

// LoadMediaFromFile loads a Media object from the given file path.
//
// # Parameters:
//   - filePath: The path to the image or video file.
//   - options: The configuration options for loading frames.
//
// # Returns:
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

	if slices.Contains(validImageTypes, ext) {
		img, _, imgErr := image.Decode(file)
		if imgErr != nil {
			return nil, imgErr
		}

		images = append(images, img)

	} else if slices.Contains(validVideoTypes, ext) {
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

	// Add the file size to the media
	info, _ := file.Stat()
	media.Size = info.Size()

	return &media, nil
}

// LoadMediaFromFiles loads Media objects from an array of file paths.
//
// # Parameters:
//   - filePaths: An array of strings containing the paths to the image or video files.
//   - options: The configuration options for loading multiple files.
//
// # Returns:
//   - A channel that will receive Media objects for each valid file processed.
//   - An error if there is an issue opening or decoding any of the files.
func LoadMediaFromFiles(filePaths []string, options FilesOptions) <-chan Result[Media] {
	options.SetDefaults()

	return async.SliceToChannel(filePaths, options.Parallel, func(filePath string) Result[Media] {
		media, err := LoadMediaFromFile(filePath, FrameOptions{
			FrameFlip:   options.FrameFlip,
			FrameRotate: options.FrameRotate,
		})

		if err == nil {
			return Result[Media]{Data: *media}
		} else {
			return Result[Media]{Err: err}
		}
	})
}

// LoadMediaFromDirectory loads Media objects from a specified directory based on the provided options.
//
// # Parameters:
//   - directory: The path to the directory containing media files.
//   - options: A DirectoryOptions struct specifying the configuration for loading media.
//
// # Returns:
//   - A channel that will receive Result[Media] objects for each valid file processed.
//   - An integer representing the total number of files that will be processed.
func LoadMediaFromDirectory(directory string, options DirectoryOptions) (<-chan Result[Media], int) {
	options.SetDefaults()

	mediaTypes := make([]string, 0)
	if options.IncludeImages {
		mediaTypes = append(mediaTypes, validImageTypes...)
	}
	if options.IncludeVideos {
		mediaTypes = append(mediaTypes, validVideoTypes...)
	}

	flags := fs.LpFile
	if options.IsRecursive {
		flags |= fs.LpRecursive
	}

	filePaths, err := fs.ListPath(directory, flags, mediaTypes)

	if err != nil {
		result := make(chan Result[Media], 1)
		defer close(result)

		result <- Result[Media]{Err: err}
		return result, 0
	}

	return LoadMediaFromFiles(filePaths, FilesOptions{
		FrameFlip:   options.FrameFlip,
		FrameRotate: options.FrameRotate,
		Parallel:    options.Parallel,
	}), len(filePaths)
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

	if ffmpegPath == "" {
		_ = command.Run()
	} else {
		_ = command.SetFfmpegPath(ffmpegPath).Run()
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

	if ffmpegPath == "" {
		err = command.Run()
	} else {
		err = command.SetFfmpegPath(ffmpegPath).Run()
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
