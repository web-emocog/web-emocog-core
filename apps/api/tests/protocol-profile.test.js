const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { FRAME_SCHEDULE, MODEL_ASSETS, protocolCameraConstraints, frameBudget } =
  require('../../participant-web/js/session-runtime/protocol-profile.mjs');

const read = file => readFileSync(path.resolve(__dirname, '../../', file));

test('frame budget separates source, sequential inference and shared auxiliary work', () => {
  const budget = frameBudget({ sourceFps: 30, primaryMs: 50, segmentMs: 60, poseMs: 30 });
  assert.equal(budget.primaryCeilingFps, 20);
  assert.equal(budget.target25Ms, 40);
  assert.equal(budget.target30Ms, 1000 / 30);
  assert.equal(budget.auxiliaryDemandMsPerAnalyzedFrame, 25);
  assert.equal(budget.auxiliaryUtilizationAtSource, .75);
  assert.equal(frameBudget({ sourceFps: 23, primaryMs: 18 }).primaryCeilingFps, 23);
  assert.equal(frameBudget({ sourceFps: 60, primaryMs: 18 }).primaryCeilingFps, 1000 / 33);
  assert.equal(frameBudget({ sourceFps: 0, primaryMs: 0, segmentMs: -5 }).primaryCeilingFps, null);
  assert.equal(frameBudget({ sourceFps: 30, primaryMs: 20, segmentMs: 10 }).auxiliaryUtilizationAtSource, null);
});

test('profile exposes the pinned weights used by actual protocol classes', () => {
  const sources = {
    face: 'precheck-analyzer/PrecheckAnalyzer.js',
    segment: 'face-segmenter/FaceSegmenter.js',
    pose: 'session-runtime/continuous-body-pose.js'
  };
  for (const [key, { file, sha256 }] of Object.entries(MODEL_ASSETS)) {
    assert.equal(createHash('sha256').update(read('participant-web/js/vendor/mediapipe/models/' + file)).digest('hex'), sha256);
    assert.ok(read('participant-web/js/' + sources[key]).toString().includes('/models/' + file));
  }
  assert.deepEqual(protocolCameraConstraints(), { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, min: 15 } } });
  const mutated = protocolCameraConstraints(); mutated.video.width.ideal = 960;
  assert.equal(protocolCameraConstraints().video.width.ideal, 640);
  assert.deepEqual(FRAME_SCHEDULE, { targetIntervalMs: 33, segmenterStride: 3, emotionStride: 6, bodyPoseStride: 6, segmentMaxAgeMs: 1000 });
});

test('developer screens delegate instead of creating alternate biometric or RT engines', () => {
  for (const file of ['bpm', 'emotion', 'body-pose', 'qc']) {
    assert.match(read('web/developer/' + file + '-test.js').toString(), /mountProtocolDiagnostic\(/);
  }
  const runner = read('web/developer/protocol-diagnostic.mjs').toString();
  assert.match(runner, /new SessionFramePipeline\(/);
  assert.match(runner, /getUserMedia\(protocolCameraConstraints\(\)\)/);
  assert.match(runner, /new QCMetrics\(/);
  assert.doesNotMatch(runner, /detectForVideo|createFromOptions|\/ingest/);
  const audio = read('web/developer/audio-test.js').toString();
  assert.match(audio, /new SessionAudioCollector\(/);
  assert.doesNotMatch(audio, /createScriptProcessor|getUserMedia|\/ingest/);
  const rt = read('web/developer/rt-test.html').toString();
  assert.match(rt, /mvp_with_precheck_1-updated\.html\?developer_module=hub/);
  assert.doesNotMatch(rt, /<script[^>]*rt-test\.js/);
});
