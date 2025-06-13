package mediasim

import (
	"fmt"
	"github.com/vitali-fedulov/images4"
)

// Result is a generic struct that represents the result of an operation.
//
// Parameters:
//   - Data is data of type T.
//   - Err is an error that indicates if the operation failed.
type Result[T any] struct {
	Data T
	Err  error
}

// IsSuccess returns true if the operation was successful (no error occurred), false otherwise.
func (r *Result[T]) IsSuccess() bool {
	return r.Err == nil
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

type Group struct {
	Name string `json:"name"`
}

func (g Group) String() string {
	return fmt.Sprintf(`{Name: %s}`, g.Name)
}
