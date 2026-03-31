#!/bin/sh
# Run mecha via Docker without installing.
# Usage: curl -fsSL https://raw.githubusercontent.com/xiaolai/mecha.im/main/scripts/install-docker.sh | sh
set -e

IMAGE="ghcr.io/xiaolai/mecha:latest"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
err() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || err "docker is not installed"

log "pulling $IMAGE..."
docker pull "$IMAGE" 2>/dev/null || err "image not available yet — use install.sh or install-go.sh instead"

log "creating mecha alias..."
cat <<'ALIAS'

# Add this to your ~/.bashrc or ~/.zshrc:
alias mecha='docker run --rm -v ~/.mecha:/root/.mecha -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/xiaolai/mecha:latest'

# Then use normally:
#   mecha version
#   mecha worker ls
#   mecha serve --addr 0.0.0.0:8080

ALIAS
