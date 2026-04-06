package services

import (
	"context"
	"runtime"

	"github.com/vegidio/mediasim"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type ComparisonService struct{}

// ComparisonMedia is a DTO representing a media item in a comparison group.
type ComparisonMedia struct {
	Path   string `json:"path"`
	Type   string `json:"type"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Size   int64  `json:"size"`
	Length int    `json:"length"`
}

// ComparisonGroup is a DTO representing a group of similar media items.
type ComparisonGroup struct {
	Media []ComparisonMedia `json:"media"`
}

// StartComparison loads media from a directory and groups them by similarity, emitting progress events.
func (c *ComparisonService) StartComparison(
	ctx context.Context,
	directory string,
	includeImages bool,
	includeVideos bool,
	frameFlip bool,
	frameRotate bool,
	threshold float64,
) ([]ComparisonGroup, error) {
	mediaCh, total := mediasim.LoadMediaFromDirectory(directory, mediasim.DirectoryOptions{
		IncludeImages: includeImages,
		IncludeVideos: includeVideos,
		IsRecursive:   false,
		Parallel:      runtime.NumCPU(),
		FrameOptions: mediasim.FrameOptions{
			FrameFlip:   frameFlip,
			FrameRotate: frameRotate,
		},
	})

	app := application.Get()
	app.Event.Emit("comparison:progress", map[string]int{"current": 0, "total": total})

	resultCh := mediasim.LoadAndGroupMedia(mediaCh, total, threshold, false)

	for result := range resultCh {
		select {
		case <-ctx.Done():
			go func() {
				for range resultCh {
				}
			}()
			return nil, ctx.Err()
		default:
		}

		if result.Err != nil {
			if result.Done {
				return nil, result.Err
			}
			continue
		}

		if result.Done {
			groups := make([]ComparisonGroup, len(result.Groups))

			for i, g := range result.Groups {
				media := make([]ComparisonMedia, len(g))

				for j, m := range g {
					media[j] = ComparisonMedia{
						Path:   m.Name,
						Type:   m.Type,
						Width:  m.Width,
						Height: m.Height,
						Size:   m.Size,
						Length: m.Length,
					}
				}

				groups[i] = ComparisonGroup{Media: media}
			}

			return groups, nil
		}

		app.Event.Emit("comparison:progress", map[string]int{
			"current": result.Loaded,
			"total":   total,
		})
	}

	return nil, nil
}
