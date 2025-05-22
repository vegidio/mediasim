package main

import (
	"context"
	"github.com/pterm/pterm"
	"time"
)

var spinnerText = ""
var spinnerNumber = 0
var spinnerSequence = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}
var spinnerArea *pterm.AreaPrinter

func createSpinner(text string, number int) context.CancelFunc {
	spinnerText = text
	spinnerNumber = number
	ctx, cancel := context.WithCancel(context.Background())

	spinnerArea, _ = pterm.DefaultArea.Start()
	go startSpinner(ctx)

	return cancel
}

func startSpinner(ctx context.Context) {
	counter := 0
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			spinnerArea.Update(pterm.Sprintf("%s %s %s %s", spinnerText, pterm.FgRed.Sprintf("■"), pterm.Bold.Sprintf("%d", spinnerNumber), "Media analysed"))
			spinnerArea.Stop()
			pterm.Println()
			return
		case <-ticker.C:
			spin := pterm.FgRed.Sprintf(spinnerSequence[counter%len(spinnerSequence)])

			if spinnerNumber == 0 {
				spinnerArea.Update(pterm.Sprintf("%s %s", spinnerText, spin))
			} else {
				spinnerArea.Update(pterm.Sprintf("%s %s %s", spinnerText, spin, pterm.Bold.Sprintf("%d", spinnerNumber)))
			}

			counter++
			if counter == len(spinnerSequence) {
				counter = 0
			}
		}
	}
}

func updateSpinner(text string, number int) {
	spinnerText = text
	spinnerNumber = number
}
