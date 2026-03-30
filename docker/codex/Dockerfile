FROM mecha-worker-base

RUN curl -fsSL https://raw.githubusercontent.com/openai/codex/main/codex-cli/scripts/install.sh | bash \
    || npm install -g @openai/codex

ENV WORKER_BACKEND=codex
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
