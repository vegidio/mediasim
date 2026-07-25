package ffmpeg

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"

	ffmpeg "github.com/u2takey/ffmpeg-go"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// maxStderrSize is how much of FFmpeg's stderr is kept in memory to describe a failure.
const maxStderrSize = 2048

func init() {
	// Stop ffmpeg-go from logging every compiled command to the terminal. This is a package-level
	// global in the library, so setting it once here covers all call sites; the alternative,
	// Stream.Silent(), mutates the same global on every call and races when frames are extracted
	// from several files in parallel.
	ffmpeg.LogCompiledCommand = false
}

// LoadFrames loads all image files from the given directory and returns them as a slice of image.Image.
func LoadFrames(directory string) ([]image.Image, error) {
	images := make([]image.Image, 0)

	files, err := os.ReadDir(directory)
	if err != nil {
		return images, err
	}

	for _, file := range files {
		if !file.IsDir() {
			img, imgErr := decodeFile(filepath.Join(directory, file.Name()))
			if imgErr != nil {
				return images, imgErr
			}

			images = append(images, img)
		}
	}

	return images, nil
}

// ExtractFrames extracts frames from a video file using FFmpeg and returns them as a slice of image.Image.
func ExtractFrames(filePath string, ffmpegPath string) ([]image.Image, error) {
	images := make([]image.Image, 0)

	tempDir, err := os.MkdirTemp("", "mediasim-*")
	if err != nil {
		return images, fmt.Errorf("error creating temp directory: %w", err)
	}

	defer os.RemoveAll(tempDir)

	// Export 1 frame per second
	path := filepath.Join(tempDir, "frame_%04d.jpg")
	multiErr := runCommand(newInput(filePath).
		Filter("fps", ffmpeg.Args{"1"}).
		Output(path), ffmpegPath)

	images, _ = LoadFrames(tempDir)
	if len(images) > 0 {
		return images, nil
	}

	// Failed to export multiple frames, so let's try to export a single frame
	path = filepath.Join(tempDir, "frame.jpg")
	err = runCommand(newInput(filePath).
		Output(path, ffmpeg.KwArgs{"vframes": 1}), ffmpegPath)

	if err != nil {
		// Both passes failed. The first one usually fails for the same reason as the second one, but
		// reports it in more detail, so it's the error worth surfacing.
		if multiErr != nil {
			err = multiErr
		}

		return images, fmt.Errorf("error exporting video frames from '%s': %w", filePath, err)
	}

	images, err = LoadFrames(tempDir)
	if err != nil {
		return images, fmt.Errorf("error loading videos frames from '%s': %w", filePath, err)
	}

	return images, nil
}

// newInput starts an FFmpeg command for the given file, quieting the output and normalizing the color
// metadata of the video.
func newInput(filePath string) *ffmpeg.Stream {
	return ffmpeg.Input(filePath, ffmpeg.KwArgs{"hide_banner": "", "loglevel": "error"}).
		// Some encoders tag videos with a transfer function that libswscale refuses to convert - e.g.
		// "log100" - which makes the whole conversion fail before a single frame is written. The color
		// accuracy of the frames is irrelevant for similarity comparison, so the tag is simply dropped.
		Filter("setparams", nil, ffmpeg.KwArgs{"color_trc": "unknown"})
}

// runCommand executes an FFmpeg command, capturing its stderr in memory so it can be included in the
// returned error. Nothing is ever written to the terminal.
func runCommand(command *ffmpeg.Stream, ffmpegPath string) error {
	if ffmpegPath != "" {
		command = command.SetFfmpegPath(ffmpegPath)
	}

	stderr := &limitedWriter{limit: maxStderrSize}

	err := command.WithErrorOutput(stderr).Run()
	if err == nil {
		return nil
	}

	if reason := firstLine(stderr.String()); reason != "" {
		return fmt.Errorf("%w (%s)", err, reason)
	}

	return err
}

// decodeFile decodes a single image file, making sure the file handle is closed before returning.
func decodeFile(fullPath string) (image.Image, error) {
	f, err := os.Open(fullPath)
	if err != nil {
		return nil, err
	}

	defer f.Close()

	img, _, err := image.Decode(f)
	if err != nil {
		return nil, err
	}

	return img, nil
}

// firstLine returns the first non-empty line of the given text, so a multi-line FFmpeg error can be
// reported as a single line.
func firstLine(text string) string {
	for line := range strings.SplitSeq(text, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			return trimmed
		}
	}

	return ""
}

// limitedWriter accumulates up to limit bytes and silently discards everything after that.
type limitedWriter struct {
	buf   bytes.Buffer
	limit int
}

func (w *limitedWriter) Write(p []byte) (int, error) {
	n := len(p)

	if remaining := w.limit - w.buf.Len(); remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}

		w.buf.Write(p)
	}

	return n, nil
}

func (w *limitedWriter) String() string {
	return w.buf.String()
}
