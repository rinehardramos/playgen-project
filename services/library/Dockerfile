FROM node:25-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY shared/types/package.json ./shared/types/
COPY shared/middleware/package.json ./shared/middleware/
COPY shared/storage/package.json ./shared/storage/
COPY services/library/package.json ./services/library/
RUN pnpm install --no-frozen-lockfile
COPY shared/types ./shared/types
COPY shared/middleware ./shared/middleware
COPY shared/storage ./shared/storage
COPY services/library ./services/library
COPY tsconfig.base.json ./
RUN pnpm --filter @playgen/types build
RUN pnpm --filter @playgen/middleware build
RUN pnpm --filter @playgen/storage build
RUN pnpm --filter @playgen/library-service build

FROM node:25-alpine
WORKDIR /app
RUN apk add --no-cache python3 py3-pip ffmpeg && \
    pip3 install --break-system-packages yt-dlp
RUN npm install -g pnpm
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared/types/package.json ./shared/types/
COPY --from=builder /app/shared/types/dist ./shared/types/dist
COPY --from=builder /app/shared/middleware/package.json ./shared/middleware/
COPY --from=builder /app/shared/middleware/dist ./shared/middleware/dist
COPY --from=builder /app/shared/storage/package.json ./shared/storage/
COPY --from=builder /app/shared/storage/dist ./shared/storage/dist
COPY --from=builder /app/services/library/package.json ./services/library/
COPY --from=builder /app/services/library/dist ./services/library/dist
RUN pnpm install --prod --no-frozen-lockfile
EXPOSE 3003
CMD ["node", "services/library/dist/index.js"]
