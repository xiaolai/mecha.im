#!/usr/bin/env bash
set -euo pipefail

# Build standalone mecha CLI binary using bun build --compile
#
# Single binary with embedded SPA dashboard:
#   mecha <command>     → CLI mode
#   mecha __runtime     → runtime mode (spawned internally as child process)
#
# The SPA is embedded inside the binary as a compressed archive.
# On first run, it extracts to ~/.mecha/.spa-cache/<version>/
#
# Usage:
#   ./scripts/build-binaries.sh                    # current platform
#   ./scripts/build-binaries.sh darwin-arm64        # macOS Apple Silicon
#   ./scripts/build-binaries.sh linux-x64           # Linux x86_64
#   ./scripts/build-binaries.sh all                 # all platforms

# Preflight: require bun
if ! command -v bun &>/dev/null; then
  echo "Error: bun is required but not installed. Install via: brew install oven-sh/bun/bun" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/bin"
ENTRY="$ROOT/packages/cli/src/bin-entry.ts"

# Validate target BEFORE expensive build steps
REQUESTED="${1:-current}"
case "$REQUESTED" in
  current|all|darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64) ;;
  *)
    echo "Usage: $0 [current|all|darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64]" >&2
    exit 1
    ;;
esac

# Build SPA dashboard
echo "Building SPA dashboard..."
(cd "$ROOT" && pnpm --filter @mecha/spa build)
echo "  → SPA built"
echo ""

# Embed SPA into a generated TypeScript module
echo "Embedding SPA into binary..."
"$ROOT/scripts/embed-spa.sh"
echo ""

TARGETS=(
  "bun-darwin-arm64"
  "bun-darwin-x64"
  "bun-linux-x64"
  "bun-linux-arm64"
  "bun-windows-x64"
)

target_dir() { echo "${1#bun-}"; }
bin_ext() { if [[ "$1" == *windows* ]]; then echo ".exe"; else echo ""; fi; }

current_ext() {
  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == CYGWIN* || "$(uname -s)" == MSYS* ]]; then
    echo ".exe"
  else
    echo ""
  fi
}

build_target() {
  local target="$1"
  local dir="$OUT/$(target_dir "$target")"
  local ext
  ext="$(bin_ext "$target")"
  mkdir -p "$dir"

  echo "Building mecha for $target..."
  bun build --compile --target="$target" \
    --outfile "$dir/mecha${ext}" \
    "$ENTRY"

  echo "  → $dir/mecha${ext}"
  du -h "$dir/mecha${ext}" | awk '{print "    size: " $1}'
  echo ""
}

build_current() {
  local dir="$OUT/current"
  local ext
  ext="$(current_ext)"
  mkdir -p "$dir"

  echo "Building mecha for current platform..."
  bun build --compile \
    --outfile "$dir/mecha${ext}" \
    "$ENTRY"

  echo "  → $dir/mecha${ext}"
  du -h "$dir/mecha${ext}" | awk '{print "    size: " $1}'
}

case "$REQUESTED" in
  current)
    build_current
    ;;
  all)
    for t in "${TARGETS[@]}"; do
      build_target "$t"
    done
    echo "All platforms built in $OUT/"
    ;;
  darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64)
    build_target "bun-${REQUESTED}"
    ;;
esac
