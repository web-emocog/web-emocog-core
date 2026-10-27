const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const modulePath = pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/reference.mjs'));

test('private replay stage profiling changes no model settings and refuses unknown source versions', async () => {
  const { profileFaceStages } = await import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/profile-stages.mjs')));
  const source = await fs.readFile(path.resolve(__dirname, '../../participant-web/js/precheck-analyzer/PrecheckAnalyzer.js'), 'utf8');
  const profiled = profileFaceStages(source);
  assert.ok(profiled.includes('replayStageMs:'));
  assert.equal(profiled.match(/detectForVideo\(videoElement, timestamp\)/g).length, 1);
  assert.throws(() => profileFaceStages('other source'), /reference_profile_source_changed/);
  assert.ok(profileFaceStages(source, 'imageData').includes('detectForVideo(imageData, timestamp)'));
  assert.throws(() => profileFaceStages(source, 'unknown'), /invalid_reference_face_input/);
  const used = profileFaceStages(source, 'bitmap', 'used');
  assert.ok(used.includes('outputFaceBlendshapes: false'));
  assert.ok(used.includes('outputFacialTransformationMatrixes: true'));
  assert.throws(() => profileFaceStages(source, 'bitmap', 'unknown'), /invalid_reference_face_outputs/);
  assert.ok(profileFaceStages(source, 'bitmap', 'full', 'compute').includes('antialias: false'));
  assert.throws(() => profileFaceStages(source, 'bitmap', 'full', 'unknown'), /invalid_reference_face_canvas/);
});

test('performance windows retain stalls, exclude only a partial tail and reject invalid clocks', async () => {
  const { distribution, fpsWindows } = await import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/performance.mjs')));
  assert.deepEqual(distribution([]), { n: 0, mean: null, p50: null, p95: null, max: null });
  const result = fpsWindows([10, 20, 2000, 2499], 2500);
  assert.deepEqual(result.counts, [2, 0]);
  assert.equal(result.below25Windows, 2); assert.equal(result.longestBelow25RunMs, 2000);
  assert.equal(result.partialTailMs, 500);
  assert.deepEqual(fpsWindows([], 2000).counts, [0, 0]);
  assert.equal(fpsWindows([0], 0).fullWindows, 0);
  for (const [times, duration] of [[[2, 1], 5], [[NaN], 5], [[-1], 5], [[6], 5], [[], Infinity]]) {
    assert.throws(() => fpsWindows(times, duration), /invalid_performance_clock/);
  }
});

test('a functional replay is not a performance pass when frames, UI or worker fallback fail', async () => {
  const { assessReplayPerformance } = await import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/performance.mjs')));
  const valid = { offlinePlaybackRate: 1, backend: 'worker', failures: 0,
    auxiliary: { segmentBackend: 'worker', poseBackend: 'worker', segmentMeanMs: 200 }, performance: {
      processedWallFps: 29, presentedWallFps: 30, maxCaptureGapMs: 67,
      fpsWindows: { fullWindows: 60, longestBelow25RunMs: 0 }, uiTimerLatenessMs: { p95: 2 } } };
  assert.equal(assessReplayPerformance(valid).status, 'pass');
  assert.equal(assessReplayPerformance({ ...valid, offlinePlaybackRate: .5 }).status, 'not_applicable');
  assert.equal(assessReplayPerformance({ ...valid, performance: {} }).status, 'not_measured');
  const slow = structuredClone(valid); slow.performance.processedWallFps = 13;
  slow.performance.uiTimerLatenessMs.p95 = 23; slow.performance.maxCaptureGapMs = 635;
  slow.performance.fpsWindows.longestBelow25RunMs = 60000; slow.auxiliary.segmentBackend = 'main';
  assert.deepEqual(assessReplayPerformance(slow).reasons,
    ['analysis_below_target', 'ui_timer_late', 'capture_gap', 'sustained_analysis_drop', 'main_thread_fallback']);
  assert.equal(assessReplayPerformance(slow).status, 'fail');
  const stale = structuredClone(valid); stale.auxiliary.segmentMeanMs = 4300;
  assert.deepEqual(assessReplayPerformance(stale).reasons, ['segment_mean_exceeds_freshness_budget']);
});

