package mediasim

import (
	"github.com/samber/lo"
	"strings"
)

var validImageTypes = []string{".bmp", ".gif", ".jpg", ".jpeg", ".png", ".tiff", ".webp"}
var validVideoTypes = []string{".avi", ".m4v", ".mp4", ".mkv", ".mov", ".webm"}

// AddImageType adds one or more image type extensions to the list of valid image types.
func AddImageType(types ...string) {
	lowerTypes := lo.Map(types, func(item string, _ int) string {
		return strings.ToLower(item)
	})

	validImageTypes = append(validImageTypes, lowerTypes...)
}

// AddVideoType adds one or more video type extensions to the list of valid video types.
func AddVideoType(types ...string) {
	lowerTypes := lo.Map(types, func(item string, _ int) string {
		return strings.ToLower(item)
	})

	validVideoTypes = append(validVideoTypes, lowerTypes...)
}
