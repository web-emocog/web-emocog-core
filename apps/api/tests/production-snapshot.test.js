const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-production.yml'), 'utf8');

describe('production pre-deploy snapshot safety', () => {
  it('runs isolated CLI, quota, retention and failure regression tests', () => {
    const result = spawnSync('python3', ['-B', '-m', 'unittest', 'discover',
      '-s', path.join(root, 'deploy/production/tests'), '-p', 'test_predeploy_snapshot.py', '-v'], {
      encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /Ran \d+ tests/);
  });

  it('keeps backup, synchronous snapshot verification and deploy as mandatory ordered gates', () => {
    const stages = [
      'predeploy-snapshot.py check',
      'Prepare release and upload the database backup',
      'predeploy-snapshot.py create',
      'Deploy the prepared release',
      'Verify production through public HTTPS',
    ].map(stage => workflow.indexOf(stage));
    assert.ok(stages.every(index => index >= 0));
    assert.deepEqual(stages, [...stages].sort((a, b) => a - b));
    assert.match(workflow, /wecog-release prepare "\$\{GITHUB_SHA\}"/);
    assert.match(workflow, /wecog-release deploy "\$\{GITHUB_SHA\}"/);
    assert.match(workflow, /YC_AUTOMATED_SNAPSHOTS_TO_KEEP: "5"/);
    assert.doesNotMatch(workflow, /continue-on-error|always\(\)|mapfile|stale_snapshot_ids|snapshot delete/);
  });

  it('serializes snapshot rotation with deployments and rollbacks without cancelling active jobs', () => {
    for (const file of ['deploy-production.yml', 'rollback-production.yml']) {
      const source = fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');
      assert.match(source, /concurrency:\s+group: wecog-production\s+cancel-in-progress: false/);
    }
  });
});
