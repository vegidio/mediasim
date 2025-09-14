package charm

import (
	"fmt"
	"strconv"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/vegidio/mediasim"
)

type tickMsg time.Time

func tickCmd() tea.Cmd {
	return tea.Tick(time.Second/10, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

type doneMsg struct{}

type loadMsg struct {
	result mediasim.Result[mediasim.Media]
}

func loadCmd(ch <-chan mediasim.Result[mediasim.Media]) tea.Cmd {
	return func() tea.Msg {
		if result, ok := <-ch; ok {
			return loadMsg{result}
		}

		return doneMsg{}
	}
}

type progressModel struct {
	progress      progress.Model
	result        <-chan mediasim.Result[mediasim.Media]
	media         []mediasim.Media
	total         int
	completed     int
	startTime     time.Time
	lastEtaUpdate time.Time
	eta           time.Duration
}

func (m *progressModel) Init() tea.Cmd {
	if m.total == 0 {
		return tea.Quit
	}

	return tea.Batch(
		tickCmd(),
		loadCmd(m.result),
	)
}

func (m *progressModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msgValue := msg.(type) {
	case tickMsg:
		if m.progress.Percent() >= 1 && !m.progress.IsAnimating() {
			return m, tea.Quit
		}

		var percent float64
		if m.total > 0 {
			percent = float64(m.completed) / float64(m.total)
		}

		barCmd := m.progress.SetPercent(percent)
		return m, tea.Batch(tickCmd(), barCmd)

	case loadMsg:
		result := msgValue.result
		if result.IsSuccess() {
			m.media = append(m.media, result.Data)
		}

		m.completed++
		return m, loadCmd(m.result)

	case doneMsg:
		barCmd := m.progress.SetPercent(1)
		m.eta = time.Duration(0)
		return m, barCmd

	case progress.FrameMsg:
		updated, cmd := m.progress.Update(msg)
		m.progress = updated.(progress.Model)
		return m, cmd

	case tea.KeyMsg:
		switch msgValue.String() {
		case "ctrl+c":
			return m, tea.Quit
		}
	}

	return m, nil
}

func (m *progressModel) View() string {
	width := len(strconv.Itoa(m.total))

	percent := m.progress.Percent() * 100
	intPart := int(percent)
	fracPart := int(percent*10) % 10
	percentStr := fmt.Sprintf("%3d.%1d%%", intPart, fracPart)

	now := time.Now()
	if now.Sub(m.lastEtaUpdate) >= time.Second {
		elapsed := time.Since(m.startTime)
		m.eta = calculateETA(m.total, m.completed, elapsed)
		m.lastEtaUpdate = now
	}

	c := bold.Render(fmt.Sprintf("%0*d", width, m.completed))
	t := bold.Render(fmt.Sprintf("%d", m.total))

	eta := m.eta.Truncate(time.Second)
	if m.eta < 10*time.Second {
		eta = m.eta.Truncate(time.Second / 10)
	}

	return fmt.Sprintf("\nLoading   %s%s%s%s%s  %s  %s   %s\n",
		gray.Render("["), c, gray.Render("/"), t, gray.Render("]"),
		m.progress.View(),
		green.Render(percentStr),
		magenta.Render(fmt.Sprintf("ETA %v", eta)),
	)
}

func initProgressModel(result <-chan mediasim.Result[mediasim.Media], total int) *progressModel {
	p := progress.New(
		progress.WithDefaultGradient(),
		progress.WithoutPercentage(),
		progress.WithWidth(50),
	)

	return &progressModel{
		progress:      p,
		result:        result,
		media:         make([]mediasim.Media, 0),
		total:         total,
		startTime:     time.Now(),
		lastEtaUpdate: time.Now(),
		eta:           time.Duration(0),
	}
}

func StartProgress(result <-chan mediasim.Result[mediasim.Media], total int) ([]mediasim.Media, error) {
	model, err := tea.NewProgram(initProgressModel(result, total)).Run()
	if err != nil {
		return nil, err
	}

	m := model.(*progressModel)
	return m.media, nil
}
