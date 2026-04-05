package services

import (
	"context"
	"runtime"

	"github.com/vegidio/mediasim"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type ComparisonService struct{}

// StartComparison loads media from a directory and groups them by similarity, emitting progress events.
func (c *ComparisonService) StartComparison(
	ctx context.Context,
	directory string,
	includeImages bool,
	includeVideos bool,
	frameFlip bool,
	frameRotate bool,
	threshold float64,
) error {
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

	updateCh := mediasim.LoadAndGroupMedia(mediaCh, total, threshold, false)

	for update := range updateCh {
		select {
		case <-ctx.Done():
			go func() {
				for range updateCh {
				}
			}()
			return ctx.Err()
		default:
		}

		if update.Err != nil {
			if update.Done {
				return update.Err
			}
			continue
		}

		if update.Done {
			break
		}

		app.Event.Emit("comparison:progress", map[string]int{
			"current": update.Loaded,
			"total":   total,
		})
	}

	return nil
}
