const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = name => import(path.resolve(__dirname, '../../web/developer', name));
const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8');

test('benchmark metadata is allowlisted, bounded and never copies identity/device identifiers or free text', async () => {
  const { benchmarkMetadata } = await load('gaze-benchmark-report.mjs');
  const report = benchmarkMetadata({ protocol: 'posture.v1', completed: false, reason: 'PRIVATE_SENTINEL',
    phase: 'PRIVATE_SENTINEL', userAgent: 'Mozilla Macintosh Version/18.2 Safari/605 PRIVATE_SENTINEL',
    viewport: { width: 1000, height: 800, label: 'PRIVATE_SENTINEL' }, camera: { deviceId: 'PRIVATE_SENTINEL', width: 640, height: 480 },
    runId: 'PRIVATE_SENTINEL', frameCount: Infinity, frameErrors: -1, calibrationAccepted: 50,
    backend: 'PRIVATE_SENTINEL', token: 'PRIVATE_SENTINEL', rawFrames: ['PRIVATE_SENTINEL'] });
  assert.equal(JSON.stringify(report).includes('PRIVATE_SENTINEL'), false);
  assert.equal(report.runId, null); assert.equal(report.reason, 'technical_error'); assert.equal(report.phase, 'setup');
  assert.equal(report.environment.browser, 'safari'); assert.equal(report.environment.browserMajor, 18);
  assert.equal(report.environment.platform, 'macos'); assert.equal(report.environment.camera.width, 640);
  assert.equal(report.counters.completedCaptures, 0); assert.equal(report.counters.calibrationAccepted, 50);
  assert.equal(report.offScreenSpecificityMeasured, false);
  assert.throws(() => benchmarkMetadata({ protocol: 'invented' }), /Unknown benchmark protocol/);
});

test('benchmark errors expose only fixed diagnostic categories', async () => {
  const { benchmarkFailureReason } = await load('gaze-benchmark-report.mjs');
  assert.equal(benchmarkFailureReason(new Error('SECRET raw error stack')), 'technical_error');
  assert.equal(benchmarkFailureReason({ code: 'staff_account_changed', message: 'SECRET' }), 'access_denied');
  assert.equal(benchmarkFailureReason({ name: 'NotAllowedError', message: 'SECRET' }), 'camera_denied');
  assert.equal(benchmarkFailureReason({ status: 401, message: 'SECRET' }), 'access_denied');
  assert.equal(benchmarkFailureReason({ code: 'request_timeout' }), 'timeout');
  assert.equal(benchmarkFailureReason({ message: 'deadline' }), 'timeout');
  assert.equal(benchmarkFailureReason({ message: 'benchmark_coverage' }), 'benchmark_coverage');
});

test('coarse environment preserves unknowns and does not export a full user agent', async () => {
  const { coarseEnvironment } = await load('gaze-benchmark-report.mjs');
  assert.deepEqual(coarseEnvironment('unknown private data'), { browser: 'unknown', browserMajor: null, platform: 'unknown' });
  assert.deepEqual(coarseEnvironment('Mozilla Android Chrome/131.23'), { browser: 'chrome', browserMajor: 131, platform: 'android' });
  assert.deepEqual(coarseEnvironment('Mozilla Macintosh Mobile Version/18.0 Safari/605'), { browser: 'safari', browserMajor: 18, platform: 'ios' });
});

