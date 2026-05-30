const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mergeBehavioralRtQc } = require('../qc/aggregator');

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
