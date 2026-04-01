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

USER worker
ENV HOME="/home/worker"
ENV BUN_INSTALL="/home/worker/.bun"
ENV PATH="/home/worker/.local/bin:/home/worker/.bun/bin:$PATH"

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=60s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
