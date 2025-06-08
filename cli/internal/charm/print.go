package charm

import (
	"encoding/json"
	"fmt"
	"github.com/vegidio/mediasim"
	"strconv"
)

func PrintError(message string, a ...interface{}) {
	format := fmt.Sprintf(message, a...)
	fmt.Printf("🧨 \n%s\n", red.Render(format))
}

func PrintCalculateFiles(amount int) {
	fmt.Printf("\n⏳ Calculating similarity in %s files\n", green.Render(strconv.Itoa(amount)))
}

func PrintCalculateDirectory(dir string) {
	fmt.Printf("\n⏳ Calculating similarity in the directory %s\n", green.Render(dir))
}

func PrintComparisonReport(comparisons []mediasim.Comparison) {
	for i, comparison := range comparisons {
		fmt.Printf("\nGroup %d: media %s:\n", i+1, bold.Render(comparison.Name))

		for _, similarity := range comparison.Similarities {
			fmt.Printf("  -> %s similarity with media %s\n",
				magenta.Render(fmt.Sprintf("%.5f", similarity.Score)),
				bold.Render(similarity.Name),
			)
		}
	}
}

func PrintComparisonJson(comparisons []mediasim.Comparison) {
	jsonBytes, _ := json.MarshalIndent(comparisons, "", "  ")
	fmt.Println(string(jsonBytes))
}

func PrintComparisonCsv(comparisons []mediasim.Comparison) {
	fmt.Printf("similarity,media1,media2\n")
	for _, comparison := range comparisons {
		for _, similarity := range comparison.Similarities {
			fmt.Printf("%.8f,%s,%s\n", similarity.Score, comparison.Name, similarity.Name)
		}
	}
}
