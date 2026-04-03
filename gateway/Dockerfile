FROM nginx:1.25-alpine

# The official nginx image runs envsubst on files in /etc/nginx/templates/
# at container start, outputting to /etc/nginx/conf.d/ with the .template suffix stripped.
# This lets us use ${VAR} placeholders for upstream hostnames.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
