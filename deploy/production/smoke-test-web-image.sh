#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 || -z ${1} ]]; then
  echo "Usage: $0 <web-image>" >&2
  exit 64
fi

readonly IMAGE=$1
readonly CONTAINER_NAME="wecog-web-smoke-${GITHUB_RUN_ID:-local}-$$"
container_started=false

cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ ${container_started} == true ]]; then
    if (( exit_code != 0 )); then
      docker logs "${CONTAINER_NAME}" >&2 || true
    fi
    docker rm --force "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
  exit "${exit_code}"
}
trap cleanup EXIT

for command in curl docker find grep sed seq sleep tr; do
  command -v "${command}" >/dev/null || {
    echo "Required command is missing: ${command}" >&2
    exit 69
  }
done

docker run \
  --detach \
  --name "${CONTAINER_NAME}" \
  --publish 127.0.0.1::8080 \
  "${IMAGE}" \
  >/dev/null
container_started=true

host_port=$(docker port "${CONTAINER_NAME}" 8080/tcp | sed -n '1s/.*://p')
if [[ ! ${host_port} =~ ^[0-9]+$ ]]; then
  echo "Unable to determine the published web-container port." >&2
  exit 70
fi
readonly BASE_URL="http://127.0.0.1:${host_port}"

ready=false
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "${BASE_URL}/healthz" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
if [[ ${ready} != true ]]; then
  echo "The web container did not become healthy." >&2
  exit 1
fi

expect_status() {
  local path=$1 expected=$2 actual
  actual=$(curl \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${BASE_URL}${path}")
  if [[ ${actual} != "${expected}" ]]; then
    echo "Expected ${path} to return ${expected}, got ${actual}." >&2
    return 1
  fi
}

expect_header() {
  local path=$1 expected=$2
  if ! curl \
    --fail \
    --silent \
    --show-error \
    --dump-header - \
    --output /dev/null \
    "${BASE_URL}${path}" \
    | tr -d '\r' \
    | grep --fixed-strings --ignore-case --quiet "${expected}"; then
    echo "Expected ${path} headers to contain: ${expected}" >&2
    return 1
  fi
}

expect_javascript_mime() {
  local path=$1
  if ! curl \
    --fail \
    --silent \
    --show-error \
    --dump-header - \
    --output /dev/null \
    "${BASE_URL}${path}" \
    | tr -d '\r' \
    | grep --extended-regexp --ignore-case --quiet \
        '^Content-Type: (application|text)/javascript(;|$)'; then
    echo "Expected ${path} to use a JavaScript MIME type." >&2
    return 1
  fi
}

expect_status / 200
expect_status /apps/participant-web/run_new.html 200
expect_status /apps/web/researcher.html 200

while IFS= read -r module; do
  public_path=/${module#./}
  expect_status "${public_path}" 200
  expect_javascript_mime "${public_path}"
done < <(
  find \
    Audio_detection/browser \
    packages/shared/multimodal \
    -type f \
    -name '*.mjs' \
    -print \
    | sort
)

expect_header \
  /apps/participant-web/run_new.html \
  'Permissions-Policy: camera=(self), microphone=(self), geolocation=()'
expect_header \
  /apps/participant-web/run_new.html \
  'Referrer-Policy: no-referrer'
expect_header \
  /apps/web/researcher.html \
  'Permissions-Policy: camera=(), microphone=(), geolocation=()'

for private_path in \
  /.git/config \
  /apps/api/.env \
  /apps/api/package.json \
  /Audio_detection/README.md \
  /packages/shared/multimodal/README.md \
  /packages/shared/contracts/session-feature.v1.schema.json \
  /DEPLOY_VERSION.txt; do
  expect_status "${private_path}" 404
done

expect_status /Audio_detection/browser/missing.mjs 404
expect_status /packages/shared/multimodal/missing.mjs 404

echo "Production web image smoke test passed for ${IMAGE}."
