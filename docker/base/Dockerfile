FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git curl jq ripgrep \
    make gcc g++ \
    tar gzip unzip \
    openssh-client ca-certificates tzdata \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Caddy (static binary)
RUN ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${ARCH}" -o /usr/local/bin/caddy \
    && chmod +x /usr/local/bin/caddy

RUN groupadd -r worker && useradd -r -g worker -m -s /bin/bash worker

COPY runtime/ /app/
WORKDIR /app
RUN bun install --production && chmod +x /app/entrypoint.sh

WORKDIR /workspace