test('reference replay options cannot select arbitrary browsers, rates or output path fragments', async () => {
  const { replayOptions } = await import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/replay-options.mjs')));
  assert.deepEqual(replayOptions(), { browser: 'chromium', playbackRate: .5, run: 1, renderer: 'software', headless: true, chromiumMode: 'shell', segmentDelegate: 'default', workload: 'signals', sourceInput: 'file', faceDelegate: 'default', faceInput: 'bitmap', faceOutputs: 'full', faceCanvas: 'default', dispatch: 'timer', glProfile: false, requirePerformance: false });
  assert.deepEqual(replayOptions({ WECOG_REFERENCE_BROWSER: 'webkit', WECOG_REFERENCE_PLAYBACK_RATE: '1', WECOG_REFERENCE_RUN: '3' }),
    { browser: 'webkit', playbackRate: 1, run: 3, renderer: 'software', headless: true, chromiumMode: 'shell', segmentDelegate: 'default', workload: 'signals', sourceInput: 'file', faceDelegate: 'default', faceInput: 'bitmap', faceOutputs: 'full', faceCanvas: 'default', dispatch: 'timer', glProfile: false, requirePerformance: false });
  assert.equal(replayOptions({ WECOG_REFERENCE_RENDERER: 'default' }).renderer, 'default');
  assert.equal(replayOptions({ WECOG_REFERENCE_WORKLOAD: 'multimodal' }).workload, 'multimodal');
  assert.equal(replayOptions({ WECOG_REFERENCE_FACE_DELEGATE: 'CPU' }).faceDelegate, 'CPU');
  assert.equal(replayOptions({ WECOG_REFERENCE_REQUIRE_PERFORMANCE: '1' }).requirePerformance, true);
  assert.equal(replayOptions({ WECOG_REFERENCE_CHROMIUM_MODE: 'browser' }).chromiumMode, 'browser');
  assert.equal(replayOptions({ WECOG_REFERENCE_SEGMENT_DELEGATE: 'GPU' }).segmentDelegate, 'GPU');
  assert.equal(replayOptions({ WECOG_REFERENCE_GL_PROFILE: '1' }).glProfile, true);
  assert.equal(replayOptions({ WECOG_REFERENCE_HEADLESS: '0' }).headless, false);
  assert.equal(replayOptions({ WECOG_REFERENCE_DISPATCH: 'frame-deadline' }).dispatch, 'frame-deadline');
  assert.equal(replayOptions({ WECOG_REFERENCE_WORKLOAD: 'source', WECOG_REFERENCE_PLAYBACK_RATE: '1' }).workload, 'source');
  assert.equal(replayOptions({ WECOG_REFERENCE_WORKLOAD: 'source', WECOG_REFERENCE_PLAYBACK_RATE: '1',
    WECOG_REFERENCE_SOURCE_INPUT: 'canvas' }).sourceInput, 'canvas');
  for (const env of [{ WECOG_REFERENCE_BROWSER: '../escape' }, { WECOG_REFERENCE_PLAYBACK_RATE: '0' },
    { WECOG_REFERENCE_PLAYBACK_RATE: '2' }, { WECOG_REFERENCE_RUN: '../escape' }, { WECOG_REFERENCE_RUN: '1.5' },
    { WECOG_REFERENCE_RENDERER: '--arbitrary-flag' }, { WECOG_REFERENCE_WORKLOAD: '../escape' },
    { WECOG_REFERENCE_HEADLESS: 'false' },
    { WECOG_REFERENCE_SOURCE_INPUT: 'other' }, { WECOG_REFERENCE_SOURCE_INPUT: 'canvas' },
    { WECOG_REFERENCE_CHROMIUM_MODE: '--arbitrary-flag' },
    { WECOG_REFERENCE_BROWSER: 'firefox', WECOG_REFERENCE_CHROMIUM_MODE: 'browser' },
    { WECOG_REFERENCE_SEGMENT_DELEGATE: '--arbitrary-flag' },
    { WECOG_REFERENCE_FACE_DELEGATE: 'arbitrary' }, { WECOG_REFERENCE_FACE_INPUT: 'arbitrary' }, { WECOG_REFERENCE_FACE_OUTPUTS: 'arbitrary' },
    { WECOG_REFERENCE_GL_PROFILE: 'true' },
    { WECOG_REFERENCE_FACE_CANVAS: 'arbitrary' },
    { WECOG_REFERENCE_DISPATCH: 'arbitrary' },
    { WECOG_REFERENCE_WORKLOAD: 'source' },
    { WECOG_REFERENCE_WORKLOAD: 'source', WECOG_REFERENCE_PLAYBACK_RATE: '1', WECOG_REFERENCE_GL_PROFILE: '1' },
    { WECOG_REFERENCE_WORKLOAD: 'source', WECOG_REFERENCE_PLAYBACK_RATE: '1', WECOG_REFERENCE_REQUIRE_PERFORMANCE: '1' },
    { WECOG_REFERENCE_GL_PROFILE: '1', WECOG_REFERENCE_REQUIRE_PERFORMANCE: '1' },
    { WECOG_REFERENCE_REQUIRE_PERFORMANCE: 'true' }]) {
    assert.throws(() => replayOptions(env), /invalid_reference/);
  }
});

