#!/bin/bash
set -e

# --- Install latest CLIs at container start time ---

echo "installing claude code CLI..."
for attempt in 1 2 3; do
  if curl -fsSL https://claude.ai/install.sh | bash; then
    break
  fi
  if [ "$attempt" -eq 3 ]; then
    echo "failed to install claude CLI after 3 attempts" >&2
    exit 1
  fi
  echo "attempt $attempt failed, retrying in 5s..."
  sleep 5
done
claude --version

echo "installing codex CLI..."
bun install -g @openai/codex
codex --version

# --- Configure Claude settings ---
mkdir -p "$HOME/.claude"
cat > "$HOME/.claude/settings.json" <<'SETTINGS'
{
  "enableAllProjectMcpServers": true
}
SETTINGS

# --- Install plugins (like claude-code-action) ---
# CLAUDE_PLUGIN_MARKETPLACES: newline-separated list of marketplace URLs
# CLAUDE_PLUGINS: newline-separated list of plugin names

if [ -n "$CLAUDE_PLUGIN_MARKETPLACES" ]; then
  echo "adding plugin marketplaces..."
  while IFS= read -r marketplace; do
    marketplace=$(echo "$marketplace" | xargs)
    [ -z "$marketplace" ] && continue
    echo "  adding marketplace: $marketplace"
    claude plugin marketplace add "$marketplace"
  done <<< "$CLAUDE_PLUGIN_MARKETPLACES"
fi

if [ -n "$CLAUDE_PLUGINS" ]; then
  echo "installing plugins..."
  while IFS= read -r plugin; do
    plugin=$(echo "$plugin" | xargs)
    [ -z "$plugin" ] && continue
    echo "  installing: $plugin"
    claude plugin install "$plugin"
  done <<< "$CLAUDE_PLUGINS"
fi

# --- Start services ---

# Caddy reverse proxy: port 8080 → Bun on 8081
caddy start --config /app/Caddyfile --adapter caddyfile

# Start Bun worker server (port 8081, internal)
exec bun run /app/server.ts
