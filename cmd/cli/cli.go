package main

import (
	"cli/internal"
	"cli/internal/charm"
	"context"
	"fmt"

	"github.com/urfave/cli/v3"
	"github.com/vegidio/go-sak/o11y"
	"github.com/vegidio/mediasim"
)

type cmdContext struct {
	threshold    float64
	output       string
	recursive    bool
	frameFlip    bool
	frameRotate  bool
	mediaType    string
	ignoreErrors bool
	otel         *o11y.Telemetry
}

func validateMediaType(s string) error {
	if s != "image" && s != "video" && s != "all" {
		return fmt.Errorf("invalid media type; must be 'image', 'video', or 'all'")
	}

	return nil
}

func buildCliCommands(otel *o11y.Telemetry) *cli.Command {
	c := &cmdContext{otel: otel}

	return &cli.Command{
		Name:            "mediasim",
		Usage:           "a tool to calculate the similarity of images & videos",
		UsageText:       "mediasim <command> [-t <threshold>] [--if] [--ir] [-o <output>]",
		Version:         internal.Version,
		HideHelpCommand: true,
		Commands: []*cli.Command{
			{
				Name:      "score",
				Usage:     "calculate the similarity score of two media files",
				UsageText: "mediasim score <file1> <file2>",
				Action: func(ctx context.Context, command *cli.Command) error {
					c.otel.LogInfo("Calculate score", map[string]any{
						"frame.flip":   c.frameFlip,
						"frame.rotate": c.frameRotate,
						"output.type":  c.output,
					})

					files := command.Args().Slice()

					if len(files) != 2 {
						return fmt.Errorf("you must specify exactly two files")
					}

					files, err := expandPaths(files)
					if err != nil {
						return err
					}

					media, err := c.loadFiles(files)
					if err != nil {
						return err
					}

					score := calculateScore(media)
					printScore(c.output, score)
					return nil
				},
			},
			{
				Name:      "files",
				Usage:     "group two or more media files based on similarity",
				UsageText: "mediasim files <file1> <file2> [<file3> ...] ",
				Action: func(ctx context.Context, command *cli.Command) error {
					c.otel.LogInfo("Compare files", map[string]any{
						"frame.flip":   c.frameFlip,
						"frame.rotate": c.frameRotate,
						"output.type":  c.output,
					})

					files := command.Args().Slice()

					if len(files) < 2 {
						return fmt.Errorf("at least two files must be specified")
					}

					files, err := expandPaths(files)
					if err != nil {
						return err
					}

					if c.output == "report" {
						charm.PrintCalculateFiles(len(files))
						charm.PrintGroupingThreshold(c.threshold)
					}

					mediaCh := mediasim.LoadMediaFromFiles(files, mediasim.FilesOptions{
						Parallel:     numWorkers,
						FrameOptions: mediasim.FrameOptions{FrameFlip: c.frameFlip, FrameRotate: c.frameRotate},
					})

					groups, err := c.loadAndGroup(mediaCh, len(files))
					if err != nil {
						return err
					}

					return printGroups(c.output, groups)
				},
			},
			{
				Name:      "dir",
				Usage:     "group media files in a directory based on similarity",
				UsageText: "mediasim dir <directory> [-r] [--mt <media-type>]",
				Flags: []cli.Flag{
					&cli.BoolFlag{
						Name:        "recursive",
						Aliases:     []string{"r"},
						Usage:       "recursively search for files in the directory",
						Value:       false,
						DefaultText: "false",
						Destination: &c.recursive,
					},
					&cli.StringFlag{
						Name:        "media-type",
						Aliases:     []string{"mt"},
						Usage:       "type of media to compare; image | video | all",
						Value:       "all",
						DefaultText: "all",
						Destination: &c.mediaType,
						Validator:   validateMediaType,
					},
				},
				Action: func(ctx context.Context, command *cli.Command) error {
					c.otel.LogInfo("Compare directory", map[string]any{
						"frame.flip":   c.frameFlip,
						"frame.rotate": c.frameRotate,
						"output.type":  c.output,
						"media.type":   c.mediaType,
					})

					directory, err := expandPath(command.Args().First())
					if err != nil {
						return err
					}

					includeImages := c.mediaType != "video"
					includeVideos := c.mediaType != "image"

					if c.output == "report" {
						charm.PrintCalculateDirectory(directory)
						charm.PrintGroupingThreshold(c.threshold)
					}

					mediaCh, total := mediasim.LoadMediaFromDirectory(directory, mediasim.DirectoryOptions{
						IncludeImages: includeImages,
						IncludeVideos: includeVideos,
						IsRecursive:   c.recursive,
						Parallel:      numWorkers,
						FrameOptions:  mediasim.FrameOptions{FrameFlip: c.frameFlip, FrameRotate: c.frameRotate},
					})

					groups, err := c.loadAndGroup(mediaCh, total)
					if err != nil {
						return err
					}

					return printGroups(c.output, groups)
				},
			},
			{
				Name:      "rename",
				Usage:     "rename files to group them based on similarity",
				UsageText: "mediasim group <directory> [--mt <media-type>]",
				Flags: []cli.Flag{
					&cli.StringFlag{
						Name:        "media-type",
						Aliases:     []string{"mt"},
						Usage:       "type of media to compare; image | video | all",
						Value:       "all",
						DefaultText: "all",
						Destination: &c.mediaType,
						Validator:   validateMediaType,
					},
				},
				Action: func(ctx context.Context, command *cli.Command) error {
					c.otel.LogInfo("Rename files", map[string]any{
						"frame.flip":   c.frameFlip,
						"frame.rotate": c.frameRotate,
						"media.type":   c.mediaType,
					})

					directory, err := expandPath(command.Args().First())
					if err != nil {
						return err
					}

					includeImages := c.mediaType != "video"
					includeVideos := c.mediaType != "image"

					mediaCh, total := mediasim.LoadMediaFromDirectory(directory, mediasim.DirectoryOptions{
						IncludeImages: includeImages,
						IncludeVideos: includeVideos,
						IsRecursive:   c.recursive,
						Parallel:      numWorkers,
						FrameOptions:  mediasim.FrameOptions{FrameFlip: c.frameFlip, FrameRotate: c.frameRotate},
					})

					groups, err := c.loadAndGroup(mediaCh, total)
					if err != nil {
						return err
					}

					return renameMedia(groups)
				},
			},
		},
		Flags: []cli.Flag{
			&cli.FloatFlag{
				Name:        "threshold",
				Aliases:     []string{"t"},
				Usage:       "similarity threshold; between 0-1",
				Value:       0.8,
				Destination: &c.threshold,
				Validator: func(f float64) error {
					if f < 0 || f > 1 {
						return fmt.Errorf("threshold must be between 0 and 1")
					}

					return nil
				},
			},
			&cli.BoolFlag{
				Name:        "frame-flip",
				Aliases:     []string{"ff"},
				Usage:       "flip the frame vertically and horizontally during comparison",
				Value:       false,
				DefaultText: "false",
				Destination: &c.frameFlip,
			},
			&cli.BoolFlag{
				Name:        "frame-rotate",
				Aliases:     []string{"fr"},
				Usage:       "rotate the frame in 90º, 180º and 270º during comparison",
				Value:       false,
				DefaultText: "false",
				Destination: &c.frameRotate,
			},
			&cli.StringFlag{
				Name:        "output",
				Aliases:     []string{"o"},
				Usage:       "format how similarity is reported; report | json | csv",
				Value:       "report",
				DefaultText: "report",
				Destination: &c.output,
				Validator: func(s string) error {
					if s != "report" && s != "json" && s != "csv" {
						return fmt.Errorf("invalid output format")
					}

					return nil
				},
			},
			&cli.BoolFlag{
				Name:        "ignore-errors",
				Aliases:     []string{"ie"},
				Usage:       "continues processing files even if an error occurs",
				Value:       false,
				DefaultText: "false",
				Destination: &c.ignoreErrors,
			},
		},
		Action: func(ctx context.Context, command *cli.Command) error {
			return fmt.Errorf("command missing; try 'mediasim --help' for more information")
		},
	}
}
