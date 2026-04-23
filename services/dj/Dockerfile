FROM node:25-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY shared/types/package.json ./shared/types/
COPY shared/middleware/package.json ./shared/middleware/
COPY shared/info-broker-client/package.json ./shared/info-broker-client/
COPY shared/storage/package.json ./shared/storage/
COPY services/dj/package.json ./services/dj/
RUN pnpm install --no-frozen-lockfile
COPY shared/types ./shared/types
COPY shared/middleware ./shared/middleware
COPY shared/info-broker-client ./shared/info-broker-client
COPY shared/storage ./shared/storage
COPY services/dj ./services/dj
COPY tsconfig.base.json ./
RUN pnpm --filter @playgen/types build
RUN pnpm --filter @playgen/middleware build
RUN pnpm --filter @playgen/info-broker-client build
RUN pnpm --filter @playgen/storage build
RUN pnpm --filter @playgen/dj-service build

FROM node:25-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared/types/package.json ./shared/types/
COPY --from=builder /app/shared/types/dist ./shared/types/dist
COPY --from=builder /app/shared/middleware/package.json ./shared/middleware/
COPY --from=builder /app/shared/middleware/dist ./shared/middleware/dist
COPY --from=builder /app/shared/info-broker-client/package.json ./shared/info-broker-client/
COPY --from=builder /app/shared/info-broker-client/dist ./shared/info-broker-client/dist
COPY --from=builder /app/shared/storage/package.json ./shared/storage/
COPY --from=builder /app/shared/storage/dist ./shared/storage/dist
COPY --from=builder /app/services/dj/package.json ./services/dj/
COPY --from=builder /app/services/dj/dist ./services/dj/dist
RUN pnpm install --prod --no-frozen-lockfile
EXPOSE 3007
CMD ["node", "services/dj/dist/index.js"]
