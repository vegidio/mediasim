package main

import (
	"context"
	"fmt"
	"github.com/pterm/pterm"
	"github.com/urfave/cli/v3"
	"github.com/vegidio/mediasim"
	"os"
)

func main() {
	var media []mediasim.Media
	var files []string
	var directory string
	var threshold float64
	var output string
	var recursive bool
	var mediaType string

	cmd := &cli.Command{
		Name:            "mediasim",
		Usage:           "a tool to calculate the similarity between images/videos",
		UsageText:       "mediasim [-f <media1>,<media2> ...] [-d <directory>] [-t <threshold>]",
		HideHelpCommand: true,
		Flags: []cli.Flag{
			&cli.StringSliceFlag{
				Name:        "files",
				Aliases:     []string{"f"},
				Usage:       "compare two or more files",
				Destination: &files,
				Validator: func(v []string) error {
					if len(v) < 2 {
						return fmt.Errorf("at least two files must be specified")
					}

					return nil
				},
				Action: func(ctx context.Context, command *cli.Command, v []string) error {
					m, err := compareFiles(files, threshold, output)
					media = m
					return err
				},
			},
			&cli.StringFlag{
				Name:    "dir",
				Aliases: []string{"d"},
				Usage:   "compare media in a directory",
				Validator: func(path string) error {
					fullDir, err := expandPath(path)
					if err != nil {
						return fmt.Errorf("directory path %s is invalid", directory)
					}

					directory = fullDir
					return nil
				},
				Action: func(ctx context.Context, command *cli.Command, _ string) error {
					m, err := compareDirectory(directory, recursive, mediaType, output)
					media = m
					return err
				},
			},
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
		},
		Action: func(ctx context.Context, command *cli.Command) error {
			if directory == "" && len(files) == 0 {
				return fmt.Errorf("either the --dir/-d or --files/-f parameters must be specified")
			}

			comparisons := calculateSimilarity(media, threshold, output)

			switch output {
			case "report":
				printComparisonReport(comparisons)
			case "json":
				printComparisonJson(comparisons)
			case "csv":
				printComparisonSingle(comparisons)
			}

			return nil
		},
	}

	if err := cmd.Run(context.Background(), os.Args); err != nil {
		pterm.FgRed.Printf("\n🧨 %s\n", err.Error())
	}
}
