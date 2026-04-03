#!/usr/bin/env bash
# setup-vps.sh — one-time VPS bootstrap script
# Run as root on a fresh Ubuntu 22.04 / Debian 12 server.
# Tested on: Hetzner CX22, Oracle Cloud ARM, DigitalOcean Droplet
#
# Usage:
#   curl -sL https://raw.githubusercontent.com/<org>/playgen/main/scripts/setup-vps.sh | bash
# or copy to server and:
#   chmod +x setup-vps.sh && sudo ./setup-vps.sh

set -euo pipefail

APP_DIR="/opt/playgen"
REPO_URL="${REPO_URL:-https://github.com/rinehardramos/playgen-project.git}"
DEPLOY_USER="${DEPLOY_USER:-playgen}"

echo "==> Updating system packages"
apt-get update -qq && apt-get upgrade -y -qq

echo "==> Installing Docker"
apt-get install -y -qq ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Creating deploy user: $DEPLOY_USER"
id "$DEPLOY_USER" &>/dev/null || useradd -m -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"

echo "==> Cloning repository to $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

echo "==> Creating .env (copy .env.example and edit before first deploy)"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo ""
  echo "  !! ACTION REQUIRED: edit $APP_DIR/.env with production secrets before continuing"
  echo "     Minimum: POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ADMIN_PASSWORD, PUBLIC_URL"
fi

echo "==> Enabling Docker on boot"
systemctl enable docker

echo ""
echo "Setup complete."
echo ""
echo "Next steps:"
echo "  1. Edit $APP_DIR/.env with your production values"
echo "  2. cd $APP_DIR && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d"
echo "  3. (Optional) Point your domain DNS A record to this server's IP, then add SSL:"
echo "     See scripts/setup-ssl.sh"
