#!/usr/bin/env bash
set -euo pipefail

# Build a standalone mecha binary for a given platform using Bun.
# Usage: ./scripts/build-binaries.sh <target>
# Targets: linux-x64, linux-arm64, darwin-x64, darwin-arm64

TARGET="${1:?Usage: build-binaries.sh <target>}"

VALID_TARGETS="linux-x64 linux-arm64 darwin-x64 darwin-arm64"
if ! echo "$VALID_TARGETS" | grep -qw "$TARGET"; then
  echo "Error: Invalid target '$TARGET'. Must be one of: $VALID_TARGETS" >&2
  exit 1
fi

# Map our target names to Bun's --target format
case "$TARGET" in
  linux-x64)    BUN_TARGET="bun-linux-x64" ;;
  linux-arm64)  BUN_TARGET="bun-linux-arm64" ;;
  darwin-x64)   BUN_TARGET="bun-darwin-x64" ;;
  darwin-arm64) BUN_TARGET="bun-darwin-arm64" ;;
esac

OUTDIR="dist/bin/$TARGET"
mkdir -p "$OUTDIR"

echo "Building mecha for $TARGET..."
bun build packages/cli/dist/main.js \
  --compile \
  --target="$BUN_TARGET" \
  --outfile "$OUTDIR/mecha"

chmod +x "$OUTDIR/mecha"
echo "Built: $OUTDIR/mecha ($(du -h "$OUTDIR/mecha" | cut -f1))"
