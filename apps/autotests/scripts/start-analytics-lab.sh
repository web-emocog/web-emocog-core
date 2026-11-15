#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
root=$(cd "$(dirname "$0")/../../.." && pwd -P)
cd "$root"
name=wecog-analytics-lab-1112
api_image=${ANALYTICS_LAB_API_IMAGE:-wecog-api:issues-fix-1109-v2}
web_image=${ANALYTICS_LAB_WEB_IMAGE:-wecog-web:issues-fix-1109-v2}
for suffix in db api web; do
  if docker container inspect "$name-$suffix" >/dev/null 2>&1; then
    echo "Refusing to replace existing lab container: $name-$suffix" >&2; exit 2
  fi
done
if [[ -f apps/api/.env ]]; then echo 'Refusing a checkout containing apps/api/.env' >&2; exit 2; fi
for port in 3012 4212; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $port is occupied" >&2; exit 2; fi
done
out=$(mktemp -d /private/tmp/wecog-analytics-lab.XXXXXX)
mkdir "$out/private"
password=$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('hex'))")
secret=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))")
db="postgres://postgres:$password@127.0.0.1:5432/wecog_analytics_lab_test"
created_db=0; created_api=0; created_web=0; complete=0
cleanup() {
  if [[ "$complete" != 1 ]]; then
    [[ "$created_web" != 1 ]] || docker stop "$name-web" >/dev/null || true
    [[ "$created_api" != 1 ]] || docker stop "$name-api" >/dev/null || true
    [[ "$created_db" != 1 ]] || docker stop "$name-db" >/dev/null || true
    echo "Lab startup failed; private diagnostics are in $out" >&2
  fi
}
trap cleanup EXIT
docker run -d --rm --name "$name-db" --label wecog.purpose=synthetic-analytics-lab \
  --memory 768m --cpus 2 --tmpfs /var/lib/postgresql/data:rw \
  -p 127.0.0.1:3012:3000 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD="$password" \
  -e POSTGRES_DB=wecog_analytics_lab_test postgres:16-alpine >/dev/null
created_db=1
for attempt in $(seq 1 40); do
  if docker exec "$name-db" pg_isready -U postgres -d wecog_analytics_lab_test >/dev/null 2>&1; then break; fi
  sleep 1
done
common=(--network "container:$name-db" --read-only --tmpfs /tmp:rw,exec,size=4g,mode=1777
  --user "$(id -u):$(id -g)" --mount "type=bind,src=$root,dst=/repo,readonly" -w /repo/apps/api
  -e DATABASE_URL="$db" -e NODE_ENV=test -e FORCE_HTTPS=false -e JWT_SECRET="$secret"
  -e NODE_PATH=/app/apps/api/node_modules
  -e STAFF_SESSION_COOKIE=wecog_analytics_lab_session
  -e CORS_ORIGINS=http://127.0.0.1:4212 -e UPLOADS_ROOT=/tmp/wecog-lab-uploads
  -e AUTH_RATE_LIMIT_PER_MINUTE=1000 -e INGEST_RATE_LIMIT_PER_MINUTE=1000 -e DEFAULT_RATE_LIMIT_PER_MINUTE=1000)
docker run --rm "${common[@]}" --entrypoint sh "$api_image" \
  -lc 'node /app/apps/api/node_modules/node-pg-migrate/bin/node-pg-migrate up' >"$out/private/migrations.log" 2>&1
docker run -d --rm --name "$name-api" --label wecog.purpose=synthetic-analytics-lab \
  --memory 2g --cpus 2 "${common[@]}" --entrypoint sh "$api_image" \
  -lc 'mkdir -p /tmp/wecog-lab-uploads/stimuli; exec node server.js' >/dev/null
created_api=1
docker run --rm "${common[@]}" --mount "type=bind,src=$out/private,dst=/test-output" \
  -e ANALYTICS_LAB_ISOLATED=YES -e ANALYTICS_LAB_VERIFY=YES -e ANALYTICS_LAB_DATABASE_URL="$db" \
  -e ANALYTICS_LAB_API_BASE=http://127.0.0.1:3000 -e ANALYTICS_LAB_FIXTURE=/test-output/analytics-lab.json \
  --entrypoint node "$api_image" scripts/seed-analytics-lab.js >"$out/private/seed.log" 2>&1
