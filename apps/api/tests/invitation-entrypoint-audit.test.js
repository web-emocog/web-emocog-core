const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const invite = require('../../shared/invitation-link');

test('canonical participant state and document have no absolute API or third-party asset endpoints', () => {
  const root = path.resolve(__dirname, '../../..');
  const source = file => fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(source('apps/participant-web/js/web-page/state.js'), /https?:\/\//i);
  const html = source('apps/participant-web/mvp_with_precheck_1-updated.html');
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(html, /(?:fetch|import)\s*\(\s*["'`](?:https?:)?\/\//i);
  assert.doesNotMatch(html, /applyLanguageWithRetry/);
  assert.doesNotMatch(html, /face-mask-collector/);
  assert.equal((html.match(/src="\.\.\/shared\/invitation-link\.js\?v=1"/g) || []).length, 1);
});

test('active model loaders and developer BPM mount use local modules, without a CDN fallback', () => {
  const root = path.resolve(__dirname, '../../..');
  for (const file of [
    'apps/participant-web/js/precheck-analyzer.js', 'apps/participant-web/js/face-segmenter.js',
    'apps/participant-web/js/gaze-tracker.js', 'apps/participant-web/js/qc-metrics.js',
    'apps/participant-web/js/precheck-analyzer/PrecheckAnalyzer.js',
    'apps/participant-web/js/face-segmenter/FaceSegmenter.js',
    'apps/web/developer/bpm-test.js', 'apps/web/developer/protocol-diagnostic-page.mjs'
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//i, file);
  }
});

test('invitation input supports current, short and legacy links without trusting the pasted origin', () => {
  for (const input of [
    ' Key_1-2 ', 'https://example.test/apps/participant-web/run_new.html?code=Key_1-2',
    'run_new.html?code=%4Bey_1-2', '/invite/Key_1-2/', 'https://example.test/invite/Key_1-2',
    '#/participant/Key_1-2', 'https://example.test/#participant/Key_1-2',
    'run_new.html?code=Key_1-2#participant/wrong',
  ]) assert.equal(invite.fromInput(input), 'Key_1-2', input);
  assert.equal(invite.fromInput('A'.repeat(64)), 'A'.repeat(64));
});

test('invalid escapes, invalid and duplicate codes and non-HTTP links do not throw or produce a code', () => {
  for (const input of [
    '', '#/participant/%E0%A4%A', 'https://example.test/#participant/%ZZ',
    '/invite/%2f', '/invite/id/extra', 'https://example.test?code=%2B',
    '?code=first&code=second', '?code=#/participant/valid',
    'javascript:alert(1)?code=valid', 'data:text/html,a?code=valid',
    '#/participant/a/b', 'a'.repeat(65), ' '.repeat(8193) + '?code=valid',
  ]) assert.equal(invite.fromInput(input), null, input.slice(0, 100));
  assert.deepEqual(invite.readUrl(new URL('https://example.test/run_new.html?code=')), { supplied: true, code: null });
  assert.deepEqual(invite.readUrl(new URL('https://example.test/run_new.html#participant/%ZZ')), { supplied: true, code: null });
  assert.deepEqual(invite.readUrl(new URL('https://example.test/run_new.html#other')), { supplied: false, code: null });
});

test('public staging rejects retired runner paths even when a manifest tries to allow them', async () => {
  const root = path.resolve(__dirname, '../../..');
  const { readPublicManifest, verifyPublicTree } = await import('../../../docker/web/stage-public.mjs');
  const manifest = await readPublicManifest(root);
  for (const retired of ['mvp_with_precheck_1.html', 'js/face-mask-collector.js', ...['app', 'experimental_task', 'precheck', 'tests', 'ui']
    .map(name => 'js/web-page/' + name + '.js')]) {
    const name = 'apps/participant-web/' + retired;
    assert.equal(manifest.files.includes(name), false);
    await assert.rejects(verifyPublicTree(root, { ...manifest, files: [...manifest.files, name] }), /Retired participant runtime/);
    await assert.rejects(verifyPublicTree(root, { ...manifest, excludedOptionalReferences: [...manifest.excludedOptionalReferences, name] }),
      /Retired participant runtime/);
  }
});
