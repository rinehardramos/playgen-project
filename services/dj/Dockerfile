FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

# Copy workspace manifests
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY shared/types/package.json ./shared/types/
COPY services/dj/package.json ./services/dj/

RUN pnpm install --no-frozen-lockfile

# Copy source
COPY shared/types ./shared/types
COPY services/dj ./services/dj
COPY tsconfig.base.json ./

# Build shared types first, then dj service
RUN pnpm --filter @playgen/types build
RUN pnpm --filter @playgen/dj-service build

# ── Runtime ──────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared/types/package.json ./shared/types/
COPY --from=builder /app/shared/types/dist ./shared/types/dist
COPY --from=builder /app/services/dj/package.json ./services/dj/
COPY --from=builder /app/services/dj/dist ./services/dj/dist

RUN pnpm install --prod --no-frozen-lockfile

# Data volume for audio
RUN mkdir -p /app/data/audio
VOLUME /app/data/audio

EXPOSE 3007
CMD ["node", "services/dj/dist/index.js"]
