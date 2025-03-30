package mediasim

import (
	"github.com/vitali-fedulov/images4"
	"math"
)

const MaxDifference = 2804

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

			similarity := calculateSimilarity(media[i].Image, media[j].Image)

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
			comparisons = append(comparisons, Comparison{
				Name:         media[i].Name,
				Similarities: similarities,
			})
		}
	}

	return comparisons
}

func calculateSimilarity(image1, image2 images4.IconT) float64 {
	m1, m2, m3 := images4.EucMetric(image1, image2)
	difference := math.Sqrt(m1+m2/2+m3/2) / MaxDifference
	return 1 - difference
}
