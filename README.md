# mediasim

<p align="center">
<img src="docs/images/icon.avif" width="300" alt="mediasim"/>
<br/>
<strong>mediasim</strong> is a CLI tool and Go library to calculate the similarity between images/videos.

## 🖼️ Usage

You can use **mediasim** in two ways: as a command-line interface (CLI) tool or a Go library.

The CLI tool is a standalone application that can be used to compare the similarity between media files, while the library can be integrated into your own Go projects.

The binaries are available for Windows, macOS, and Linux. Download the [latest release](https://github.com/vegidio/mediasim/releases) that matches your computer architecture and operating system.

### CLI

<p align="center">
<img src="docs/images/screenshot.avif" width="80%" alt="mediasim"/>
</p>

If you want to compare two or more files, run the command below in the terminal:

```bash
$ mediasim -f <media1>,<media2> ...
```

Where:

- `-f` (mandatory): the path to the media files you want to compare. You must pass at least two files, separated by comma.

---

If you want to compare a folder with multiple files, run the command below:

```bash
$ mediasim -d <directory>
```

Where:

- `-d` (mandatory): the path to the directory where the media files are located.

---

Other parameters you can use:

- `-t` (optional): the threshold for the similarity score; a value between 0-1, where 0 is completely different and 1 is identical. The default value is `0.8`, which means only files with 80% similarity or higher will be reported.
- `-o` (optional): the output format; you can choose `report` (default) or, if you prefer a raw output, `json` or `csv`.

For the full list of parameters, type `mediasim --help` in the terminal.

## 💣 Troubleshooting

### "App Is Damaged..." (Unidentified Developer)

For a couple of years now, Apple has required developers to join their "Developer Program" to gain the pretentious status of an _identified developer_ 😛.

Translating to non-BS language, this means that if you’re not registered with Apple (i.e., paying the fee), you can’t freely distribute macOS software. Apps from unidentified developers will display a message saying the app is damaged and can’t be opened.

To bypass this, open the Terminal and run the command below, replacing `<path-to-app>` with the correct path to where you’ve installed the app:

```bash
$ xattr -d com.apple.quarantine <path-to-app>
```

## 🛠️ Build

### Dependencies

In order to build this project you will need the following dependencies installed in your computer:

- [Golang](https://go.dev/doc/install)
- [Task](https://taskfile.dev/installation/)

### Compiling

With all the dependencies installed, in the project's root folder run the command:

```bash
$ task build os=<operating-system> arch=<architecture>
```

Where:

- `<operating-system>`: can be `windows`, `darwin` (macOS), or `linux`.
- `<architecture>`: can be `amd64` or `arm64`.

For example, if I wanted to build the CLI for Windows, on architecture AMD64, I would run the command:

```bash
$ task build os=windows arch=amd64
```

## 📈 Telemetry

This app collects information about the data that you're downloading to help me track bugs and improve the general stability of the software.

**No identifiable information about you or your computer is tracked.** But if you still want to stop the telemetry, you can do that by adding the flag `--no-telemetry` in the CLI tool.

## 📝 License

**mediasim** is released under the MIT License. See [LICENSE](LICENSE) for details.

## 👨🏾‍💻 Author

Vinicius Egidio ([vinicius.io](http://vinicius.io))
