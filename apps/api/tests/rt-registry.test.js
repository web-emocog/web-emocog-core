/**
 * RT registry + event adapter unit tests.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  mapWebTaskToAnalyzer,
  resolveSelectedMetrics,
  getMetricValueFromAnalyzer,
} = require('../../shared/rt-registry');
const { eventsToRtJsonl, conditionToIsGo } = require('../rt/event_adapter');

describe('rt-registry', () => {
  it('maps web task ids to analyzer tasks', () => {
    assert.equal(mapWebTaskToAnalyzer('simple_rt'), 'simple');
    assert.equal(mapWebTaskToAnalyzer('go_nogo'), 'go_nogo');
    assert.equal(mapWebTaskToAnalyzer('ax_cpt'), 'cpt');
  });

  it('resolveSelectedMetrics adds QC metrics and defaults', () => {
    const sel = resolveSelectedMetrics('simple_rt', ['rt_mean']);
    assert.ok(sel.includes('rt_mean'));
    assert.ok(sel.includes('omission_rate'));
  });

  it('getMetricValueFromAnalyzer reads mean_rt_ms', () => {
    const metrics = { rt: { mean_rt_ms: 412.5 } };
    assert.equal(getMetricValueFromAnalyzer(metrics, 'rt_mean'), 412.5);
  });
});

describe('rt event_adapter', () => {
  it('builds stimulus_on and keypress events from cognitive rows', () => {
    const events = [
      { type: 'stimulus_on', blockId: 'b1', trialIndex: 0, tRelMs: 1000 },
      { type: 'response', blockId: 'b1', trialIndex: 0, rtMs: 320, key: 'Space' },
    ];
    const cognitiveResults = [
      {
        trialId: 't1',
        blockId: 'b1',
        condition: 'go',
        rt: 320,
        response: 'Space',
        expectedResponse: 'Space',
      },
    ];
    const { events: jsonl, analyzerTask } = eventsToRtJsonl(events, cognitiveResults, {
      blockId: 'b1',
      taskType: 'simple_rt',
      rtWindowMs: 2000,
    });
    assert.equal(analyzerTask, 'simple');
    assert.ok(jsonl.some((e) => e.event_type === 'stimulus_on'));
    assert.ok(jsonl.some((e) => e.event_type === 'keypress'));
  });

  it('conditionToIsGo detects nogo', () => {
    assert.equal(conditionToIsGo('No-Go'), false);
    assert.equal(conditionToIsGo('go'), true);
  });

  it('maps ArrowLeft to left for choice analyzer compatibility', () => {
    const { normalizeButtonId } = require('../rt/event_adapter');
    assert.equal(normalizeButtonId('ArrowLeft'), 'left');
  });
});
