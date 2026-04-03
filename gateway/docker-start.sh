#!/bin/sh
set -e

# Auto-detect the DNS resolver from /etc/resolv.conf (works on Docker Compose
# and Railway — avoids hardcoding 127.0.0.11 which is Docker-only).
DNS_RESOLVER=$(grep -m1 '^nameserver' /etc/resolv.conf | awk '{print $2}')
echo "[gateway] DNS_RESOLVER=$DNS_RESOLVER"
export DNS_RESOLVER

# Run envsubst with an explicit variable list so unrelated dollar-signs in
# nginx config are left untouched.
envsubst '${AUTH_HOST} ${STATION_HOST} ${LIBRARY_HOST} ${SCHEDULER_HOST} ${PLAYLIST_HOST} ${ANALYTICS_HOST} ${FRONTEND_HOST} ${DNS_RESOLVER} ${ALLOWED_ORIGIN}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[gateway] nginx config written — starting nginx"
exec nginx -g 'daemon off;'
