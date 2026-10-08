const test = require('node:test');
const assert = require('node:assert/strict');

test('RT response policy', async t => {
  const {
    RESPONSE_MODES,
    RtResponseCollector,
    normalizeResponseMode,
    normalizeKeyboardResponse,
    responseValueForMode,
  } = await import('../../participant-web/js/rt-input/response-policy.mjs');

  await t.test('normalizes Russian/English responses to physical keys and preserves legacy keys', () => {
    for (const [code, en, ru] of [['KeyZ', 'z', '\u044f'], ['KeyX', 'x', '\u0447'], ['Comma', ',', '\u0431'], ['Period', '.', '\u044e']]) {
      for (const key of [en, ru, ru.toUpperCase()]) {
        assert.equal(normalizeKeyboardResponse(key), code);
        assert.equal(responseValueForMode('keypress', { code, key }), code);
      }
    }
    assert.equal(responseValueForMode('keypress', { code: 'Space' }), 'Space');
    assert.equal(responseValueForMode('keypress', { code: 'ArrowLeft' }), 'ArrowLeft');
    assert.equal(responseValueForMode('keypress', { code: 'KeyA', key: 'z' }), null);
    for (const flag of ['repeat', 'ctrlKey', 'altKey', 'metaKey', 'isComposing']) {
      assert.equal(responseValueForMode('keypress', { code: 'KeyZ', [flag]: true }), null);
    }
    assert.equal(responseValueForMode('none', { code: 'KeyZ' }), null);
  });

  await t.test('records exactly one canonical response and ignores a held key', () => {
    let now = 100;
    const decisions = [];
    const collector = new RtResponseCollector({ mode: 'keypress', now: () => now,
      target: { addEventListener() {}, removeEventListener() {} } });
    collector.arm(result => decisions.push(result));
    collector._onKeydown({ code: 'KeyZ', key: '\u044f', repeat: true });
    assert.equal(decisions.length, 0);
    now = 250;
    collector._onKeydown({ code: 'Comma', key: '\u0431' });
    collector._onKeydown({ code: 'Period', key: '\u044e' });
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].response, 'Comma');
    assert.equal(decisions[0].rtMs, 150);
  });

  await t.test('preserves equivalent responses through the server RT event adapter', () => {
    const { eventsToRtJsonl } = require('../rt/event_adapter');
    for (const [code, alias] of [['KeyZ', '\u044f'], ['KeyX', 'x'], ['Comma', '\u0431'], ['Period', '.']]) {
      const { events } = eventsToRtJsonl([], [{ trialId: 'trial_1', expectedResponse: alias, response: code, rt: 320 }], { taskType: 'choice' });
      assert.equal(events[0].expected_response, code.toLowerCase());
      assert.equal(events[1].button_id, code.toLowerCase());
    }
  });

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
