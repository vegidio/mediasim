package mediasim

import (
	"github.com/vitali-fedulov/images4"
	"math"
	"slices"
)

const Version = "<version>"

// CompareMedia compares media files based on a similarity threshold. It returns a list of comparisons where each
// comparison contains media files that are similar to each other.
//
// # Parameters:
//   - media: an array of Media files to be compared.
//   - threshold: a float64 value representing the similarity threshold.
//
// # Returns:
//   - <-chan Comparison: a channel that provides Comparison objects containing information about similar media files.
func CompareMedia(media []Media, threshold float64) <-chan Comparison {
	out := make(chan Comparison)

	go func() {
		defer close(out)
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
					similarity = calculateImageSimilarity(media[i].Frames[0], media[j].Frames)
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

				out <- Comparison{
					Name:         media[i].Name,
					Similarities: similarities,
				}
			}
		}
	}()

	return out
}

// region - Private functions

func calculateImageSimilarity(frame1 images4.IconT, frames2 []images4.IconT) float64 {
	// This constant is the maximum numeric difference when comparing two images:
	// i.e., a completely white image compared to a completely black image.
	const MaxDifference = 2804

	similarity := 0.0

	// Even though we are comparing two images, frames2 can have more than one frame if we are also comparing the
	// flipped and rotated versions of the same image.
	for _, frame2 := range frames2 {
		m1, m2, m3 := images4.EucMetric(frame1, frame2)

		// m1 is the lumen, in other words, what makes easy to identify the form and shape in the image, so this value
		// is the most important doing the similarity comparison. The other values, m2 and m3, are the colors, which are
		// not so important to calculate the similarity, that's why their values are divided by 2.
		difference := math.Sqrt(m1+m2/2+m3/2) / MaxDifference
		similarity = max(similarity, 1-difference)
	}

	return similarity
}

func calculateVideoSimilarity(frames1, frames2 []images4.IconT) float64 {
	matrix := make([][]float64, len(frames1))

	for i := 0; i < len(frames1); i++ {
		for j := 0; j < len(frames2); j++ {
			similarity := calculateImageSimilarity(frames1[i], []images4.IconT{frames2[j]})
			matrix[i] = append(matrix[i], similarity)
		}
	}

	distance, path := dtw(matrix)
	return distance / float64(len(path))
}

// endregion
