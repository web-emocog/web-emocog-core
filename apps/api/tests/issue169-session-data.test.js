const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSessionFeaturePayload } = require('../security/payload-policy');

function fixture() {
  return {
    schemaVersion: 'session_feature.v1',
    ids: { session: 'synthetic-169', participant: 'P1' },
    lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'running', status: 'in_progress' },
    meta: { tech: {
      cameraFPSDetails: { fps: 30, duration: 2, frames: 60, measurementVersion: 'video_cadence.v2', playbackQuality: null },
      framePipeline: { frameIdentityMethod: 'video-frame-callback', contextBoundaryFrames: 2 }
    } },
    precheck: {
      head_pose_reference: { centerX: .5, centerY: .5, width: .3, height: .5 },
      pose: { eyesCentering: { quality: 77, eyesMidpoint: { x: .5, y: .5 }, isOptimal: true, hint: null } },
      eyes: { gazeDirection: 'center' },
      visibility: { timestamp: 1000, regions: { forehead: { isVisible: true, pixelCounts: { total: 8, faceSkin: 8 } } } }
    },
    body_pose_summary: { rawVideoStored: false, rawLandmarksStored: false },
    multimodal_heatmap: {
      schemaVersion: 'multimodal_heatmap.v1',
      presentations: [{ attempt: 1, alignment: { matchedSampleCount: 2 }, layers: {
        density: { id: 'density', values: [0, 1, null], valueDomain: [0, 1], sampleCount: 2, noData: false }
      } }],
      legend: [{ layer: 'density', domain: [0, 1], palette: 'amber' }]
    },
    gazeValidation: {
      metrics: { validSamples: 120, totalSamples: 123, validPct: '97.6', screenSize: { width: 1280, height: 720 } },
      baselineVsNew: { independent: true, decision: { accepted: false, reason: 'not_enough_gain' } },
      postCalibrationCorrection: { fitted: true, loocv: { targetCount: 9, loocvRmsHeldOutPx: 60 } }
    },
    events: [
      { type: 'session_continuity_gap', startTimestamp: 10, endTimestamp: 20, sampleCoverage: 'not_inferred' },
      { type: 'modules', modules: ['gaze', 'rt'], featureFlags: { audioDebugCapture: false } },
      { type: 'session_issue_raised', issue: { code: 'protocol_qc_fpsStable', details: {
        rule: 'fpsStable', method: 'cumulative-observed-metrics-1.0.0', totalFrames: 220,
        fpsDiagnostics: { analysisSession: { frames: 220, windows: 10, observedMs: 10000,
          meanFps: 22, threshold: 25, belowThresholdMs: 7000 } }
      } } }
    ].map((event, index) => ({ schemaVersion: 'session_event.v1', eventId: `synthetic-event-${index}`,
      category: 'technical', severity: 'warning', timestamp: 1000 + index, ...event }))
  };
}

test('#169 accepts current and older report shapes without mutating either', () => {
  const current = fixture();
  const before = structuredClone(current);
  assert.deepEqual(validateSessionFeaturePayload(current), []);
  assert.deepEqual(current, before);
  current.events[1].modules = { gaze: 'running', rt: 'idle' };
  current.multimodal_heatmap.presentations[0].layers = [{ id: 'density', values: [0, 1], sampleCount: 2 }];
  current.precheck.eyes.gazeDirection = { x: 0, y: 0 };
  assert.deepEqual(validateSessionFeaturePayload(current), []);
});

test('#169 schema still rejects raw measurements, extra keys, identifiers and oversized grids', () => {
  for (const mutate of [
    p => { p.precheck.visibility.regions.forehead.unknown = true; },
    p => { p.body_pose_summary.rawVideoStored = true; },
    p => { p.events[1].featureFlags.audioDebugCapture = true; },
    p => { p.events[1].modules = ['synthetic@example.test']; },
    p => { p.gazeValidation.metrics.screenSize.rawLandmarks = [1]; },
    p => { p.multimodal_heatmap.presentations[0].layers.density.valueDomain = [0]; },
    p => { p.multimodal_heatmap.presentations[0].layers.density.values = Array(4097).fill(0); }
  ]) {
    const p = fixture();
    mutate(p);
    const errors = validateSessionFeaturePayload(p);
    assert.ok(errors.length, String(mutate));
    assert.doesNotMatch(JSON.stringify(errors), /synthetic@example\.test/);
  }
});

module.exports = { fixture };
