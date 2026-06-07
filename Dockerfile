# Build client
FROM oven/bun:1 AS client-builder
WORKDIR /app/client
COPY client/package.json client/bun.lock* ./
RUN bun install --frozen-lockfile
COPY client/ ./
RUN bun run build

# Build server
FROM oven/bun:1 AS server-builder
WORKDIR /app/server
COPY server/package.json server/bun.lock* ./
RUN bun install --frozen-lockfile
COPY server/ ./

# Production image
FROM oven/bun:1-slim
WORKDIR /app/server

# Copy server source + deps
COPY --from=server-builder /app/server /app/server

# Copy client build output
COPY --from=client-builder /app/client/dist /app/client/dist

# Data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

ENV STORAGE_TYPE=sqlite
ENV SQLITE_PATH=/app/data/logs.db
ENV DOCKER_SOCKET=/var/run/docker.sock
ENV HOST=0.0.0.0
ENV PORT=3000
ENV JWT_TTL_SECONDS=86400
ENV RETAIN_LOGS_ON_RESTART=true

CMD ["bun", "run", "src/index.ts"]
