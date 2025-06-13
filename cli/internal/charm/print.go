package charm

import (
	"encoding/json"
	"fmt"
	"github.com/vegidio/mediasim"
	"strconv"
)

func PrintError(message string, a ...interface{}) {
	format := fmt.Sprintf(message, a...)
	fmt.Printf("\n🧨 %s\n", red.Render(format))
}

func PrintCalculateFiles(amount int) {
	fmt.Printf("\n⏳ Calculating similarity in %s files\n", green.Render(strconv.Itoa(amount)))
}

func PrintCalculateDirectory(dir string) {
	fmt.Printf("\n⏳ Calculating similarity in the directory %s\n", green.Render(dir))
}

func PrintGroupReport(groups [][]mediasim.Group) {
	for i, group := range groups {
		fmt.Printf("\nGroup %s:\n", magenta.Render(strconv.Itoa(i+1)))

		for _, g := range group {
			fmt.Printf("  -> %s\n", bold.Render(g.Name))
		}
	}
}

func PrintGroupJson(groups [][]mediasim.Group) {
	jsonBytes, _ := json.MarshalIndent(groups, "", "  ")
	fmt.Println(string(jsonBytes))
}

func PrintGroupCsv(groups [][]mediasim.Group) {
	fmt.Printf("group,media\n")

	for i, group := range groups {
		for _, g := range group {
			fmt.Printf("Group %d,%s\n", i+1, g.Name)
		}
	}
}
