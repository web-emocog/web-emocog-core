const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'wecog-pr162-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('local outbox keys are read from a private opened file, never a symlink or hardlink', async t => {
  const { readOutboxKey } = require('../scripts/identity-local');
  const root = await temporary(t), key = path.join(root, 'key');
  const expected = randomBytes(32).toString('base64');
  await fs.writeFile(key, expected, { mode: 0o600 });
  assert.equal(await readOutboxKey(key), expected);
  await fs.symlink(key, path.join(root, 'linked'));
  await assert.rejects(readOutboxKey(path.join(root, 'linked')));
  await fs.link(key, path.join(root, 'hardlinked'));
  await assert.rejects(readOutboxKey(key), /Unsafe/);
  await fs.unlink(path.join(root, 'hardlinked'));
  await fs.chmod(key, 0o644);
  await assert.rejects(readOutboxKey(key), /Unsafe/);
  await fs.chmod(key, 0o600);
  await fs.writeFile(key, 'not-a-key');
  await assert.rejects(readOutboxKey(key), /Unsafe/);
});

test('expression benchmark bounds the opened file and rejects links and non-files', async t => {
  const { readExpressionBenchmark } = await import('../../../scripts/reference-data/compare-expressions.mjs');
  const root = await temporary(t), file = path.join(root, 'input.json');
  await fs.writeFile(file, '{"rows":[]}');
  assert.deepEqual(await readExpressionBenchmark(file), { rows: [] });
  await fs.symlink(file, path.join(root, 'linked.json'));
  await assert.rejects(readExpressionBenchmark(path.join(root, 'linked.json')));
  await assert.rejects(readExpressionBenchmark(root));
  await fs.truncate(file, 10 * 1024 * 1024 + 1);
  await assert.rejects(readExpressionBenchmark(file), /too_large/);
});

test('public staging copies only opened regular files and rejects links outside the source', async t => {
  const { stagePublicTree } = await import('../../../docker/web/stage-public.mjs');
  const root = await temporary(t), source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'docker/web'), { recursive: true });
  const manifest = { schemaVersion: 'wecog_public_files.v1', files: ['index.html'], excludedOptionalReferences: [],
    entrypoints: { public: [], staff: [], authenticatedWorkspace: [] } };
  await fs.writeFile(path.join(source, 'docker/web/public-files.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(source, 'index.html'), '<title>Safe</title>');
  await stagePublicTree(source, path.join(root, 'valid'));
  assert.equal(await fs.readFile(path.join(root, 'valid/index.html'), 'utf8'), '<title>Safe</title>');
  await fs.writeFile(path.join(root, 'outside.html'), 'SECRET');
  await fs.unlink(path.join(source, 'index.html'));
  await fs.symlink(path.join(root, 'outside.html'), path.join(source, 'index.html'));
  await assert.rejects(stagePublicTree(source, path.join(root, 'invalid')));
});

test('identity and workspace routers independently bound authorization attempts before reaching auth', async t => {
  const express = require('express');
  const factories = [require('../routes/identity').createIdentityRouter, require('../routes/workspace').createWorkspaceRouter];
  for (const [index, factory] of factories.entries()) {
    let attempts = 0;
    const app = express();
    app.use(factory({ config: { enabled: true, trustedOrigins: [] },
      rateLimits: { auth: 2, default: 2 }, pool: { query() { throw new Error('No database expected'); } },
      requireAuth(_req, res) { attempts++; res.sendStatus(401); } }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const endpoint = `http://127.0.0.1:${server.address().port}` + (index ? '/' : '/verification');
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const response = await fetch(endpoint, index ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      statuses.push(response.status);
      if (i === 2) {
        assert.ok(Number(response.headers.get('retry-after')) > 0);
        assert.equal((await response.json()).code, 'rate_limit_exceeded');
      }
    }
    assert.deepEqual(statuses, [401, 401, 429]);
    assert.equal(attempts, 2);
  }
});

test('media hash rejects foreign paths and links even with a valid file extension', async t => {
  const { hashFile } = require('../stimuli/versions');
  const root = await temporary(t), allowed = path.join(root, 'uploads');
  await fs.mkdir(allowed);
  await fs.writeFile(path.join(root, 'foreign.png'), 'private');
  await assert.rejects(hashFile(path.join(root, 'foreign.png'), allowed), { code: 'content_path_outside_uploads_root' });
  await fs.symlink(path.join(root, 'foreign.png'), path.join(allowed, 'linked.png'));
  await assert.rejects(hashFile(path.join(allowed, 'linked.png'), allowed));
});

test('native invocation rejects malformed command envelopes before spawning', async () => {
  const { runNativeProcess } = require('../security/native-process');
  for (const [command, args] of [['', []], ['python3\0', []], ['python3', {}], ['python3', [null]], ['python3', ['a\0b']]]) {
    await assert.rejects(runNativeProcess(command, args), { code: 'invalid_invocation' });
  }
});

test('RT trial suffix parsing stays linear on long near-matches and preserves legacy indices', () => {
  const { parseTrialIndex } = require('../rt/event_adapter');
  for (const [value, expected] of [['trial_42  ', 42], ['0042', 42], ['42-tail', 42], ['trial-none', 9], [null, 9]]) {
    assert.equal(parseTrialIndex(value, 9), expected);
  }
  assert.equal(parseTrialIndex('trial-' + '0'.repeat(100000) + 'x', 9), 9);
  assert.equal(parseTrialIndex('trial-' + '0'.repeat(100000) + '17\n', 9), 17);
});
