package charm

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/vegidio/mediasim"
)

func PrintError(message string, a ...interface{}) {
	format := fmt.Sprintf(message, a...)
	fmt.Printf("\n🧨 %s\n", red.Render(format))
}

func PrintScoreReport(score float64) {
	percent := fmt.Sprintf("%.5f", score)
	percent = strings.TrimRight(strings.TrimRight(percent, "0"), ".")
	fmt.Printf("\n🧮 Similarity score between the files is %s\n", magenta.Render(percent))
}

func PrintScoreJson(score float64) {
	fmt.Printf("{\n  \"score\": %.5f\n}", score)
}

func PrintScoreCsv(score float64) {
	fmt.Printf("%.5f", score)
}

func PrintCalculateFiles(amount int) {
	fmt.Printf("\n⏳ Calculating similarity in %s files\n", green.Render(strconv.Itoa(amount)))
}

func PrintCalculateDirectory(dir string) {
	fmt.Printf("\n⏳ Calculating similarity in the directory %s\n", green.Render(dir))
}

func PrintGroupReport(groups [][]mediasim.Media) {
	for i, media := range groups {
		fmt.Printf("\nGroup %s:\n", magenta.Render(strconv.Itoa(i+1)))

		// Best media
		best := media[0]
		fmt.Printf("  -> %s %s\n", bold.Render(best.Name), bold.Render(mediaInfo(best)))

		for _, m := range media[1:] {
			fmt.Printf("  -> %s %s\n", m.Name, mediaInfo(m))
		}
	}
}

func PrintGroupJson(groups [][]mediasim.Media) error {
	jsonBytes, err := json.MarshalIndent(groups, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal groups to JSON: %w", err)
	}

	fmt.Println(string(jsonBytes))
	return nil
}

func PrintGroupCsv(groups [][]mediasim.Media) {
	for i, media := range groups {
		for _, m := range media {
			fmt.Printf("Group %d,%s\n", i+1, m.Name)
		}
	}
}

func mediaInfo(media mediasim.Media) string {
	const megapixel = 1_000_000

	if media.Type == "image" {
		return fmt.Sprintf("(%.1f MP)", float64(media.Width)*float64(media.Height)/megapixel)
	}

	return fmt.Sprintf("(%d sec, %.1f MP)", media.Length, float64(media.Width)*float64(media.Height)/megapixel)
}
