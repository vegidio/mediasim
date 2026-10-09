#!/bin/sh
# MediaSim installer — macOS and Linux
# Usage:
#   curl -fsSL https://vegidio.github.io/mediasim/install.sh | sh
#   curl -fsSL https://vegidio.github.io/mediasim/install.sh | sh -s -- --cli
#   curl -fsSL https://vegidio.github.io/mediasim/install.sh | MEDIASIM_VERSION=<tag> sh
#
# MEDIASIM_VERSION defaults to 'latest', which is resolved dynamically from
# https://github.com/vegidio/mediasim/releases/latest at run time.

set -eu

REPO="vegidio/mediasim"
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
has()   { command -v "$1" >/dev/null 2>&1; }

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
  MEDIASIM_INSTALL   cli | gui | both    (default: both)
  MEDIASIM_VERSION   release tag         (default: latest)
  MEDIASIM_CLI_DIR   CLI install dir     (default: /usr/local/bin)
  MEDIASIM_GUI_DIR   GUI install dir     (macOS only, default: ~/Applications)

On Linux the GUI is installed system-wide as a .deb or .rpm package, picked
from the distro, so sudo is needed unless the installer runs as root.
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
    Darwin) OS=macos ;;
    Linux)  OS=linux ;;
    *) error "unsupported OS: $(uname -s). This installer supports macOS and Linux. For Windows, use install.ps1." ;;
esac

case "$(uname -m)" in
    arm64|aarch64)  ARCH=arm64 ;;
    x86_64|amd64)   ARCH=x64 ;;
    *) error "unsupported architecture: $(uname -m)" ;;
esac

# Only Apple Silicon builds are released for macOS.
if [ "$OS" = macos ] && [ "$ARCH" != arm64 ]; then
    error "unsupported architecture: MediaSim for macOS is only available for Apple Silicon (arm64)"
fi

CLI_DIR="${MEDIASIM_CLI_DIR:-/usr/local/bin}"
GUI_DIR="${MEDIASIM_GUI_DIR:-$HOME/Applications}"

has curl || error "curl is required but not found"
if [ "$MEDIASIM_INSTALL" != gui ] || [ "$OS" = macos ]; then
    has unzip || error "unzip is required but not found"
fi

if [ "$MEDIASIM_VERSION" = "latest" ]; then
    info "resolving latest version..."
    RESOLVED_URL=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest") \
        || error "could not reach github.com to resolve the latest version"
    TAG=$(printf '%s' "$RESOLVED_URL" | sed -n 's|.*/tag/\(.*\)$|\1|p')
    [ -n "$TAG" ] || error "could not parse latest version from $RESOLVED_URL"
else
    TAG="$MEDIASIM_VERSION"
fi

info "installing MediaSim ${TAG} (${OS}/${ARCH})"

TMP=$(mktemp -d -t mediasim-install.XXXXXX)
trap 'rm -rf "$TMP"' EXIT INT TERM

download_asset() {
    asset="$1"
    url="https://github.com/${REPO}/releases/download/${TAG}/${asset}"
    info "downloading ${asset}"
    curl -fL --progress-bar -o "$TMP/$asset" "$url" \
        || error "download failed: $url"
}

download_zip() {
    asset="$1"
    download_asset "$asset"
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
        sudo mkdir -p "$dst_dir"
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
    if [ "$OS" = macos ]; then
        xattr -d com.apple.quarantine "$bin" 2>/dev/null || true
    fi

    info "installing mediasim to ${CLI_DIR}"
    move_in_place "$bin" "${CLI_DIR}/mediasim"
    info "${GREEN}mediasim installed${RESET} at ${CLI_DIR}/mediasim"

    case ":${PATH}:" in
        *":${CLI_DIR}:"*) ;;
        *) warn "${CLI_DIR} is not in your PATH; add it to run mediasim from anywhere" ;;
    esac
}

install_gui_macos() {
    asset="mediasim-gui_macos_${ARCH}.zip"
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

# Prints `deb` or `rpm`: from the distro's os-release when it's one we know, otherwise from whichever package
# manager is on the system.
detect_pkg_format() {
    if [ -r /etc/os-release ]; then
        ids=$(. /etc/os-release && printf '%s %s' "${ID:-}" "${ID_LIKE:-}")
        for id in $ids; do
            case "$id" in
                debian|ubuntu|linuxmint|pop|elementary|raspbian|kali|zorin|neon)
                    echo deb; return ;;
                fedora|rhel|centos|rocky|almalinux|suse|opensuse*|sles|mageia|amzn|ol|nobara)
                    echo rpm; return ;;
            esac
        done
    fi
    if has apt-get || has dpkg; then echo deb; return; fi
    if has dnf || has yum || has zypper || has rpm; then echo rpm; return; fi
    error "unsupported Linux distribution: no apt/dpkg or dnf/yum/zypper/rpm found"
}

