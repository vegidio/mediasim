package charm

import (
	"fmt"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/vegidio/mediasim"
	"strings"
)

type spinnerDoneMsg struct {
	groups [][]mediasim.Group
}

func compareCmd(media []mediasim.Media, threshold float64) tea.Cmd {
	return func() tea.Msg {
		groups := mediasim.GroupMedia(media, threshold)
		return spinnerDoneMsg{groups}
	}
}

type spinnerModel struct {
	spinner   spinner.Model
	media     []mediasim.Media
	threshold float64
	groups    [][]mediasim.Group
	text      string
}

func initSpinnerModel(media []mediasim.Media, threshold float64, message string) *spinnerModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = pink

	str := fmt.Sprintf("%.5f", threshold)
	str = strings.TrimRight(strings.TrimRight(str, "0"), ".")
	msg := fmt.Sprintf(message, yellow.Render(str))

	return &spinnerModel{
		spinner:   s,
		media:     media,
		threshold: threshold,
		text:      msg,
	}
}

func (m *spinnerModel) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		compareCmd(m.media, m.threshold),
	)
}

func (m *spinnerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msgValue := msg.(type) {
	case spinner.TickMsg:
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd

	case spinnerDoneMsg:
		m.groups = msgValue.groups
		return m, tea.Quit

	case tea.KeyMsg:
		switch msgValue.String() {
		case "ctrl+c":
			return m, tea.Quit
		}
	}

	return m, cmd
}

func (m *spinnerModel) View() string {
	return fmt.Sprintf("\n%s %s\n", m.text, m.spinner.View())
}

func StartSpinner(media []mediasim.Media, threshold float64, message string) [][]mediasim.Group {
	model, _ := tea.NewProgram(initSpinnerModel(media, threshold, message)).Run()
	m := model.(*spinnerModel)
	return m.groups
}
