package charm

import (
	"fmt"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/vegidio/mediasim"
	"strings"
)

type spinnerDoneMsg struct{}

type compareMsg struct {
	result mediasim.Comparison
}

func compareCmd(ch <-chan mediasim.Comparison) tea.Cmd {
	return func() tea.Msg {
		if result, ok := <-ch; ok {
			return compareMsg{result}
		}

		return spinnerDoneMsg{}
	}
}

type spinnerModel struct {
	spinner     spinner.Model
	result      <-chan mediasim.Comparison
	comparisons []mediasim.Comparison
	text        string
}

func initSpinnerModel(result <-chan mediasim.Comparison, threshold float64) *spinnerModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = pink

	str := fmt.Sprintf("%.5f", threshold)
	str = strings.TrimRight(strings.TrimRight(str, "0"), ".")
	msg := fmt.Sprintf("🔎 Grouping media with at least %s similarity threshold...", yellow.Render(str))

	return &spinnerModel{
		spinner:     s,
		result:      result,
		comparisons: make([]mediasim.Comparison, 0),
		text:        msg,
	}
}

func (m *spinnerModel) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		compareCmd(m.result),
	)
}

func (m *spinnerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd

	switch msgValue := msg.(type) {
	case spinner.TickMsg:
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd

	case compareMsg:
		result := msgValue.result
		m.comparisons = append(m.comparisons, result)
		return m, compareCmd(m.result)

	case spinnerDoneMsg:
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

func StartSpinner(result <-chan mediasim.Comparison, threshold float64) []mediasim.Comparison {
	model, _ := tea.NewProgram(initSpinnerModel(result, threshold)).Run()
	m := model.(*spinnerModel)
	return m.comparisons
}
