const test = require('node:test');
const assert = require('node:assert/strict');

test('RT response policy', async t => {
  const {
    RESPONSE_MODES,
    RtResponseCollector,
    normalizeResponseMode,
  } = await import('../../participant-web/js/rt-input/response-policy.mjs');

  await t.test('keeps legacy key/click behavior and requires explicit pointer intent', () => {
    assert.equal(normalizeResponseMode({}, { correctResponse: 'Space' }), RESPONSE_MODES.KEYPRESS);
    assert.equal(normalizeResponseMode({}, { correctResponse: 'Click' }), RESPONSE_MODES.CLICK);
    assert.equal(normalizeResponseMode({ responseMode: 'none' }, { correctResponse: 'Space' }), RESPONSE_MODES.NONE);
    assert.equal(normalizeResponseMode({ responseMode: 'pointer_intent' }, {}), RESPONSE_MODES.POINTER_INTENT);
  });

  await t.test('ignores jitter and fires pointer intent once after sustained movement', () => {
    let now = 0;
    let pending = null;
    const target = { addEventListener() {}, removeEventListener() {} };
    const decisions = [];
    const collector = new RtResponseCollector({
      mode: 'pointer_intent',
      target,
      now: () => now,
      setTimer: callback => { pending = callback; return 1; },
      clearTimer: () => { pending = null; },
      devicePixelRatio: 1,
    });
    collector.startBaseline();
    for (const [x, y, tMs] of [[100, 100, 0], [101, 100, 100], [99, 101, 200], [100, 99, 300]]) {
      now = tMs;
      collector._onPointerMove({ clientX: x, clientY: y });
    }
    now = 400;
    collector.arm(decision => decisions.push(decision));
    now = 410;
    collector._onPointerMove({ clientX: 102, clientY: 100 });
    assert.equal(pending, null);
    now = 420;
    collector._onPointerMove({ clientX: 132, clientY: 100 });
    assert.equal(typeof pending, 'function');
    now = 475;
    pending();
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].response, 'PointerIntent');
    assert.equal(decisions[0].pointerSummary.thresholdVersion, 'pointer_intent.v1');
    assert.ok(decisions[0].pointerSummary.deadZonePx >= 4);
    pending?.();
    assert.equal(decisions.length, 1);
  });

  await t.test('does not accept synthetic pointer input', () => {
    let now = 0;
    let pending = null;
    const collector = new RtResponseCollector({
      mode: 'pointer_intent',
      target: { addEventListener() {}, removeEventListener() {} },
      now: () => now,
      setTimer: callback => { pending = callback; return 1; },
    });
    collector.startBaseline();
    collector._onPointerMove({ clientX: 10, clientY: 10 });
    now = 300;
    collector.arm(() => assert.fail('synthetic input must not trigger'));
    now = 310;
    collector._onPointerMove({ clientX: 200, clientY: 200, isTrusted: false });
    assert.equal(pending, null);
    collector.dispose();
  });
});
