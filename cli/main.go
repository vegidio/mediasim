package main

import (
	"context"
	"fmt"
	"github.com/pterm/pterm"
	"github.com/samber/lo"
	"github.com/urfave/cli/v3"
	_ "github.com/vegidio/avif-go"
	_ "github.com/vegidio/heif-go"
	"github.com/vegidio/mediasim"
	"os"
	"time"
)

func main() {
	// Add support for AVIF and HEIC images
	mediasim.AddImageType(".avif", ".heic")

	cmd := buildCliCommands()

	if err := cmd.Run(context.Background(), os.Args); err != nil {
		// Give some time for the animations to stop before printing the error
		time.Sleep(250 * time.Millisecond)
		pterm.FgRed.Printf("\n🧨 %s\n", err.Error())
	}
}

func buildCliCommands() *cli.Command {
	var media []mediasim.Media
	var files []string
	var directory string
	var threshold float64
	var output string
	var recursive bool
	var frameFlip bool
	var frameRotate bool
	var mediaType string
	var ignoreErrors bool
	var err error

	return &cli.Command{
		Name:            "mediasim",
		Usage:           "a tool to calculate the similarity of images & videos",
		UsageText:       "mediasim <command> [-t <threshold>] [--if] [--ir] [-o <output>]",
		Version:         mediasim.Version,
		HideHelpCommand: true,
		Commands: []*cli.Command{
			{
				Name:      "files",
				Usage:     "compare two or more files",
				UsageText: "mediasim files <file1> <file2> [<file3> ...] ",
				Flags:     []cli.Flag{},
				Action: func(ctx context.Context, command *cli.Command) error {
					files = command.Args().Slice()

					if len(files) < 2 {
						return fmt.Errorf("at least two files must be specified")
					}

					files = lo.Map(files, func(file string, _ int) string {
						fullFile, _ := expandPath(file)
						return fullFile
					})

					media, err = compareFiles(files, frameFlip, frameRotate, output, ignoreErrors)
					if err != nil {
						return err
					}

					return nil
				},
			},
			{
				Name:      "dir",
				Usage:     "compare media in a directory",
				UsageText: "mediasim dir <directory> [-r] [--mt <media-type>]",
				Flags: []cli.Flag{
					&cli.BoolFlag{
						Name:        "recursive",
						Aliases:     []string{"r"},
						Usage:       "recursively search for files in the directory",
						Value:       false,
						DefaultText: "false",
						Destination: &recursive,
					},
					&cli.StringFlag{
						Name:        "media-type",
						Aliases:     []string{"mt"},
						Usage:       "type of media to compare; image | video | all",
						Value:       "all",
						DefaultText: "all",
						Destination: &mediaType,
						Validator: func(s string) error {
							if s != "image" && s != "video" && s != "all" {
								return fmt.Errorf("invalid media type")
							}

							return nil
						},
					},
				},
				Action: func(ctx context.Context, command *cli.Command) error {
					directory = command.Args().First()
					directory, err = expandPath(directory)
					if err != nil {
						return nil
					}

					media, err = compareDirectory(
						directory,
						recursive,
						frameFlip,
						frameRotate,
						mediaType,
						output,
						ignoreErrors,
					)

					if err != nil {
						return err
					}

					return nil
				},
			},
		},
		Flags: []cli.Flag{
			&cli.FloatFlag{
				Name:        "threshold",
				Aliases:     []string{"t"},
				Usage:       "similarity threshold; between 0-1",
				Value:       0.8,
				Destination: &threshold,
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
				Destination: &frameFlip,
			},
			&cli.BoolFlag{
				Name:        "frame-rotate",
				Aliases:     []string{"fr"},
				Usage:       "rotate the frame in 90º, 180º and 270º during comparison",
				Value:       false,
				DefaultText: "false",
				Destination: &frameRotate,
			},
			&cli.StringFlag{
				Name:        "output",
				Aliases:     []string{"o"},
				Usage:       "format how similarity is reported; report | json | csv",
				Value:       "report",
				DefaultText: "report",
				Destination: &output,
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
				Destination: &ignoreErrors,
			},
		},
		After: func(ctx context.Context, command *cli.Command) error {
			if len(media) == 0 {
				return nil
			}

			comparisons := calculateSimilarity(media, threshold, output)

			switch output {
			case "report":
				printComparisonReport(comparisons)
			case "json":
				printComparisonJson(comparisons)
			case "csv":
				printComparisonCsv(comparisons)
			}

			return nil
		},
		Action: func(ctx context.Context, command *cli.Command) error {
			return fmt.Errorf("either the command <files> or <dir> must be used")
		},
	}
}
