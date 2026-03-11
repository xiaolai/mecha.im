# Build stage
FROM node:22-alpine AS build
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

# Runtime stage
FROM node:22-alpine

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

# System dependencies
RUN apk add --no-cache python3 py3-pip git bash curl tailscale

# Create non-root user
RUN adduser -D -u 10001 appuser

# Claude Code CLI — Agent SDK spawns this as child process
RUN npm install -g @anthropic-ai/claude-code

# Codex CLI — OpenAI coding agent
RUN npm install -g @openai/codex

# Application
WORKDIR /app
COPY --from=build /app/dist/agent ./agent
COPY --from=build /app/dist/shared ./shared
COPY --from=build /app/node_modules ./node_modules
COPY --from=dashboard-build /dashboard/dist ./agent/dashboard/dist

# s6 service definitions
COPY s6/tailscaled /etc/s6-overlay/s6-rc.d/tailscaled
COPY s6/tailscale-up /etc/s6-overlay/s6-rc.d/tailscale-up
COPY s6/mecha-agent /etc/s6-overlay/s6-rc.d/mecha-agent
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/tailscaled \
    && touch /etc/s6-overlay/s6-rc.d/user/contents.d/tailscale-up \
    && touch /etc/s6-overlay/s6-rc.d/user/contents.d/mecha-agent

# Ensure scripts are executable
RUN chmod +x /etc/s6-overlay/s6-rc.d/tailscaled/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/tailscale-up/up \
    && chmod +x /etc/s6-overlay/s6-rc.d/mecha-agent/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/mecha-agent/finish

# Create runtime directories and set ownership
RUN mkdir -p /state/tailscale /var/run/tailscale /home/appuser/.codex \
    && chown -R appuser:appuser /state /var/run/tailscale /app /home/appuser

EXPOSE 3000
ENTRYPOINT ["/init"]
