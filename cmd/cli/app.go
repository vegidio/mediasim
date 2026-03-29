package main

import (
	"cli/internal/charm"
	"fmt"
	"runtime"

	"github.com/vegidio/go-sak/types"
	"github.com/vegidio/mediasim"
)

var numWorkers = runtime.NumCPU()

func (c *cmdContext) loadFiles(files []string) ([]mediasim.Media, error) {
	if c.output == "report" {
		charm.PrintCalculateFiles(len(files))
	}

	mediaCh := mediasim.LoadMediaFromFiles(files, mediasim.FilesOptions{
		Parallel:     numWorkers,
		FrameOptions: mediasim.FrameOptions{FrameFlip: c.frameFlip, FrameRotate: c.frameRotate},
	})

	return c.getMedia(mediaCh, len(files))
}

func (c *cmdContext) loadDirectory(directory string) ([]mediasim.Media, error) {
	if c.output == "report" {
		charm.PrintCalculateDirectory(directory)
	}

	includeImages := c.mediaType != "video"
	includeVideos := c.mediaType != "image"

	mediaCh, total := mediasim.LoadMediaFromDirectory(directory, mediasim.DirectoryOptions{
		IncludeImages: includeImages,
		IncludeVideos: includeVideos,
		IsRecursive:   c.recursive,
		Parallel:      numWorkers,
		FrameOptions:  mediasim.FrameOptions{FrameFlip: c.frameFlip, FrameRotate: c.frameRotate},
	})

	return c.getMedia(mediaCh, total)
}

func (c *cmdContext) getMedia(
	channel <-chan types.Result[mediasim.Media],
	total int,
) ([]mediasim.Media, error) {
	media := make([]mediasim.Media, 0, total)
	var err error

	if c.output == "report" {
		media, err = charm.StartProgress(channel, total)
		if err != nil {
			return nil, fmt.Errorf("error loading media: %w", err)
		}
	} else {
		for r := range channel {
			if r.Err != nil {
				if c.ignoreErrors {
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

func (c *cmdContext) groupMedia(media []mediasim.Media, message string) ([][]mediasim.Media, error) {
	if c.output == "report" {
		return charm.StartSpinner(media, c.threshold, message)
	}

	return mediasim.GroupMedia(media, c.threshold), nil
}

func printScore(output string, score float64) {
	switch output {
	case "report":
		charm.PrintScoreReport(score)
	case "json":
		charm.PrintScoreJson(score)
	case "csv":
		charm.PrintScoreCsv(score)
	}
}

func printGroups(output string, groups [][]mediasim.Media) error {
	switch output {
	case "report":
		charm.PrintGroupReport(groups)
	case "json":
		return charm.PrintGroupJson(groups)
	case "csv":
		charm.PrintGroupCsv(groups)
	}

	return nil
}
