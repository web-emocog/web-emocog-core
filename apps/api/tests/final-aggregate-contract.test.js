const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const { buildSessionMetrics, channelQc } = require('../analytics/metrics');

test('participant final aggregates pass ingest policy and remain visible to researcher analytics', async () => {
  const aggregateModule = path.resolve(
    __dirname,
    '../../participant-web/js/unified-aggregates-new.js'
  );
  const { buildAggregatesPayload } = await import(pathToFileURL(aggregateModule).href);
  const completedAt = '2026-08-10T10:01:00.000Z';
  const payload = buildAggregatesPayload({
    ids: {
      session: 'S-FINAL-CONTRACT',
      participant: 'P-FINAL-CONTRACT',
      invitationCode: 'INV-FINAL-CONTRACT',
    },
    user: {
      interfaceLanguage: 'ru',
      email: 'must-not-cross-ingest@example.test',
    },
    tech: { deviceClass: 'laptop_webcam', cameraFPS: 30 },
    precheck: { pass_fail: true },
    qcSummary: { qcScore: 94, validity: 'valid', failReasons: [] },
    attentionMetrics: { global: { attentionScore: 91 } },
    blinkSummary: { blinkCount: 8, meanDurationMs: 170 },
    perclosSummary: { meanPct: 4.2 },
    bodyPoseSummary: { sampleCount: 120, movementIndex: 0.08 },
    audioSummary: {
      schemaVersion: 'audio_session.v1', algorithmVersion: 'open_vocal_biomarkers.test',
      status: 'completed', enabled: true, consentGranted: true, permission: 'granted',
      rawAudioStored: false, rawAudioTransmitted: false, sampleRate: 16000,
      windowDurationMs: 10000, windowCount: 0, acceptedWindowCount: 0,
      rejectedWindowCount: 0, droppedWindowCount: 0, durationMs: 0,
      qualityMean: null, reliabilityMean: null, markers: [], windows: [],
      provenance: { coreLicense: 'MIT' }, disclaimer: 'research only',
    },
    multimodalSummary: {
      schemaVersion: 'multimodal_session.v1', enabled: true, gamerMode: false,
      timebase: {}, head: {}, body: {}, eventCount: 0,
      rawVideoStored: false, rawLandmarksStored: false, disclaimer: 'research only',
    },
    multimodalHeatmap: {
      schemaVersion: 'multimodal_heatmap.v1',
      coordinateSpace: 'stimulus_normalized_0_1',
      presentationCountTotal: 0, presentationCountStored: 0,
      presentationsTruncated: false, alignmentP95Ms: null,
      presentations: [], legend: [], disclaimer: 'research only',
    },
    emotionAccumulator: { n: 10, valenceSum: 2, arousalSum: 4 },
    eyeTracking: [
      {
        correctedX: 320, correctedY: 180, valid: true, onScreen: true,
        confidence: 0.91, t: 1000,
      },
      {
        correctedX: 330, correctedY: 184, valid: true, onScreen: true,
        confidence: 0.89, t: 1100,
      },
      {
        correctedX: null, correctedY: null, valid: false, onScreen: false,
        confidence: 0.4, t: 1200,
      },
    ],
    heatmaps: {
      perStimulus: [{
        blockId: 'vpc',
        trialId: 'trial-1',
        stimulusId: 'felidae-1',
        stimulusName: 'Felidae',
        stimulusType: 'image_pair',
        presentationId: 'vpc:trial-1:felidae-1',
        intrinsicWidth: 800,
        intrinsicHeight: 600,
        grid: { width: 2, height: 2, values: [1, 0, 0, 1] },
        fixationPoints: [{ x: 0.4, y: 0.5, startMs: 20, durationMs: 220 }],
        sampleCountTotal: 3,
        sampleCountValid: 2,
        lowConfidenceCount: 1,
        offScreenCount: 1,
        outsideStimulusCount: 0,
        validObservationDurationMs: 200,
        meanConfidence: 0.9,
      }],
    },
    cognitiveResults: [{
      blockId: 'rt-1', trialId: 'rt-trial-1', stimulusId: 'go',
      response: 'Space', correct: true, rt: 410, qualityValid: true,
    }],
    gazeValidation: { passed: true, metrics: { accuracyPct: 5, precisionPct: 2 } },
    events: [],
    lifecycle: {
      schemaVersion: 'session_lifecycle.v1',
      state: 'completed',
      status: 'completed',
      startedAt: '2026-08-10T10:00:00.000Z',
      lastTransitionAt: completedAt,
      completedAt,
      finishAttemptId: 'finish-final-contract',
      currentBlock: null,
      repeatQueue: [],
      activeIssues: [],
      modules: {},
    },
    startTime: '2026-08-10T10:00:00.000Z',
  }, { forIngest: true });

  assert.deepEqual(validateSessionFeaturePayload(payload), []);
  assert.equal(JSON.stringify(payload).includes('must-not-cross-ingest@example.test'), false);
  assert.equal(payload.gaze_analytics.summary.sampleCountTotal, 3);
  assert.equal(payload.gaze_analytics.summary.sampleCountValid, 2);
  assert.equal(payload.gaze_analytics.presentations.length, 1);
  assert.equal(payload.blink_summary.blinkCount, 8);
  assert.equal(payload.body_pose_summary.sampleCount, 120);
  assert.equal(payload.audio_summary.rawAudioStored, false);
  assert.equal(payload.multimodal_summary.rawVideoStored, false);
  assert.equal(payload.multimodal_heatmap.coordinateSpace, 'stimulus_normalized_0_1');
  assert.equal(payload.emotion_summary.n, 10);

  const researcherRow = {
    id: 1,
    session_id: payload.ids.session,
    participant_id: payload.ids.participant,
    started_at: '2026-08-10T10:00:00.000Z',
    stopped_at: completedAt,
    qc_validity: 'valid',
    features_payload: payload,
  };
  const query = {
    metricIds: ['qc.valid_gaze_pct', 'task.accuracy_pct'],
    filters: { blockIds: [], stimulusIds: [] },
  };
  const metrics = buildSessionMetrics(researcherRow, query);
  assert.equal(metrics.find(metric => metric.metricId === 'qc.valid_gaze_pct').value, 66.667);
  assert.equal(metrics.find(metric => metric.metricId === 'task.accuracy_pct').value, 100);
  assert.equal(channelQc(researcherRow, 'gaze').status, 'borderline');

  const finalUi = fs.readFileSync(
    path.resolve(__dirname, '../../participant-web/js/web-page/ui-updated.js'),
    'utf8'
  );
  const finishFlow = fs.readFileSync(
    path.resolve(__dirname, '../../participant-web/js/web-page/tests-updated.js'),
    'utf8'
  );
  assert.match(finalUi, /serverValidity === 'valid'/);
  assert.match(finalUi, /QC рассчитывается/);
  assert.match(finishFlow, /uploadResult\.result\?\.qc_validity/);
  assert.match(finishFlow, /runtime\?\.ui\?\.hideIssue\?\.\(\)/);
});

