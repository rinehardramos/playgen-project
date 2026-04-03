#!/bin/sh
# Auto-detect the container's DNS resolver from /etc/resolv.conf
# if DNS_RESOLVER is not explicitly set.
if [ -z "$DNS_RESOLVER" ]; then
    export DNS_RESOLVER=$(grep -m1 nameserver /etc/resolv.conf | awk '{print $2}')
    echo "[gateway] Auto-detected DNS_RESOLVER=$DNS_RESOLVER"
else
    echo "[gateway] Using DNS_RESOLVER=$DNS_RESOLVER"
fi
