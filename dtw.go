package mediasim

import "math"

type Pair struct {
	I, J int
}

func min3(a, b, c float64) float64 {
	if a <= b && a <= c {
		return a
	} else if b <= a && b <= c {
		return b
	}
	return c
}

func dtw(input [][]float64) (float64, []Pair) {
	n := len(input)
	if n == 0 {
		return 0, nil
	}
	m := len(input[0])

	// Create and initialize the cumulative cost matrix with Inf.
	matrix := make([][]float64, n)
	for i := 0; i < n; i++ {
		matrix[i] = make([]float64, m)
		for j := 0; j < m; j++ {
			matrix[i][j] = math.Inf(1)
		}
	}
	matrix[0][0] = input[0][0]

	// Initialize first column and first row.
	for i := 1; i < n; i++ {
		matrix[i][0] = input[i][0] + matrix[i-1][0]
	}
	for j := 1; j < m; j++ {
		matrix[0][j] = input[0][j] + matrix[0][j-1]
	}

	// Populate rest of the cumulative cost matrix.
	for i := 1; i < n; i++ {
		for j := 1; j < m; j++ {
			matrix[i][j] = input[i][j] + min3(matrix[i-1][j], matrix[i][j-1], matrix[i-1][j-1])
		}
	}

	// Backtracking to determine the optimal warping path.
	i, j := n-1, m-1
	path := []Pair{{i, j}}
	for i > 0 || j > 0 {
		if i == 0 {
			j--
		} else if j == 0 {
			i--
		} else if matrix[i-1][j-1] <= matrix[i-1][j] && matrix[i-1][j-1] <= matrix[i][j-1] {
			i--
			j--
		} else if matrix[i-1][j] < matrix[i][j-1] {
			i--
		} else {
			j--
		}
		path = append(path, Pair{i, j})
	}

	// Reverse the path.
	for l, r := 0, len(path)-1; l < r; l, r = l+1, r-1 {
		path[l], path[r] = path[r], path[l]
	}

	return matrix[n-1][m-1], path
}
