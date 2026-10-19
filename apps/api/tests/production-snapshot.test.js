const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const helper = path.resolve(__dirname, '../../../deploy/production/prepare-disk-snapshot.cjs');
const { readConfig, readySnapshots, prepareSnapshot, isSnapshotQuotaFailure } = require(helper);
const env = { YC_FOLDER_ID: 'testfolder000000000001', YC_VM_DISK_ID: 'testdisk0000000000001',
  GITHUB_SHA: 'a'.repeat(40), YC_AUTOMATED_SNAPSHOTS_TO_KEEP: '5' };
const config = patch => readConfig({ ...env, ...patch });
const snapshot = (index, patch = {}) => ({ id: `snapshot${String(index).padStart(12, '0')}`,
  folder_id: env.YC_FOLDER_ID, source_disk_id: env.YC_VM_DISK_ID, status: 'READY',
  created_at: new Date(Date.UTC(2026, 9, index)).toISOString(),
  name: `wecog-predeploy-20261001-120000-${'b'.repeat(8)}`,
  labels: { app: 'wecog', reason: 'predeploy', commit: 'b'.repeat(12) }, ...patch });

function fixture(options = {}) {
  const cfg = config(options.env);
  const protectedCopies = [snapshot(20, { id: 'manualbaseline', name: 'manual-baseline' }),
    snapshot(21, { id: 'otherdiskcopy', source_disk_id: 'anotherdisk0000000001' }),
    snapshot(22, { id: 'otherfoldercopy', folder_id: 'anotherfolder00000001' }),
    snapshot(23, { id: 'creatingcopy', status: 'CREATING' }),
    snapshot(24, { id: 'unlabelledcopy', labels: {} })];
  const copies = new Map([...Array.from({ length: options.count ?? 6 }, (_, i) => snapshot(i + 1)), ...protectedCopies]
    .map(item => [item.id, item]));
  const calls = [], sleeps = [];
  let createAttempts = 0, lists = 0;
  const run = args => {
    calls.push(args);
    if (args[2] === 'list') {
      lists++;
      if (options.listError) throw new Error('PermissionDenied');
      if (options.inventory) return options.inventory;
      const result = structuredClone([...copies.values()]);
      if (options.changed && lists > 1) result.find(item => item.id === snapshot(1).id).status = 'DELETING';
      return result;
    }
    if (args[2] === 'delete') {
      if (options.deleteError) throw new Error('PermissionDenied');
      copies.delete(args[args.indexOf('--id') + 1]);
      return null;
    }
    if (args[2] === 'create') {
      createAttempts++;
      if (options.createError) throw new Error(options.createError);
      if (readySnapshots([...copies.values()], cfg).length >= (options.capacity ?? 50)
          || (options.staleOnce && createAttempts === 1)) {
        throw Object.assign(new Error('ResourceExhausted'), { snapshotQuota: true });
      }
      const item = snapshot(25, { id: 'newreadysnapshot00001',
        name: args[args.indexOf('--name') + 1], labels: { app: 'wecog', reason: 'predeploy', commit: cfg.sha.slice(0, 12) },
        ...options.created });
      copies.set(item.id, item);
      return item;
    }
    throw new Error('Unexpected CLI operation');
  };
  return { cfg, copies, protectedCopies, calls, sleeps,
    prepare: patch => prepareSnapshot(cfg, { run, log() {}, sleep: async ms => { sleeps.push(ms); },
      now: () => new Date('2026-10-19T08:13:10Z'), ...patch }) };
}

test('snapshot retention parameters fail closed and quota adaptation requires an explicit floor', () => {
  assert.equal(config().minimum, 5);
  for (const patch of [{ YC_FOLDER_ID: '--foreign' }, { YC_VM_DISK_ID: '' }, { GITHUB_SHA: 'main' },
    { YC_AUTOMATED_SNAPSHOTS_TO_KEEP: '1' }, { YC_AUTOMATED_SNAPSHOTS_TO_KEEP: '1.5' },
    { YC_MIN_AUTOMATED_SNAPSHOTS_TO_KEEP: '1' }, { YC_MIN_AUTOMATED_SNAPSHOTS_TO_KEEP: '6' }]) {
    assert.throws(() => config(patch), /Invalid snapshot/);
  }
});

