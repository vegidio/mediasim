package mediasim

import (
	"fmt"

	"github.com/vitali-fedulov/images4"
)

type frames struct {
	framesOriginal   []images4.IconT
	framesFlippedV   []images4.IconT
	framesFlippedH   []images4.IconT
	framesRotated90  []images4.IconT
	framesRotated180 []images4.IconT
	framesRotated270 []images4.IconT
}

// Media represents a media object.
type Media struct {
	frames

	// Name of the media.
	Name string `json:"name"`
	// Type of the media (e.g., image, video).
	Type string `json:"type"`
	// Width represents the width of the media in pixels.
	Width int `json:"width"`
	// Height represents the height of the media in pixels.
	Height int `json:"height"`
	// Size represents the size of the media file in bytes.
	Size int64 `json:"size"`
	// Length represents the duration of the media in seconds (for images this is always 0)
	Length int `json:"length"`
}

func (m Media) String() string {
	return fmt.Sprintf(`{Name: %s, Type: %s, Width: %d, Height: %d, Size: %d, Length: %d}`,
		m.Name, m.Type, m.Width, m.Height, m.Size, m.Length)
}

func (m Media) Equal(other Media) bool {
	return m.Name == other.Name &&
		m.Type == other.Type &&
		m.Width == other.Width &&
		m.Height == other.Height &&
		m.Size == other.Size &&
		m.Length == other.Length
}
