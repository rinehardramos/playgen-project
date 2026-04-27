FROM node:20-slim

# Install claude-code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY relay.mjs .

# Auth is persisted here — mount as a named volume so login survives restarts
VOLUME /root/.claude

EXPOSE 3099

CMD ["node", "relay.mjs"]
