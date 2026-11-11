#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/../../.."
root=$PWD
: "${MEDIA_TEST_API_IMAGE:?Build a local API image and set MEDIA_TEST_API_IMAGE}"
if [[ -e apps/api/.env ]]; then
 echo 'Refusing a worktree with apps/api/.env: its values override the isolated test environment.'; exit 2
fi
docker image inspect "$MEDIA_TEST_API_IMAGE" >/dev/null
docker image inspect postgres:16-alpine >/dev/null
out=$(mktemp -d "${TMPDIR:-/tmp}/wecog-stimulus-check.XXXXXX")
chmod 700 "$out"
dbname=wecog-stimulus-check-$$-db
apiname=wecog-stimulus-check-$$-api
test_password=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')
for name in "$dbname" "$apiname"; do
  if docker inspect "$name" >/dev/null 2>&1; then echo "Refusing existing test container $name"; exit 2; fi
done
created_db=0; created_api=0
cleanup() {
 if [[ "$created_api" == 1 ]]; then docker logs "$apiname" > "$out/api.log" 2>&1 || true; docker stop "$apiname" >/dev/null || true; fi
 if [[ "$created_db" == 1 ]]; then docker stop "$dbname" >/dev/null || true; fi
 echo "Evidence: $out"
}
trap cleanup EXIT
docker run -d --rm --name "$dbname" --memory 768m --cpus 2 --tmpfs /var/lib/postgresql/data:rw \
 -p 127.0.0.1::3000 \
 -e POSTGRES_USER=postgres -e "POSTGRES_PASSWORD=$test_password" -e POSTGRES_DB=wecog_stimulus_test postgres:16-alpine >/dev/null
created_db=1
for i in $(seq 1 30); do if docker exec "$dbname" pg_isready -U postgres -d wecog_stimulus_test >/dev/null 2>&1; then break; fi; sleep 1; done
apiport=$(docker port "$dbname" 3000/tcp | awk -F: '{print $NF}')
db="postgres://postgres:$test_password@127.0.0.1:5432/wecog_stimulus_test"
common=(--network "container:$dbname" --read-only --tmpfs /tmp:rw,exec,size=2g,mode=1777 --memory 1g --cpus 2 --user "$(id -u):$(id -g)"
 --mount "type=bind,src=$root,dst=/repo,readonly" --mount "type=bind,src=$out,dst=/test-output" -w /repo/apps/api
 -e "DATABASE_URL=$db" -e "MEDIA_TEST_DATABASE_URL=$db" -e "S2_TEST_DATABASE_URL=$db"
 -e JWT_SECRET=synthetic-stimulus-check-secret-not-for-real-users-1111 -e NODE_ENV=test -e FORCE_HTTPS=false
 -e RATE_LIMIT_STORE=postgres -e CORS_ORIGINS=http://127.0.0.1:4237 -e UPLOADS_ROOT=/test-output/uploads
 -e LIVE_STIMULUS_FIXTURE=/test-output/fixture.json --entrypoint sh)
docker run --rm "${common[@]}" "$MEDIA_TEST_API_IMAGE" -lc 'set -e; mkdir -p /test-output/uploads/stimuli; npm run migrate:up > /test-output/migrations.log 2>&1' > "$out/setup.log" 2>&1 || { tail -n 40 "$out/setup.log"; exit 1; }
start_api() {
 docker run -d --rm --name "$apiname" "${common[@]}" "$@" "$MEDIA_TEST_API_IMAGE" -lc 'node server.js' >/dev/null
 created_api=1
 for i in $(seq 1 30); do if curl --max-time 2 -fsS "http://127.0.0.1:$apiport/health" >/dev/null 2>&1; then return; fi; sleep 1; done
 docker logs "$apiname"; return 1
}
start_api
docker exec -e MEDIA_LOAD_TEST_ISOLATED=YES \
 -e MEDIA_LOAD_TEST_REPORT=/test-output/load-report.json "$apiname" node scripts/load-stimuli.js > "$out/load.log" 2>&1 || { tail -n 30 "$out/load.log"; exit 1; }
cat "$out/load-report.json"
docker logs "$apiname" > "$out/api-load.log" 2>&1
docker stop "$apiname" >/dev/null; created_api=0
# Only this disposable database is reset. The user's running application is untouched.
docker exec "$dbname" psql -U postgres -d wecog_stimulus_test -c 'TRUNCATE http_rate_windows' >/dev/null
# Fixture tests perform many valid logins. Only their login budget is raised;
# the preceding load benchmark uses all unmodified production rate defaults.
start_api -e AUTH_RATE_LIMIT_PER_MINUTE=1000
node - "$out/fixture.json" "$apiport" <<'JS'
const fs=require('fs'); const file=process.argv[2];const fixture=JSON.parse(fs.readFileSync(file,'utf8'));fixture.apiBase='http://127.0.0.1:'+process.argv[3];fs.writeFileSync(file,JSON.stringify(fixture),{mode:0o600});
JS
cd apps/autotests
for engine in chromium firefox webkit; do
 # Each browser gets a fresh test window, like independent CI matrix jobs.
 docker exec "$dbname" psql -U postgres -d wecog_stimulus_test -c 'TRUNCATE http_rate_windows' >/dev/null
 LIVE_STIMULUS_FIXTURE="$out/fixture.json" npx playwright test --config=playwright.stimulus-live.config.ts --project="$engine" --max-failures=1 > "$out/browser-$engine.log" 2>&1 || { tail -n 80 "$out/browser-$engine.log"; exit 1; }
 tail -n 3 "$out/browser-$engine.log"
done
