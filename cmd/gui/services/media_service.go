package services

import (
	"fmt"
	"os"
	"sync"

	"shared"

	"github.com/vegidio/go-sak/fs"
)

type MediaInfo struct {
	Path     string `json:"path"`
	ModTime  int64  `json:"modTime"`
	FileSize int64  `json:"fileSize"`
}

type MediaService struct{}

// ListMedia returns metadata for all image and video files in the given directory (non-recursive).
func (m *MediaService) ListMedia(directory string) ([]MediaInfo, error) {
	filePaths, err := fs.ListPath(directory, fs.LpFile, append(shared.ValidImageTypes, shared.ValidVideoTypes...))
	if err != nil {
		return nil, fmt.Errorf("error listing directory: %w", err)
	}

	mediaInfos := make([]MediaInfo, len(filePaths))
	var wg sync.WaitGroup

	for i, p := range filePaths {
		wg.Go(func() {
			info, err := os.Stat(p)
			if err != nil {
				return
			}

			mediaInfos[i] = MediaInfo{
				Path:     p,
				ModTime:  info.ModTime().Unix(),
				FileSize: info.Size(),
			}
		})
	}

	wg.Wait()

	// Filter out entries where os.Stat failed
	result := make([]MediaInfo, 0, len(mediaInfos))
	for _, info := range mediaInfos {
		if info.Path != "" {
			result = append(result, info)
		}
	}

	return result, nil
}

// DeleteFiles permanently removes the given file paths from disk.
// It returns the list of paths that were successfully deleted.
func (m *MediaService) DeleteFiles(paths []string) []string {
	deleted := make([]string, 0, len(paths))

	for _, p := range paths {
		if err := os.Remove(p); err == nil {
			deleted = append(deleted, p)
		}
	}

	return deleted
}
