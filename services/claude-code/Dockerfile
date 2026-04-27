FROM node:20-slim

# Install claude-code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Non-root user required — claude refuses --dangerously-skip-permissions as root
RUN useradd -m -u 1001 claude
USER claude
WORKDIR /home/claude/app
COPY --chown=claude:claude relay.mjs .

# Auth is persisted here — mount as a named volume so login survives restarts
VOLUME /home/claude/.claude

EXPOSE 3099

CMD ["node", "relay.mjs"]
