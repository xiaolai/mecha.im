FROM mecha-worker-base

USER root

# Claude Agent SDK is pinned in docker/runtime/package.json and installed
# by the base image's bun install step. No separate install needed here.

# Credential mount targets for both CLIs
RUN mkdir -p /home/worker/.claude /home/worker/.codex \
    && chown worker:worker /home/worker/.claude /home/worker/.codex

# Allow worker user to install CLIs at runtime
RUN mkdir -p /home/worker/.local/bin /home/worker/.bun/install/global \
    && chown -R worker:worker /home/worker/.local /home/worker/.bun

# Make home writable by any UID — containers may run as the host user
# (--user uid:gid) for workspace mount permissions, not as the worker user.
RUN chmod 777 /home/worker

USER worker
ENV HOME="/home/worker"
ENV BUN_INSTALL="/home/worker/.bun"
ENV PATH="/home/worker/.local/bin:/home/worker/.bun/bin:$PATH"

# Pre-install CLIs at build time so containers boot in seconds, not minutes.
# The entrypoint skips installation when these binaries already exist.
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && claude --version
RUN mkdir -p "$HOME/.codex-cli" && cd "$HOME/.codex-cli" \
    && bun init -y > /dev/null 2>&1 \
    && bun add @openai/codex \
    && ln -sf "$HOME/.codex-cli/node_modules/.bin/codex" "$HOME/.local/bin/codex" \
    && codex --version

EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
