package mediasim

import "strings"

var validImageTypes = []string{".bmp", ".gif", ".jpg", ".jpeg", ".png", ".tiff", ".webp"}
var validVideoTypes = []string{".avi", ".m4v", ".mp4", ".mkv", ".mov", ".webm", "wmv"}

// AddImageType adds one or more image type extensions to the list of valid image types.
func AddImageType(types ...string) {
	for _, t := range types {
		validImageTypes = append(validImageTypes, strings.ToLower(t))
	}
}

// AddVideoType adds one or more video type extensions to the list of valid video types.
func AddVideoType(types ...string) {
	for _, t := range types {
		validVideoTypes = append(validVideoTypes, strings.ToLower(t))
	}
}
