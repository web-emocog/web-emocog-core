const test = require('node:test');
const assert = require('node:assert/strict');
const { channelQc, buildAoiRows, buildSessionMetrics } = require('../analytics/metrics');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

function row(validation) {
  return { id: 1, qc_validity: 'valid', features_payload: {
    gazeValidation: validation,
    gaze_analytics: { schemaVersion: 'gaze_analytics.v1', summary: {
      sampleCountTotal: 100, sampleCountValid: 95, validFraction: .95, meanConfidence: .94,
    }, presentations: [{ blockId: 'b', stimulusId: 's', presentationId: 'p', trialId: 't',
      fixationPoints: [{ x: .5, y: .5, startMs: 10, durationMs: 200 }],
      validObservationDurationMs: 1000 }] },
    cognitiveResults: [{ qualityValid: true, correct: true, blockId: 'b', trialId: 't', stimulusId: 's' }],
  } };
}
const query = { metricIds: ['aoi.dwell_time_ms', 'aoi.ttff_ms', 'aoi.fixation_count', 'aoi.target_reached_pct'],
  filters: { blockIds: [], stimulusIds: [], aoiIds: [], conditionIds: [] } };
const protocol = { definition: { blocks: [{ id: 'b', blockConfig: { aoiDefinitions: { s: [{
  id: 'a', shape: 'rectangle', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
}] } } }] } };

test('95% available gaze with passed broad validation does not certify AOI accuracy or drift', () => {
  const source = row({ passed: true, metrics: { accuracyPx: 148.4, accuracyPct: 8.8, precisionPx: 80.6 } });
  const qc = channelQc(source, 'gaze');
  assert.equal(qc.status, 'valid'); // Availability policy unchanged.
  assert.deepEqual(qc.spatialAccuracy, { version: 'gaze_spatial_qc.v1', validationStatus: 'passed',
    meanErrorPx: 148.4, meanErrorPct: 8.8, radialErrorSdPx: 80.6,
    scope: 'pre_session_only', driftStatus: 'not_measured', aoiSuitability: 'not_established' });
  assert.ok(qc.reasons.includes('gaze_drift_not_measured'));
  assert.ok(qc.reasons.includes('gaze_aoi_accuracy_unestablished'));
  for (const metric of buildAoiRows(source, protocol, query)[0].metrics) {
    assert.equal(metric.qc.spatialAccuracy.aoiSuitability, 'not_established');
  }
  const schema = require('../../web/docs/analytics-contract/analytics-response-v1.schema.json').$defs.qcResult;
  for (const key of Object.keys(qc.spatialAccuracy)) assert.ok(Object.hasOwn(schema.properties.spatialAccuracy.properties, key));
});

test('failed spatial validation cannot be hidden by excellent availability or publish AOI numbers', () => {
  const source = row({ passed: false, metrics: { accuracyPx: 210, accuracyPct: 13 } });
  assert.equal(channelQc(source, 'gaze').status, 'invalid');
  assert.equal(channelQc(source, 'task').status, 'valid');
  for (const metric of buildAoiRows(source, protocol, query)[0].metrics) {
    assert.equal(metric.value, null);
    assert.equal(metric.status, 'insufficient_quality');
    assert.equal(metric.reason, 'gaze_spatial_validation_failed');
  }
  const availability = buildSessionMetrics(source, { metricIds: ['qc.valid_gaze_pct'] })[0];
  assert.equal(availability.value, 95);
  assert.equal(availability.qc.status, 'invalid');
});

test('legacy missing spatial data stays unknown, not zero or an invented failure; inputs are unchanged', () => {
  const source = row(undefined);
  const before = JSON.stringify(source);
  const qc = channelQc(source, 'gaze');
  assert.equal(qc.spatialAccuracy.validationStatus, 'not_recorded');
  assert.equal(qc.spatialAccuracy.meanErrorPx, null);
  assert.ok(qc.reasons.includes('gaze_spatial_validation_missing'));
  buildAoiRows(source, protocol, query);
  assert.equal(JSON.stringify(source), before);
  for (const invalid of [null, '', true, [], '148', -1, NaN, Infinity]) {
    assert.equal(channelQc(row({ metrics: { accuracyPx: invalid } }), 'gaze').spatialAccuracy.meanErrorPx, null);
  }
});

test('new feature-method provenance survives aggregate compaction without raw face data', async () => {
  const { buildAggregatesPayload } = await import(pathToFileURL(path.resolve(__dirname,
    '../../participant-web/js/unified-aggregates-new.js')));
  const payload = buildAggregatesPayload({ ids: { session: 'synthetic-143' },
    tech: { gazeFeatureMethod: 'same_eye_iris.v2', gazeCalibrationSampling: 'open_eye_calibration.v1', gazeQcSignalMethod: 'corrected_validity.v1' },
    gazeValidation: { passed: true, metrics: { accuracyPx: 148.4, accuracyPct: 8.8 },
      points: [{ samples: [{ gazeX: 1, gazeY: 2, landmarks: ['MUST_NOT_SEND'] }] }] },
    lifecycle: {}, events: [] }, { forIngest: true });
  assert.equal(payload.meta.tech.gazeFeatureMethod, 'same_eye_iris.v2');
  assert.equal(payload.meta.tech.gazeCalibrationSampling, 'open_eye_calibration.v1');
  assert.equal(payload.meta.tech.gazeQcSignalMethod, 'corrected_validity.v1');
  assert.equal(payload.gazeValidation.metrics.accuracyPx, 148.4);
  assert.equal(payload.gazeValidation.pointsCount, 1);
  assert.equal(JSON.stringify(payload).includes('MUST_NOT_SEND'), false);
  // Lifecycle fixture is intentionally incomplete: isolate that error from data shape.
  const errors = validateSessionFeaturePayload(payload);
  assert.equal(errors.some(error => error.path === '/meta/tech/gazeFeatureMethod'), false);
  assert.equal(errors.some(error => error.path === '/meta/tech/gazeQcSignalMethod'), false);
  for (const invalid of [null, false, {}, [], 'unknown', 'corner_width_iris.experimental.v1',
    'camera_pixel_quadratic.experimental.v1', 'normalized_linear.experimental.v1', 'camera_pixel_linear.experimental.v1',
    'normalized_axis_mixed.experimental.v1', 'camera_pixel_axis_mixed.experimental.v1', 'normalized_quadratic.experimental.v1',
    'normalized_axis_auto.experimental.v1', 'camera_pixel_axis_auto.experimental.v1',
    'eye_patch_ridge.experimental.v1',
    'eye_patch_core_ridge.experimental.v1',
    'eye_gradient_iris.experimental.v1',
    'eye_gradient_all_iris.experimental.v1',
    'same_eye_iris.v2 '.repeat(1000)]) {
    payload.meta.tech.gazeFeatureMethod = invalid;
    const invalidErrors = validateSessionFeaturePayload(payload);
    assert.ok(invalidErrors.some(error => error.path === '/meta/tech/gazeFeatureMethod'));
    payload.meta.tech.gazeCalibrationSampling = invalid;
    assert.ok(validateSessionFeaturePayload(payload).some(error => error.path === '/meta/tech/gazeCalibrationSampling'));
    payload.meta.tech.gazeQcSignalMethod = invalid;
    assert.ok(validateSessionFeaturePayload(payload).some(error => error.path === '/meta/tech/gazeQcSignalMethod'));
  }
});
