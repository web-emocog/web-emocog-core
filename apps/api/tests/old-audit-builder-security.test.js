const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ URL,
  document: { baseURI: 'http://127.0.0.1:4211/apps/web/researcher.html' },
  window: { location: { origin: 'http://127.0.0.1:4211' } }
});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../web/researcher-builder.js'), 'utf8'), context);
const mediaUrl = context.safeBuilderMediaUrl;

test('builder HTML escaping preserves strings without leaving markup/attribute delimiters', () => {
  assert.equal(context.escapeBuilderHtml('<img src="x" onerror=\'bad()\'> & &#39;'),
    '&lt;img src=&quot;x&quot; onerror=&#39;bad()&#39;&gt; &amp; &amp;#39;');
  assert.equal(context.escapeBuilderHtml(null), '');
  assert.equal(context.escapeBuilderHtml(0), '0');
});

test('builder media rejects script/document/local schemes, controls, credentials and foreign blobs', () => {
  for (const type of ['image', 'slides', 'audio', 'video']) {
    for (const source of [null, {}, 0, '', ' ', 'javascript:alert(1)', ' JaVaScRiPt:alert(1)',
      'java\nscript:alert(1)', 'java\tscript:alert(1)', '\u0000https://example.test/file',
      'https://example.test/\u007f', 'vbscript:bad()', 'data:text/html,<svg onload=bad()>',
      'data:application/xhtml+xml,<html/>', 'file:///tmp/a.png', 'ftp://example.test/a.png',
      'https://user:password@example.test/a.png', '//user@example.test/a.png',
      'blob:https://example.test/id', 'blob:null/id', 'https://[invalid']) {
      assert.equal(mediaUrl(source, type), '', `${type}: ${String(source)}`);
    }
  }
});

test('builder media retains relative/HTTP URLs, queries, local blobs and matching data media', () => {
  assert.equal(mediaUrl('../media/a.png?x=1&y=2', 'image'), 'http://127.0.0.1:4211/apps/media/a.png?x=1&y=2');
  assert.equal(mediaUrl('https://cdn.example.test/a.mp4?x=1&y=2', 'video'), 'https://cdn.example.test/a.mp4?x=1&y=2');
  assert.equal(mediaUrl('blob:http://127.0.0.1:4211/synthetic', 'image'), 'blob:http://127.0.0.1:4211/synthetic');
  for (const [source, type] of [['data:image/svg+xml;charset=UTF-8,%3Csvg/%3E', 'image'],
    ['data:image/png;base64,AA==', 'slides'], ['data:audio/wav;base64,AA==', 'audio'],
    ['data:video/mp4;base64,AA==', 'video']]) assert.equal(mediaUrl(source, type), source);
  assert.equal(mediaUrl('data:image/png;base64,AA==', 'audio'), '');
  assert.equal(mediaUrl('data:audio/wav;base64,AA==', 'video'), '');
  assert.equal(mediaUrl('data:image/png;base64,AA==', 'unknown'), '');
});

test('URL validation and HTML attribute encoding are separate boundaries', () => {
  const source = 'https://cdn.example.test/a.png?x=" onerror="bad()&second=1';
  const safe = mediaUrl(source, 'image');
  assert.equal(safe, 'https://cdn.example.test/a.png?x=%22%20onerror=%22bad()&second=1');
  assert.equal(context.escapeBuilderHtml(safe), 'https://cdn.example.test/a.png?x=%22%20onerror=%22bad()&amp;second=1');
});
