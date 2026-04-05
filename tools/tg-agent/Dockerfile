FROM python:3.12-alpine

# Install gh CLI + git
RUN apk add --no-cache curl bash git && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /usr/share/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
    echo "https://cli.github.com/packages stable main" > /etc/apk/repositories && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community github-cli || \
    (curl -L https://github.com/cli/cli/releases/download/v2.65.0/gh_2.65.0_linux_amd64.tar.gz | tar xz -C /usr/local --strip-components=1)

WORKDIR /workspace

COPY bot.py /app/bot.py

CMD ["python3", "/app/bot.py"]
