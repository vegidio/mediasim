package charm

import "time"

func calculateETA(total, completed int, elapsed time.Duration) time.Duration {
	// Validate inputs
	if total <= 0 || completed <= 0 || elapsed <= 0 {
		return time.Duration(7 * 24 * time.Hour)
	}

	// Nothing to do
	if completed >= total {
		return 0
	}

	remaining := total - completed
	avgPerTask := elapsed / time.Duration(completed)
	eta := avgPerTask * time.Duration(remaining)

	return eta
}
