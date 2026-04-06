package mediasim

import (
	. "github.com/vegidio/go-sak/types"
	"github.com/vegidio/mediasim/internal/dsu"
)

// LoadAndGroupResult represents a progress update from the single-pass load-and-group operation.
type LoadAndGroupResult struct {
	// Media is the item just loaded (nil on error or final message).
	Media *Media
	// Loaded is the number of items successfully loaded so far.
	Loaded int
	// Err is non-nil if this item had a loading error.
	Err error
	// Done is true on the final message; Groups will be populated.
	Done bool
	// Groups contains the final grouped result, only populated when Done is true.
	Groups [][]Media
}

// LoadAndGroupMedia performs media loading and similarity grouping in a single pass.
//
// As each media item arrives from the input channel, it is immediately compared against all previously loaded items.
// Matches (similarity >= threshold) are unioned in a DSU. When the channel closes, groups are extracted.
//
// # Parameters:
//   - channel: A channel of Result[Media] from LoadMediaFromFiles or LoadMediaFromDirectory.
//   - total: The expected total number of items (used for DSU pre-allocation).
//   - threshold: Similarity threshold (0.0–1.0) for merging two media items.
//   - ignoreErrors: If true, loading errors are skipped; if false, the first error terminates processing.
//
// # Returns:
//   - A channel of LoadAndGroupResult messages reporting progress and the final result.
func LoadAndGroupMedia(
	channel <-chan Result[Media],
	total int,
	threshold float64,
	ignoreErrors bool,
) <-chan LoadAndGroupResult {
	out := make(chan LoadAndGroupResult)

	go func() {
		defer close(out)

		media := make([]Media, 0, total)
		d := dsu.NewDSU(total)

		for r := range channel {
			if r.Err != nil {
				if ignoreErrors {
					out <- LoadAndGroupResult{Err: r.Err}
					continue
				}

				out <- LoadAndGroupResult{Err: r.Err, Done: true}
				return
			}

			m := r.Data
			i := len(media)
			media = append(media, m)

			// Compare against all previously loaded items.
			for j := range i {
				if CalculateSimilarity(media[j], m) >= threshold {
					d.Union(i, j)
				}
			}

			out <- LoadAndGroupResult{
				Media:  &media[i],
				Loaded: len(media),
			}
		}

		groups := extractGroups(media, d)
		out <- LoadAndGroupResult{
			Done:   true,
			Groups: groups,
		}
	}()

	return out
}
