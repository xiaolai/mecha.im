FROM mecha-worker-base

USER root

# Install Claude Code CLI (required by Agent SDK as subprocess)
SHELL ["/bin/bash", "-c"]
RUN curl -fsSL https://claude.ai/install.sh | bash \
    || { sleep 5 && curl -fsSL https://claude.ai/install.sh | bash; }
RUN cp "$(readlink -f /root/.local/bin/claude)" /usr/local/bin/claude \
    && chmod +x /usr/local/bin/claude

# Install Claude Agent SDK
WORKDIR /app
RUN bun add @anthropic-ai/claude-agent-sdk

# Install Codex CLI (available as MCP server for dual-agent workers)
RUN bun install -g @openai/codex

# Credential mount targets for both CLIs
RUN mkdir -p /home/worker/.claude /home/worker/.codex \
    && chown worker:worker /home/worker/.claude /home/worker/.codex

USER worker

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
