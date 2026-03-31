#!/bin/sh
# Install mecha — single binary, no dependencies.
# Usage: curl -fsSL https://mecha.im/install.sh | sh
#    or: curl -fsSL https://raw.githubusercontent.com/xiaolai/mecha.im/main/scripts/install.sh | sh
#
# Options (via env vars):
#   MECHA_VERSION=v0.5.11   Install a specific version (default: latest)
#   MECHA_INSTALL_DIR=/usr/local/bin   Install directory (default: /usr/local/bin or ~/.local/bin)
set -e

REPO="xiaolai/mecha.im"
INSTALL_DIR="${MECHA_INSTALL_DIR:-}"
VERSION="${MECHA_VERSION:-}"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
err() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Detect OS and arch
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) err "unsupported architecture: $ARCH" ;;
esac
case "$OS" in
    linux|darwin) ;;
    *) err "unsupported OS: $OS (use WSL on Windows)" ;;
esac

PLATFORM="${OS}-${ARCH}"
log "detected platform: $PLATFORM"

# Resolve version
if [ -z "$VERSION" ]; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
    [ -z "$VERSION" ] && err "could not determine latest version"
fi
log "version: $VERSION"

# Resolve install dir
if [ -z "$INSTALL_DIR" ]; then
    if [ -w /usr/local/bin ]; then
        INSTALL_DIR="/usr/local/bin"
    else
        INSTALL_DIR="$HOME/.local/bin"
        mkdir -p "$INSTALL_DIR"
    fi
fi

# Download and install
URL="https://github.com/$REPO/releases/download/$VERSION/mecha-${PLATFORM}.tar.gz"
log "downloading $URL"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$URL" | tar -xz -C "$TMP"
install -m 755 "$TMP/mecha" "$INSTALL_DIR/mecha"

log "installed mecha $VERSION to $INSTALL_DIR/mecha"

# Verify
if command -v mecha >/dev/null 2>&1; then
    mecha version
else
    log "add $INSTALL_DIR to your PATH:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi
