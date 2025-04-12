package mediasim

import (
	"fmt"
	"github.com/vitali-fedulov/images4"
)

// Result is a generic struct that represents the result of an operation.
//
// Parameters:
//   - Data is a data of type T.
//   - Err is an error that indicates if the operation failed.
type Result[T any] struct {
	Data T
	Err  error
}

// Media represents a media object.
type Media struct {
	// Name of the media.
	Name string
	// Type of the media (e.g., image, video).
	Type string
	// Frames is the array of frames of the media.
	Frames []images4.IconT
}

// Similarity represents a similarity score for a media object.
type Similarity struct {
	// Name of the media being compared.
	Name string `json:"name"`
	// Score is a number between 0 (not similar) and 1 (identical).
	Score float64 `json:"score"`
}

func (s Similarity) String() string {
	return fmt.Sprintf(`{Name: %s, Score: %.8f}`, s.Name, s.Score)
}

// Comparison represents a comparison of a media with another media.
type Comparison struct {
	// Name is the name of the media being compared.
	Name string `json:"name"`
	// Similarities is a list of similarity scores for the media being compared with this media.
	Similarities []Similarity `json:"similarities"`
}

func (c Comparison) String() string {
	return fmt.Sprintf(`{Name: %s, Similarities: %v}`, c.Name, c.Similarities)
}
