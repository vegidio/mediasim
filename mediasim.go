package mediasim

import (
	"github.com/vitali-fedulov/images4"
	"math"
	"slices"
)

// CompareMedia compares media items based on a similarity threshold. It returns a list of comparisons where each
// comparison contains media items that are similar to each other.
//
// Parameters:
//   - media: an array of Media items to be compared.
//   - threshold: a float64 value representing the similarity threshold.
//
// Returns:
//   - An array of Comparison containing media items that are similar to each other.
func CompareMedia(media []Media, threshold float64) []Comparison {
	comparisons := make([]Comparison, 0)
	compared := make([]bool, len(media))

	for i := 0; i < len(media); i++ {
		if compared[i] {
			continue
		}

		similarities := make([]Similarity, 0)

		for j := i + 1; j < len(media); j++ {
			if compared[j] {
				continue
			}

			var similarity float64

			if media[i].Type == "image" && media[j].Type == "image" {
				similarity = calculateImageSimilarity(media[i].Frames[0], media[j].Frames[0])
			} else if media[i].Type == "video" && media[j].Type == "video" {
				similarity = calculateVideoSimilarity(media[i].Frames, media[j].Frames)
			} else {
				continue
			}

			if similarity >= threshold {
				similarities = append(similarities, Similarity{
					Name:  media[j].Name,
					Score: similarity,
				})

				compared[i] = true
				compared[j] = true
			}
		}

		if len(similarities) > 0 {
			// Sort the similarities in descending order
			slices.SortFunc(similarities, func(a, b Similarity) int {
				if a.Score > b.Score {
					return -1
				} else if a.Score < b.Score {
					return 1
				}
				return 0
			})

			comparisons = append(comparisons, Comparison{
				Name:         media[i].Name,
				Similarities: similarities,
			})
		}
	}

	return comparisons
}

// region - Private functions

func calculateImageSimilarity(frame1, frame2 images4.IconT) float64 {
	const MaxDifference = 2804

	m1, m2, m3 := images4.EucMetric(frame1, frame2)
	difference := math.Sqrt(m1+m2/2+m3/2) / MaxDifference
	return 1 - difference
}

func calculateVideoSimilarity(frames1, frames2 []images4.IconT) float64 {
	matrix := make([][]float64, len(frames1))

	iLength := len(frames1)
	jLength := len(frames2)
	maxValue := math.Max(float64(iLength), float64(jLength))

	for i := 0; i < iLength; i++ {
		for j := 0; j < jLength; j++ {
			similarity := calculateImageSimilarity(frames1[i], frames2[j])
			matrix[i] = append(matrix[i], similarity)
		}
	}

	distance, _ := dtw(matrix)
	return distance / maxValue
}

// endregion
