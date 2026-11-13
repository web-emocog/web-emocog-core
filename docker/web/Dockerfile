# syntax=docker/dockerfile:1.7

FROM node:25-alpine AS public-files
WORKDIR /source
COPY docker/web/public-files.json docker/web/stage-public.mjs ./docker/web/
COPY index.html ./index.html
COPY apps/participant-web ./apps/participant-web
COPY apps/shared ./apps/shared
COPY apps/web ./apps/web
COPY Audio_detection/browser/*.mjs ./Audio_detection/browser/
COPY packages/shared/multimodal/*.mjs ./packages/shared/multimodal/
COPY lib ./lib
RUN node docker/web/stage-public.mjs /source /public

FROM nginx:1.29-alpine

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Wecog Web" \
      org.opencontainers.image.source="https://github.com/web-emocog/web-emocog-core" \
      org.opencontainers.image.revision="${VCS_REF}"

RUN rm -rf /usr/share/nginx/html/* && \
    mkdir -p /tmp/nginx-client-body /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi && \
    chown -R nginx:nginx /tmp/nginx-client-body /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi

COPY docker/web/nginx.conf /etc/nginx/nginx.conf
COPY --from=public-files /public/ /usr/share/nginx/html/

RUN chown -R nginx:nginx /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:8080/healthz"]

CMD ["sh", "-c", "mkdir -p /tmp/nginx-client-body /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi && exec nginx -g 'daemon off;'"]
