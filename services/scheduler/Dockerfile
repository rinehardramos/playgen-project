FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY shared/types/package.json ./shared/types/
COPY shared/middleware/package.json ./shared/middleware/
COPY services/scheduler/package.json ./services/scheduler/
RUN pnpm install --no-frozen-lockfile
COPY shared/types ./shared/types
COPY shared/middleware ./shared/middleware
COPY services/scheduler ./services/scheduler
COPY tsconfig.base.json ./
RUN pnpm --filter @playgen/types build
RUN pnpm --filter @playgen/middleware build
RUN pnpm --filter @playgen/scheduler-service build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared/types/package.json ./shared/types/
COPY --from=builder /app/shared/types/dist ./shared/types/dist
COPY --from=builder /app/shared/middleware/package.json ./shared/middleware/
COPY --from=builder /app/shared/middleware/dist ./shared/middleware/dist
COPY --from=builder /app/services/scheduler/package.json ./services/scheduler/
COPY --from=builder /app/services/scheduler/dist ./services/scheduler/dist
RUN pnpm install --prod --no-frozen-lockfile
EXPOSE 3004
CMD ["node", "services/scheduler/dist/index.js"]
