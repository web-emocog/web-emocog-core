const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { protectSpreadsheetCell, escapeCsv } = require('../security/csv');

it('neutralizes CSV formulas including whitespace and control-character prefixes', () => {
  for (const value of ['=1+1', '+1+1', '-1+1', '@SUM(1)', '  =1+1', '\ufeff=1+1', '\tlabel', '\rlabel', '\nlabel']) {
    assert.equal(protectSpreadsheetCell(value), `'${value}`);
  }
  assert.equal(escapeCsv('=HYPERLINK("untrusted")'), '"\'=HYPERLINK(""untrusted"")"');
});

it('retains negative numeric observations, missingness and conventional CSV quoting', () => {
  assert.equal(escapeCsv(-0.25), '-0.25');
  assert.equal(escapeCsv(0), '0');
  assert.equal(escapeCsv(null), '');
  assert.equal(escapeCsv(false), 'false');
  assert.equal(escapeCsv('normal'), 'normal');
  assert.equal(escapeCsv('a,"b"'), '"a,""b"""');
  assert.equal(escapeCsv({ value: -0.25 }), '"{""value"":-0.25}"');
});

it('uses the same safe serializer in canonical analytics and legacy session exports', () => {
  for (const file of ['analytics/v1-router.js', 'routes/export.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    assert.match(source, /require\('\.\.\/security\/csv'\)/);
    assert.doesNotMatch(source, /function escapeCsv\(/);
  }
});
