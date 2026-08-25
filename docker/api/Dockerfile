# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies

WORKDIR /app/apps/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Wecog API" \
      org.opencontainers.image.source="https://github.com/web-emocog/web-emocog-core" \
      org.opencontainers.image.revision="${VCS_REF}"

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      ca-certificates \
      fonts-dejavu-core \
      libreoffice-impress \
      poppler-utils \
      postgresql-client \
      python3 \
      tini && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 10001 wecog && \
    useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin wecog && \
    install --directory --owner=10001 --group=10001 --mode=0750 /var/lib/wecog/uploads

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    RT_PYTHON=python3 \
    HOME=/tmp

WORKDIR /app/apps/api
COPY --from=dependencies --chown=10001:10001 /app/apps/api/node_modules ./node_modules
COPY --chown=10001:10001 apps/api ./
COPY --chown=10001:10001 apps/shared /app/apps/shared
COPY --chown=10001:10001 rt_component- /app/rt_component-

USER 10001:10001
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
  CMD ["node", "-e", "require('http').get({host:'127.0.0.1',port:3000,path:'/ready',headers:{'X-Forwarded-Proto':'https'}},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
