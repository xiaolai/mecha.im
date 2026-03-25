#!/usr/bin/env bash
set -euo pipefail

# Pre-publish build: compile all packages before npm publish.
# Called by packages/cli/package.json prepublishOnly from the monorepo root.

echo "Building all packages for publish..."
pnpm build
echo "Build complete."
