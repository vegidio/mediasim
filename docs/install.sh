#!/bin/sh
# MediaSim installer — macOS and Linux
# Usage:
#   curl -fsSL https://vegidio.github.io/mediasim/install.sh | sh
#   curl -fsSL https://vegidio.github.io/mediasim/install.sh | MEDIASIM_INSTALL=gui sh
#   curl -fsSL https://vegidio.github.io/mediasim/install.sh | MEDIASIM_VERSION=<tag> sh
#
# MEDIASIM_VERSION defaults to 'latest', which is resolved dynamically from
# https://github.com/vegidio/mediasim/releases/latest at run time.

set -eu

REPO="vegidio/mediasim"
CLI_DIR="${MEDIASIM_CLI_DIR:-/usr/local/bin}"
MEDIASIM_INSTALL="${MEDIASIM_INSTALL:-both}"
MEDIASIM_VERSION="${MEDIASIM_VERSION:-latest}"

if [ -t 1 ]; then
    BOLD=$(printf '\033[1m')
    RED=$(printf '\033[31m')
    GREEN=$(printf '\033[32m')
    YELLOW=$(printf '\033[33m')
    RESET=$(printf '\033[0m')
else
    BOLD=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

info()  { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*" >&2; }
warn()  { printf '%swarn:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
error() { printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
    cat <<EOF
Usage: install.sh [options]

Options:
  --cli            Install only the CLI
  --gui            Install only the GUI
  --all            Install both CLI and GUI (default)
  --version <tag>  Install a specific version (default: latest)
  -h, --help       Show this help message

Environment variables:
  MEDIASIM_INSTALL    cli | gui | both    (default: both)
  MEDIASIM_VERSION    release tag         (default: latest)
  MEDIASIM_CLI_DIR    CLI install dir     (default: /usr/local/bin)
  MEDIASIM_GUI_DIR    GUI install dir     (default: ~/Applications on macOS,
                                                     /usr/local/bin on Linux)
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --cli)         MEDIASIM_INSTALL=cli ;;
        --gui)         MEDIASIM_INSTALL=gui ;;
        --all|--both)  MEDIASIM_INSTALL=both ;;
        --version)     shift; [ $# -gt 0 ] || error "--version requires an argument"; MEDIASIM_VERSION="$1" ;;
        --version=*)   MEDIASIM_VERSION="${1#--version=}" ;;
        -h|--help)     usage; exit 0 ;;
        *)             error "unknown option: $1 (try --help)" ;;
    esac
    shift
done

case "$MEDIASIM_INSTALL" in
    cli|gui|both) ;;
    *) error "invalid MEDIASIM_INSTALL=$MEDIASIM_INSTALL (expected: cli, gui, or both)" ;;
esac

case "$(uname -s)" in
    Darwin) OS=darwin ;;
    Linux)  OS=linux ;;
    *) error "unsupported OS: $(uname -s). This installer supports macOS and Linux. For Windows, use install.ps1." ;;
esac

case "$(uname -m)" in
    arm64|aarch64)  ARCH=arm64 ;;
    x86_64|amd64)   ARCH=amd64 ;;
    *) error "unsupported architecture: $(uname -m)" ;;
esac

if [ "$OS" = darwin ]; then
    GUI_DIR="${MEDIASIM_GUI_DIR:-$HOME/Applications}"
else
    GUI_DIR="${MEDIASIM_GUI_DIR:-/usr/local/bin}"
fi

command -v curl  >/dev/null 2>&1 || error "curl is required but not found"
command -v unzip >/dev/null 2>&1 || error "unzip is required but not found"

if [ "$MEDIASIM_VERSION" = "latest" ]; then
    info "resolving latest version..."
    RESOLVED_URL=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest") \
        || error "could not reach github.com to resolve the latest version"
    TAG=$(printf '%s' "$RESOLVED_URL" | sed -n 's|.*/tag/\(.*\)$|\1|p')
    [ -n "$TAG" ] || error "could not parse latest version from $RESOLVED_URL"
else
    TAG="$MEDIASIM_VERSION"
fi

info "installing mediasim ${TAG} (${OS}/${ARCH})"

TMP=$(mktemp -d -t mediasim-install.XXXXXX)
trap 'rm -rf "$TMP"' EXIT INT TERM

download_zip() {
    asset="$1"
    url="https://github.com/${REPO}/releases/download/${TAG}/${asset}"
    info "downloading ${asset}"
    curl -fL --progress-bar -o "$TMP/$asset" "$url" \
        || error "download failed: $url"
    mkdir -p "$TMP/${asset%.zip}"
    unzip -q -o "$TMP/$asset" -d "$TMP/${asset%.zip}" \
        || error "failed to unzip $asset"
}

move_in_place() {
    src="$1"
    dst="$2"
    dst_dir=$(dirname "$dst")
    if [ -w "$dst_dir" ] || { [ ! -e "$dst_dir" ] && mkdir -p "$dst_dir" 2>/dev/null; }; then
        rm -rf "$dst"
        mv "$src" "$dst"
    else
        info "elevating with sudo to write to ${dst_dir}"
        sudo rm -rf "$dst"
        sudo mv "$src" "$dst"
    fi
}

install_cli() {
    asset="mediasim-cli_${OS}_${ARCH}.zip"
    download_zip "$asset"
    bin="$TMP/${asset%.zip}/mediasim"
    [ -f "$bin" ] || error "mediasim not found inside $asset"
    chmod +x "$bin"
    [ "$OS" = darwin ] && xattr -d com.apple.quarantine "$bin" 2>/dev/null || true

    info "installing mediasim to ${CLI_DIR}"
    move_in_place "$bin" "${CLI_DIR}/mediasim"
    info "${GREEN}mediasim installed${RESET} at ${CLI_DIR}/mediasim"
}

install_gui_darwin() {
    asset="mediasim-gui_darwin_${ARCH}.zip"
    download_zip "$asset"
    app_src=$(find "$TMP/${asset%.zip}" -maxdepth 3 -name '*.app' -type d 2>/dev/null | head -n 1)
    [ -n "$app_src" ] || error ".app bundle not found inside $asset"
    app_name=$(basename "$app_src")

    mkdir -p "$GUI_DIR"
    info "installing ${app_name} to ${GUI_DIR}"
    move_in_place "$app_src" "${GUI_DIR}/${app_name}"
    xattr -dr com.apple.quarantine "${GUI_DIR}/${app_name}" 2>/dev/null || true
    info "${GREEN}${app_name} installed${RESET} at ${GUI_DIR}/${app_name}"
}

install_gui_linux() {
    asset="mediasim-gui_linux_${ARCH}.zip"
    download_zip "$asset"
    bin="$TMP/${asset%.zip}/MediaSim"
    [ -f "$bin" ] || error "MediaSim binary not found inside $asset"
    chmod +x "$bin"

    info "installing MediaSim-GUI to ${GUI_DIR}"
    move_in_place "$bin" "${GUI_DIR}/MediaSim-GUI"
    info "${GREEN}MediaSim-GUI installed${RESET} at ${GUI_DIR}/MediaSim-GUI"
}

install_gui() {
    case "$OS" in
        darwin) install_gui_darwin ;;
        linux)  install_gui_linux ;;
    esac
}

case "$MEDIASIM_INSTALL" in
    cli)  install_cli ;;
    gui)  install_gui ;;
    both) install_cli; install_gui ;;
esac

printf '%s\n' "${GREEN}done.${RESET}" >&2
