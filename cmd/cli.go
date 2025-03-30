package main

import (
	"encoding/json"
	"fmt"
	"mediasim"
	"time"
)

func main() {
	media := make([]mediasim.Media, 0)
	newMedia, _ := mediasim.LoadMediaFromDirectory("assets")

	fmt.Println(time.Now())
	for m := range newMedia {
		media = append(media, m)
	}
	fmt.Println(time.Now())

	comparisons := mediasim.CompareMedia(media, 0.8)
	jsonBytes, _ := json.Marshal(comparisons)
	fmt.Println(string(jsonBytes))
}
