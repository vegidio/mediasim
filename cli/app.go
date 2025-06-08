package main

import (
	"cli/internal/charm"
	"fmt"
	"github.com/vegidio/mediasim"
)

func compareFiles(
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

func compareDirectory(
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

func calculateSimilarity(media []mediasim.Media, threshold float64, output string) []mediasim.Comparison {
	comparisons := make([]mediasim.Comparison, 0)
	result := mediasim.CompareMedia(media, threshold)

	if output == "report" {
		comparisons = charm.StartSpinner(result, threshold)
	} else {
		for c := range result {
			comparisons = append(comparisons, c)
		}
	}

	return comparisons
}
