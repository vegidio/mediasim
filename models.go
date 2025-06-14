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
	// Frames contain the image data of the media.
	Frames []images4.IconT
	// Width represents the width of the media in pixels.
	Width int
	// Height represents the height of the media in pixels.
	Height int
	// Size represents the size of the media file in bytes.
	Size int64
	// Length represents the duration of the media in seconds (for images this is always 0)
	Length int
}

type Group struct {
	Name string `json:"name"`
}

func (g Group) String() string {
	return fmt.Sprintf(`{Name: %s}`, g.Name)
}
