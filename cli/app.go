package main

import (
	"cli/internal/charm"
	"fmt"
	"github.com/vegidio/mediasim"
)

func loadFiles(
	files []string,
	frameFlip,
	frameRotate bool,
	output string,
	ignoreErrors bool,
) ([]mediasim.Media, error) {
	if output == "report" {
		charm.PrintCalculateFiles(len(files))
	}

	results := mediasim.LoadMediaFromFiles(files, mediasim.FilesOptions{
		Parallel:    5,
		FrameFlip:   frameFlip,
		FrameRotate: frameRotate,
	})

	return getMedia(results, len(files), output, ignoreErrors)
}

func loadDirectory(
	directory string,
	recursive bool,
	frameFlip bool,
	frameRotate bool,
	mediaType string,
	output string,
	ignoreErrors bool,
) ([]mediasim.Media, error) {
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

	results, total := mediasim.LoadMediaFromDirectory(directory, mediasim.DirectoryOptions{
		IncludeImages: includeImages,
		IncludeVideos: includeVideos,
		IsRecursive:   recursive,
		Parallel:      5,
		FrameFlip:     frameFlip,
		FrameRotate:   frameRotate,
	})

	return getMedia(results, total, output, ignoreErrors)
}

func getMedia(
	result <-chan mediasim.Result[mediasim.Media],
	total int,
	output string,
	ignoreErrors bool,
) ([]mediasim.Media, error) {
	media := make([]mediasim.Media, 0)
	var err error

	if output == "report" {
		media, err = charm.StartProgress(result, total)
		if err != nil {
			return nil, fmt.Errorf("error loading media: %w", err)
		}
	} else {
		for r := range result {
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

func calculateScore(media []mediasim.Media) float64 {
	return mediasim.CalculateSimilarity(media[0], media[1])
}

func groupAndReport(media []mediasim.Media, threshold float64, output string) [][]mediasim.Group {
	groups := make([][]mediasim.Group, 0)

	if output == "report" {
		groups = charm.StartSpinner(media, threshold, "🔎 Grouping media with at least %s similarity threshold...")
	} else {
		groups = mediasim.GroupMedia(media, threshold)
	}

	return groups
}

func groupAndRename(media []mediasim.Media, threshold float64, output string) [][]mediasim.Group {
	groups := make([][]mediasim.Group, 0)

	if output == "report" {
		groups = charm.StartSpinner(media, threshold, "📝 Renaming media with at least %s similarity threshold...")
	} else {
		groups = mediasim.GroupMedia(media, threshold)
	}

	return groups
}
