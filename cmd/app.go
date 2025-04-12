package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/pterm/pterm"
	"github.com/vegidio/mediasim"
	"strconv"
	"time"
)

func compareFiles(files []string, frameFlip, frameRotate bool, output string) ([]mediasim.Media, error) {
	var stopSpinner context.CancelFunc
	count := 0
	msg := pterm.Sprintf("🧮 Calculating similarity in %s files", pterm.FgLightGreen.Sprintf(strconv.Itoa(len(files))))

	if output == "report" {
		pterm.Println()
		stopSpinner = createSpinner(msg, count)
		defer stopSpinner()
	}

	media := make([]mediasim.Media, 0)
	results := mediasim.LoadMediaFromFiles(files, mediasim.FilesOptions{
		Parallel:    5,
		FrameFlip:   frameFlip,
		FrameRotate: frameRotate,
	})

	for r := range results {
		if r.Err != nil {
			return media, fmt.Errorf("error loading media files: %w", r.Err)
		}

		if output == "report" {
			count++
			updateSpinner(msg, count)
		}

		media = append(media, r.Data)
	}

	return media, nil
}

func compareDirectory(
	directory string,
	recursive bool,
	frameFlip bool,
	frameRotate bool,
	mediaType string,
	output string,
) ([]mediasim.Media, error) {
	var stopSpinner context.CancelFunc
	count := 0
	media := make([]mediasim.Media, 0)
	msg := pterm.Sprintf("🧮 Calculating similarity in the directory %s", pterm.FgLightGreen.Sprintf(directory))

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

	if output == "report" {
		pterm.Println()
		stopSpinner = createSpinner(msg, count)
		defer stopSpinner()
	}

	results := mediasim.LoadMediaFromDirectory(directory, mediasim.DirectoryOptions{
		IncludeImages: includeImages,
		IncludeVideos: includeVideos,
		IsRecursive:   recursive,
		Parallel:      5,
		FrameFlip:     frameFlip,
		FrameRotate:   frameRotate,
	})

	for r := range results {
		if r.Err != nil {
			return nil, fmt.Errorf("error loading from directory: %w", r.Err)
		}

		if output == "report" {
			count++
			updateSpinner(msg, count)
		}

		media = append(media, r.Data)
	}

	return media, nil
}

func calculateSimilarity(media []mediasim.Media, threshold float64, output string) []mediasim.Comparison {
	if output == "report" {
		// We need to wait some time before displaying the next message because the spinner takes time to stop
		time.Sleep(250 * time.Millisecond)
		pterm.Printf("🔎 Selecting media with at least %s similarity threshold...",
			pterm.FgLightYellow.Sprintf(floatToStr(threshold)))
		pterm.Println()
	}

	return mediasim.CompareMedia(media, threshold)
}

func printComparisonReport(comparisons []mediasim.Comparison) {
	for i, comparison := range comparisons {
		pterm.Printf("\nGroup %d: media %s:\n", i+1, pterm.Bold.Sprintf(comparison.Name))

		for _, similarity := range comparison.Similarities {
			pterm.Printf("  -> %s similarity with media %s\n",
				pterm.FgLightMagenta.Sprintf("%.5f", similarity.Score),
				pterm.Bold.Sprintf(similarity.Name),
			)
		}
	}
}

func printComparisonJson(comparisons []mediasim.Comparison) {
	jsonBytes, _ := json.Marshal(comparisons)
	pterm.Println(string(jsonBytes))
}

func printComparisonCsv(comparisons []mediasim.Comparison) {
	for _, comparison := range comparisons {
		for _, similarity := range comparison.Similarities {
			pterm.Printf("%.8f,%s,%s\n", similarity.Score, comparison.Name, similarity.Name)
		}
	}
}
