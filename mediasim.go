package mediasim

import (
	"github.com/vitali-fedulov/images4"
	"math"
)

const MaxDifference = 2804

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
