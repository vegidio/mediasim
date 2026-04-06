package shared

import (
	"os"
	"path/filepath"
	"strings"
)

// CleanupTempDirs removes leftover temp directories from previous sessions
// that match the "mediasim-" prefix. Call this at startup before creating any
// new temp directories.
func CleanupTempDirs() {
	tmpDir := os.TempDir()
	entries, err := os.ReadDir(tmpDir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "mediasim-") {
			os.RemoveAll(filepath.Join(tmpDir, entry.Name()))
		}
	}
}
