#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${CI:-}" != "true" && "${CI_POSTGRES_ALLOW_LOCAL:-}" != "YES" ]]; then
  echo 'This disposable PostgreSQL fixture is restricted to CI or an explicit local test.' >&2
  exit 2
fi

container="${CI_POSTGRES_CONTAINER:-wecog-ci-postgres}"
port="${CI_POSTGRES_PORT:-5432}"
if [[ ! "$container" =~ ^wecog-[a-zA-Z0-9_-]+$ || ! "$port" =~ ^[0-9]{4,5}$ ]] \
  || (( 10#$port < 1024 || 10#$port > 65535 )); then
  echo 'Invalid disposable PostgreSQL container name or port.' >&2
  exit 2
fi
if docker container inspect "$container" >/dev/null 2>&1; then
  echo 'Refusing to replace an existing container.' >&2
  exit 2
fi

digest='sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297'
image=''
for repository in mirror.gcr.io/library/postgres docker.io/library/postgres; do
  candidate="${repository}:16.10-alpine@${digest}"
  if timeout 90s docker pull "$candidate"; then
    image="$candidate"
    break
  fi
  echo "Unable to pull ${repository}; trying the next pinned source." >&2
done
if [[ -z "$image" ]]; then
  echo 'No verified PostgreSQL image was available; release tests cannot proceed.' >&2
  exit 1
fi

created=0
ready=0
cleanup_failed_start() {
  if (( created == 1 && ready == 0 )); then
    docker logs "$container" >&2 || true
    docker rm --force "$container" >/dev/null 2>&1 || true
  fi
}
trap cleanup_failed_start EXIT
docker run --detach --rm --name "$container" \
  --publish "127.0.0.1:${port}:5432" \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=postgres --env POSTGRES_DB=emocog_test \
  --health-cmd 'pg_isready -U postgres -d emocog_test' --health-interval 2s --health-timeout 3s --health-retries 30 \
  "$image" >/dev/null
created=1
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -d emocog_test >/dev/null 2>&1; then
    ready=1
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then printf 'container=%s\n' "$container" >> "$GITHUB_OUTPUT"; fi
    echo 'Disposable PostgreSQL is ready.'
    exit 0
  fi
  sleep 1
done
echo 'PostgreSQL did not become ready within the startup deadline.' >&2
exit 1
