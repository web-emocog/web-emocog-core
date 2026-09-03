#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || -z ${1} ]]; then
  echo "Usage: $0 <api-image>" >&2
  exit 64
fi

readonly IMAGE=$1
readonly CONTAINER_NAME="wecog-api-smoke-${GITHUB_RUN_ID:-local}-$$"
container_started=false

cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ ${container_started} == true ]]; then
    if (( exit_code != 0 )); then
      docker logs --tail 200 "${CONTAINER_NAME}" >&2 || true
    fi
    docker rm --force "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
  exit "${exit_code}"
}
trap cleanup EXIT

for command in curl docker grep sed seq sleep; do
  command -v "${command}" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 69
  }
done

docker run \
  --detach \
  --name "${CONTAINER_NAME}" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --tmpfs /var/lib/wecog/uploads:rw,noexec,nosuid,nodev,size=16m,mode=0750,uid=10001,gid=10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --no-healthcheck \
  --publish 127.0.0.1::3000 \
  --env NODE_ENV=production \
  --env HOST=0.0.0.0 \
  --env PORT=3000 \
  --env TRUST_PROXY_HOPS=1 \
  --env UPLOADS_ROOT=/var/lib/wecog/uploads \
  --env DATABASE_URL=postgres://wecog:unused@127.0.0.1:1/wecog \
  --env DB_CONNECTION_TIMEOUT_MS=500 \
  --env JWT_SECRET=ci-only-secret-that-is-longer-than-thirty-two-characters \
  "${IMAGE}" \
  >/dev/null
container_started=true

host_port=$(docker port "${CONTAINER_NAME}" 3000/tcp | sed -n '1s/.*://p')
if [[ ! ${host_port} =~ ^[0-9]+$ ]]; then
  echo "Unable to determine the published API-container port." >&2
  exit 70
fi
readonly BASE_URL="http://127.0.0.1:${host_port}"

ready=false
for attempt in $(seq 1 30); do
  if curl \
      --fail \
      --silent \
      --max-time 3 \
      --header 'X-Forwarded-Proto: https' \
      "${BASE_URL}/health" \
      >/dev/null; then
    ready=true
    break
  fi
  if ! docker container inspect \
      --format '{{.State.Running}}' \
      "${CONTAINER_NAME}" \
      2>/dev/null \
      | grep --fixed-strings --quiet true; then
    echo "The API container exited before becoming healthy." >&2
    exit 1
  fi
  sleep 1
done
if [[ ${ready} != true ]]; then
  echo "The API container did not become healthy." >&2
  exit 1
fi

readiness_status=$(curl \
  --silent \
  --show-error \
  --max-time 3 \
  --header 'X-Forwarded-Proto: https' \
  --output /dev/null \
  --write-out '%{http_code}' \
  "${BASE_URL}/ready")
if [[ ${readiness_status} != 503 ]]; then
  echo "Expected /ready to fail closed without PostgreSQL, got ${readiness_status}." >&2
  exit 1
fi

echo "Production API image smoke test passed for ${IMAGE}."
