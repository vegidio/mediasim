package mediasim

import (
	"math"
	"slices"

	"github.com/vegidio/mediasim/internal/dsu"
	idtw "github.com/vegidio/mediasim/internal/dtw"
	"github.com/vitali-fedulov/images4"
)

// maxDifference is the maximum numeric difference when comparing two images:
// i.e., a completely white image compared to a completely black image.
const maxDifference = 2804

// CalculateSimilarity computes a similarity score between two Media objects.
// Returns a value between 0 and 1, where higher values indicate greater similarity.
func CalculateSimilarity(media1, media2 Media) float64 {
	frameGroup := slices.DeleteFunc([][]images4.IconT{
		media2.framesOriginal,
		media2.framesFlippedV,
		media2.framesFlippedH,
		media2.framesRotated90,
		media2.framesRotated180,
		media2.framesRotated270,
	}, func(f []images4.IconT) bool {
		return len(f) == 0
	})

	similarity := 0.0

	if media1.Type == "image" && media2.Type == "image" {
		for _, frames := range frameGroup {
			similarity = max(similarity, calculateImageSimilarity(media1.framesOriginal[0], frames[0]))
		}
	} else if media1.Type == "video" && media2.Type == "video" {
		for _, frames := range frameGroup {
			similarity = max(similarity, calculateVideoSimilarity(media1.framesOriginal, frames))
		}
	}

	return similarity
}

// GroupMedia organizes a list of media objects into groups based on a similarity threshold.
//
// It uses a Disjoint Set Union (DSU) to cluster media items whose pairwise similarity score meets or exceeds the given
// threshold. Within each group (of at least two items), media are sorted by quality, prioritizing length, then
// resolution, then file size.
//
// # Parameters:
//   - media: []Media Slice of Media objects to be grouped.
//   - threshold: float64 Similarity threshold (0.0–1.0) for merging two media items.
//
// # Returns:
//   - [][]Media A two-dimensional slice where each inner slice represents a group of media items (minimum length of 2),
//     sorted by quality descending.
func GroupMedia(media []Media, threshold float64) [][]Media {
	size := len(media)
	d := dsu.NewDSU(size)

	for i := 0; i < size; i++ {
		for j := i + 1; j < size; j++ {
			similarity := CalculateSimilarity(media[i], media[j])
			if similarity >= threshold {
				d.Union(i, j)
			}
		}
	}

	return extractGroups(media, d)
}

// extractGroups builds groups from a DSU, keeping only groups with 2+ items, sorted by quality.
func extractGroups(media []Media, d *dsu.DSU) [][]Media {
	groups := make([][]Media, 0)
	groupsMap := make(map[int][]Media)

	for idx, m := range media {
		root := d.Find(idx)
		groupsMap[root] = append(groupsMap[root], m)
	}

	for _, m := range groupsMap {
		if len(m) >= 2 {
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

func calculateImageSimilarity(frame1 images4.IconT, frame2 images4.IconT) float64 {
	m1, m2, m3 := images4.EucMetric(frame1, frame2)

	// m1 is the lumen, in other words, what makes easy to identify the form and shape in the image, so this value
	// is the most important doing the similarity comparison. The other values, m2 and m3, are the colors, which are
	// not so important to calculate the similarity, that's why their values have half the weight of lumen.
	difference := math.Sqrt(m1+m2/2+m3/2) / maxDifference

	return 1 - difference
}

func calculateVideoSimilarity(frames1, frames2 []images4.IconT) float64 {
	matrix := make([][]float64, len(frames1))

	// Dynamic Time Warping (DTW) is used to measure the similarity of videos. It does that by creating a matrix
	// measuring the image similarity of every frame with the other frames of the opposing video and calculating the
	// shortest path to traverse the matrix.
	for i, f1 := range frames1 {
		// Pre-allocate each row to avoid repeated append reallocations.
		matrix[i] = make([]float64, len(frames2))

		for j, f2 := range frames2 {
			// We are using the inverted similarity here (in other words, the difference) because DTW uses the shortest
			// path to traverse the matrix.
			matrix[i][j] = 1 - calculateImageSimilarity(f1, f2)
		}
	}

	distance, path := idtw.DTW(matrix)

	// After calculating the distance, we need to invert it again to get the similarity.
	return 1 - (distance / float64(len(path)))
}

// endregion
