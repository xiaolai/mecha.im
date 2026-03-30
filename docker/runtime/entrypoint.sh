#!/bin/bash
set -e

# If a domain is set, configure Caddy for HTTPS (automatic Let's Encrypt)
# Otherwise, plain HTTP on port 8080
if [ -n "$WORKER_DOMAIN" ]; then
  export CADDY_SCHEME=""
  export CADDY_PORT="443"
  cat > /tmp/Caddyfile <<EOF
$WORKER_DOMAIN {
  reverse_proxy localhost:8081
}
EOF
  caddy start --config /tmp/Caddyfile --adapter caddyfile
else
  caddy start --config /app/Caddyfile --adapter caddyfile
fi

# Start Bun worker server (port 8081, internal)
exec bun run /app/server.ts
