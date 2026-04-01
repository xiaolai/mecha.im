#!/bin/bash
set -e

# --- Install Claude CLI at container start (always latest) ---
# The installer accepts a version arg: bash -s -- <version>
# We install latest by omitting the version, with 3 retries.

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

# --- Install Codex CLI at container start (always latest) ---
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

# --- Start services ---

# Caddy reverse proxy: port 8080 → Bun on 8081
caddy start --config /app/Caddyfile --adapter caddyfile

# Start Bun worker server (port 8081, internal)
exec bun run /app/server.ts
