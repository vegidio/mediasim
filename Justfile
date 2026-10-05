set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# Host architecture, as spelled in the release asset names.
host_arch := if arch() == "aarch64" { "arm64" } else if arch() == "x86_64" { "x64" } else { error("unsupported host architecture: " + arch()) }

os_triple := if os() == "macos" { "apple-darwin" } else if os() == "linux" { "unknown-linux-gnu" } else if os() == "windows" { "pc-windows-msvc" } else { error("unsupported OS: " + os()) }

build_dir := justfile_directory() / "build"

default:
    @just --list

# Build a target for this OS into build/. The only target is `cli`; pass `arm64` or `x64` to override the host architecture.
build target arch=host_arch: (_compile (if target != "cli" { error("unknown target: " + target + " (expected: cli)") } else if arch == "arm64" { "aarch64" } else if arch == "x64" { "x86_64" } else { error("arch must be arm64 or x64, got: " + arch) }) + "-" + os_triple)

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

# Run a target in development mode, passing the arguments through to it. The only target is `cli`.
run target *args:
    {{ if target != "cli" { error("unknown target: " + target + " (expected: cli)") } else { "" } }}cargo run -p cli -- {{ args }}

_compile triple:
    rustup target add {{ triple }}
    cargo build --release -p cli --target {{ triple }}
    @just _stage {{ triple }}

[unix]
_stage triple:
    mkdir -p "{{ build_dir }}"
    cp "target/{{ triple }}/release/mediasim" "{{ build_dir }}/mediasim"
    @echo "Built {{ build_dir }}/mediasim"

[windows]
_stage triple:
    New-Item -ItemType Directory -Force -Path "{{ build_dir }}" | Out-Null
    Copy-Item -Force "target/{{ triple }}/release/mediasim.exe" "{{ build_dir }}/mediasim.exe"
    @echo "Built {{ build_dir }}/mediasim.exe"

[unix]
_package base:
    cd "{{ build_dir }}" && rm -f "{{ base }}.zip" && zip -9 -q "{{ base }}.zip" mediasim
    @echo "Packaged {{ build_dir }}/{{ base }}.zip"

# Test-Path rather than -ErrorAction SilentlyContinue: a silenced error still leaves $? false, and
# `powershell -Command` turns that into exit code 1 when the zip doesn't exist yet.
[windows]
_package base:
    if (Test-Path "{{ build_dir }}/{{ base }}.zip") { Remove-Item -Force "{{ build_dir }}/{{ base }}.zip" }
    Compress-Archive -CompressionLevel Optimal -Path "{{ build_dir }}/mediasim.exe" -DestinationPath "{{ build_dir }}/{{ base }}.zip"
    @echo "Packaged {{ build_dir }}/{{ base }}.zip"
