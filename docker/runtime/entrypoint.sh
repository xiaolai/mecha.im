#!/bin/bash
set -e

# --- Install latest CLIs and SDK at container start time ---
# Always runs the newest versions (same approach as claude-code-action).

echo "installing claude code CLI..."
curl -fsSL https://claude.ai/install.sh | bash
claude --version

echo "installing claude agent SDK..."
cd /app && bun add @anthropic-ai/claude-agent-sdk
cd /workspace

echo "installing codex CLI..."
bun install -g @openai/codex
codex --version

# --- Start services ---

# Caddy reverse proxy: port 8080 → Bun on 8081
caddy start --config /app/Caddyfile --adapter caddyfile

# Start Bun worker server (port 8081, internal)
exec bun run /app/server.ts
