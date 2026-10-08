const { test } = require('node:test');
const assert = require('node:assert/strict');

test('precheck guide and gate use the unchanged distance boundaries', async () => {
  const { getDistanceStatus, precheckContourStatus } = await import('../../participant-web/js/precheck-status.mjs');
  for (const [height, expected] of [[0.169, 'too_far'], [0.17, 'ok'], [0.3, 'ok'], [0.52, 'ok'], [0.521, 'too_close']]) {
    const frame = { face: { detected: true, bbox: { height } }, pose: { status: 'stable' } };
    assert.equal(getDistanceStatus(frame).status, expected);
    assert.equal(precheckContourStatus(frame), expected === 'ok' ? 'passed' : 'failed');
  }
  assert.equal(getDistanceStatus({}).failed, true);
  assert.equal(getDistanceStatus({ face: { detected: true, bbox: { height: NaN } } }).failed, true);
});

test('precheck does not report an unknown pose as passed', async () => {
  const { precheckPoseStatus, precheckContourStatus } = await import('../../participant-web/js/precheck-status.mjs');
  for (const status of ['tilted', 'off_center', 'unstable', 'partial_face', 'no_face', 'error']) {
    assert.equal(precheckPoseStatus({ status }), 'failed');
  }
  for (const pose of [null, {}, { status: 'unknown' }]) {
    assert.equal(precheckPoseStatus(pose), 'pending');
  }
  assert.equal(precheckPoseStatus({ status: 'stable' }), 'passed');
  assert.equal(precheckContourStatus({ face: { detected: true, bbox: { height: 0.3 } } }), 'pending');
});
