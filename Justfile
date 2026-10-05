set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# Host architecture, as spelled in the release asset names.
host_arch := if arch() == "aarch64" { "arm64" } else if arch() == "x86_64" { "x64" } else { error("unsupported host architecture: " + arch()) }

os_triple := if os() == "macos" { "apple-darwin" } else if os() == "linux" { "unknown-linux-gnu" } else if os() == "windows" { "pc-windows-msvc" } else { error("unsupported OS: " + os()) }

build_dir := justfile_directory() / "build"

default:
    @just --list

# Build a target (`cli` or `gui`) for this OS into build/<target>/; pass `arm64` or `x64` to override the host architecture.
build target arch=host_arch: (_compile (if target == "cli" { target } else if target == "gui" { target } else { error("unknown target: " + target + " (expected: cli or gui)") }) (if arch == "arm64" { "aarch64" } else if arch == "x64" { "x86_64" } else { error("arch must be arm64 or x64, got: " + arch) }) + "-" + os_triple)

# Build the CLI like `build cli`, then package it as build/mediasim_<os>_<arch>.zip.
package arch=host_arch: (build "cli" arch) (_package "mediasim_" + os() + "_" + arch)

# Delete build output and the Cargo target directory.
[unix]
clean:
    rm -rf "{{ build_dir }}" target

[windows]
clean:
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "{{ build_dir }}", target

# Run the tests of every crate in the workspace.
test:
    cargo test --workspace

# Run a target (`cli` or `gui`) in development mode. `cli` gets the arguments; `gui` passes them to `tauri dev`.
run target *args:
    {{ if target == "cli" { "cargo run -p cli -- " + args } else if target == "gui" { "just _run_gui " + args } else { error("unknown target: " + target + " (expected: cli or gui)") } }}

_run_gui *args:
    pnpm --dir crates/gui install
    pnpm --dir crates/gui tauri dev {{ args }}

_compile target triple:
    rustup target add {{ triple }}
    @just _compile_{{ target }} {{ triple }}
    @just _stage {{ target }} {{ if target == "gui" { "MediaSim" } else { "mediasim" } }} {{ triple }}

_compile_cli triple:
    cargo build --release -p cli --target {{ triple }}

# `--no-bundle`: only the executable is staged; installers are not built yet.
_compile_gui triple:
    pnpm --dir crates/gui install
    pnpm --dir crates/gui tauri build --no-bundle --target {{ triple }}

# One folder per target: `mediasim` and `MediaSim` are the same file on case-insensitive filesystems
# (the macOS and Windows defaults), so the two can't share a folder.
[unix]
_stage target bin triple:
    mkdir -p "{{ build_dir / target }}"
    cp "target/{{ triple }}/release/{{ bin }}" "{{ build_dir / target / bin }}"
    @echo "Built {{ build_dir / target / bin }}"

[windows]
_stage target bin triple:
    New-Item -ItemType Directory -Force -Path "{{ build_dir / target }}" | Out-Null
    Copy-Item -Force "target/{{ triple }}/release/{{ bin }}.exe" "{{ build_dir / target / bin }}.exe"
    @echo "Built {{ build_dir / target / bin }}.exe"

[unix]
_package base:
    cd "{{ build_dir }}" && rm -f "{{ base }}.zip" && zip -9 -q -j "{{ base }}.zip" cli/mediasim
    @echo "Packaged {{ build_dir }}/{{ base }}.zip"

# Test-Path rather than -ErrorAction SilentlyContinue: a silenced error still leaves $? false, and
# `powershell -Command` turns that into exit code 1 when the zip doesn't exist yet.
[windows]
_package base:
    if (Test-Path "{{ build_dir }}/{{ base }}.zip") { Remove-Item -Force "{{ build_dir }}/{{ base }}.zip" }
    Compress-Archive -CompressionLevel Optimal -Path "{{ build_dir }}/cli/mediasim.exe" -DestinationPath "{{ build_dir }}/{{ base }}.zip"
    @echo "Packaged {{ build_dir }}/{{ base }}.zip"
