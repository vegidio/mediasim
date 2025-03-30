package mediasim

import (
	"fmt"
	"github.com/vitali-fedulov/images4"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
)

var ValidFileTypes = []string{".jpg", ".jpeg", ".png", ".gif"}

// LoadMediaFromImage creates a Media object from the given image or video.
//
// Parameters:
//   - name: The name of the media.
//   - img: The image to be converted into a Media object.
//
// Returns:
//   - A Media object containing the name and the converted image.
func LoadMediaFromImage(name string, img image.Image) Media {
	return Media{
		Name:  name,
		Image: images4.Icon(img),
	}
}

// LoadMediaFromFile loads a Media object from the given file path.
//
// Parameters:
//   - filePath: The path to the image file or video.
//
// Returns:
//   - A pointer to a Media object containing the name and the converted image.
//   - An error if there is an issue opening or decoding the file.
func LoadMediaFromFile(filePath string) (*Media, error) {
	file, err := os.Open(filePath)
	if err != nil {
		fmt.Println("Error opening image:", err)
		return nil, err
	}

	defer file.Close()

	img, _, err := image.Decode(file)
	if err != nil {
		fmt.Println("Error decoding image:", err)
		return nil, err
	}

	media := LoadMediaFromImage(filePath, img)
	return &media, nil
}

// LoadMediaFromDirectory loads Media objects from all files in the given directory.
//
// Parameters:
//   - directory: The path to the directory containing the files.
//   - parallel: The number of files to process in parallel.
//
// Returns:
//   - A channel that will receive Media objects for each valid file processed.
//   - An error if there is an issue reading the directory.
func LoadMediaFromDirectory(directory string, parallel int) (<-chan Media, error) {
	result := make(chan Media)

	files, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}

	go func() {
		defer close(result)

		var wg sync.WaitGroup
		sem := make(chan struct{}, parallel)

		for _, file := range files {
			wg.Add(1)
			sem <- struct{}{}

			go func(file os.DirEntry) {
				defer wg.Done()
				defer func() { <-sem }()

				ext := strings.ToLower(filepath.Ext(file.Name()))

				if !file.IsDir() && slices.Contains(ValidFileTypes, ext) {
					filePath := filepath.Join(directory, file.Name())
					media, mediaErr := LoadMediaFromFile(filePath)

					if mediaErr == nil {
						result <- *media
					}
				}
			}(file)
		}

		wg.Wait()
		close(sem)
	}()

	return result, nil
}
