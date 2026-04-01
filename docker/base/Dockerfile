FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git curl jq ripgrep \
    make gcc g++ \
    tar gzip unzip \
    openssh-client ca-certificates tzdata \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Caddy v2.9 (static binary, pinned version)
RUN ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${ARCH}&version=v2.9.1" -o /usr/local/bin/caddy \
    && chmod +x /usr/local/bin/caddy

RUN groupadd -r worker && useradd -r -g worker -m -s /bin/bash worker

COPY runtime/ /app/
WORKDIR /app
RUN bun install --production \
    && chmod +x /app/entrypoint.sh

# /app must be writable by worker for runtime CLI installs
RUN chown -R worker:worker /app

WORKDIR /workspace
USER worker
