set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# Host architecture, as spelled in the release asset names.
host_arch := if arch() == "aarch64" { "arm64" } else if arch() == "x86_64" { "x64" } else { error("unsupported host architecture: " + arch()) }

os_triple := if os() == "macos" { "apple-darwin" } else if os() == "linux" { "unknown-linux-gnu" } else if os() == "windows" { "pc-windows-msvc" } else { error("unsupported OS: " + os()) }

# What the GUI ships as: an .app on macOS, .deb and .rpm packages on Linux, and the bare executable on Windows.
bundle_flags := if os() == "macos" { "--bundles app" } else if os() == "linux" { "--bundles deb,rpm" } else { "--no-bundle" }

build_dir := justfile_directory() / "build"

default:
    @just --list

# Build a target (`cli` or `gui`) for this OS into build/<target>/; pass `arm64` or `x64` to override the host architecture.
build target arch=host_arch: (_check-target target) (_compile (target) (if arch == "arm64" { "aarch64" } else if arch == "x64" { "x86_64" } else { error("arch must be arm64 or x64, got: " + arch) }) + "-" + os_triple)

# The GUI's package is a .zip on macOS and Windows, and unzipped .deb and .rpm packages on Linux.
# Build both targets, then package them as build/mediasim-cli_<os>_<arch>.zip and build/mediasim-gui_<os>_<arch>.*.
package arch=host_arch: (build "cli" arch) (build "gui" arch) (_package_cli "mediasim-cli_" + os() + "_" + arch) (_package_gui "mediasim-gui_" + os() + "_" + arch)

# Delete build output and all generated build/dev artifacts (target, node_modules, dist, ...).
[unix]
clean:
    rm -rf "{{ build_dir }}" target crates/gui/dist crates/gui/gen/schemas
    find . -path ./.git -prune -o \( -name node_modules -o -name .vite -o -name coverage \) -type d -prune -exec rm -rf {} +
    find . -path ./.git -prune -o -name '*.tsbuildinfo' -type f -exec rm -f {} +

[windows]
clean:
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "{{ build_dir }}", target, crates/gui/dist, crates/gui/gen/schemas
    Get-ChildItem -Recurse -Force -Directory -Include node_modules,.vite,coverage | Where-Object { $_.FullName -notmatch '\\node_modules\\.+' } | Remove-Item -Recurse -Force
    Get-ChildItem -Recurse -Force -File -Filter *.tsbuildinfo | Remove-Item -Force

# The frontend is built before the Rust tests because `tauri::generate_context!` embeds crates/gui/dist at compile
# time, and dist is not committed.
# Run the Rust and frontend tests. Pass `rust` or `node` to run only one of them.
test suite="all": (_check-suite suite)
    @just _pnpm install --frozen-lockfile
    {{ if suite != "node" { "just _pnpm build" } else { "" } }}
    {{ if suite != "node" { "cargo test --workspace" } else { "" } }}
    {{ if suite != "rust" { "just _pnpm test" } else { "" } }}

# Run a target (`cli` or `gui`) in development mode. `cli` gets the arguments; `gui` passes them to `tauri dev`.
run target *args: (_check-target target)
    {{ if target == "cli" { "cargo run -p cli -- " + args } else { "just _run_gui " + args } }}

_run_gui *args:
    @just _pnpm install
    @just _pnpm tauri dev {{ args }}

# Runs pnpm from inside the GUI rather than with `--dir`: corepack picks the pnpm version from the `packageManager`
# field of the package.json in the *current* directory, and never sees `--dir`, so run from the root it starts
# whatever pnpm is installed globally, which then refuses the GUI's pinned version.
[working-directory: 'crates/gui']
_pnpm +args:
    pnpm {{ args }}

_check-suite suite:
    @{{ if suite =~ '^(all|rust|node)$' { "" } else { error("suite must be rust or node, got: " + suite) } }}

_check-target target:
    @{{ if target =~ '^(cli|gui)$' { "" } else { error("unknown target: " + target + " (expected: cli or gui)") } }}

_compile target triple:
    rustup target add {{ triple }}
    @just _compile_{{ target }} {{ triple }}
    @just _stage_{{ target }} {{ triple }}

_compile_cli triple:
    cargo build --release -p cli --target {{ triple }}

_compile_gui triple:
    @just _pnpm install --frozen-lockfile
    @just _pnpm tauri build --target {{ triple }} {{ bundle_flags }}

