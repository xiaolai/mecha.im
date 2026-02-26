#!/usr/bin/env bash
# Docs sync check — warns when CLI commands change without doc updates
# Runs as Stop hook at end of conversation
#
# Toggle: touch .claude/.docs-sync-enabled  → enabled
#         rm .claude/.docs-sync-enabled     → disabled
#         Or use: .claude/scripts/docs-sync-check.sh --toggle
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FLAG_FILE="$PROJECT_ROOT/.claude/.docs-sync-enabled"

# Handle --toggle / --status commands
case "${1:-}" in
  --toggle)
    if [ -f "$FLAG_FILE" ]; then
      rm "$FLAG_FILE"
      echo "Docs sync hook: DISABLED"
    else
      touch "$FLAG_FILE"
      echo "Docs sync hook: ENABLED"
    fi
    exit 0
    ;;
  --status)
    if [ -f "$FLAG_FILE" ]; then
      echo "Docs sync hook: ENABLED"
    else
      echo "Docs sync hook: DISABLED"
    fi
    exit 0
    ;;
  --enable)
    touch "$FLAG_FILE"
    echo "Docs sync hook: ENABLED"
    exit 0
    ;;
  --disable)
    rm -f "$FLAG_FILE"
    echo "Docs sync hook: DISABLED"
    exit 0
    ;;
esac

# Skip if disabled
[ -f "$FLAG_FILE" ] || exit 0

# Check for unstaged/staged changes in command files without matching doc changes
cd "$PROJECT_ROOT"

# Get changed files (staged + unstaged)
CHANGED=$(git diff --name-only HEAD 2>/dev/null || true)
[ -z "$CHANGED" ] && exit 0

# Check if any CLI command files changed
CMD_CHANGED=false
while IFS= read -r file; do
  case "$file" in
    packages/cli/src/commands/*.ts) CMD_CHANGED=true; break ;;
    packages/core/src/*.ts) CMD_CHANGED=true; break ;;
    packages/runtime/src/*.ts) CMD_CHANGED=true; break ;;
    packages/agent/src/*.ts) CMD_CHANGED=true; break ;;
    packages/meter/src/*.ts) CMD_CHANGED=true; break ;;
    packages/service/src/*.ts) CMD_CHANGED=true; break ;;
  esac
done <<< "$CHANGED"

$CMD_CHANGED || exit 0

# Check if any doc files also changed
DOC_CHANGED=false
while IFS= read -r file; do
  case "$file" in
    website/docs/*.md) DOC_CHANGED=true; break ;;
  esac
done <<< "$CHANGED"

if ! $DOC_CHANGED; then
  # Collect which specific areas changed for a targeted warning
  AREAS=""
  while IFS= read -r file; do
    case "$file" in
      packages/cli/src/commands/*) AREAS="$AREAS CLI commands," ;;
      packages/runtime/src/*) AREAS="$AREAS runtime API," ;;
      packages/core/src/*) AREAS="$AREAS core types/schemas," ;;
      packages/agent/src/*) AREAS="$AREAS agent server," ;;
      packages/meter/src/*) AREAS="$AREAS metering," ;;
      packages/service/src/*) AREAS="$AREAS service layer," ;;
    esac
  done <<< "$CHANGED"
  # Deduplicate
  AREAS=$(echo "$AREAS" | tr ',' '\n' | sort -u | tr '\n' ',' | sed 's/,$//' | sed 's/^,//')

  echo "WARNING: Code changed in${AREAS} but no website docs were updated."
  echo "Run /docs-check to audit documentation accuracy."
  echo ""
  echo "To disable this warning: .claude/scripts/docs-sync-check.sh --disable"
fi
