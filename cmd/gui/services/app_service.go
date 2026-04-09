package services

import (
	"context"
	"shared"

	"github.com/vegidio/go-sak/github"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type AppService struct{}

func (a *AppService) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

func (a *AppService) ServiceShutdown() error {
	return nil
}

func (a *AppService) Version() string {
	return shared.Version
}

func (a *AppService) IsOutdated() bool {
	return github.IsOutdatedRelease("vegidio", "mediasim", shared.Version)
}
