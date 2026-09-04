const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const production = path.join(root, 'deploy/production');
const controller = fs.readFileSync(path.join(production, 'wecog-release'), 'utf8');
const metricFunctions = controller.slice(controller.indexOf('backup_metrics_on_exit()'), controller.indexOf('metadata_iam_token()'));
const backupFunctions = controller.slice(controller.indexOf('prune_local_backups()'), controller.indexOf('wait_for_health()'));

describe('production backup set and observability', () => {
  it('runs archive, restore-confinement and metric-transition regression tests', () => {
    const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', path.join(production, 'tests'), '-v'], {
      encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Ran 12 tests/);
  });

  for (const scenario of ['empty', 'files', 'dump-failure', 'archive-failure', 'upload-failure', 'manifest-failure', 'early-failure']) {
    it(`executes real backup orchestration with isolated IO: ${scenario}`, () => {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-backup-orchestration-'));
      try {
        for (const name of ['uploads', 'backups', 'metrics', 'objects']) fs.mkdirSync(path.join(temporary, name));
        if (scenario !== 'empty') fs.writeFileSync(path.join(temporary, 'uploads', 'stimulus.txt'), 'test stimulus');
        if (scenario === 'archive-failure') fs.symlinkSync('/nonexistent-private-target', path.join(temporary, 'uploads', 'unsafe'));
        const env = {
          ...process.env,
          LC_ALL: 'C',
          BACKUP_HELPER: path.join(production, 'backup-support.py'),
          BACKUP_METRICS_DIR: path.join(temporary, 'metrics'),
          WECOG_BACKUP_DIR: path.join(temporary, 'backups'),
          WECOG_UPLOADS_DIR: path.join(temporary, 'uploads'),
          TEST_ROOT: temporary,
          SCENARIO: scenario,
        };
        const seed = spawnSync('python3', [env.BACKUP_HELPER, 'metrics', env.BACKUP_METRICS_DIR, 'daily', 'success', '2']);
        assert.equal(seed.status, 0);
        const oldState = JSON.parse(fs.readFileSync(path.join(temporary, 'metrics', 'backup-daily.json')));
        const result = spawnSync('bash', ['-c', `
set -Eeuo pipefail
umask 077
LOCAL_BACKUP_RETENTION_MINUTES=2880
${metricFunctions}
${backupFunctions}
log() { printf '%s\\n' "$*"; }
prune_local_backups() { :; } # GNU find is tested statically; no deletion outside the fixture.
date() { printf '20260904T120000123456789Z\\n'; }
sha256sum() { shasum -a 256 "$1"; }
compose_for() {
  if [[ $SCENARIO == dump-failure ]]; then return 7; fi
  if [[ $* == *pg_restore* ]]; then return 0; fi
  printf 'database fixture' > "$WECOG_BACKUP_DIR/wecog-20260904T120000123456789Z-aaaaaaaaaaaa.dump"
}
upload_object() {
  local source=$1 key=$2
  printf '%s\\n' "$key" >> "$TEST_ROOT/upload-order"
  if [[ $SCENARIO == upload-failure && $key == *.uploads.tar.gz ]]; then return 9; fi
  if [[ $SCENARIO == manifest-failure && $key == *.manifest.json ]]; then return 10; fi
  cp "$source" "$TEST_ROOT/objects/$(basename "$source")"
}
begin_backup_metrics daily
if [[ $SCENARIO == early-failure ]]; then exit 11; fi
backup_database aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa daily
`], { env, encoding: 'utf8', timeout: 30_000 });
        const state = JSON.parse(fs.readFileSync(path.join(temporary, 'metrics', 'backup-daily.json')));
        if (['empty', 'files'].includes(scenario)) {
          assert.equal(result.status, 0, result.stderr);
          assert.equal(state.last_run_success, 1);
          assert.equal(state.uploads_files, scenario === 'empty' ? 0 : 1);
          assert.equal(state.in_progress, 0);
          const order = fs.readFileSync(path.join(temporary, 'upload-order'), 'utf8').trim().split('\n');
          assert.match(order.at(-1), /\.manifest\.json$/);
          assert.equal(order.length, scenario === 'empty' ? 3 : 5);
          const manifest = JSON.parse(fs.readFileSync(path.join(temporary, 'objects', path.basename(order.at(-1)))));
          assert.equal(manifest.uploads.empty, scenario === 'empty');
          assert.deepEqual(fs.readdirSync(path.join(temporary, 'backups')), []);
        } else {
          const codes = { 'dump-failure': 7, 'archive-failure': 1, 'upload-failure': 9, 'manifest-failure': 10, 'early-failure': 11 };
          assert.equal(result.status, codes[scenario], result.stderr);
          assert.equal(state.last_run_success, 0);
          assert.equal(state.last_success_timestamp_seconds, oldState.last_success_timestamp_seconds);
          assert.equal(state.in_progress, 0);
          assert.equal(fs.readdirSync(path.join(temporary, 'objects')).some(name => name.endsWith('.manifest.json')), false);
          assert.doesNotMatch(result.stdout + result.stderr, /nonexistent-private-target|test stimulus/);
        }
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    });
  }

  it('wires metrics and the helper into existing services without changing IAM or lifecycle scope', () => {
    const bootstrap = fs.readFileSync(path.join(production, 'bootstrap.sh'), 'utf8');
    const compose = fs.readFileSync(path.join(root, 'compose.monitoring.yaml'), 'utf8');
    const collector = fs.readFileSync(path.join(production, 'monitoring/otelcol.yaml'), 'utf8');
    const lifecycle = JSON.parse(fs.readFileSync(path.join(production, 'object-storage-lifecycle.json'), 'utf8'));
    assert.match(bootstrap, /backup-support\.py/);
    assert.match(bootstrap, /metrics \/var\/lib\/wecog\/metrics daily init/);
    assert.match(compose, /--collector\.textfile\.directory=\/textfile/);
    assert.match(compose, /\/var\/lib\/wecog\/metrics:\/textfile:ro/);
    assert.match(compose, /--collector\.time/);
    assert.match(collector, /job_name: wecog_backups/);
    assert.match(collector, /node_time_seconds\|node_textfile_scrape_error/);
    assert.equal(lifecycle.lifecycleRules[0].filter.prefix, 'postgresql/');
    assert.match(controller, /object_prefix="postgresql\/\$\{reason\}/);
    for (const reason of ['daily', 'pre-deploy']) assert.match(controller, new RegExp(`begin_backup_metrics ${reason}`));
    for (const file of ['wecog-*.uploads.tar.gz', 'wecog-*.uploads.tar.gz.sha256', 'wecog-*.manifest.json']) {
      assert.ok(controller.includes(`-name '${file}'`));
    }
  });
});
