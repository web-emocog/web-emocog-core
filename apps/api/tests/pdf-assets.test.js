const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

test('current-report PDF ships its pinned offline library, Cyrillic font and licenses', () => {
  const root = path.resolve(__dirname, '../../..');
  const files = [
    ['apps/web/assets/vendor/jspdf/dist/jspdf.umd.min.js', 'e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54'],
    ['apps/web/assets/fonts/DejaVuSans.ttf', '7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954']
  ];
  for (const [file, hash] of files) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), hash, file);
  }
  for (const file of ['apps/web/assets/vendor/jspdf/LICENSE', 'apps/web/assets/fonts/DejaVuSans-LICENSE.txt']) {
    assert.ok(fs.readFileSync(path.join(root, file), 'utf8').length > 100, file);
  }
  const html = fs.readFileSync(path.join(root, 'apps/web/researcher.html'), 'utf8');
  assert.ok(html.includes('assets/vendor/jspdf/dist/jspdf.umd.min.js?v=4.2.1'));
});