test('only the provider snapshot size/count quota error authorizes adaptive retention', () => {
  assert.equal(isSnapshotQuotaFailure('ERROR: rpc error: code = ResourceExhausted desc = The limit on total size of snapshots has exceeded.'), true);
  assert.equal(isSnapshotQuotaFailure('rpc error: code = ResourceExhausted desc = The limit on total number of snapshots has exceeded.'), true);
  for (const details of ['PermissionDenied', 'network timeout', 'code = ResourceExhausted desc = concurrent operations limit exceeded',
    'code = PermissionDenied desc = cannot view size of snapshots', 'snapshot creation returned invalid JSON']) {
    assert.equal(isSnapshotQuotaFailure(details), false);
  }
});

test('only exact folder/disk/label/name READY snapshots are eligible for deletion', () => {
  const f = fixture();
  assert.deepEqual(readySnapshots([...f.copies.values()], f.cfg).map(item => item.id),
    [6, 5, 4, 3, 2, 1].map(i => snapshot(i).id));
});

test('normal rotation frees the Nth slot before creating a verified READY snapshot', async () => {
  const f = fixture();
  const created = await f.prepare();
  assert.equal(created.name, 'wecog-predeploy-20261019-081310-aaaaaaaa');
  assert.equal(readySnapshots([...f.copies.values()], f.cfg).length, 5);
  assert.deepEqual(f.calls.filter(args => args[2] === 'delete').map(args => args.at(-1)), [snapshot(1).id, snapshot(2).id]);
  assert.ok(f.calls.findIndex(args => args[2] === 'create') > f.calls.findLastIndex(args => args[2] === 'delete'));
  for (const copy of f.protectedCopies) assert.deepEqual(f.copies.get(copy.id), copy);
});

test('early preflight reads inventory without deleting or creating any backup', async () => {
  const f = fixture();
  assert.deepEqual(await f.prepare({ checkOnly: true }), { readyCount: 6 });
  assert.deepEqual(f.calls.map(args => args[2]), ['list']);
});

test('explicit quota floor permits oldest-first rotation but never deletes the last recovery copy', async () => {
  const f = fixture({ env: { YC_MIN_AUTOMATED_SNAPSHOTS_TO_KEEP: '2' }, capacity: 2 });
  await f.prepare();
  assert.deepEqual(readySnapshots([...f.copies.values()], f.cfg).map(item => item.id), ['newreadysnapshot00001', snapshot(6).id]);
  assert.deepEqual(f.calls.filter(args => args[2] === 'delete').map(args => args.at(-1)), [1, 2, 3, 4, 5].map(i => snapshot(i).id));
  for (const copy of f.protectedCopies) assert.deepEqual(f.copies.get(copy.id), copy);
});

test('unresolvable quota stops at the approved floor rather than deleting the final backup', async () => {
  const f = fixture({ env: { YC_MIN_AUTOMATED_SNAPSHOTS_TO_KEEP: '2' }, capacity: 1 });
  await assert.rejects(f.prepare(), /quota exhausted at the approved retention floor/);
  assert.equal(f.copies.has(snapshot(6).id), true);
  assert.equal(readySnapshots([...f.copies.values()], f.cfg).length, 1);
});

test('without approval quota pressure cannot silently lower the five-snapshot retention policy', async () => {
  const f = fixture({ capacity: 4 });
  await assert.rejects(f.prepare(), /retention floor \(5\)/);
  assert.equal(readySnapshots([...f.copies.values()], f.cfg).length, 4);
  assert.equal(f.calls.filter(args => args[2] === 'delete').length, 2);
});

test('quota accounting lag retries after removal without deleting another backup immediately', async () => {
  const f = fixture({ staleOnce: true });
  await f.prepare();
  assert.deepEqual(f.sleeps, [3000]);
  assert.equal(f.calls.filter(args => args[2] === 'delete').length, 2);
});

test('inventory access errors stop before snapshot cleanup or creation', async () => {
  const f = fixture({ listError: true });
  await assert.rejects(f.prepare(), /PermissionDenied/);
  assert.deepEqual(f.calls.map(args => args[2]), ['list']);
});

