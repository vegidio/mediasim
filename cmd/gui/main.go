package main

import (
	"embed"
	_ "embed"
	"gui/services"
	"log"
	"log/slog"
	"net/http"
	"shared"

	_ "github.com/vegidio/avif-go"
	_ "github.com/vegidio/heif-go"
	"github.com/vegidio/mediasim"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Add support for AVIF and HEIC images
	mediasim.AddImageType(".avif", ".heic")

	// Remove leftover temp dirs from previous sessions (crash, force quit, etc.)
	shared.CleanupTempDirs()

	// Create services needed before app init for middleware.
	streamerService := &services.Streamer{}
	thumbService := &services.ThumbnailService{}

	// Create a new Wails application by providing the necessary options.
	app := application.New(application.Options{
		Name:        "MediaSim",
		Description: "A tool to calculate the similarity of images & videos.",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			Middleware: func(next http.Handler) http.Handler {
				return services.NewThumbMiddleware(thumbService)(
					services.NewHlsMiddleware(streamerService)(next),
				)
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		LogLevel: slog.LevelError,
	})

	// Register services
	app.RegisterService(application.NewService(&services.AppService{}))
	app.RegisterService(application.NewService(&services.MediaService{}))
	app.RegisterService(application.NewService(&services.ComparisonService{}))
	app.RegisterService(application.NewService(thumbService))
	app.RegisterService(application.NewService(streamerService))

	// Create a new window with the necessary options.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:      "MediaSim",
		StartState: application.WindowStateMaximised,
		MinWidth:   1280,
		MinHeight:  720,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHidden,
		},
		URL: "/",
	})

	// Run the application. This blocks until the application exists
	err := app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatalf("%+v", err)
	}
}