# Installing a package is system-wide, so it needs root.
set_sudo() {
    if [ "$(id -u)" -eq 0 ]; then
        SUDO=""
    else
        has sudo || error "sudo is required to install the package (or run this installer as root)"
        SUDO="sudo"
        info "elevating with sudo to install the package"
    fi
}

install_deb() {
    pkg="$1"
    # apt fetches local files as the unprivileged _apt user, which can't read mktemp's 0700 directory.
    chmod 755 "$TMP" && chmod 644 "$pkg"
    if has apt-get; then
        # The path must be absolute (it is, via $TMP) for apt to treat it as a file and resolve its dependencies.
        $SUDO apt-get install -y "$pkg" || error "apt-get failed to install $(basename "$pkg")"
    else
        $SUDO dpkg -i "$pkg" || error "dpkg failed to install $(basename "$pkg")"
    fi
}

install_rpm() {
    pkg="$1"
    if has dnf; then
        $SUDO dnf install -y "$pkg"
    elif has yum; then
        $SUDO yum install -y "$pkg"
    elif has zypper; then
        # The package isn't signed.
        $SUDO zypper --non-interactive install --allow-unsigned-rpm "$pkg"
    else
        $SUDO rpm -Uvh --replacepkgs "$pkg"
    fi || error "failed to install $(basename "$pkg")"
}

# Copies the menu entry the package installed onto the user's desktop; best-effort.
create_shortcut() {
    fmt="$1"
    name="$2"
    if [ "$fmt" = deb ]; then
        files=$(dpkg -L "$name" 2>/dev/null || true)
    else
        files=$(rpm -ql "$name" 2>/dev/null || true)
    fi
    entry=$(printf '%s\n' "$files" | grep '/applications/.*\.desktop$' | head -n 1 || true)
    if [ -z "$entry" ]; then
        entry=$(grep -l '^Exec=.*MediaSim' /usr/share/applications/*.desktop 2>/dev/null | head -n 1 || true)
    fi
    if [ -z "$entry" ] || [ ! -r "$entry" ]; then
        warn "could not find the app's menu entry, so no desktop shortcut was created"
        return
    fi

    desktop_dir=""
    has xdg-user-dir && desktop_dir=$(xdg-user-dir DESKTOP 2>/dev/null || true)
    { [ -n "$desktop_dir" ] && [ "$desktop_dir" != "$HOME" ]; } || desktop_dir="$HOME/Desktop"
    if [ ! -d "$desktop_dir" ]; then
        info "no desktop folder at ${desktop_dir}, skipping the desktop shortcut"
        return
    fi

    shortcut="${desktop_dir}/mediasim.desktop"
    if cp "$entry" "$shortcut" 2>/dev/null && chmod +x "$shortcut" 2>/dev/null; then
        # GNOME won't launch a desktop file until it's marked trusted.
        if has gio; then
            gio set "$shortcut" metadata::trusted true >/dev/null 2>&1 || true
        fi
        info "desktop shortcut created at ${shortcut}"
    else
        warn "could not create desktop shortcut at ${shortcut}"
    fi
}

install_gui_linux() {
    fmt=$(detect_pkg_format)
    asset="mediasim-gui_linux_${ARCH}.${fmt}"
    download_asset "$asset"
    pkg="$TMP/$asset"

    if [ "$fmt" = deb ]; then
        name=$(dpkg-deb -f "$pkg" Package 2>/dev/null || true)
    else
        name=$(rpm -qp --queryformat '%{NAME}' "$pkg" 2>/dev/null || true)
    fi
    name="${name:-media-sim}"

    set_sudo
    info "installing ${asset} (${name})"
    if [ "$fmt" = deb ]; then install_deb "$pkg"; else install_rpm "$pkg"; fi
    info "${GREEN}MediaSim installed${RESET} (${fmt} package ${name})"

    create_shortcut "$fmt" "$name"
}

install_gui() {
    case "$OS" in
        macos)  install_gui_macos ;;
        linux)  install_gui_linux ;;
    esac
}

case "$MEDIASIM_INSTALL" in
    cli)  install_cli ;;
    gui)  install_gui ;;
    both) install_cli; install_gui ;;
esac

printf '%s\n' "${GREEN}done.${RESET}" >&2
