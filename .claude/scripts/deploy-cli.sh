#!/usr/bin/env bash
# Deploy @mecha/cli to pnpm global bin after build
# Runs as PostToolUse hook — exits silently if nothing changed
set -euo pipefail

DEST="${MECHA_CLI_DEST:-$(pnpm bin -g 2>/dev/null || echo "$HOME/.local/bin")/mecha}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIST="$SCRIPT_DIR/../../packages/cli/dist/bin.js"

# Resolve to absolute path
CLI_DIST="$(cd "$(dirname "$CLI_DIST")" && pwd)/$(basename "$CLI_DIST")"

# Skip if CLI not built yet
[ -f "$CLI_DIST" ] || exit 0

# Skip if already deployed with correct path
EXPECTED="$(printf '#!/usr/bin/env node\nimport('\''%s'\'');' "$CLI_DIST")"
[ -f "$DEST" ] && [ "$(cat "$DEST")" = "$EXPECTED" ] && exit 0

# Deploy
printf '#!/usr/bin/env node\nimport('\''%s'\'');\n' "$CLI_DIST" > "$DEST"
chmod +x "$DEST"
echo "Deployed mecha CLI → $DEST"
