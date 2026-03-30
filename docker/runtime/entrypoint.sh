#!/bin/bash
set -e

# Caddy reverse proxy: port 8080 → Bun on 8081
# TLS termination happens OUTSIDE the container (host-level Caddy/nginx)
caddy start --config /app/Caddyfile --adapter caddyfile

# Start Bun worker server (port 8081, internal)
exec bun run /app/server.ts
