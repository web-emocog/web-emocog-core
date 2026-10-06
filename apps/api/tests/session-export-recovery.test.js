const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const InlineQc = require('../../participant-web/js/qc-metrics');

function participantModule(file) {
  return import(pathToFileURL(path.resolve(__dirname, '../../participant-web/js', file)).href);
}

test('language changes and legacy exports produce contract-valid events without mutating the source', async () => {
  const { createSessionEvent } = await participantModule('session-runtime/contracts.mjs');
  const { buildAggregatesPayload } = await participantModule('unified-aggregates-new.js');
  const current = createSessionEvent({ type: 'interface_language_changed', category: 'session', from: 'ru', to: 'en' });
  assert.equal(current.category, 'lifecycle');
  const legacy = { ...current, category: 'session' };
  const source = {
    ids: { session: 'S-RECOVERY', participant: 'P-RECOVERY' },
    user: { interfaceLanguage: 'en', email: 'not-exported@example.test' },
    precheck: { landmarks: [{ x: 0.2, y: 0.3 }] },
    eyeSignals: Array.from({ length: 6000 }, () => ({ leftEAR: 0.25 })),
    events: [legacy],
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed',
      completedAt: '2026-10-04T20:00:00.000Z', finishAttemptId: 'finish-recovery' },
  };
  const payload = buildAggregatesPayload(source, { forIngest: true });
  assert.deepEqual(validateSessionFeaturePayload(payload), []);
  assert.equal(payload.events[0].category, 'lifecycle');
  assert.equal(payload.events[0].eventId, legacy.eventId);
  assert.equal(source.events[0].category, 'session');
  assert.equal(JSON.stringify(payload).includes('not-exported@example.test'), false);
  assert.equal(payload.eyeSignals, undefined);
  assert.equal(payload.precheck.landmarks, undefined);
});

test('legacy compatibility does not hide unknown event categories or PII', async () => {
  const { buildAggregatesPayload } = await participantModule('unified-aggregates-new.js');
  const { createSessionEvent } = await participantModule('session-runtime/contracts.mjs');
  const payload = buildAggregatesPayload({
    ids: { session: 'S-REJECT' },
    events: [createSessionEvent({ type: 'bad_event', category: 'unknown_category', email: 'sensitive@example.test' })],
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed' },
  }, { forIngest: true });
  const errors = validateSessionFeaturePayload(payload);
  assert.ok(errors.some(error => error.path === '/events/0/category' && error.keyword === 'enum'));
  assert.ok(errors.some(error => error.keyword === 'pii'));
});

test('final QC, inline fallback and runtime agree on regional versus global occlusion', async () => {
  const { computeFrameFlags, createInstrumentCounters, updateInstrumentCounters, computePercentages } =
    await participantModule('qc-metrics/frame-analysis.js');
  const { SessionQualityDetector } = await participantModule('session-runtime/quality-detector.mjs');
  const { getCurrentMetrics } = await participantModule('qc-metrics/metrics-calculator.js');
  const frame = { face: { detected: true, status: 'optimal' },
    pose: { status: 'stable' }, illumination: { status: 'optimal' }, eyes: { bothOpen: true } };
  const cases = [
    [null, false],
    [{ faceVisibility: { handDetected: true, issues: ['hand_on_face', 'low_skin_visibility'] } }, false],
    [{ faceVisibility: { issues: [null, 1, 'glasses'] } }, false],
    [{ issues: ['left_eye_hand_occluded'], faceVisibility: { handDetected: true } }, true],
    [{ issues: [], faceVisibility: { issues: ['right_cheek_hand_occluded'] } }, true],
  ];
  const inline = new InlineQc();
  const detector = new SessionQualityDetector({ rules: { face_occluded: { holdMs: 0, message: 'occluded' } } });
  for (const [segmentation, occluded] of cases) {
    const flags = computeFrameFlags(frame, segmentation);
    assert.deepEqual(inline._computeFlags(frame, segmentation), flags);
    assert.equal(flags.faceVisible, true);
    assert.equal(flags.faceOk, !occluded);
    assert.equal(flags.occlusionDetected, occluded);
    detector.reset();
    const raised = detector.update(frame, segmentation, 1000).raised.map(issue => issue.code);
    assert.equal(raised.includes('face_occluded'), occluded);
  }
  const flags = computeFrameFlags(frame, cases[1][0]);
  const counters = updateInstrumentCounters(createInstrumentCounters(), flags, {}, false, 33);
  assert.equal(computePercentages(counters).faceOkPct, 100);
  assert.equal(computePercentages(counters).occlusionPct, 0);
  const metrics = getCurrentMetrics(counters, { validTimeMs: 0, onScreenTimeMs: 0 }, null, Date.now());
  assert.equal(metrics.faceVisibilityMethod, 'regional_hand_evidence.v2');
});
