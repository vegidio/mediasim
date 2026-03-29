package main

import (
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/vegidio/mediasim"
)

func expandPaths(paths []string) ([]string, error) {
	result := make([]string, 0, len(paths))
	for _, p := range paths {
		expanded, err := expandPath(p)
		if err != nil {
			return nil, fmt.Errorf("failed to expand path %q: %w", p, err)
		}
		result = append(result, expanded)
	}
	return result, nil
}

func expandPath(path string) (string, error) {
	path = filepath.Clean(path)

	if strings.HasPrefix(path, "~") {
		usr, err := user.Current()
		if err != nil {
			return "", err
		}

		return strings.Replace(path, "~", usr.HomeDir, 1), nil
	}

	return path, nil
}

func renameMedia(groups [][]mediasim.Media) error {
	size := len(groups)
	width := len(strconv.Itoa(size))

	for i, group := range groups {
		for _, media := range group {
			dir, file := filepath.Split(media.Name)
			newName := fmt.Sprintf("group%0*d_%s", width, i+1, file)
			newPath := filepath.Join(dir, newName)

			if err := os.Rename(media.Name, newPath); err != nil {
				return fmt.Errorf("failed to rename file %s to %s: %w", media.Name, newPath, err)
			}
		}
	}

	return nil
}
