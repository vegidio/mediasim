package mediasim

import "math"

type Pair struct {
	I, J int
}

func dtw(input [][]float64) (float64, []Pair) {
	n := len(input)
	if n == 0 {
		return 0, nil
	}
	m := len(input[0])

	// Initialize the cumulative input matrix with infinity
	matrix := make([][]float64, n)
	for i := range matrix {
		matrix[i] = make([]float64, m)
		for j := range matrix[i] {
			matrix[i][j] = math.Inf(1)
		}
	}
	matrix[0][0] = input[0][0]

	// Initialize the first column
	for i := 1; i < n; i++ {
		matrix[i][0] = input[i][0] + matrix[i-1][0]
	}

	// Initialize the first row
	for j := 1; j < m; j++ {
		matrix[0][j] = input[0][j] + matrix[0][j-1]
	}

	// Populate the rest of the cumulative cost matrix
	for i := 1; i < n; i++ {
		for j := 1; j < m; j++ {
			matrix[i][j] = input[i][j] + min(matrix[i-1][j], matrix[i][j-1], matrix[i-1][j-1])
		}
	}

	// Backtracking to determine the optimal warping path.
	i, j := n-1, m-1
	var path []Pair
	path = append(path, Pair{i, j})
	for i > 0 || j > 0 {
		if i == 0 {
			j--
		} else if j == 0 {
			i--
		} else {
			// Determine which neighbor has the minimum cost.
			up := matrix[i-1][j]
			left := matrix[i][j-1]
			diag := matrix[i-1][j-1]
			if diag <= up && diag <= left {
				i--
				j--
			} else if up < left {
				i--
			} else {
				j--
			}
		}
		path = append(path, Pair{i, j})
	}

	// Reverse the path so it starts from the beginning.
	for i, j = 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}

	return matrix[n-1][m-1], path
}