# One folder per target: `mediasim` and `MediaSim` are the same file on case-insensitive filesystems
# (the macOS and Windows defaults), so the two can't share a folder.
[unix]
_stage_cli triple:
    mkdir -p "{{ build_dir }}/cli"
    cp "target/{{ triple }}/release/mediasim" "{{ build_dir }}/cli/mediasim"
    @echo "Built {{ build_dir }}/cli/mediasim"

[windows]
_stage_cli triple:
    New-Item -ItemType Directory -Force -Path "{{ build_dir }}/cli" | Out-Null
    Copy-Item -Force "target/{{ triple }}/release/mediasim.exe" "{{ build_dir }}/cli/mediasim.exe"
    @echo "Built {{ build_dir }}/cli/mediasim.exe"

[macos]
_stage_gui triple:
    rm -rf "{{ build_dir }}/gui/MediaSim.app"
    mkdir -p "{{ build_dir }}/gui"
    cp -R "target/{{ triple }}/release/bundle/macos/MediaSim.app" "{{ build_dir }}/gui/MediaSim.app"
    @echo "Built {{ build_dir }}/gui/MediaSim.app"

[linux]
_stage_gui triple:
    rm -f "{{ build_dir }}/gui/MediaSim.deb" "{{ build_dir }}/gui/MediaSim.rpm"
    mkdir -p "{{ build_dir }}/gui"
    cp "$(ls -t target/{{ triple }}/release/bundle/deb/*.deb | head -n 1)" "{{ build_dir }}/gui/MediaSim.deb"
    cp "$(ls -t target/{{ triple }}/release/bundle/rpm/*.rpm | head -n 1)" "{{ build_dir }}/gui/MediaSim.rpm"
    @echo "Built {{ build_dir }}/gui/MediaSim.deb"
    @echo "Built {{ build_dir }}/gui/MediaSim.rpm"

[windows]
_stage_gui triple:
    New-Item -ItemType Directory -Force -Path "{{ build_dir }}/gui" | Out-Null
    Copy-Item -Force "target/{{ triple }}/release/MediaSim.exe" "{{ build_dir }}/gui/MediaSim.exe"
    @echo "Built {{ build_dir }}/gui/MediaSim.exe"

[unix]
_package_cli base:
    cd "{{ build_dir }}" && rm -f "{{ base }}.zip" && zip -9 -q -j "{{ base }}.zip" cli/mediasim
    @echo "Packaged {{ build_dir }}/{{ base }}.zip"

# Test-Path rather than -ErrorAction SilentlyContinue: a silenced error still leaves $? false, and
# `powershell -Command` turns that into exit code 1 when the zip doesn't exist yet.
[windows]
_package_cli base:
    if (Test-Path "{{ build_dir }}/{{ base }}.zip") { Remove-Item -Force "{{ build_dir }}/{{ base }}.zip" }
    Compress-Archive -CompressionLevel Optimal -Path "{{ build_dir }}/cli/mediasim.exe" -DestinationPath "{{ build_dir }}/{{ base }}.zip"
    @echo "Packaged {{ build_dir }}/{{ base }}.zip"

# `-y` keeps the symlinks inside the .app bundle as symlinks.
[macos]
_package_gui base:
    cd "{{ build_dir }}/gui" && rm -f "../{{ base }}.zip" && zip -9 -r -y -q "../{{ base }}.zip" MediaSim.app
    @echo "Packaged {{ build_dir }}/{{ base }}.zip"

# The .deb and .rpm are already compressed and are released as they are, so they're only renamed.
[linux]
_package_gui base:
    cp "{{ build_dir }}/gui/MediaSim.deb" "{{ build_dir }}/{{ base }}.deb"
    cp "{{ build_dir }}/gui/MediaSim.rpm" "{{ build_dir }}/{{ base }}.rpm"
    @echo "Packaged {{ build_dir }}/{{ base }}.deb"
    @echo "Packaged {{ build_dir }}/{{ base }}.rpm"

[windows]
_package_gui base:
    if (Test-Path "{{ build_dir }}/{{ base }}.zip") { Remove-Item -Force "{{ build_dir }}/{{ base }}.zip" }
    Compress-Archive -CompressionLevel Optimal -Path "{{ build_dir }}/gui/MediaSim.exe" -DestinationPath "{{ build_dir }}/{{ base }}.zip"
    @echo "Packaged {{ build_dir }}/{{ base }}.zip"
