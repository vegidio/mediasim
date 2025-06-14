package charm

import (
	"encoding/json"
	"fmt"
	"github.com/vegidio/mediasim"
	"strconv"
	"strings"
)

func PrintError(message string, a ...interface{}) {
	format := fmt.Sprintf(message, a...)
	fmt.Printf("\n🧨 %s\n", red.Render(format))
}

func PrintScore(score float64) {
	percent := fmt.Sprintf("%.5f", score)
	percent = strings.TrimRight(strings.TrimRight(percent, "0"), ".")
	fmt.Printf("\n🧮 Similarity score between the files is %s\n", magenta.Render(percent))
}

func PrintCalculateFiles(amount int) {
	fmt.Printf("\n⏳ Calculating similarity in %s files\n", green.Render(strconv.Itoa(amount)))
}

func PrintCalculateDirectory(dir string) {
	fmt.Printf("\n⏳ Calculating similarity in the directory %s\n", green.Render(dir))
}

func PrintGroupReport(groups []mediasim.Group) {
	for i, group := range groups {
		fmt.Printf("\nGroup %s:\n", magenta.Render(strconv.Itoa(i+1)))

		// Best media
		fmt.Printf("  -> %s %s\n", bold.Render(group.Best.Name), bold.Render(mediaInfo(group.Best)))

		for _, m := range group.Media {
			fmt.Printf("  -> %s %s\n", m.Name, mediaInfo(m))
		}
	}
}

func PrintGroupJson(groups []mediasim.Group) {
	jsonBytes, _ := json.MarshalIndent(groups, "", "  ")
	fmt.Println(string(jsonBytes))
}

func PrintGroupCsv(groups []mediasim.Group) {
	fmt.Printf("group,media\n")

	for i, group := range groups {
		allMedia := append(group.Media, group.Best)

		for _, m := range allMedia {
			fmt.Printf("Group %d,%s\n", i+1, m.Name)
		}
	}
}

// region - Private function

func mediaInfo(media mediasim.Media) string {
	if media.Type == "image" {
		return fmt.Sprintf("(%.1f MP)", float64(media.Width)*float64(media.Height)/1000000)
	} else {
		return fmt.Sprintf("(%d sec, %.1f MP)", media.Length, float64(media.Width)*float64(media.Height)/1000000)
	}
}

// endregion
