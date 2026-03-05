#!/usr/bin/env bash
# Blue/green deployment script — runs on EC2 via GitHub Actions
set -euo pipefail

APP_DIR="/opt/ugpt"
DEPLOY_SRC="/tmp/deploy-staging"

# Determine which slot is active (blue=3001, green=3002)
ACTIVE_PORT=$(grep -oP 'proxy_pass http://127.0.0.1:\K\d+' /etc/nginx/sites-enabled/ugpt 2>/dev/null || echo "3001")

if [ "$ACTIVE_PORT" = "3001" ]; then
  DEPLOY_SLOT="green"
  DEPLOY_PORT="3002"
else
  DEPLOY_SLOT="blue"
  DEPLOY_PORT="3001"
fi

echo "==> Active: port $ACTIVE_PORT. Deploying to: $DEPLOY_SLOT (port $DEPLOY_PORT)"

# Copy new bundle
mkdir -p "$APP_DIR/$DEPLOY_SLOT"
cp "$DEPLOY_SRC/server.mjs" "$APP_DIR/$DEPLOY_SLOT/server.mjs"
chown -R ugpt:ugpt "$APP_DIR/$DEPLOY_SLOT"

# Create/update systemd service for the deploy slot
cat > "/etc/systemd/system/ugpt-${DEPLOY_SLOT}.service" <<UNIT
[Unit]
Description=ugpt server ($DEPLOY_SLOT)
After=network.target

[Service]
Type=simple
User=ugpt
WorkingDirectory=$APP_DIR/$DEPLOY_SLOT
ExecStart=/usr/bin/node --max-old-space-size=256 server.mjs
Restart=on-failure
RestartSec=3
Environment=PORT=$DEPLOY_PORT
EnvironmentFile=$APP_DIR/.env

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl restart "ugpt-${DEPLOY_SLOT}.service"

# Health check (up to 15 seconds)
echo "==> Waiting for health check on port $DEPLOY_PORT..."
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:${DEPLOY_PORT}/health" > /dev/null 2>&1; then
    echo "==> Health check passed on attempt $i"
    break
  fi
  if [ "$i" = "15" ]; then
    echo "==> HEALTH CHECK FAILED. Rolling back."
    systemctl stop "ugpt-${DEPLOY_SLOT}.service"
    exit 1
  fi
  sleep 1
done

# Switch nginx to the new slot
sed -i "s|proxy_pass http://127.0.0.1:[0-9]*;|proxy_pass http://127.0.0.1:${DEPLOY_PORT};|" \
  /etc/nginx/sites-enabled/ugpt

nginx -t && systemctl reload nginx

echo "==> Deployed $DEPLOY_SLOT on port $DEPLOY_PORT."

# Stop the old slot
if [ "$DEPLOY_SLOT" = "green" ]; then
  systemctl stop ugpt-blue.service 2>/dev/null || true
else
  systemctl stop ugpt-green.service 2>/dev/null || true
fi

# Cleanup old slot's bundle
if [ "$DEPLOY_SLOT" = "green" ]; then
  rm -f "$APP_DIR/blue/server.mjs"
else
  rm -f "$APP_DIR/green/server.mjs"
fi

echo "==> Done. $DEPLOY_SLOT is live."
