package shared

import (
	"path/filepath"
	"slices"
	"strings"
)

var ValidImageTypes = []string{".bmp", ".gif", ".jpg", ".jpeg", ".png", ".tiff", ".webp"}
var ValidVideoTypes = []string{".avi", ".m4v", ".mp4", ".mkv", ".mov", ".webm", ".wmv"}

// IsVideoFile checks if the file has a video extension.
func IsVideoFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return slices.Contains(ValidVideoTypes, ext)
}
