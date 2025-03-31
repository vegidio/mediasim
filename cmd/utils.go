package main

import (
	"fmt"
	"os/user"
	"strings"
)

func expandPath(path string) (string, error) {
	if strings.HasPrefix(path, "~") {
		usr, err := user.Current()
		if err != nil {
			return "", err
		}

		return strings.Replace(path, "~", usr.HomeDir, 1), nil
	}

	return path, nil
}

func floatToStr(f float64) string {
	s := fmt.Sprintf("%.5f", f)
	return strings.TrimRight(strings.TrimRight(s, "0"), ".")
}
