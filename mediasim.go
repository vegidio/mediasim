package mediasim

import (
	"github.com/samber/lo"
	"github.com/vitali-fedulov/images4"
	"math"
)

const Version = "<version>"

func CalculateSimilarity(media1, media2 Media) float64 {
	if media1.Type == "image" && media2.Type == "image" {
		return calculateImageSimilarity(media1.Frames[0], media2.Frames)
	} else if media1.Type == "video" && media2.Type == "video" {
		return calculateVideoSimilarity(media1.Frames, media2.Frames)
	} else {
		return 0.0
	}
}

func GroupMedia(media []Media, threshold float64) [][]Group {
	groups := make([][]Group, 0)
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

	groupsMap := make(map[int][]string)
	for idx, m := range media {
		root := dsu.Find(idx)
		groupsMap[root] = append(groupsMap[root], m.Name)
	}

	for _, v := range groupsMap {
		if len(v) >= 2 {
			group := lo.Map(v, func(name string, _ int) Group {
				return Group{
					Name: name,
				}
			})

			groups = append(groups, group)
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
