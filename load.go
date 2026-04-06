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
	"github.com/vegidio/go-sak/async"
	"github.com/vegidio/go-sak/fs"
	. "github.com/vegidio/go-sak/types"
	iffmpeg "github.com/vegidio/mediasim/internal/ffmpeg"
	"github.com/vitali-fedulov/images4"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
	"shared"
)

// Holds the file path to the FFmpeg binary. Defaults to the system-installed path if not explicitly set.
var ffmpegPath = shared.GetFFmpegPath("mediasim")

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

	media.framesOriginal = lo.Map(images, func(img image.Image, _ int) images4.IconT {
		return images4.Icon(img)
	})

	if options.FrameFlip {
		flipped := lo.Map(images, func(img image.Image, _ int) lo.Tuple2[images4.IconT, images4.IconT] {
			return lo.T2(
				images4.Icon(imaging.FlipH(img)),
				images4.Icon(imaging.FlipV(img)),
			)
		})

		media.framesFlippedH, media.framesFlippedV = lo.Unzip2(flipped)
	}

	if options.FrameRotate {
		rotated := lo.Map(images, func(img image.Image, _ int) lo.Tuple3[images4.IconT, images4.IconT, images4.IconT] {
			return lo.T3(
				images4.Icon(imaging.Rotate90(img)),
				images4.Icon(imaging.Rotate180(img)),
				images4.Icon(imaging.Rotate270(img)),
			)
		})

		media.framesRotated90, media.framesRotated180, media.framesRotated270 = lo.Unzip3(rotated)
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
		videos, vidErr := iffmpeg.ExtractFrames(file.Name(), ffmpegPath)
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
	if info, infoErr := file.Stat(); infoErr == nil {
		media.Size = info.Size()
	}

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
		media, err := LoadMediaFromFile(filePath, options.FrameOptions)

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
		Parallel:     options.Parallel,
		FrameOptions: options.FrameOptions,
	}), len(filePaths)
}
