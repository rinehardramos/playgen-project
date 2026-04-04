#!/bin/sh
set -e

# Detect DNS resolver from /etc/resolv.conf.
# Prefer IPv4 (no brackets needed in nginx). If only IPv6 is available,
# wrap it in brackets as nginx requires: resolver [fd12::10] valid=10s;
IPV4_NS=$(grep '^nameserver' /etc/resolv.conf | awk '{print $2}' | grep -v ':' | head -1)
IPV6_NS=$(grep '^nameserver' /etc/resolv.conf | awk '{print $2}' | grep ':' | head -1)

if [ -n "$IPV4_NS" ]; then
    DNS_RESOLVER="$IPV4_NS"
elif [ -n "$IPV6_NS" ]; then
    # nginx requires brackets around IPv6 resolver addresses
    DNS_RESOLVER="[$IPV6_NS]"
else
    DNS_RESOLVER="8.8.8.8"
    echo "[gateway] WARNING: no nameserver found in /etc/resolv.conf, using $DNS_RESOLVER"
fi

echo "[gateway] DNS_RESOLVER=$DNS_RESOLVER"
export DNS_RESOLVER

# Substitute env vars in nginx template (explicit list keeps other $ signs safe)
envsubst '${AUTH_HOST} ${STATION_HOST} ${LIBRARY_HOST} ${SCHEDULER_HOST} ${PLAYLIST_HOST} ${ANALYTICS_HOST} ${DJ_HOST} ${FRONTEND_HOST} ${DNS_RESOLVER} ${ALLOWED_ORIGIN}' \
  < /etc/nginx/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[gateway] Starting nginx"
exec nginx -g 'daemon off;'
