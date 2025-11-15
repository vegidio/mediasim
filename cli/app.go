package main

import (
	"cli/internal/charm"
	"fmt"
	"runtime"

	. "github.com/vegidio/go-sak/types"
	. "github.com/vegidio/mediasim"
)

// The max number of files to process in parallel, depending on the number of cores in the computer
var numWorkers = runtime.NumCPU()

func loadFiles(
	files []string,
	frameFlip,
	frameRotate bool,
	output string,
	ignoreErrors bool,
) ([]Media, error) {
	if output == "report" {
		charm.PrintCalculateFiles(len(files))
	}

	mediaCh := LoadMediaFromFiles(files, FilesOptions{
		Parallel:    numWorkers,
		FrameFlip:   frameFlip,
		FrameRotate: frameRotate,
	})

	return getMedia(mediaCh, len(files), output, ignoreErrors)
}

func loadDirectory(
	directory string,
	recursive bool,
	frameFlip bool,
	frameRotate bool,
	mediaType string,
	output string,
	ignoreErrors bool,
) ([]Media, error) {
	if output == "report" {
		charm.PrintCalculateDirectory(directory)
	}

	// Determine what media types to include
	var includeImages, includeVideos bool
	if mediaType == "image" {
		includeImages = true
	} else if mediaType == "video" {
		includeVideos = true
	} else {
		includeImages = true
		includeVideos = true
	}

	mediaCh, total := LoadMediaFromDirectory(directory, DirectoryOptions{
		IncludeImages: includeImages,
		IncludeVideos: includeVideos,
		IsRecursive:   recursive,
		Parallel:      numWorkers,
		FrameFlip:     frameFlip,
		FrameRotate:   frameRotate,
	})

	return getMedia(mediaCh, total, output, ignoreErrors)
}

func getMedia(
	channel <-chan Result[Media],
	total int,
	output string,
	ignoreErrors bool,
) ([]Media, error) {
	media := make([]Media, 0)
	var err error

	if output == "report" {
		media, err = charm.StartProgress(channel, total)
		if err != nil {
			return nil, fmt.Errorf("error loading media: %w", err)
		}
	} else {
		for r := range channel {
			if r.Err != nil {
				if ignoreErrors {
					continue
				}

				return nil, fmt.Errorf("error loading media: %w", r.Err)
			}

			media = append(media, r.Data)
		}
	}

	return media, nil
}

func calculateScore(media []Media) float64 {
	return CalculateSimilarity(media[0], media[1])
}

func groupAndReport(media []Media, threshold float64, output string) [][]Media {
	groups := make([][]Media, 0)

	if output == "report" {
		groups = charm.StartSpinner(media, threshold, "🔎 Grouping media with at least %s similarity threshold...")
	} else {
		groups = GroupMedia(media, threshold)
	}

	return groups
}

func groupAndRename(media []Media, threshold float64, output string) [][]Media {
	groups := make([][]Media, 0)

	if output == "report" {
		groups = charm.StartSpinner(media, threshold, "📝 Renaming media with at least %s similarity threshold...")
	} else {
		groups = GroupMedia(media, threshold)
	}

	return groups
}
