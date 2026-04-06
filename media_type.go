package mediasim

import (
	"shared"
	"strings"
)

// AddImageType adds one or more image type extensions to the list of valid image types.
func AddImageType(types ...string) {
	for _, t := range types {
		shared.ValidImageTypes = append(shared.ValidImageTypes, strings.ToLower(t))
	}
}

// AddVideoType adds one or more video type extensions to the list of valid video types.
func AddVideoType(types ...string) {
	for _, t := range types {
		shared.ValidVideoTypes = append(shared.ValidVideoTypes, strings.ToLower(t))
	}
}
