const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeButtonId, eventsToRtJsonl } = require('../rt/event_adapter');
const { computeBlockRtFeatures } = require('../rt/compute');

describe('RT web→analyzer key mapping', () => {
  it('preserves the first exact response index and positional fallback after indexing', () => {
    const { events } = eventsToRtJsonl([
      { type: 'response', blockId: 'b1', trialIndex: 1, rtMs: 501, key: 'KeyD' },
      { type: 'response', blockId: 'b1', trialIndex: 1, rtMs: 999, key: 'KeyF' },
      { type: 'response', blockId: 'b1', trialIndex: '2', rtMs: 602, key: 'KeyG' },
    ], [{}, {}, {}], { blockId: 'b1' });
    const responses = events.filter(event => event.event_type === 'keypress');
    assert.deepEqual(responses.map(event => event.button_id), ['keyd', 'keyd', 'keyg']);
    assert.deepEqual(responses.map(event => Math.round((event.t_mono % 3) * 1000)), [501, 501, 602]);
  });
  it('maps Arrow keys to left/right for choice task', () => {
    assert.equal(normalizeButtonId('ArrowLeft'), 'left');
    assert.equal(normalizeButtonId('ArrowRight'), 'right');
    assert.equal(normalizeButtonId('Space'), 'space');
  });

  it('flanker-style trial produces matching expected and button_id', () => {
    const { events, analyzerTask } = eventsToRtJsonl(
      [
        { type: 'stimulus_on', blockId: 'b1', trialIndex: 0, tRelMs: 2000, condition: 'congruent/right' },
        { type: 'response', blockId: 'b1', trialIndex: 0, rtMs: 510, key: 'ArrowRight' },
      ],
      [{
        trialId: 't1',
        blockId: 'b1',
        condition: 'congruent/right',
        rt: 510,
        response: 'ArrowRight',
        expectedResponse: 'ArrowRight',
        correct: true,
      }],
      { blockId: 'b1', taskType: 'flanker', rtWindowMs: 1500 },
    );
    assert.equal(analyzerTask, 'choice');
    const stim = events.find((e) => e.event_type === 'stimulus_on');
    const press = events.find((e) => e.event_type === 'keypress');
    assert.equal(stim.expected_response, 'right');
    assert.equal(press.button_id, 'right');
  });
});

describe('analyzer unavailable fallback', () => {
  it('returns analyzer_unavailable without throwing when Python missing', async () => {
    const orig = process.env.RT_PYTHON;
    process.env.RT_PYTHON = 'python_nonexistent_xyz_999';
    try {
      const feat = await computeBlockRtFeatures(
        { blockId: 'b1', taskType: 'simple_rt', selectedMetrics: ['rt_mean'] },
        [{ type: 'stimulus_on', blockId: 'b1', trialIndex: 0, tRelMs: 1 }],
        [{ blockId: 'b1', rt: 300, response: 'Space', condition: 'go' }],
      );
      assert.equal(feat.status, 'analyzer_unavailable');
      assert.ok(feat.error);
    } finally {
      if (orig == null) delete process.env.RT_PYTHON;
      else process.env.RT_PYTHON = orig;
    }
  });
});
