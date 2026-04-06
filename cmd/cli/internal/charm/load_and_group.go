package charm

import (
	"fmt"
	"strconv"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/vegidio/go-sak/types"
	"github.com/vegidio/mediasim"
)

type lagUpdateMsg struct {
	update mediasim.LoadAndGroupResult
}

type lagDoneMsg struct{}

func lagReadCmd(ch <-chan mediasim.LoadAndGroupResult) tea.Cmd {
	return func() tea.Msg {
		if update, ok := <-ch; ok {
			return lagUpdateMsg{update}
		}

		return lagDoneMsg{}
	}
}

type loadAndGroupModel struct {
	progress      progress.Model
	updateCh      <-chan mediasim.LoadAndGroupResult
	total         int
	loaded        int
	groups        [][]mediasim.Media
	err           error
	startTime     time.Time
	lastEtaUpdate time.Time
	eta           time.Duration
}

func (m *loadAndGroupModel) Init() tea.Cmd {
	if m.total == 0 {
		return tea.Quit
	}

	return tea.Batch(
		tickCmd(),
		lagReadCmd(m.updateCh),
	)
}

func (m *loadAndGroupModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msgValue := msg.(type) {
	case tickMsg:
		if m.progress.Percent() >= 1 && !m.progress.IsAnimating() {
			return m, tea.Quit
		}

		var percent float64
		if m.total > 0 {
			percent = float64(m.loaded) / float64(m.total)
		}

		barCmd := m.progress.SetPercent(percent)
		return m, tea.Batch(tickCmd(), barCmd)

	case lagUpdateMsg:
		update := msgValue.update

		if update.Done {
			if update.Err != nil {
				m.err = update.Err
				return m, tea.Quit
			}

			m.groups = update.Groups
			barCmd := m.progress.SetPercent(1)
			m.eta = time.Duration(0)
			return m, barCmd
		}

		if update.Err != nil {
			// ignoreErrors mode: skip this item
			return m, lagReadCmd(m.updateCh)
		}

		m.loaded = update.Loaded
		return m, lagReadCmd(m.updateCh)

	case lagDoneMsg:
		barCmd := m.progress.SetPercent(1)
		m.eta = time.Duration(0)
		return m, barCmd

	case progress.FrameMsg:
		updated, cmd := m.progress.Update(msg)
		if p, ok := updated.(progress.Model); ok {
			m.progress = p
		}
		return m, cmd

	case tea.KeyMsg:
		switch msgValue.String() {
		case "ctrl+c":
			return m, tea.Quit
		}
	}

	return m, nil
}

func (m *loadAndGroupModel) View() string {
	width := len(strconv.Itoa(m.total))

	percent := m.progress.Percent() * 100
	intPart := int(percent)
	fracPart := int(percent*10) % 10
	percentStr := fmt.Sprintf("%3d.%1d%%", intPart, fracPart)

	now := time.Now()
	if now.Sub(m.lastEtaUpdate) >= time.Second {
		elapsed := time.Since(m.startTime)
		m.eta = calculateETA(m.total, m.loaded, elapsed)
		m.lastEtaUpdate = now
	}

	c := bold.Render(fmt.Sprintf("%0*d", width, m.loaded))
	t := bold.Render(fmt.Sprintf("%d", m.total))

	eta := m.eta.Truncate(time.Second)
	if m.eta < 10*time.Second {
		eta = m.eta.Truncate(time.Second / 10)
	}

	return fmt.Sprintf("\nProcessing   %s%s%s%s%s  %s  %s   %s\n",
		gray.Render("["), c, gray.Render("/"), t, gray.Render("]"),
		m.progress.View(),
		green.Render(percentStr),
		magenta.Render(fmt.Sprintf("ETA %v", eta)),
	)
}

func initLoadAndGroupModel(updateCh <-chan mediasim.LoadAndGroupResult, total int) *loadAndGroupModel {
	p := progress.New(
		progress.WithDefaultGradient(),
		progress.WithoutPercentage(),
		progress.WithWidth(50),
	)

	return &loadAndGroupModel{
		progress:      p,
		updateCh:      updateCh,
		total:         total,
		startTime:     time.Now(),
		lastEtaUpdate: time.Now(),
		eta:           time.Duration(0),
	}
}

// StartLoadAndGroup runs a combined load-and-group operation with a progress bar TUI.
func StartLoadAndGroup(
	channel <-chan types.Result[mediasim.Media],
	total int,
	threshold float64,
	ignoreErrors bool,
) ([][]mediasim.Media, error) {
	updateCh := mediasim.LoadAndGroupMedia(channel, total, threshold, ignoreErrors)

	model, err := tea.NewProgram(initLoadAndGroupModel(updateCh, total)).Run()
	if err != nil {
		return nil, err
	}

	m, ok := model.(*loadAndGroupModel)
	if !ok {
		return nil, fmt.Errorf("unexpected model type from load-and-group program")
	}

	if m.err != nil {
		return nil, m.err
	}

	return m.groups, nil
}
