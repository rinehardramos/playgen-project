#!/bin/sh
set -e

# Auto-detect an IPv4 DNS resolver from /etc/resolv.conf.
# We skip IPv6 nameservers (contain ':') because nginx resolver with
# ipv6=off requires an IPv4 address.
DNS_RESOLVER=$(grep '^nameserver' /etc/resolv.conf | awk '{print $2}' | grep -v ':' | head -1)
if [ -z "$DNS_RESOLVER" ]; then
    # Fallback: try first nameserver regardless of type but switch to IPv6 syntax
    DNS_RESOLVER="8.8.8.8"
    echo "[gateway] WARNING: no IPv4 nameserver found, using fallback $DNS_RESOLVER"
else
    echo "[gateway] DNS_RESOLVER=$DNS_RESOLVER"
fi
export DNS_RESOLVER

# Substitute env vars in nginx template (explicit list so other $ signs are untouched)
envsubst '${AUTH_HOST} ${STATION_HOST} ${LIBRARY_HOST} ${SCHEDULER_HOST} ${PLAYLIST_HOST} ${ANALYTICS_HOST} ${FRONTEND_HOST} ${DNS_RESOLVER} ${ALLOWED_ORIGIN}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[gateway] Starting nginx"
exec nginx -g 'daemon off;'
