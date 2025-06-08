package main

import (
	"cli/internal/charm"
	"context"
	_ "github.com/vegidio/avif-go"
	_ "github.com/vegidio/heif-go"
	"github.com/vegidio/mediasim"
	"os"
)

func main() {
	// Add support for AVIF and HEIC images
	mediasim.AddImageType(".avif", ".heic")

	cmd := buildCliCommands()

	if err := cmd.Run(context.Background(), os.Args); err != nil {
		charm.PrintError(err.Error())
	}
}
