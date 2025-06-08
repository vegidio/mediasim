package main

import (
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
