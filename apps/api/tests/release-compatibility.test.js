const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertCompatibleMigrations, checkReleaseCompatibility } = require('../scripts/check-release-compatibility');
const controller = fs.readFileSync(path.resolve(__dirname, '../../../deploy/production/wecog-release'), 'utf8');
const start = controller.slice(controller.indexOf('start_release() {'), controller.indexOf('\ndump_release_diagnostics() {'));

test('compatibility fails closed for missing history or any newer database migration', async () => {
  assert.doesNotThrow(() => assertCompatibleMigrations(['a'], ['a', 'b']));
  assert.throws(() => assertCompatibleMigrations(['a', 'future'], ['a', 'b']));
  await assert.rejects(checkReleaseCompatibility({ query: async () => ({ rows: [{ table_name: null }] }) }));
  await assert.rejects(checkReleaseCompatibility({ query: async sql => ({ rows: sql.includes('to_regclass')
    ? [{ table_name: 'pgmigrations' }] : [{ name: 'future_privacy_contract' }] }) }));
});

for (const [compatible, writable] of [[false, true], [true, true], [true, false]]) {
  test(`controller start: compatible=${compatible}, writable release state=${writable}`, () => {
    const result = spawnSync('bash', ['-c', `
set -Eeuo pipefail
log() { :; }
write_release_env() { printf 'write-state\\n'; return ${writable ? 0 : 1}; }
wait_for_health() { printf 'health\\n'; }
compose_for() {
  shift
  if [[ $1 == run ]]; then printf 'check\\n'; return ${compatible ? 0 : 1}; fi
  printf 'up\\n'
}
${start}
start_release target
`], { encoding: 'utf8' });
    assert.equal(result.status, compatible && writable ? 0 : 1, result.stderr);
    assert.equal(result.stdout, !compatible ? 'check\n' : !writable ? 'check\nwrite-state\n' : 'check\nwrite-state\nup\nhealth\n');
  });
}

for (const mode of ['deploy', 'rollback']) {
  test(`${mode} refuses an incompatible recovery target without starting it or recording it as current`, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-release-safety-'));
    try {
      const current = path.join(temporary, 'current');
      const pending = path.join(temporary, 'pending');
      fs.writeFileSync(current, mode === 'deploy' ? 'old' : 'new');
      fs.writeFileSync(pending, 'new');
      const functions = controller.slice(controller.indexOf('deploy_release() {'), controller.indexOf('\nshow_status() {'));
      const result = spawnSync('bash', ['-c', `
set -Eeuo pipefail
CURRENT_TAG_FILE=$TEST_CURRENT
PENDING_TAG_FILE=$TEST_PENDING
PREVIOUS_TAG_FILE=$TEST_CURRENT.previous
log() { :; }
require_tag() { :; }
render_secret_env() { :; }
registry_login() { :; }
dump_release_diagnostics() { :; }
prune_local_release_images() { :; }
write_release_env() { :; }
wait_for_health() { return 1; }
compose_for() {
  printf '%s %s\\n' "$1" "$2"
  if [[ $1 == old && $2 == run ]]; then return 1; fi
}
${start}
${functions}
${mode}_release ${mode === 'deploy' ? 'new' : 'old'}
`], { encoding: 'utf8', env: { ...process.env, TEST_CURRENT: current, TEST_PENDING: pending } });
      assert.equal(result.status, 1, result.stderr);
      assert.doesNotMatch(result.stdout, /old up/);
      assert.equal(fs.readFileSync(current, 'utf8'), mode === 'deploy' ? 'old' : 'new');
      if (mode === 'deploy') assert.ok(result.stdout.indexOf('old stop') < result.stdout.indexOf('new run'));
      assert.match(result.stdout, /new stop|old stop/);
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
}
