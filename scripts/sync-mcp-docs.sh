#!/bin/bash
# Sync website docs into the MCP server's embedded docs directory.
# Run before building mecha-mcp to ensure docs are current.
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/website/guide"
DST="$REPO_ROOT/cmd/mecha-mcp/docs"

rm -rf "$DST"
mkdir -p "$DST"

# Copy guide pages
cp "$SRC"/*.md "$DST/"

# Copy landing page as home.md
cp "$REPO_ROOT/website/index.md" "$DST/home.md"

echo "synced $(ls "$DST"/*.md | wc -l | tr -d ' ') docs to $DST"