test('replay comparisons pair fresh publications once, retain missingness and never call agreement sensor accuracy', async () => {
  const { comparePublications } = await import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/compare-publications.mjs')));
  const sample = (t, bpm, extra = {}) => ({ t, bpm, published: true, held: false, ...extra });
  const result = comparePublications([sample(1000, 70), sample(1500, 70, { held: true }), sample(2000, 80)],
    [sample(1000, 70), sample(1000, 70), sample(1100, 100), sample(2000, 82)]);
  assert.equal(result.baselinePublications, 2);
  assert.equal(result.candidatePublications, 3);
  assert.equal(result.pairedPublications, 2);
  assert.equal(result.unmatchedCandidate, 1);
  assert.equal(result.meanAbsDifferencePerMinute, 1);
  assert.equal(result.interpretation, 'configuration_agreement_not_sensor_accuracy');
  assert.equal(comparePublications([], []).meanAbsDifferencePerMinute, null);
  assert.equal(comparePublications([sample(0, 70)], [sample(0, 70)]).meanAbsDifferencePerMinute, 0);
  assert.equal(comparePublications([sample(0, 70)], [sample(1000, 70)]).pairedPublications, 0);
  const resp = comparePublications([sample(0, null, { respRate: 10, respConf: .3 })],
    [sample(0, null, { respRate: 12, respConf: .3 })], 'respiration');
  assert.equal(resp.meanAbsDifferencePerMinute, 2);
  assert.throws(() => comparePublications([sample(2, 70), sample(1, 70)], []), /clock/);
  assert.throws(() => comparePublications([], [], 'unknown'), /comparison/);
});

test('dataset alignment never silently trims clocks or promotes equal counts into validated accuracy', async () => {
  const { assessAlignment, parsePpg, validateRoundedClock } = await import(modulePath);
  assert.equal(assessAlignment({ decodedFrames: 5382, referenceSamples: 5382, captureTimestamps: 5399 }).status, 'not_scored');
  assert.equal(assessAlignment({ decodedFrames: 100, referenceSamples: 100, captureTimestamps: 100 }).accuracyValidated, false);
  assert.equal(assessAlignment({ decodedFrames: 100, referenceSamples: 100, captureTimestamps: 100, decoderErrors: true }).status, 'not_scored');
  assert.deepEqual(parsePpg(Array(100).fill('50 0.001').join('\n')), Array(100).fill(50));
  assert.throws(() => parsePpg(Array(100).fill('NaN 0.001').join('\n')));
  assert.ok(validateRoundedClock([0, .01, .02, .02], 125) <= .004000001);
  assert.throws(() => validateRoundedClock([0, .01, .03], 125), /clock_gap/);
});
test('reference files are confined and a changed byte fails the locked manifest', async () => {
  const { DATASET, privateFile, fingerprint, verifyManifest } = await import(modulePath);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-reference-test-'));
  try {
    await fs.writeFile(path.join(root, 'a.txt'), 'synthetic'); await fs.writeFile(path.join(root, 'b.txt'), 'synthetic2');
    const files = await Promise.all(['a.txt', 'b.txt'].map(async p => ({ path: p, ...await fingerprint(path.join(root, p)) })));
    const manifest = { dataset: DATASET, files };
    await verifyManifest(root, manifest);
    await fs.writeFile(path.join(root, 'a.txt'), 'changed');
    await assert.rejects(verifyManifest(root, manifest), /integrity/);
    await assert.rejects(privateFile(root, '../escape'), /unsafe/);
    await fs.symlink(path.join(root, 'b.txt'), path.join(root, 'link.txt'));
    await assert.rejects(privateFile(root, 'link.txt'), /unsafe/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
