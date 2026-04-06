package shared

import downloader "github.com/vegidio/ffmpeg-downloader"

// GetFFmpegPath returns the path to the FFmpeg binary. It checks for a system installation first,
// then a static installation, and finally downloads FFmpeg if neither is found.
func GetFFmpegPath(configName string) string {
	if downloader.IsSystemInstalled() {
		return ""
	}

	path, installed := downloader.IsStaticallyInstalled(configName)
	if installed {
		return path
	}

	path, err := downloader.Download(configName)
	if err != nil {
		return ""
	}

	return path
}
