const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { runNativeProcess } = require('../security/native-process');
const { runMediaTool } = require('../stimuli/media-preview');

test('native media tools receive no API secrets and cap both output streams by bytes', async t => {
  const previous = process.env.WECOG_SYNTHETIC_SECRET;
  process.env.WECOG_SYNTHETIC_SECRET = 'synthetic-do-not-inherit';
  t.after(() => { if (previous === undefined) delete process.env.WECOG_SYNTHETIC_SECRET;
    else process.env.WECOG_SYNTHETIC_SECRET = previous; });
  const output = await runMediaTool(process.execPath,
    ['-e', 'process.stdout.write(process.env.WECOG_SYNTHETIC_SECRET || "absent")'], 5000, { resourceLimits: false });
  assert.equal(output, 'absent');
  for (const stream of ['stdout', 'stderr']) await assert.rejects(runNativeProcess(process.execPath,
    ['-e', `process.${stream}.write("x".repeat(100000))`], { timeoutMs: 5000 }), { code: 'output_limit' });
  const result = await runNativeProcess(process.execPath, ['-e', 'process.stdout.write("✓")'], { maxOutputBytes: 3 });
  assert.equal(result.stdout, '✓');
  await assert.rejects(runNativeProcess(process.execPath, ['-e', 'process.stdout.write("✓")'],
    { maxOutputBytes: 2 }), { code: 'output_limit' });
});

test('a decoder timeout kills its descendants, not just the parent', { skip: process.platform === 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-process-group-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ready = path.join(root, 'ready'), escaped = path.join(root, 'escaped');
  const pending = runNativeProcess('/bin/sh', ['-c',
    'printf ready > "$1"; (sleep 1; printf escaped > "$2") & wait', 'audit', ready, escaped], { timeoutMs: 400 });
  const rejected = assert.rejects(pending, { code: 'timeout' });
  for (let i = 0; i < 30; i++) {
    if (await fs.access(ready).then(() => true, () => false)) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(await fs.readFile(ready, 'utf8'), 'ready');
  await rejected;
  await new Promise(resolve => setTimeout(resolve, 1100));
  await assert.rejects(fs.access(escaped), { code: 'ENOENT' });
});

test('Linux media wrapper enforces memory limits and hides missing tool paths', { skip: process.platform !== 'linux' }, async () => {
  const result = await runNativeProcess('python3', ['-c',
    'import resource; print(resource.getrlimit(resource.RLIMIT_AS)[0])'], { resourceLimits: true });
  assert.equal(Number(result.stdout.trim()), 1024 ** 3);
  await assert.rejects(runMediaTool('/synthetic-missing-tool', [], 5000), error =>
    error.code === 'media_preview_unavailable' && !error.message.includes('/synthetic'));
});
