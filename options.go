package mediasim

import (
	"context"
	"runtime"
)

// FrameOptions represents the configuration options for loading media frames.
//
// # Fields:
//   - FrameFlip: A flag indicating whether the frame should be flipped.
//   - FrameRotate: A flag indicating whether the frame should be rotated.
type FrameOptions struct {
	FrameFlip   bool
	FrameRotate bool
}

// FilesOptions represents the configuration options for processing multiple files.
//
// # Fields:
//   - Parallel: The number of files to process in parallel.
//   - FrameOptions: Frame transformation options (flip, rotate).
type FilesOptions struct {
	Parallel int
	FrameOptions
}

func (o *FilesOptions) SetDefaults() {
	if o.Parallel == 0 {
		o.Parallel = runtime.NumCPU()
	}
}

// DirectoryOptions represents the configuration options for loading media from a directory.
//
// # Fields:
//   - IncludeImages: A flag indicating whether to include image files.
//   - IncludeVideos: A flag indicating whether to include video files.
//   - IsRecursive: A flag indicating whether to search subdirectories recursively.
//   - Parallel: The number of files to process in parallel.
//   - FrameOptions: Frame transformation options (flip, rotate).
//   - UseCache: A flag indicating whether to keep a cache file (CacheFileName) in the directory, so files that haven't
//     changed since a previous (complete or interrupted) run are not processed again.
//   - Context: An optional context; once cancelled, the remaining files are skipped and returned as errors.
type DirectoryOptions struct {
	IncludeImages bool
	IncludeVideos bool
	IsRecursive   bool
	Parallel      int
	FrameOptions
	UseCache bool
	Context  context.Context
}

func (o *DirectoryOptions) SetDefaults() {
	// You can't search for files in a directory without including either images or videos. If none are included,
	// default to both.
	if !o.IncludeImages && !o.IncludeVideos {
		o.IncludeImages = true
		o.IncludeVideos = true
	}

	if o.Parallel == 0 {
		o.Parallel = runtime.NumCPU()
	}

	if o.Context == nil {
		o.Context = context.Background()
	}
}