test('malformed inventory, duplicate IDs and invalid timestamps cannot authorize cleanup', async () => {
  for (const inventory of [{}, [null], [snapshot(1), snapshot(1)], [snapshot(1, { id: '--bad' })],
    [snapshot(1, { created_at: 'unknown' })]]) {
    const f = fixture({ inventory });
    await assert.rejects(f.prepare(), /Invalid snapshot/);
    assert.deepEqual(f.calls.map(args => args[2]), ['list']);
  }
});

test('failed deletion is not swallowed and cannot proceed to deployment snapshot creation', async () => {
  const f = fixture({ deleteError: true });
  await assert.rejects(f.prepare(), /PermissionDenied/);
  assert.equal(f.calls.some(args => args[2] === 'create'), false);
  assert.equal(f.copies.has(snapshot(1).id), true);
});

test('changed inventory is revalidated before deletion', async () => {
  const f = fixture({ changed: true });
  await assert.rejects(f.prepare(), /inventory changed/);
  assert.equal(f.calls.some(args => args[2] === 'delete'), false);
});

test('network, permission or unrelated create errors never trigger quota deletion', async () => {
  for (const createError of ['PermissionDenied', 'timeout', 'ResourceExhausted: concurrent operations']) {
    const f = fixture({ count: 2, createError });
    await assert.rejects(f.prepare(), new RegExp(createError));
    assert.equal(f.calls.some(args => args[2] === 'delete'), false);
    assert.equal(f.calls.filter(args => args[2] === 'create').length, 1);
  }
});

test('a non-ready or foreign new snapshot cannot satisfy the pre-deploy backup gate', async () => {
  for (const created of [{ status: 'CREATING' }, { status: 'ERROR' }, { source_disk_id: 'anotherdisk0000000001' },
    { folder_id: 'anotherfolder00000001' }, { labels: {} }, { name: 'foreign-snapshot' }]) {
    const f = fixture({ count: 2, created });
    await assert.rejects(f.prepare(), /not verified READY/);
    assert.equal(f.calls.filter(args => args[2] === 'create').length, 1);
  }
});

test('actual CLI adapter propagates listing failures and invalid JSON instead of succeeding through shell substitution', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wecog-snapshot-cli-'));
  try {
    const binary = path.join(directory, 'yc');
    for (const code of ['console.error("PermissionDenied"); process.exit(1);', 'process.stdout.write("invalid-json");']) {
      fs.writeFileSync(binary, `#!${process.execPath}\n${code}\n`);
      fs.chmodSync(binary, 0o700);
      const result = spawnSync(process.execPath, [helper, '--check-only'], { encoding: 'utf8',
        env: { ...process.env, ...env, PATH: `${directory}:${process.env.PATH}` } });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /deployment must not proceed/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('production workflow requires inventory preflight and a READY snapshot after logical backup but before deploying', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/deploy-production.yml'), 'utf8');
  const preflight = workflow.indexOf('prepare-disk-snapshot.cjs --check-only');
  const prepare = workflow.indexOf('Prepare release and upload the database backup');
  const snapshotStep = workflow.indexOf('Create pre-deploy disk snapshot');
  const deploy = workflow.indexOf('Deploy the prepared release');
  assert.ok(preflight > 0 && preflight < prepare && prepare < snapshotStep && snapshotStep < deploy);
  assert.match(workflow.slice(snapshotStep, deploy), /run: node deploy\/production\/prepare-disk-snapshot\.cjs\s/);
  assert.doesNotMatch(workflow.slice(snapshotStep, deploy), /continue-on-error|if:.*always|\|\| true/);
  assert.doesNotMatch(workflow, /mapfile.*stale_snapshot_ids|Keep only the latest automated/);
});

test('every embedded production deploy shell block has valid Bash syntax', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/deploy-production.yml'), 'utf8');
  const lines = workflow.split('\n');
  let checked = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^        run: \|\s*$/.test(lines[i])) continue;
    const body = [];
    while (++i < lines.length && (/^          /.test(lines[i]) || !lines[i].trim())) body.push(lines[i].slice(10));
    i--;
    const result = spawnSync('bash', ['-n'], { input: body.join('\n'), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    checked++;
  }
  assert.ok(checked >= 8);
});
