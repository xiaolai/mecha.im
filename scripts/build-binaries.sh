#!/usr/bin/env bash
set -euo pipefail

# Build standalone mecha CLI binary using bun build --compile
#
# Single binary acts as both CLI and CASA runtime:
#   mecha <command>     → CLI mode
#   mecha __runtime     → runtime mode (spawned internally as child process)
#
# The SPA dashboard is built first and copied alongside the binary
# so the agent server can serve it on the same port.
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
SPA_DIST="$ROOT/packages/spa/dist"

# Build SPA dashboard first
echo "Building SPA dashboard..."
if command -v pnpm &>/dev/null; then
  pnpm --filter @mecha/spa build
else
  (cd "$ROOT/packages/spa" && npm run build)
fi
echo "  → SPA built at $SPA_DIST"
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

  # Copy SPA dist alongside binary (clean first to avoid nested dirs)
  if [[ -d "$SPA_DIST" ]]; then
    rm -rf "$dir/spa"
    cp -r "$SPA_DIST" "$dir/spa"
  fi

  echo "  → $dir/mecha${ext}"
  ls -lh "$dir/mecha${ext}" | awk '{print "    size: " $5}'
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

  # Copy SPA dist alongside binary (clean first to avoid nested dirs)
  if [[ -d "$SPA_DIST" ]]; then
    rm -rf "$dir/spa"
    cp -r "$SPA_DIST" "$dir/spa"
  fi

  echo "  → $dir/mecha${ext}"
  ls -lh "$dir/mecha${ext}" | awk '{print "    size: " $5}'
}

REQUESTED="${1:-current}"

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
  *)
    echo "Usage: $0 [current|all|darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64]"
    exit 1
    ;;
esac
