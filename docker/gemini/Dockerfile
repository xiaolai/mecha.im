FROM mecha-worker-base

RUN npm install -g @google/gemini-cli || true

ENV WORKER_BACKEND=gemini
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["/app/entrypoint.sh"]
