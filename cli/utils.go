package main

import (
	"fmt"
	"github.com/vegidio/mediasim"
	"os"
	"os/user"
	"path/filepath"
	"strings"
)

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

func renameMedia(groups [][]mediasim.Group) error {
	for i, group := range groups {
		for _, g := range group {
			dir, file := filepath.Split(g.Name)
			newName := fmt.Sprintf("group%d_%s", i+1, file)
			newPath := filepath.Join(dir, newName)

			if err := os.Rename(g.Name, newPath); err != nil {
				return fmt.Errorf("failed to rename file %s to %s: %w", g.Name, newPath, err)
			}
		}
	}

	return nil
}
