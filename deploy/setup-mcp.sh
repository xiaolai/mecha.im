#!/bin/bash
# Deploy mecha-mcp on linode02. Run with sudo.
# Usage: sudo bash deploy/setup-mcp.sh
set -e

WEBHOOK_SECRET="${GITHUB_MECHA_MCP_WEBHOOK_SECRET:?Set GITHUB_MECHA_MCP_WEBHOOK_SECRET before running}"

echo "==> Installing binary"
cp /tmp/mecha-mcp /usr/local/bin/mecha-mcp
chmod +x /usr/local/bin/mecha-mcp

echo "==> Cloning repo for docs"
if [ ! -d /opt/mecha ]; then
  git clone https://github.com/xiaolai/mecha.im.git /opt/mecha
  chown -R www-data:www-data /opt/mecha
else
  git -C /opt/mecha fetch origin
  git -C /opt/mecha reset --hard origin/main
  chown -R www-data:www-data /opt/mecha
fi

echo "==> Installing systemd service"
cat > /etc/systemd/system/mecha-mcp.service << 'EOF'
[Unit]
Description=Mecha MCP Documentation Server
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
ExecStart=/usr/local/bin/mecha-mcp
Environment=ADDR=127.0.0.1:8090
Environment=DOCS_DIR=/opt/mecha/website/guide
Environment=REPO_DIR=/opt/mecha
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "==> Setting webhook secret"
mkdir -p /etc/systemd/system/mecha-mcp.service.d
cat > /etc/systemd/system/mecha-mcp.service.d/secret.conf << EOF
[Service]
Environment=GITHUB_MECHA_MCP_WEBHOOK_SECRET=${WEBHOOK_SECRET}
EOF
chmod 600 /etc/systemd/system/mecha-mcp.service.d/secret.conf

echo "==> Configuring Caddy"
# Add mcp.mecha.im reverse proxy if not already configured
if ! grep -q "mcp.mecha.im" /etc/caddy/Caddyfile 2>/dev/null; then
  cat >> /etc/caddy/Caddyfile << 'EOF'

mcp.mecha.im {
  reverse_proxy 127.0.0.1:8090
}
EOF
  systemctl reload caddy
  echo "    Caddy configured and reloaded"
else
  echo "    Caddy already configured for mcp.mecha.im"
fi

echo "==> Starting service"
systemctl daemon-reload
systemctl enable mecha-mcp
systemctl restart mecha-mcp

echo "==> Verifying"
sleep 2
systemctl is-active mecha-mcp
curl -s http://127.0.0.1:8090/health
echo ""

echo "==> Done! MCP server running at https://mcp.mecha.im"
