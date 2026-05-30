const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getRtAnalyzerHealth, computeSessionRtFeatures } = require('../rt/compute');

describe('RT analyzer health', () => {
  it('getRtAnalyzerHealth returns structured status', () => {
    const h = getRtAnalyzerHealth();
    assert.equal(typeof h.available, 'boolean');
    assert.equal(typeof h.script_exists, 'boolean');
    assert.equal(typeof h.config_exists, 'boolean');
    assert.ok(h.python);
  });
});

describe('RT ingest compute (no DB)', () => {
  it('computes rt_features for minimal payload when Python available', () => {
    const h = getRtAnalyzerHealth();
    const payload = {
      ids: { session: 'S-test-1' },
      events: [
        { type: 'stimulus_on', blockId: 'b1', trialIndex: 0, tRelMs: 1000, condition: 'go' },
        { type: 'response', blockId: 'b1', trialIndex: 0, rtMs: 400, key: 'Space' },
      ],
      cognitiveResults: [
        {
          trialId: 't1',
          blockId: 'b1',
          condition: 'go',
          rt: 400,
          response: 'Space',
          expectedResponse: 'Space',
          correct: true,
        },
      ],
    };
    const protocol = {
      version: 'v2.0_universal',
      blocks: [{
        id: 'b1',
        type: 'cognitive_task',
        taskType: 'simple_rt',
        blockConfig: { selected_metrics: ['rt_mean', 'omission_rate'] },
        trials: [],
      }],
    };
    const rt = computeSessionRtFeatures(payload, protocol);
    assert.equal(rt.schema_version, 'rt_features.v1');
    if (h.available) {
      assert.equal(rt.blocks[0].status, 'ok');
      assert.ok(rt.blocks[0].computed_metrics.rt_mean);
      assert.equal(rt.blocks[0].computed_metrics.rt_mean.value, 400);
    } else {
      assert.equal(rt.blocks[0].status, 'analyzer_unavailable');
    }
  });

  it('backward compat: protocol without selected_metrics uses defaults', () => {
    const payload = {
      events: [],
      cognitiveResults: [],
    };
    const protocol = {
      version: 'v2.0_universal',
      blocks: [{
        id: 'b1',
        type: 'cognitive_task',
        taskType: 'go_nogo',
        blockConfig: {},
        trials: [],
      }],
    };
    const rt = computeSessionRtFeatures(payload, protocol);
    assert.ok(Array.isArray(rt.blocks));
  });

  it('malformed payload does not throw', () => {
    assert.doesNotThrow(() => computeSessionRtFeatures(null, null));
    assert.doesNotThrow(() => computeSessionRtFeatures({}, undefined));
  });
});

describe('RT Python smoke file', () => {
  it('sample_events.jsonl exists for manual smoke', () => {
    const p = path.resolve(__dirname, '../../../rt_component-/tests/sample_events.jsonl');
    assert.ok(fs.existsSync(p));
  });
});
