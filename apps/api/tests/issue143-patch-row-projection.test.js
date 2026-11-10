const test = require('node:test');
const assert = require('node:assert/strict');

test('row projection removes uniform per-row intensity without removing vertical feature position', async () => {
  const { projectPatchRows } = await import('../../web/developer/gaze-eye-patch-rows.mjs');
  const pixels = (darkRow, offset = false) => Array.from({ length: 120 }, (_, i) => {
    const row = Math.floor((i % 60) / 10), column = i % 10, right = i >= 60;
    return (row === darkRow && column === (right ? 6 : 3) ? -2 : 0)
      + (offset ? 2 * (row - 2) + (right ? 9 : -10) : 0);
  });
  const up = projectPatchRows(pixels(1)), down = projectPatchRows(pixels(4));
  const shiftedLight = projectPatchRows(pixels(1, true));
  assert.equal(up.length, 120);
  assert.ok(up[13] < -1 && down[43] < -1);
  assert.ok(up.every((v, i) => Math.abs(v - shiftedLight[i]) < 1e-12));
  assert.notDeepEqual(projectPatchRows(pixels(1), .25), projectPatchRows(pixels(1, true), .25));
});

test('row projection does not invent a feature from a malformed or entirely row-constant patch', async () => {
  const { projectPatchRows } = await import('../../web/developer/gaze-eye-patch-rows.mjs');
  assert.equal(projectPatchRows([0, 1]), null);
  assert.equal(projectPatchRows(new Array(120).fill(1), 1), null);
  assert.equal(projectPatchRows(Array.from({ length: 120 }, (_, i) => Math.floor(i / 10))), null);
  assert.equal(projectPatchRows(new Array(120).fill(1), -1), null);
  assert.equal(projectPatchRows([...new Array(119).fill(0), Infinity]), null);
});
