# Media Similarity (MediaSim)

<p align="center">
<img src="docs/images/icon.avif" width="240" alt="mediasim"/>
<br/>
<strong>MediaSim</strong> is a CLI tool and Go library to calculate the similarity of images & videos.

## ⬇️ Installation

This app has versions for Windows, macOS, and Linux. Download the [latest release](https://github.com/vegidio/mediasim/releases) that matches your computer architecture and operating system.

However, the recommended (and easiest) way to install **MediaSim** is using one of the following scripts; copy and paste the command below in the terminal, and the script will automatically detect and install the correct version of the app:

### macOS & Linux

```bash
curl -fsSL https://vegidio.github.io/mediasim/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://vegidio.github.io/mediasim/install.ps1 | iex
```

By default both the CLI and the GUI are installed. To install only one of them, pass `--cli` or `--gui` to the script on macOS & Linux (`curl -fsSL https://vegidio.github.io/mediasim/install.sh | sh -s -- --cli`), or set `$env:MEDIASIM_INSTALL='cli'` (or `'gui'`) before running it on Windows.

## 🖼️ Usage

You can use **mediasim** in two ways: as a command-line interface (CLI) tool or a Go library.

The CLI tool is a standalone application that can be used to compare the similarity between media files, while the library can be integrated into your own Go projects.

### CLI

<p align="center">
<img src="docs/images/cli-screenshot.avif" width="80%" alt="mediasim"/>
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
- `--mt` (optional): the file types to be included in the comparison. You can choose between `images`, `videos`, or `all` (default).
</details>

---

Other parameters you can use:

- `-t` (optional): the threshold for the similarity score; a value between 0–1, where 0 is completely different and 1 is identical. The default value is `0.8`, which means only similarities of 80% or higher will be reported.
- `-o` (optional): the output format; you can choose `term` (default) or, if you prefer a raw output, `json` or `csv`.
- `--ie` (optional): ignores errors and continues the comparison even if some files are not valid.
- `--ff` (optional): flips the frames vertically and horizontally during the comparison.
- `--fr` (optional): rotates the frames in multiple angles during the comparison.

For the full list of parameters, type `mediasim --help` in the terminal.

## 💣 Troubleshooting

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

- [Rust](https://rust-lang.org/tools/install)
- [Just](https://just.systems/man/en/installation.html)

If you want to build the GUI you will also need:

- [Node.js](https://nodejs.org/en/download/)
- [PNPM](https://pnpm.io/installation)

### Compiling

With all the dependencies installed, in the project's root folder run the command:

```bash
just build <interface> <architecture>
```

Where:

- `<interface>`: can be `cli` or `gui`.
- `<architecture>`: can be `x64` or `arm64` (optional).

For example, if I wanted to build a GUI version of the app, on architecture x64, I would run the command:

```bash
just build gui x64
```

## 📝 License

**MediaSim** is released under the Apache 2.0 License. See [LICENSE](LICENSE) for details.

## 👨🏾‍💻 Author

Vinicius Egidio ([vinicius.io](http://vinicius.io))
