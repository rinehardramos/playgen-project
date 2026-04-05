FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

# Copy workspace manifests
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY shared/types/package.json ./shared/types/
COPY shared/middleware/package.json ./shared/middleware/
COPY services/auth/package.json ./services/auth/

RUN pnpm install --no-frozen-lockfile

# Copy source
COPY shared/types ./shared/types
COPY shared/middleware ./shared/middleware
COPY services/auth ./services/auth
COPY tsconfig.base.json ./

# Build shared packages first, then auth service
RUN pnpm --filter @playgen/types build
RUN pnpm --filter @playgen/middleware build
RUN pnpm --filter @playgen/auth-service build

# ── Runtime ──────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared/types/package.json ./shared/types/
COPY --from=builder /app/shared/types/dist ./shared/types/dist
COPY --from=builder /app/shared/middleware/package.json ./shared/middleware/
COPY --from=builder /app/shared/middleware/dist ./shared/middleware/dist
COPY --from=builder /app/services/auth/package.json ./services/auth/
COPY --from=builder /app/services/auth/dist ./services/auth/dist

RUN pnpm install --prod --no-frozen-lockfile

EXPOSE 3001
CMD ["node", "services/auth/dist/index.js"]
