# syntax=docker/dockerfile:1.7

FROM nginx:1.29-alpine

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Wecog Web" \
      org.opencontainers.image.source="https://github.com/web-emocog/web-emocog-core" \
      org.opencontainers.image.revision="${VCS_REF}"

RUN rm -rf /usr/share/nginx/html/* && \
    mkdir -p /tmp/nginx-client-body /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi && \
    chown -R nginx:nginx /tmp/nginx-client-body /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi

COPY docker/web/nginx.conf /etc/nginx/nginx.conf
COPY index.html /usr/share/nginx/html/index.html
COPY apps/participant-web /usr/share/nginx/html/apps/participant-web
COPY apps/researcher-web /usr/share/nginx/html/apps/researcher-web
COPY apps/shared /usr/share/nginx/html/apps/shared
COPY apps/web /usr/share/nginx/html/apps/web
COPY Audio_detection/browser/*.mjs /usr/share/nginx/html/Audio_detection/browser/
COPY packages/shared/multimodal/*.mjs /usr/share/nginx/html/packages/shared/multimodal/
COPY lib /usr/share/nginx/html/lib

RUN chown -R nginx:nginx /usr/share/nginx/html

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:8080/healthz"]

CMD ["sh", "-c", "mkdir -p /tmp/nginx-client-body /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi && exec nginx -g 'daemon off;'"]
