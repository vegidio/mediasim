package main

import (
	"cli/internal/charm"
	"context"
	"os"
	"shared"

	_ "github.com/vegidio/avif-go"
	"github.com/vegidio/go-sak/o11y"
	_ "github.com/vegidio/heif-go"
	"github.com/vegidio/mediasim"
)

func main() {
	otel := o11y.NewTelemetry(
		shared.OtelEndpoint,
		"mediasim",
		shared.Version,
		map[string]string{"Authorization": shared.OtelAuth},
		shared.OtelEnvironment,
		true,
	)

	defer otel.Close()

	// Remove leftover temp dirs from previous sessions (crash, force quit, etc.)
	shared.CleanupTempDirs()

	// Add support for AVIF and HEIC images
	mediasim.AddImageType(".avif", ".heic")

	cmd := buildCliCommands(otel)

	if err := cmd.Run(context.Background(), os.Args); err != nil {
		otel.LogError("Error running app", make(map[string]any), err)
		charm.PrintError("%s", err.Error())
	}
}
