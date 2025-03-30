package main

import (
	"encoding/json"
	"fmt"
	"mediasim"
)

func main() {
	media := make([]mediasim.Media, 0)
	newMedia, _ := mediasim.LoadMediaFromDirectory("assets", 5)

	for m := range newMedia {
		media = append(media, m)
	}

	comparisons := mediasim.CompareMedia(media, 0.8)
	jsonBytes, _ := json.Marshal(comparisons)
	fmt.Println(string(jsonBytes))
}
