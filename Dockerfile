# Build stage
FROM node:22-alpine AS build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY shared/ shared/
COPY agent/ agent/
RUN npx tsc -p tsconfig.agent.json

# Bot dashboard build
FROM node:22-alpine AS dashboard-build
WORKDIR /dashboard
COPY agent/dashboard/package*.json ./
RUN npm ci
COPY agent/dashboard/ ./
RUN npm run build

# Runtime stage — plain Alpine, nothing pre-installed
FROM alpine

# s6-overlay for multi-process management (multi-arch)
ARG S6_OVERLAY_VERSION=3.2.0.2
ARG TARGETARCH
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp
RUN apk add --no-cache xz \
    && S6_ARCH=$(case "${TARGETARCH}" in arm64) echo "aarch64";; arm) echo "armhf";; *) echo "x86_64";; esac) \
    && wget -q "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" -O /tmp/s6-overlay-arch.tar.xz \
    && tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
    && tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz \
    && rm /tmp/s6-overlay-*.tar.xz

# Minimal system deps (root) — only what requires root privileges
RUN apk add --no-cache git bash curl libstdc++ python3 py3-pip

# Create non-root user
RUN adduser -D -u 10001 appuser

# ── Everything below is appuser-owned ──
USER appuser
WORKDIR /home/appuser

# Node.js — copy from build stage into appuser's home
COPY --from=build --chown=appuser:appuser /usr/local/bin/node /home/appuser/.local/bin/node
COPY --from=build --chown=appuser:appuser /usr/local/lib/node_modules /home/appuser/.local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /home/appuser/.local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /home/appuser/.local/bin/npx \
    && ln -s ../lib/node_modules/corepack/dist/corepack.js /home/appuser/.local/bin/corepack
ENV PATH="/home/appuser/.local/bin:$PATH"

# Tailscale — download prebuilt static binary (no root needed to install)
ARG TAILSCALE_VERSION=1.82.5
RUN TS_ARCH=$(case "${TARGETARCH}" in arm64) echo "arm64";; arm) echo "arm";; *) echo "amd64";; esac) \
    && curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${TAILSCALE_VERSION}_${TS_ARCH}.tgz" \
    | tar -xz --strip-components=1 -C /home/appuser/.local/bin/ \
       tailscale_${TAILSCALE_VERSION}_${TS_ARCH}/tailscale \
       tailscale_${TAILSCALE_VERSION}_${TS_ARCH}/tailscaled

# Headscale — coordination server (installed but not started by default)
ARG HEADSCALE_VERSION=0.25.1
RUN HS_ARCH=$(case "${TARGETARCH}" in arm64) echo "arm64";; arm) echo "armv7";; *) echo "amd64";; esac) \
    && curl -fsSL "https://github.com/juanfont/headscale/releases/download/v${HEADSCALE_VERSION}/headscale_${HEADSCALE_VERSION}_linux_${HS_ARCH}" \
       -o /home/appuser/.local/bin/headscale \
    && chmod +x /home/appuser/.local/bin/headscale

# Claude Code CLI + Codex CLI + Agent SDKs
# CACHEBUST_CLI is set by CI when new versions are available to invalidate this layer
ARG CACHEBUST_CLI=default
ENV NPM_CONFIG_PREFIX=/home/appuser/.local
RUN npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk @openai/codex @google/gemini-cli
RUN pip install --user --break-system-packages claude-agent-sdk

# ── Application (still appuser-owned) ──
WORKDIR /app
COPY --chown=appuser:appuser --from=build /app/dist/agent ./agent
COPY --chown=appuser:appuser --from=build /app/dist/shared ./shared
COPY --chown=appuser:appuser --from=build /app/node_modules ./node_modules
COPY --chown=appuser:appuser --from=dashboard-build /dashboard/dist ./agent/dashboard/dist

# Runtime directories — appuser creates them
RUN mkdir -p /home/appuser/.codex /home/appuser/workspace

# ── s6 service setup (needs root for /etc/s6-overlay) ──
USER root
COPY s6/tailscaled /etc/s6-overlay/s6-rc.d/tailscaled
COPY s6/tailscale-up /etc/s6-overlay/s6-rc.d/tailscale-up
COPY s6/mecha-agent /etc/s6-overlay/s6-rc.d/mecha-agent
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/tailscaled \
    && touch /etc/s6-overlay/s6-rc.d/user/contents.d/tailscale-up \
    && touch /etc/s6-overlay/s6-rc.d/user/contents.d/mecha-agent \
    && chmod +x /etc/s6-overlay/s6-rc.d/tailscaled/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/tailscale-up/up \
    && chmod +x /etc/s6-overlay/s6-rc.d/mecha-agent/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/mecha-agent/finish

# State and tailscale runtime dirs — writable by appuser
RUN mkdir -p /state/tailscale /var/run/tailscale \
    && chown -R appuser:appuser /state /var/run/tailscale /app

ENV S6_KEEP_ENV=1
EXPOSE 3000
ENTRYPOINT ["/init"]
