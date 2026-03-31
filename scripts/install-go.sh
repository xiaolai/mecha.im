#!/bin/sh
# Install mecha from source via go install.
# Requires Go 1.26.1+.
# Usage: curl -fsSL https://raw.githubusercontent.com/xiaolai/mecha.im/main/scripts/install-go.sh | sh
set -e

MIN_GO="1.26"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
err() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Check Go is installed
command -v go >/dev/null 2>&1 || err "go is not installed. Get it at https://go.dev/dl/"

GO_VER=$(go version | awk '{print $3}' | sed 's/go//')
log "go version: $GO_VER"

# Install
log "installing mecha from source..."
go install mecha.im/cmd/mecha@latest

GOBIN=$(go env GOBIN)
[ -z "$GOBIN" ] && GOBIN="$(go env GOPATH)/bin"
log "installed to $GOBIN/mecha"

# Verify
if command -v mecha >/dev/null 2>&1; then
    mecha version
else
    log "add $GOBIN to your PATH:"
    echo "  export PATH=\"$GOBIN:\$PATH\""
fi