test('developer benchmark ships without autotests, uses existing sensor boundary and explicit auth before camera', async () => {
  const html = read('participant-web/tools/gaze-benchmark.html'), page = read('web/developer/gaze-benchmark-page.mjs');
  const core = read('web/developer/gaze-benchmark.mjs');
  assert.match(read('web/developer.html'), /participant-web\/tools\/gaze-benchmark.html/);
  assert.match(page, /allowedRoles: \['admin', 'developer'\]/);
  assert.match(page, /authorizeDiagnostic\(accessRun, 'camera'\)/);
  assert.match(page, /wecog:staffsessionblocked/);
  assert.match(page, /allowed && !blocked && consent.checked/);
  assert.ok(core.indexOf('await deadline(authorize?.(') < core.indexOf('navigator.mediaDevices.getUserMedia('));
  const { mountGazeBenchmark } = await load('gaze-benchmark.mjs');
  assert.throws(() => mountGazeBenchmark({ cohort: true }), /requires explicit authorization/);
  assert.throws(() => mountGazeBenchmark({ cohort: true, mode: 'aoi-continuous' }), /requires explicit authorization/);
  assert.throws(() => mountGazeBenchmark({ cohort: true, mode: 'eye-gate' }), /requires explicit authorization/);
  assert.throws(() => mountGazeBenchmark({ cohort: true, mode: 'gradient', authorize: async () => {} }), /fixed candidates/);
  assert.throws(() => mountGazeBenchmark({ mode: 'masked', canStart: () => true }), /only on loopback/);
  assert.throws(() => mountGazeBenchmark({ mode: 'lid-support', canStart: () => true }), /only on loopback/);
  assert.throws(() => mountGazeBenchmark({ mode: 'nuisance', canStart: () => true }), /only on loopback/);
  assert.throws(() => mountGazeBenchmark({ mode: 'nuisance-geometry', canStart: () => true }), /only on loopback/);
  assert.throws(() => mountGazeBenchmark({ mode: 'aoi-continuous', canStart: () => true }), /only on loopback/);
  assert.throws(() => mountGazeBenchmark({ mode: 'eye-gate', canStart: () => true }), /only on loopback/);
  assert.throws(() => mountGazeBenchmark({ cohort: true, mode: 'masked', authorize: async () => {} }), /fixed candidates/);
  assert.match(core, /SerialDiagnosticStage/); assert.match(core, /rawGazeStored: false/);
  for (const source of [html, page, core, read('web/developer/gaze-benchmark-models.mjs'), read('web/developer/gaze-benchmark-summary.mjs')]) {
    assert.doesNotMatch(source, /from\s+['"][^'"]*autotests|import\(['"][^'"]*autotests/);
    assert.doesNotMatch(source, /fetch\(|sendBeacon\(|localStorage\.setItem|indexedDB|\/ingest/);
  }
  for (const name of ['api-base', 'http-client', 'account-storage', 'staff-session', 'auth-guard']) assert.match(html, new RegExp(name + '\\.js'));
  assert.match(html, /id="consent" type="checkbox"/);
  assert.match(html, /<option value="aoi-continuous">/);
  assert.match(html, /<option value="eye-gate">/);
  assert.match(html, /id="start" disabled/);
});

test('coverage records one rejection per fresh analyzer result and never exports predictions or free text', async () => {
  const { createValidationAttemptRecorder } = await load('gaze-benchmark-coverage.mjs');
  const recorder = createValidationAttemptRecorder(['baseline', 'eye_patch'], { monotonicStart: 100, wallStart: 1000 }, true);
  const frame = timestamp => ({ timestamp, landmarks: [{ x: 'PRIVATE_SENTINEL' }] });
  const valid = { valid: true, rawX: 12, rawY: 25 };
  recorder.observe(frame(99), { baseline: valid });
  recorder.observe(frame(101), { baseline: valid });
  recorder.observe(frame(101), { baseline: valid });
  recorder.observe(frame(102), { baseline: { rejectionReason: 'low_confidence' }, eye_patch: { rejectionReason: 'PRIVATE_SENTINEL' } }, { full: [] });
  recorder.observe({ timestamp: 103 }, {});
  recorder.observe({}, {});
  const summary = recorder.summary({ baseline: { samples: [valid] }, eye_patch: { samples: [] } });
  assert.deepEqual(summary.models, {
    baseline: { acceptedSamples: 1, rejectionCounts: { low_confidence: 1, no_face_landmarks: 1 } },
    eye_patch: { acceptedSamples: 0, rejectionCounts: { missing_eye_descriptor: 1, missing_prediction: 1, no_face_landmarks: 1 } },
  });
  assert.equal(summary.captures.accepted, 3);
  assert.equal(summary.captures.beforeWindow, 1);
  assert.equal(summary.captures.duplicate, 1);
  assert.equal(summary.captures.missingTimestamp, 1);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_SENTINEL|rawX|"landmarks"\s*:/);
});

test('validation retries only missing targets once and does not replace already usable samples', async () => {
  const { collectValidationTargets } = await load('gaze-benchmark-coverage.mjs');
  const modelNames = ['baseline', 'eye_patch'], positions = [{}, {}, {}];
  const diagnostics = positions.map(() => ({ attempts: [], selectedAttempt: { baseline: null, eye_patch: null } }));
  const seen = [];
  const measure = async (index, attempt) => {
    seen.push([index, attempt]);
    return { measured: { baseline: { samples: [attempt] },
      eye_patch: { samples: index === 0 || index === 1 && attempt === 2 ? [attempt] : [] } }, summary: { attempt } };
  };
  const points = await collectValidationTargets({ positions, modelNames, diagnostics, measure });
  assert.deepEqual(seen, [[0, 1], [1, 1], [2, 1], [1, 2], [2, 2]]);
  assert.deepEqual(points.baseline.map(x => x.samples), [[1], [1], [1]]);
  assert.deepEqual(points.eye_patch.map(x => x.samples), [[1], [2], []]);
  assert.deepEqual(diagnostics.map(x => x.selectedAttempt.eye_patch), [1, 2, null]);
  assert.deepEqual(diagnostics.map(x => x.attempts.length), [1, 2, 2]);
  seen.length = 0;
  await collectValidationTargets({ positions, modelNames, measure });
  assert.deepEqual(seen, [[0, 1], [1, 1], [2, 1]]);
});

test('calibration reports rejected eye or pose signal before missing eye descriptors', async () => {
  const { calibrationRejection, countCalibrationRejection } = await load('gaze-benchmark-coverage.mjs');
  const eye = { accepted: false, invalidEyes: 12, invalidPose: 0 };
  const pose = { accepted: false, invalidEyes: 0, invalidPose: 3 };
  const targets = {};
  for (const result of [eye, eye, pose]) countCalibrationRejection(targets, 20, calibrationRejection(result, false), result);
  assert.deepEqual(Object.values(targets), [{ targetIndex: 20, rejectedClicks: 3, invalidEyes: 24, invalidPose: 3,
    reasons: { eye_signal: 2, pose_signal: 1 } }]);
  assert.equal(calibrationRejection({ accepted: false }, false), 'insufficient_fresh_frames');
  assert.equal(calibrationRejection({ accepted: true }, false), 'eye_descriptors');
  assert.equal(calibrationRejection({ accepted: true }, true), 'tracker_rejected');
});

test('masked coverage exports only counts on accepted control frames and fixed reasons', async () => {
  const { recordMaskedCalibrationClick } = await load('gaze-benchmark-coverage.mjs');
  const coverage = { missingCommonClicks: 0, targets: {} };
  const first = [null, 'weak_match', 'PRIVATE_SENTINEL', 'insufficient_visible_rows'];
  recordMaskedCalibrationClick(coverage, 22, first, 1, 2, value => value);
  recordMaskedCalibrationClick(coverage, 22, [null, null], 2, 2, value => value);
  assert.equal(coverage.missingCommonClicks, 1);
  assert.deepEqual(coverage.targets[22], { targetIndex: 22, acceptedControlClicks: 2,
    clicksWithEnoughCommonFrames: 1, controlFrames: 6, commonFrames: 3,
    rejectionCounts: { weak_match: 1, unclassified: 1, insufficient_visible_rows: 1 } });
  assert.doesNotMatch(JSON.stringify(coverage), /PRIVATE_SENTINEL/);
});

test('lid support counts paired availability without leaking status text or coordinates', async () => {
  const { summarizeLidSupportClick } = await load('gaze-benchmark-coverage.mjs');
  const report = summarizeLidSupportClick([
    { control: false, hard: null, soft: null },
    { control: true, hard: null, soft: null },
    { control: true, hard: null, soft: 'weak_match' },
    { control: true, hard: 'insufficient_visible_rows', soft: null },
    { control: true, hard: 'insufficient_visible_rows', soft: null },
    { control: true, hard: 'PRIVATE_SENTINEL', soft: 'low_contrast' },
  ], 3, value => value);
  assert.deepEqual(report, { minFrames: 3, controlFrames: 5, gateEligibleFrames: 6,
    pairs: { both: 1, hardOnly: 1, softOnly: 2, neither: 1 },
    rejections: { hard: { insufficient_visible_rows: 2, unclassified: 1 }, soft: { weak_match: 1, low_contrast: 1 } },
    controlReady: true, hardReady: false, softReady: true });
});
