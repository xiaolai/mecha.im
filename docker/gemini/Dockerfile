FROM mecha-worker-base

RUN npm install -g @anthropic-ai/claude-code@latest 2>/dev/null; \
    npm install -g @google/gemini-cli || true

ENV WORKER_BACKEND=gemini
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["bun", "run", "/app/server.ts"]
