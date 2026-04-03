#!/usr/bin/env bash
# setup-ssl.sh — add free Let's Encrypt SSL via Certbot + nginx
# Run AFTER setup-vps.sh, once your domain DNS points to this server.
#
# Usage:
#   DOMAIN=playgen.example.com EMAIL=you@example.com ./scripts/setup-ssl.sh

set -euo pipefail

DOMAIN="${DOMAIN:?Set DOMAIN=your.domain.com}"
EMAIL="${EMAIL:?Set EMAIL=you@example.com}"

echo "==> Installing Certbot"
apt-get install -y -qq certbot

echo "==> Stopping nginx gateway to free port 80"
docker compose -f /opt/playgen/docker-compose.yml stop gateway || true

echo "==> Obtaining certificate for $DOMAIN"
certbot certonly --standalone \
  --non-interactive --agree-tos \
  --email "$EMAIL" \
  -d "$DOMAIN"

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

echo "==> Updating gateway/nginx.conf for HTTPS"
# Append a 443 server block and redirect 80→443
cat >> /opt/playgen/gateway/nginx.conf << NGINX

# ─── HTTPS server (added by setup-ssl.sh) ─────────────────────────────────────
server {
    listen 443 ssl;
    server_name $DOMAIN;

    ssl_certificate     $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    include /etc/nginx/conf.d/locations.conf;
}

server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
NGINX

echo "==> Mounting certificates into gateway container"
# Add volume mount via docker-compose override
cat > /opt/playgen/docker-compose.ssl.yml << YML
services:
  gateway:
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
YML

echo "==> Restarting gateway with SSL"
docker compose \
  -f /opt/playgen/docker-compose.yml \
  -f /opt/playgen/docker-compose.prod.yml \
  -f /opt/playgen/docker-compose.ssl.yml \
  up -d gateway

echo ""
echo "SSL setup complete. PlayGen is now available at https://$DOMAIN"
echo ""
echo "Auto-renewal: add this cron entry (runs daily at 02:30):"
echo "  30 2 * * * certbot renew --quiet && docker compose -f /opt/playgen/docker-compose.yml restart gateway"
