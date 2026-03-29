FROM mecha-worker-base

SHELL ["/bin/bash", "-c"]
RUN curl -fsSL https://claude.ai/install.sh | bash \
    || { sleep 5 && curl -fsSL https://claude.ai/install.sh | bash; }

# Copy the actual binary (not symlink) to a system-wide location
RUN cp "$(readlink -f /root/.local/bin/claude)" /usr/local/bin/claude \
    && chmod +x /usr/local/bin/claude

ENV WORKER_BACKEND=claude
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD curl -sf http://localhost:8080/health || exit 1
ENTRYPOINT ["bun", "run", "/app/server.ts"]
