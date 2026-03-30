FROM mecha-worker-base

USER root

RUN npm install -g @openai/codex

USER worker

ENV WORKER_BACKEND=codex
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