node docker/web/stage-public.mjs "$root" "$out/public" >"$out/private/staging.log" 2>&1
node - "$out" <<'NODE'
const fs = require('fs'), path = require('path');
const out = process.argv[2], fixture = JSON.parse(fs.readFileSync(path.join(out, 'private/analytics-lab.json')));
if (fixture.status !== 'complete' || !fixture.synthetic) throw new Error('Incomplete synthetic lab');
const plan = { axis: 'condition', referenceId: 'congruent', comparisonId: 'incongruent', metricId: 'rt.mean',
  secondMetricId: 'physiology.bpm', baselineBlockId: 'baseline', fastThresholdMs: 200, slowThresholdMs: 600,
  signalConditions: { signal: ['go'], noise: ['nogo'] }, familyMetricIds: ['rt.mean', 'rt.median', 'rt.cv'],
  surveyScoring: [{ id: 'pleasantness', items: [{ questionId: 'pleasantness', numericText: true, min: -5, max: 5 }] }],
  repeatVisits: fixture.sessions.map(session => ({ sessionId: session.sessionId, visit: session.visit === 1 ? 'A' : 'B' })) };
const storage = fixture.dashboard.localStorage;
// Only this disposable, already-staged lab receives its own endpoint and synthetic selection.
const apiConfig = `window.WECOG_API_BASE='http://127.0.0.1:3012';\nwindow.WECOG_API_ORIGINS=['http://127.0.0.1:3012'];\n`;
const config = apiConfig + `window.WECOG_ANALYTICS_LAB_PLAN=${JSON.stringify(plan)};\n` +
  `for(const [k,v] of Object.entries(${JSON.stringify(storage)}))if(localStorage.getItem(k)===null)localStorage.setItem(k,typeof v==='string'?v:JSON.stringify(v));\n` +
  `document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='ЛОКАЛЬНЫЙ СТЕНД · СИНТЕТИЧЕСКИЕ ДАННЫЕ · НЕ НАУЧНЫЕ РЕЗУЛЬТАТЫ';b.style.cssText='background:#c8f54b;color:#17392d;padding:7px 18px;font:700 12px sans-serif;text-align:center;position:relative;z-index:10';document.body.prepend(b);});\n`;
fs.writeFileSync(path.join(out, 'public/analytics-lab-config.js'), config, { mode: 0o644 });
fs.writeFileSync(path.join(out, 'public/analytics-lab-participant.js'), apiConfig, { mode: 0o644 });
for (const [file, configName] of [
  ['apps/web/researcher.html', 'analytics-lab-config.js'],
  ['apps/web/developer/login.html', 'analytics-lab-config.js'],
  ['apps/participant-web/mvp_with_precheck_1-updated.html', 'analytics-lab-participant.js'],
]) {
  const filename = path.join(out, 'public', file);
  fs.writeFileSync(filename, fs.readFileSync(filename, 'utf8').replace('<head>', `<head><script src="/${configName}"></script>`));
}
NODE
# nginx's unprivileged account needs the public tree, never its private sibling.
chmod 755 "$out"
find "$out/public" -type d -exec chmod 755 {} +
find "$out/public" -type f -exec chmod 644 {} +
docker run -d --rm --name "$name-web" --label wecog.purpose=synthetic-analytics-lab \
  --memory 256m --cpus 1 --read-only --tmpfs /tmp:rw,size=64m,mode=1777 \
  -p 127.0.0.1:4212:8080 --mount "type=bind,src=$out/public,dst=/usr/share/nginx/html,readonly" \
  "$web_image" >/dev/null
created_web=1
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4212/healthz >/dev/null; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:4212/apps/web/analytics-explorer.js >/dev/null
printf '%s\n' "$out" > /private/tmp/wecog-analytics-lab-current
complete=1
echo "Lab: http://127.0.0.1:4212/apps/web/researcher.html#/analytics/group-comparison"
echo "Private fixture: $out/private/analytics-lab.json"
echo 'No existing application or database was changed. No camera or microphone was used.'