test('long sessions are compacted below ingest limit without raw biometric series', async () => {
  const aggregateModule = path.resolve(
    __dirname,
    '../../participant-web/js/unified-aggregates-new.js'
  );
  const { buildAggregatesPayload } = await import(
    pathToFileURL(aggregateModule).href + `?compact=${Date.now()}`
  );
  const repeated = Array.from({ length: 25000 }, (_, index) => index / 100);
  const completedAt = '2026-08-28T10:01:00.000Z';
  const payload = buildAggregatesPayload({
    ids: { session: 'S-LONG-CONTRACT', participant: 'P-LONG-CONTRACT' },
    precheck: { landmarks: repeated.map(value => ({ x: value, y: value })) },
    attentionMetrics: {
      global: { perclos: { windows: { '60s': { meanPct: 4, values: repeated } } } },
      postCalibration: { perclos: { windows: { '60s': { meanPct: 4, values: repeated } } } },
    },
    blinkSummary: { blinkCount: 50, durationsMs: repeated },
    perclosSummary: { meanPct: 4, closureEvents: repeated.map(value => ({ value })) },
    gazeValidation: { passed: true, points: repeated.map(value => ({ x: value, y: value })) },
    eyeTracking: repeated.slice(0, 15000).map((value, index) => ({
      correctedX: value,
      correctedY: value,
      valid: true,
      onScreen: true,
      confidence: 0.9,
      t: index * 33,
    })),
    audioSummary: {
      schemaVersion: 'audio_session.v1', algorithmVersion: 'test', status: 'completed',
      enabled: true, consentGranted: true, permission: 'granted', rawAudioStored: false,
      rawAudioTransmitted: false, sampleRate: 16000, windowDurationMs: 10000,
      windowCount: 1000, acceptedWindowCount: 1000, rejectedWindowCount: 0,
      droppedWindowCount: 0, durationMs: 10000000, qualityMean: 0.9,
      reliabilityMean: 0.9, markers: [],
      windows: Array.from({ length: 1000 }, (_, index) => ({
        index,
        quality: 0.9,
        samples: repeated.slice(0, 100),
      })),
      provenance: {}, disclaimer: 'research only',
    },
    events: [],
    lifecycle: {
      schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed',
      completedAt, finishAttemptId: 'finish-long-contract', modules: {},
    },
  }, { forIngest: true });

  const encoded = JSON.stringify(payload);
  assert.ok(Buffer.byteLength(encoded) < 1750 * 1024);
  assert.equal(encoded.includes('"landmarks":'), false);
  assert.equal(encoded.includes('"samples":'), false);
  assert.equal(encoded.includes('"closureEvents":'), false);
  assert.deepEqual(validateSessionFeaturePayload(payload), []);
});
