FROM nginx:1.25-alpine

# Custom startup: auto-detects DNS resolver and runs envsubst before nginx.
# Bypasses the nginx Docker template mechanism so env vars are correctly
# propagated (entrypoint.d scripts run in subshells and cannot export vars).
COPY gateway/nginx.conf.template /etc/nginx/nginx.conf.template
COPY gateway/docker-start.sh /docker-start.sh
RUN chmod +x /docker-start.sh

EXPOSE 80
CMD ["/docker-start.sh"]
