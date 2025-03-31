package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/pterm/pterm"
	"mediasim"
	"strconv"
	"time"
)

func compareFiles(files []string, threshold float64, output string) ([]mediasim.Media, error) {
	var stopSpinner context.CancelFunc
	count := 0
	msg := pterm.Sprintf("🧮 Calculating similarity in %s files", pterm.FgLightGreen.Sprintf(strconv.Itoa(len(files))))

	if output == "report" {
		pterm.Println()
		stopSpinner = createSpinner(msg, count)
	}

	media := make([]mediasim.Media, 0)
	newMedia, err := mediasim.LoadMediaFromFiles(files, 5)
	if err != nil {
		return media, fmt.Errorf("error loading media files: " + err.Error())
	}

	for m := range newMedia {
		if output == "report" {
			count++
			updateSpinner(msg, count)
		}

		media = append(media, m)
	}

	if output == "report" {
		stopSpinner()
	}

	return media, nil
}

func compareDirectory(directory string, threshold float64, output string) ([]mediasim.Media, error) {
	var stopSpinner context.CancelFunc
	count := 0
	msg := pterm.Sprintf("🧮 Calculating similarity in the directory %s", pterm.FgLightGreen.Sprintf(directory))

	if output == "report" {
		pterm.Println()
		stopSpinner = createSpinner(msg, count)
	}

	media := make([]mediasim.Media, 0)
	newMedia, err := mediasim.LoadMediaFromDirectory(directory, 5)
	if err != nil {
		return media, fmt.Errorf("error loading from directory: " + err.Error())
	}

	for m := range newMedia {
		if output == "report" {
			count++
			updateSpinner(msg, count)
		}

		media = append(media, m)
	}

	if output == "report" {
		stopSpinner()
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

func printComparisonSingle(comparisons []mediasim.Comparison) {
	for _, comparison := range comparisons {
		for _, similarity := range comparison.Similarities {
			pterm.Printf("%.8f,%s,%s\n", similarity.Score, comparison.Name, similarity.Name)
		}
	}
}
