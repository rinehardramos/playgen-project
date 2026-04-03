FROM nginx:1.25-alpine

# Auto-detect DNS resolver at startup (runs before envsubst on templates)
COPY gateway/10-detect-dns.sh /docker-entrypoint.d/10-detect-dns.sh
RUN chmod +x /docker-entrypoint.d/10-detect-dns.sh

# The official nginx image runs envsubst on files in /etc/nginx/templates/
# at container start, outputting to /etc/nginx/conf.d/ with .template suffix stripped.
COPY gateway/nginx.conf.template /etc/nginx/templates/default.conf.template

# Explicit EXPOSE so Railway detects the correct port
EXPOSE 80
