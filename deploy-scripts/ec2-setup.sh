#!/usr/bin/env bash
# One-time EC2 provisioning for ugpt backend
# Run on a fresh Ubuntu 24.04 ARM64 t4g.nano instance
set -euo pipefail

echo "==> Installing Node.js 20 LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx

echo "==> Creating ugpt system user..."
sudo useradd --system --shell /bin/false ugpt 2>/dev/null || true

echo "==> Creating app directories..."
sudo mkdir -p /opt/ugpt/blue /opt/ugpt/green
sudo chown -R ugpt:ugpt /opt/ugpt

echo "==> Creating .env file (edit with real values)..."
sudo tee /opt/ugpt/.env > /dev/null <<'ENV'
OPENROUTER_API_KEY=REPLACE_ME
EXA_API_KEY=REPLACE_ME
MODEL=minimax/minimax-m2.5
DAILY_BUDGET=1.00
ENV
sudo chown ugpt:ugpt /opt/ugpt/.env
sudo chmod 600 /opt/ugpt/.env

echo "==> Configuring nginx..."
sudo tee /etc/nginx/sites-available/ugpt > /dev/null <<'NGINX'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE streaming support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/ugpt /etc/nginx/sites-enabled/ugpt
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl enable --now nginx

echo "==> Creating 512MB swapfile (critical for t4g.nano)..."
if [ ! -f /swapfile ]; then
  sudo fallocate -l 512M /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo ""
echo "========================================="
echo "EC2 setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit /opt/ugpt/.env with real API keys"
echo "  2. For HTTPS: sudo certbot --nginx -d api.ugpt.ca"
echo "  3. Push to main branch to trigger deploy"
echo "========================================="
