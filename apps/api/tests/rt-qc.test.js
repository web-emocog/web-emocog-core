const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeQcValidity, mergeBehavioralRtQc } = require('../qc/aggregator');

describe('session QC classification', () => {
  it('keeps strong gaze evidence borderline when only pose and a short FPS episode fail', () => {
    const out = computeQcValidity({
      qcScore: 0.3,
      checks: {
        duration: true,
        faceVisible: true,
        faceOk: true,
        poseOk: false,
        illuminationOk: true,
        eyesOpen: true,
        occlusion: true,
        gazeValid: true,
        gazeOnScreen: true,
        lowFps: false,
        consecutiveLowFps: false,
        gazeAccuracy: true,
        gazePrecision: true,
      },
    });
    assert.equal(out.validity, 'borderline');
    assert.equal(out.qc_score, 76.9);
    assert.ok(out.fail_reasons.includes('low_pose_ok_pct'));
    assert.ok(out.fail_reasons.includes('consecutive_low_fps'));
  });

  it('keeps a critical gaze failure invalid even when most other checks pass', () => {
    const out = computeQcValidity({
      qcScore: 0.9,
      checks: {
        duration: true,
        faceVisible: true,
        gazeValid: false,
        gazeOnScreen: true,
        lowFps: true,
      },
    });
    assert.equal(out.validity, 'invalid');
    assert.ok(out.fail_reasons.includes('low_gaze_valid_pct'));
  });
});

describe('behavioral RT QC', () => {
  it('adds high_omission_rate without forcing session invalid', () => {
    const rtFeatures = {
      blocks: [{
        block_id: 'b1',
        status: 'ok',
        computed_metrics: {
          omission_rate: { value: 0.3 },
        },
      }],
    };
    const payload = {};
    const out = mergeBehavioralRtQc(
      { validity: 'valid', qc_score: 80, fail_reasons: [] },
      rtFeatures,
      payload,
    );
    assert.ok(out.fail_reasons.includes('high_omission_rate'));
    assert.equal(out.validity, 'valid');
    assert.ok(payload.rt_qc);
  });
});
