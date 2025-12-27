package main

import (
	"cli/internal"
	"cli/internal/charm"
	"context"
	"os"

	_ "github.com/vegidio/avif-go"
	"github.com/vegidio/go-sak/o11y"
	_ "github.com/vegidio/heif-go"
	"github.com/vegidio/mediasim"
)

func main() {
	tel := o11y.NewTelemetry(internal.OtelEndpoint, "mediasim", internal.Version, internal.OtelEnvironment, true)
	defer tel.Close()

	// Add support for AVIF and HEIC images
	mediasim.AddImageType(".avif", ".heic")

	cmd := buildCliCommands(tel)

	if err := cmd.Run(context.Background(), os.Args); err != nil {
		tel.LogError("Error running app", make(map[string]any), err)
		charm.PrintError(err.Error())
	}
}
