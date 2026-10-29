# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 静态站点与同源 API 代理。
FROM nginx:1.27-alpine

ENV CANVAS_API_UPSTREAM=http://host.docker.internal:8080
ENV CANVAS_JOBS_UPSTREAM=http://host.docker.internal:18081
ENV CANVAS_FRAME_ANCESTORS=""
ENV NGINX_ENVSUBST_FILTER=^CANVAS_(API_UPSTREAM|JOBS_UPSTREAM|FRAME_ANCESTORS)$

COPY --from=web-build /app/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY deploy/nginx-api-proxy.conf /etc/nginx/snippets/canvas-api-proxy.conf
COPY web/docker-entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh

EXPOSE 3000
