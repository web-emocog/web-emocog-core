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
  assert.throws(() => mountGazeBenchmark({ cohort: true, mode: 'gradient', authorize: async () => {} }), /fixed candidates/);
  assert.match(core, /SerialDiagnosticStage/); assert.match(core, /rawGazeStored: false/);
  for (const source of [html, page, core, read('web/developer/gaze-benchmark-models.mjs'), read('web/developer/gaze-benchmark-summary.mjs')]) {
    assert.doesNotMatch(source, /from\s+['"][^'"]*autotests|import\(['"][^'"]*autotests/);
    assert.doesNotMatch(source, /fetch\(|sendBeacon\(|localStorage\.setItem|indexedDB|\/ingest/);
  }
  for (const name of ['api-base', 'http-client', 'account-storage', 'staff-session', 'auth-guard']) assert.match(html, new RegExp(name + '\\.js'));
  assert.match(html, /id="consent" type="checkbox"/);
  assert.match(html, /id="start" disabled/);
});
