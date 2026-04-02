FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

# Copy workspace manifests from project root (context = .)
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY shared/db/package.json ./shared/db/

RUN pnpm install --no-frozen-lockfile

COPY shared/db/src ./shared/db/src
COPY shared/db/tsconfig.json ./shared/db/

RUN pnpm --filter @playgen/db build
# Copy SQL migration files into dist (tsc does not copy non-TS assets)
COPY shared/db/src/migrations ./shared/db/dist/migrations

FROM node:20-alpine
WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared/db/package.json ./shared/db/
COPY --from=builder /app/shared/db/dist ./shared/db/dist

RUN pnpm install --prod --no-frozen-lockfile

WORKDIR /app/shared/db
CMD ["node", "dist/migrate.js"]
