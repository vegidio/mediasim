package mediasim

import (
	"github.com/vitali-fedulov/images4"
	"math"
	"slices"
)

const Version = "<version>"

// CalculateSimilarity computes a similarity score between two Media objects.
// Returns a value between 0 and 1, where higher values indicate greater similarity.
func CalculateSimilarity(media1, media2 Media) float64 {
	if media1.Type == "image" && media2.Type == "image" {
		return calculateImageSimilarity(media1.Frames[0], media2.Frames)
	} else if media1.Type == "video" && media2.Type == "video" {
		return calculateVideoSimilarity(media1.Frames, media2.Frames)
	} else {
		return 0.0
	}
}

// GroupMedia organizes a list of media objects into groups based on a similarity threshold.
// It uses a Disjoint Set Union (DSU) to cluster media items whose pairwise similarity
// score meets or exceeds the given threshold. Within each group (of at least two items),
// media are sorted by quality, prioritizing length, then resolution, then file size.
//
// # Parameters:
//   - media: []Media Slice of Media objects to be grouped.
//   - threshold: float64 Similarity threshold (0.0–1.0) for merging two media items.
//
// # Returns:
//   - [][]Media A two-dimensional slice where each inner slice represents a group of media items (minimum length of 2),
//     sorted by quality descending.
func GroupMedia(media []Media, threshold float64) [][]Media {
	groups := make([][]Media, 0)
	size := len(media)
	dsu := NewDSU(size)

	for i := 0; i < size; i++ {
		for j := i + 1; j < size; j++ {
			similarity := CalculateSimilarity(media[i], media[j])
			if similarity >= threshold {
				dsu.Union(i, j)
			}
		}
	}

	groupsMap := make(map[int][]Media)
	for idx, m := range media {
		root := dsu.Find(idx)
		groupsMap[root] = append(groupsMap[root], m)
	}

	for _, m := range groupsMap {
		if len(m) >= 2 {
			// Sort the media keeping the one with the "best" quality first.
			// The best media are the videos highest number of megapixels and the biggest length (if it's a video).
			slices.SortFunc(m, func(a, b Media) int {
				if a.Length != b.Length {
					return b.Length - a.Length
				}

				mp1 := a.Width * a.Height
				mp2 := b.Width * b.Height
				if mp1 != mp2 {
					return mp2 - mp1
				}

				return int(b.Size - a.Size)
			})

			groups = append(groups, m)
		}
	}

	return groups
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
		// not so important to calculate the similarity, that's why their values have half the weight of lumen.
		difference := math.Sqrt(m1+m2/2+m3/2) / MaxDifference
		similarity = max(similarity, 1-difference)
	}

	return similarity
}

func calculateVideoSimilarity(frames1, frames2 []images4.IconT) float64 {
	matrix := make([][]float64, len(frames1))

	// Dynamic Time Warping (DTW) is used to measure the similarity of videos. It does that by creating a matrix
	// measuring the image similarity of every frame with the other frames of the opposing video and calculating the
	// shortest path to traverse the matrix.
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
