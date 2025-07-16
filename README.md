# Media Similarity (mediasim)

<p align="center">
<img src="docs/images/icon.avif" width="240" alt="mediasim"/>
<br/>
<strong>mediasim</strong> is a CLI tool and Go library to calculate the similarity of images & videos.

## 🖼️ Usage

You can use **mediasim** in two ways: as a command-line interface (CLI) tool or a Go library.

The CLI tool is a standalone application that can be used to compare the similarity between media files, while the library can be integrated into your own Go projects.

The binaries are available for Windows, macOS, and Linux. Download the [latest release](https://github.com/vegidio/mediasim/releases) that matches your computer architecture and operating system.

### CLI

<p align="center">
<img src="docs/images/screenshot.avif" width="80%" alt="mediasim"/>
</p>

<details>
<summary>Calculating the similarity score of two files</summary>

#### Run the command below in the terminal:

```bash
$ mediasim score <media1> <media2>
```
</details>

<details>
<summary>Comparing two or more files</summary>

#### Run the command below in the terminal:

```bash
$ mediasim files <media1> <media2> [<media3> ...]
```

Where:

- `files` (mandatory): the path to the media files you want to compare. You must pass at least two files, separated by space.
</details>

<details>
<summary>Comparing multiple files in a directory</summary>

#### Run the command below in the terminal:

```bash
$ mediasim dir <directory> [-r] [--mt <media-type>]
```

Where:

- `directory` (mandatory): the path to the directory where the media files are located.
- `-r` (optional): recursively search for files in subdirectories to include in the comparison.
- `--mt` (optional): the file types to be included in the comparison. You can choose between `image`, `video`, or `all` (default).
</details>

<details>
<summary>Renaming files based on similarity</summary>

#### Run the command below in the terminal:

```bash
$ mediasim rename <directory> [-r] [--mt <media-type>]
```

Where:

- `directory` (mandatory): the path to the directory where the media files are located.
- `-r` (optional): recursively search for files in subdirectories to include in the comparison.
- `--mt` (optional): the file types to be included in the comparison. You can choose between `image`, `video`, or `all` (default).
</details>

---

Other parameters you can use:

- `-t` (optional): the threshold for the similarity score; a value between 0–1, where 0 is completely different and 1 is identical. The default value is `0.8`, which means only similarities of 80% or higher will be reported.
- `-o` (optional): the output format; you can choose `report` (default) or, if you prefer a raw output, `json` or `csv`.
- `--ie` (optional): ignores errors and continues the comparison even if some files are not valid.
- `--ff` (optional; images only): flips the frames vertically and horizontally during the comparison.
- `--fr` (optional; images only): rotates the frames in multiple angles during the comparison.

For the full list of parameters, type `mediasim --help` in the terminal.

## 🎞️ Supported media types

In its default configuration, **mediasim** supports media files with the following extensions:

- Images: `.bmp`, `.gif`, `.jpg` (`.jpeg`), `.png`, `.tiff`, `.webp`
- Videos: `.avi`, `.mp4` (`.m4v`), `.mkv`, `.mov`, `.webm`

If you want to work with additional file extensions, you can use the functions `AddImageType` or `AddVideoType` before performing any similarity comparisons. This allows **mediasim** to include these file types during calculations.

When adding support for new media formats, it's essential to load a 3rd party library capable of decoding them. For example, to enable AVIF image comparison in **mediasim**, you could use a library like [avif-go](https://github.com/vegidio/avif-go) to do this:

```go
import _ "github.com/vegidio/avif-go"
mediasim.AddImageType(".avif")
```

## 💣 Troubleshooting

### Video Comparison Doesn't Work

If the comparison of videos is not working, it may be because you don't have [FFmpeg](https://www.ffmpeg.org/download.html) working in your computer, which is required to extract frames from the video files.

When FFmpeg is not found, **mediasim** will try to automatically download and install it for you. Even though this will work in most cases, it may fail for unpredictable reasons.

The best option to have the video comparison working is to install FFmpeg yourself in your computer and make sure it is available in your `PATH`.

### Video Comparison Is Taking Too Long

Comparing videos is inherently resource-intensive because it requires analyzing multiple frames from each video to get an accurate similarity score. For instance, comparing two 15-second videos requires roughly 250 times more CPU resources than comparing two images.

Therefore, if you have many videos to compare, especially long ones, the process may take a significant amount of time, and unfortunately, there is not much that can be done to speed it up.

### "App Is Damaged/Blocked..." (Windows & macOS only)

For a couple of years now, Microsoft and Apple have required developers to join their "Developer Program" to gain the pretentious status of an _identified developer_ 😛.

Translating to non-BS language, this means that if you’re not registered with them (i.e., paying the fee), you can’t freely distribute Windows or macOS software. Apps from unidentified developers will display a message saying the app is damaged or blocked and can’t be opened.

To bypass this, open the Terminal and run one of the commands below (depending on your operating system), replacing `<path-to-app>` with the correct path to where you’ve installed the app:

- Windows: `Unblock-File -Path <path-to-app>`
- macOS: `xattr -d com.apple.quarantine <path-to-app>`

## 🛠️ Build

### Dependencies

To build this project, you will need the following dependencies installed in your computer:

- [Golang](https://go.dev/doc/install)
- [Task](https://taskfile.dev/installation/)

### Compiling

With all the dependencies installed, in the project's root folder run the command:

```bash
$ task cli os=<operating-system> arch=<architecture>
```

Where:

- `<operating-system>`: can be `windows`, `darwin` (macOS), or `linux`.
- `<architecture>`: can be `amd64` or `arm64`.

For example, if I wanted to build the CLI for Windows, on architecture AMD64, I would run the command:

```bash
$ task cli os=windows arch=amd64
```

## 📝 License

**mediasim** is released under the MIT License. See [LICENSE](LICENSE) for details.

## 👨🏾‍💻 Author

Vinicius Egidio ([vinicius.io](http://vinicius.io))
