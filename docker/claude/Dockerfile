FROM mecha-worker-base

USER root

# Install Claude Code CLI (required by Agent SDK as subprocess)
# Download installer, verify it's a shell script (not HTML/error page), then execute.
SHELL ["/bin/bash", "-c"]
RUN INSTALLER=$(mktemp) \
    && curl -fsSL https://claude.ai/install.sh -o "$INSTALLER" \
    && head -1 "$INSTALLER" | grep -q '^#!/' \
    && bash "$INSTALLER" \
    && rm "$INSTALLER"
RUN cp "$(readlink -f /root/.local/bin/claude)" /usr/local/bin/claude \
    && chmod +x /usr/local/bin/claude \
    && claude --version

# Claude Agent SDK is pinned in docker/runtime/package.json and installed
# by the base image's bun install step. No separate install needed here.

# Install Codex CLI (used as MCP server for dual-agent workers)
RUN bun install -g @openai/codex

# Credential mount targets for both CLIs
RUN mkdir -p /home/worker/.claude /home/worker/.codex \
    && chown worker:worker /home/worker/.claude /home/worker/.codex

USER worker

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
