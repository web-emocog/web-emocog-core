const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { mayReadStimulus, mayManageSharing, rejectOwnedFields } = require('../stimuli/access');
const { runMediaTool, createPreview } = require('../stimuli/media-preview');
const { collectMediaInventory } = require('../stimuli/media-inventory');
const { hashFile } = require('../stimuli/versions');

test('personal ownership is not conferred by membership, sharing is owner-only, server fields are rejected', () => {
  const row = { visibility: 'private', created_by: 7 };
  assert.equal(mayReadStimulus(row, { sub: 7, role: 'researcher' }), true);
  for (const role of ['researcher', 'PI', 'org_admin', 'analyst']) {
    assert.equal(mayReadStimulus(row, { sub: 8, role }), false);
    assert.equal(mayManageSharing(row, { sub: 8, role }), false);
  }
  assert.equal(mayReadStimulus(row, { sub: 8, role: 'admin' }), true);
  assert.equal(mayReadStimulus({ ...row, visibility: 'project' }, { sub: 8, role: 'researcher' }), true);
  assert.equal(mayReadStimulus({ visibility: 'private', created_by: null }, { sub: 8, role: 'researcher' }), false);
  for (const field of ['created_by', 'current_version_id', 'sha256', 'content_path', 'preview_path']) assert.equal(rejectOwnedFields({ [field]: 'x' }), true);
  assert.equal(rejectOwnedFields({ name: 'Personal', visibility: 'private' }), false);
});

test('media processes have real time/output limits and report no host paths', async () => {
  await assert.rejects(runMediaTool(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 50), { code: 'media_preview_timeout' });
  await assert.rejects(runMediaTool(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], 1000), { code: 'media_metadata_oversized' });
  const output = await runMediaTool(process.execPath, ['-e', 'process.stdout.write("ok")'], 1000);
  assert.equal(output, 'ok');
  await assert.rejects(runMediaTool('/nonexistent-private-host-path', [], 1000), error => error.code === 'media_preview_unavailable' && !error.message.includes('/nonexistent'));
});

test('preview generation confines inputs, records source geometry and rejects linked files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-preview-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'source.png'), 'source');
  const probe = path.join(root, 'probe');
  const encoder = path.join(root, 'encoder');
  await fs.writeFile(probe, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({streams:[{codec_type:"video",codec_name:"png",width:1200,height:800}],format:{duration:"1.5"}}));\n', { mode: 0o700 });
  await fs.writeFile(encoder, '#!/usr/bin/env node\nrequire("fs").writeFileSync(process.argv.at(-1),Buffer.from([255,216,255,217]));\n', { mode: 0o700 });
  // Cold fixture processes need startup headroom in the parallel suite; the timeout contract above stays strict.
  const options = { ffprobeBin: probe, ffmpegBin: encoder, maxConcurrent: 2, maxDimension: 480, timeoutMs: 5000 };
  const preview = await createPreview({ mime_type: 'image/png', content_path: 'source.png' }, root, options);
  assert.equal(preview.status, 'ready');
  assert.match(preview.path, /^previews\/[a-f0-9-]+\.jpg$/);
  assert.equal(preview.info.intrinsic_width, 1200);
  assert.equal(preview.info.intrinsic_height, 800);
  assert.equal(preview.info.duration_ms, 1500);
  await fs.symlink(path.join(root, 'source.png'), path.join(root, 'linked.png'));
  await assert.rejects(createPreview({ mime_type: 'image/png', content_path: 'linked.png' }, root, options));
  await assert.rejects(createPreview({ mime_type: 'image/png', content_path: '../escape.png' }, root, options));
  assert.deepEqual(await createPreview({ mime_type: 'application/pdf' }, root, options), { status: 'unsupported', info: {} });
});

test('backup reconciliation includes historical versions and posters and fails on missing/corrupt files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-inventory-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'stimuli'));
  for (const [name, bytes] of [['old.png', 'old'], ['new.png', 'new'], ['poster.jpg', 'poster']]) await fs.writeFile(path.join(root, 'stimuli', name), bytes);
  const oldHash = await hashFile(path.join(root, 'stimuli/old.png'));
  const queryable = { query: async sql => {
    if (sql.includes('to_regclass')) return { rows: [{ versions: 'stimulus_versions' }] };
    if (sql.includes('FROM stimuli ')) return { rows: [{ metadata: { content_path: 'new.png' } }] };
    return { rows: [{ content_path: 'old.png', sha256: oldHash, size_bytes: 3 },
      { content_path: 'new.png', size_bytes: 3, preview_path: 'poster.jpg', preview_status: 'ready' }] };
  } };
  const inventory = await collectMediaInventory(queryable, root);
  assert.deepEqual(inventory.files.map(file => file.file), ['stimuli/new.png', 'stimuli/old.png', 'stimuli/poster.jpg']);
  assert.equal(inventory.files.find(file => file.file === 'stimuli/old.png').sha256, oldHash);
  await fs.writeFile(path.join(root, 'stimuli/old.png'), 'bad');
  await assert.rejects(collectMediaInventory(queryable, root), /integrity/);
  await fs.unlink(path.join(root, 'stimuli/old.png'));
  await assert.rejects(collectMediaInventory(queryable, root), /unavailable/);
});
