# Build client
FROM crpi-w68av1ccsmi71363.cn-beijing.personal.cr.aliyuncs.com/misaka19327/bun:1 AS client-builder
WORKDIR /app/client
COPY client/package.json client/bun.lock* ./
RUN bun install --frozen-lockfile
COPY client/ ./
RUN bun run build

# Build server
FROM crpi-w68av1ccsmi71363.cn-beijing.personal.cr.aliyuncs.com/misaka19327/bun:1 AS server-builder
WORKDIR /app/server
COPY server/package.json server/bun.lock* ./
RUN bun install --frozen-lockfile
COPY server/ ./

# Docker CLI used by the env editor to run docker-compose against the mounted host socket.
FROM docker:28-cli AS docker-cli

# Production image
FROM crpi-w68av1ccsmi71363.cn-beijing.personal.cr.aliyuncs.com/misaka19327/bun:1-slim
WORKDIR /app/server

# Copy server source + deps
COPY --from=server-builder /app/server /app/server

# Copy client build output
COPY --from=client-builder /app/client/dist /app/client/dist

# Copy Docker CLI and compose/buildx plugins for docker-compose rebuilds.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
RUN printf '#!/bin/sh\nexec docker compose "$@"\n' > /usr/local/bin/docker-compose \
    && chmod +x /usr/local/bin/docker-compose

# Data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

ENV STORAGE_TYPE=sqlite
ENV SQLITE_PATH=/app/data/logs.db
ENV DOCKER_SOCKET=/var/run/docker.sock
ENV HOST=0.0.0.0
ENV PORT=3000
ENV TIMEZONE=Asia/Shanghai
ENV TZ=Asia/Shanghai
ENV JWT_TTL_SECONDS=86400
ENV RETAIN_LOGS_ON_RESTART=true

CMD ["bun", "run", "src/index.ts"]
