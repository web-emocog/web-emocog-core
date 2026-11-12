const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');

function makeLandmarks(overrides = {}) {
  const landmarks = Array.from({ length: 468 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const defaults = {
    234: { x: 0.30, y: 0.50, z: 0 }, 454: { x: 0.70, y: 0.50, z: 0 },
    10: { x: 0.50, y: 0.25, z: 0 }, 152: { x: 0.50, y: 0.75, z: 0 },
    33: { x: 0.42, y: 0.42, z: 0 }, 263: { x: 0.58, y: 0.42, z: 0 },
    159: { x: 0.42, y: 0.40, z: 0 }, 145: { x: 0.42, y: 0.44, z: 0 },
    386: { x: 0.58, y: 0.40, z: 0 }, 374: { x: 0.58, y: 0.44, z: 0 },
    61: { x: 0.44, y: 0.62, z: 0 }, 291: { x: 0.56, y: 0.62, z: 0 },
    13: { x: 0.50, y: 0.61, z: 0 }, 14: { x: 0.50, y: 0.63, z: 0 },
    0: { x: 0.50, y: 0.60, z: 0 }, 17: { x: 0.50, y: 0.65, z: 0 },
    1: { x: 0.50, y: 0.55, z: 0 }, 107: { x: 0.44, y: 0.37, z: 0 },
    336: { x: 0.56, y: 0.37, z: 0 }, 70: { x: 0.38, y: 0.37, z: 0 },
    300: { x: 0.62, y: 0.37, z: 0 }, 117: { x: 0.38, y: 0.52, z: 0 },
    346: { x: 0.62, y: 0.52, z: 0 }, 203: { x: 0.47, y: 0.57, z: 0 },
    423: { x: 0.53, y: 0.57, z: 0 }, 127: { x: 0.35, y: 0.65, z: 0 },
    356: { x: 0.65, y: 0.65, z: 0 },
  };
  Object.entries({ ...defaults, ...overrides }).forEach(([index, point]) => {
    landmarks[Number(index)] = point;
  });
  return landmarks;
}

describe('browser emotion runtime', () => {
  let api;
  before(async () => {
    api = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/public-api.js')).href);
  });
  beforeEach(() => api.resetEmotionAnalyzerState());

  function calibrate() {
    let sample;
    for (let i = 0; i < 18; i++) sample = api.getEmotionSample({ landmarks: makeLandmarks() });
    return sample;
  }

  it('diagnostics count calculations, show calibration AU and distinguish missing samples', async () => {
    const { EmotionDiagnostics } = await import(pathToFileURL(path.join(root,
      'web/developer/emotion-diagnostics.mjs')).href);
    let now = 0;
    const diagnostics = new EmotionDiagnostics(() => now);
    const stop = api.observeEmotionSamples((sample, calibration) => diagnostics.record(sample, calibration));
    try {
      api.getEmotionSample({ landmarks: makeLandmarks() });
      const first = diagnostics.snapshot();
      assert.equal(first.latest.status, 'calibrating');
      assert.equal(first.latest.calibration.frames, 1);
      assert.ok(Number.isFinite(first.latest.rawAU.AU12));
      assert.equal(first.latest.adjustedAU, null);
      assert.equal(first.latest.valence, null);
      first.latest.calibration.baseline.AU12 = 999;
      assert.notEqual(diagnostics.snapshot().latest.calibration.baseline.AU12, 999);
      for (let i = 1; i < 20; i++) {
        now += 200;
        api.getEmotionSample({ landmarks: makeLandmarks() });
      }
      assert.equal(diagnostics.snapshot().attemptHzSinceFirst, 5);
      assert.ok(diagnostics.snapshot().counts.success > 0);
      assert.ok(diagnostics.snapshot().latest.smoothedScores);
      now += 200;
      const broken = makeLandmarks(); broken[61].x = NaN;
      api.getEmotionSample({ landmarks: broken });
      const snapshot = diagnostics.snapshot();
      assert.equal(snapshot.counts.attempts, 21);
      assert.equal(snapshot.counts.missing, 1);
      assert.equal(snapshot.latest.status, 'invalid_landmarks');
      assert.equal(snapshot.latest.rawAU, null);
      assert.equal(snapshot.latest.valence, null);
      // UI polling cannot create additional measurements.
      diagnostics.snapshot(); diagnostics.snapshot();
      assert.equal(diagnostics.snapshot().counts.attempts, 21);
      now += 2000;
      assert.equal(diagnostics.snapshot().lastAttemptAgeMs, 2000);
      assert.ok(diagnostics.snapshot().attemptHzSinceFirst < 5);
    } finally { stop(); }
    api.getEmotionSample();
    assert.equal(diagnostics.snapshot().counts.attempts, 21);
  });

  it('a failing or mutating diagnostic observer cannot corrupt emotion results', () => {
    calibrate();
    const stop = api.observeEmotionSamples(sample => {
      sample.valence = 999;
      throw new Error('diagnostic UI failed');
    });
    try {
      const sample = api.getEmotionSample({ landmarks: makeLandmarks() });
      assert.equal(sample.status, 'success');
      assert.notEqual(sample.valence, 999);
    } finally { stop(); }
  });

  function assertMissing(sample) {
    assert.equal(sample.degraded, true);
    assert.equal(sample.dominant, 'unknown');
    assert.equal(sample.valence, null);
    assert.equal(sample.arousal, null);
    assert.equal(sample.confidence, 0);
    assert.notEqual(sample.dataQuality, 'high');
  }

  function assertEmptySummary(sessionData) {
    assert.deepEqual(api.getEmotionSummary(sessionData), { valence_mean: null, arousal_mean: null, n: 0 });
  }

  it('rejects corrupt coordinates without inventing neutral affect or contaminating the baseline', async () => {
    const api = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/public-api.js')).href);
    api.analyzer.startSession('corrupt-landmarks-regression');
    const nan = makeLandmarks(); nan[61].x = NaN;
    const infinite = makeLandmarks(); infinite[1].z = Infinity;
    const state = { sessionData: {} };
    for (const landmarks of [Array(478), Array.from({ length: 478 }, () => ({})), nan, infinite]) {
      const sample = api.getEmotionSample({ landmarks });
      assert.equal(sample.dominant, 'unknown');
      assert.equal(sample.valence, null);
      assert.equal(sample.arousal, null);
      assert.equal(sample.missingData, true);
      assert.equal(sample.degraded, true);
      assert.equal(sample.dataQuality, 'missing');
      api.appendEmotionSample(state, sample);
    }
    assert.equal(api.analyzer._auBaselineFrames, 0);
    assert.equal(api.getEmotionSummary(state.sessionData).n, 0);
  });
  it('abstains when only camera metadata is available', async () => {
    const api = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/public-api.js')).href);
    const sample = api.getEmotionSample({ face: { detected: true }, illumination: { score: 0.95 } });
    assert.equal(sample.dominant, 'unknown');
    assert.equal(sample.emotionInferred, false);
    assert.equal(sample.degraded, true);
    assert.equal(sample.scores.happiness, 0);
    assertMissing(sample);
    const state = { sessionData: {} };
    api.appendEmotionSample(state, sample);
    assertEmptySummary(state.sessionData);
  });

  it('calibrates a personal neutral baseline before reporting expression changes', async () => {
    const module = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/emotion-analyzer.js')).href);
    const analyzer = new module.EmotionAnalyzer();
    let result;
    for (let index = 0; index < 18; index += 1) {
      result = analyzer.analyzeLandmarks(makeLandmarks());
      assert.equal(result.dominant, index < 17 ? 'unknown' : 'neutral');
    }
    assert.equal(result.calibrationReady, true);

    const smile = makeLandmarks({
      61: { x: 0.35, y: 0.59, z: 0 },
      291: { x: 0.65, y: 0.59, z: 0 },
      117: { x: 0.38, y: 0.49, z: 0 },
      346: { x: 0.62, y: 0.49, z: 0 },
    });
    const neutralHappiness = result.scores.happiness;
    for (let index = 0; index < 6; index += 1) result = analyzer.analyzeLandmarks(smile);

    assert.ok(result.scores.happiness > neutralHappiness + 0.15);
    assert.equal(result.dominant, 'happiness');
    assert.ok(result.confidence >= 0.7);
  });

  it('keeps a transient ambiguous surprise score neutral until it is sustained', async () => {
    const module = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/emotion-analyzer.js')).href);
    const analyzer = new module.EmotionAnalyzer();
    analyzer._auBaselineReady = true;
    const scores = {
      neutral: 0.10,
      happiness: 0.03,
      sadness: 0.03,
      anger: 0.03,
      fear: 0.04,
      surprise: 0.70,
      disgust: 0.02,
    };
    assert.equal(analyzer._dominant(scores), 'neutral');
    assert.equal(analyzer._dominant(scores), 'surprise');
    const neutralScores = analyzer._publishScores(scores, 'neutral');
    assert.ok(neutralScores.neutral >= 0.65);
    assert.ok(neutralScores.surprise < neutralScores.neutral);
  });

  it('returns to neutral and reacts to a new sustained expression without sticky output', async () => {
    const module = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion/emotion-analyzer.js')).href);
    const analyzer = new module.EmotionAnalyzer();
    analyzer._auBaselineReady = true;
    const happiness = { neutral:0.08, happiness:0.74, sadness:0.03, anger:0.03, fear:0.03, surprise:0.05, disgust:0.04 };
    const anger = { neutral:0.08, happiness:0.02, sadness:0.03, anger:0.76, fear:0.04, surprise:0.03, disgust:0.04 };
    const neutral = { neutral:0.72, happiness:0.06, sadness:0.05, anger:0.04, fear:0.04, surprise:0.05, disgust:0.04 };

    assert.equal(analyzer._dominant(happiness), 'neutral');
    assert.equal(analyzer._dominant(happiness), 'happiness');
    assert.equal(analyzer._dominant(neutral), 'neutral');
    assert.equal(analyzer._dominant(anger), 'neutral');
    assert.equal(analyzer._dominant(anger), 'anger');
  });

  it('excludes all calibration samples and counts genuine neutral zeros after calibration', () => {
    const state = { sessionData: {} };
    for (let i = 0; i < 17; i++) {
      const sample = api.getEmotionSample({ landmarks: makeLandmarks() });
      assertMissing(sample);
      assert.equal(sample.status, 'calibrating');
      assert.equal(sample.calibrationReady, false);
      api.appendEmotionSample(state, sample);
    }
    assertEmptySummary(state.sessionData);
    assert.equal(state.sessionData.emotionAccumulator, undefined);
    const sample = api.getEmotionSample({ landmarks: makeLandmarks() });
    assert.equal(sample.status, 'success');
    assert.equal(sample.calibrationReady, true);
    assert.equal(sample.dominant, 'neutral');
    api.appendEmotionSample(state, sample, 1000);
    assert.deepEqual(api.getEmotionSummary(state.sessionData), { valence_mean: 0, arousal_mean: 0, n: 1 });
    assert.equal(state.sessionData.emotionSamples.length, 1);
    assert.equal(api.analyzer.emotionCategoryCounts.total, 1);
  });

  const invalidInputs = {
    'null points': () => Array(468).fill(null),
    'sparse array': () => Array(468),
    'short mesh': () => makeLandmarks().slice(0, 467),
    'NaN x': () => makeLandmarks({ 61: { x: NaN, y: 0.62, z: 0 } }),
    'infinite y': () => makeLandmarks({ 107: { x: 0.44, y: Infinity, z: 0 } }),
    'NaN z': () => makeLandmarks({ 159: { x: 0.42, y: 0.40, z: NaN } }),
    'string coordinate': () => makeLandmarks({ 61: { x: '0.44', y: 0.62, z: 0 } }),
    'zero face width': () => makeLandmarks({ 454: { x: 0.30, y: 0.50, z: 0 } }),
    'zero face height': () => makeLandmarks({ 152: { x: 0.50, y: 0.25, z: 0 } }),
    'width rounded to zero': () => makeLandmarks({ 454: { x: 0.300001, y: 0.50, z: 0 } }),
    'overflowing face dimensions': () => makeLandmarks({ 454: { x: 1e308, y: 0.50, z: 0 } }),
  };
  for (const [name, build] of Object.entries(invalidInputs)) {
    it(`rejects ${name} without advancing calibration or recording neutral observations`, () => {
      const state = { sessionData: {} };
      for (let i = 0; i < 25; i++) {
        const sample = api.getEmotionSample({ landmarks: build() });
        assertMissing(sample);
        assert.equal(sample.status, 'invalid_landmarks');
        api.appendEmotionSample(state, sample);
      }
      assert.equal(api.analyzer._auBaselineFrames, 0);
      assert.equal(api.analyzer._auBaseline, null);
      assertEmptySummary(state.sessionData);
      assert.equal(calibrate().status, 'success');
    });
  }

  it('rejects invalid input after calibration without changing accumulated measurements or baseline', () => {
    const sample = calibrate();
    const state = { sessionData: {} };
    api.appendEmotionSample(state, sample, 1000);
    const before = JSON.stringify(state.sessionData);
    const baseline = { ...api.analyzer._auBaseline };
    for (const input of [undefined, {}, { landmarks: invalidInputs['NaN z']() }]) {
      const invalid = api.getEmotionSample(input);
      assertMissing(invalid);
      api.appendEmotionSample(state, invalid, 2000);
    }
    assert.equal(JSON.stringify(state.sessionData), before);
    assert.deepEqual(api.analyzer._auBaseline, baseline);
    assert.equal(api.getEmotionSample({ landmarks: makeLandmarks() }).status, 'success');
  });

  it('preserves support for finite 2D points and the 478-point MediaPipe mesh', () => {
    for (let i = 0; i < 18; i++) {
      const points = makeLandmarks().map(({ x, y }) => ({ x, y }));
      const result = api.getEmotionSample({ landmarks: points });
      assert.equal(result.status, i < 17 ? 'calibrating' : 'success');
    }
    const mesh = [...makeLandmarks(), ...Array.from({ length: 10 }, () => ({ x: 0.5, y: 0.5, z: 0 }))];
    assert.equal(api.getEmotionSample({ landmarks: mesh }).status, 'success');
  });

  it('reports calculation exceptions as missing and recovers on the next valid input', t => {
    const state = { sessionData: {} };
    t.mock.method(console, 'error', () => {});
    const getMask = t.mock.method(api.analyzer, '_getMask', () => { throw new Error('test calculation failure'); });
    const failed = api.getEmotionSample({ landmarks: makeLandmarks() });
    assertMissing(failed);
    assert.equal(failed.status, 'analysis_error');
    api.appendEmotionSample(state, failed);
    assertEmptySummary(state.sessionData);
    assert.equal(api.analyzer._auBaselineFrames, 0);
    getMask.mock.restore();
    assert.equal(calibrate().status, 'success');
  });

  it('rejects non-finite intermediate scores and rolls back baseline updates', t => {
    calibrate();
    const baseline = { ...api.analyzer._auBaseline };
    const frames = api.analyzer._auBaselineFrames;
    t.mock.method(console, 'error', () => {});
    const smooth = t.mock.method(api.analyzer, '_smoothScores', () => ({ neutral: NaN }));
    const failed = api.getEmotionSample({ landmarks: makeLandmarks({ 61: { x: 0.43, y: 0.62, z: 0 } }) });
    assertMissing(failed);
    assert.equal(failed.status, 'analysis_error');
    assert.deepEqual(api.analyzer._auBaseline, baseline);
    assert.equal(api.analyzer._auBaselineFrames, frames);
    assert.equal(api.analyzer.emotionCategoryCounts.total, 1);
    smooth.mock.restore();
    assert.equal(api.getEmotionSample({ landmarks: makeLandmarks() }).status, 'success');
  });

  it('rejects an invalid mask geometry before it can affect calibration', t => {
    t.mock.method(console, 'error', () => {});
    t.mock.method(api.analyzer, '_getMask', () => ({ geometry: { faceWidth: 0, faceHeight: 0.5 } }));
    const failed = api.getEmotionSample({ landmarks: makeLandmarks() });
    assertMissing(failed);
    assert.equal(failed.status, 'analysis_error');
    assert.equal(api.analyzer._auBaselineFrames, 0);
  });

  it('does not record success or advance calibration when the final confidence is invalid', t => {
    for (let i = 0; i < 17; i++) api.getEmotionSample({ landmarks: makeLandmarks() });
    t.mock.method(console, 'error', () => {});
    const confidence = t.mock.method(api.analyzer, '_calcLandmarksConfidence', () => NaN);
    const failed = api.getEmotionSample({ landmarks: makeLandmarks() });
    assertMissing(failed);
    assert.equal(failed.status, 'analysis_error');
    assert.equal(api.analyzer._auBaselineFrames, 17);
    assert.equal(api.analyzer._auBaselineReady, false);
    assert.equal(api.analyzer.emotionCategoryCounts.total, 0);
    confidence.mock.restore();
    assert.equal(api.getEmotionSample({ landmarks: makeLandmarks() }).status, 'success');
  });

  it('does not count event-path errors or calibration as successful observations', () => {
    api.analyzer.startSession('emotion-test');
    api.analyzer.processLandmarks(invalidInputs['NaN x']());
    for (let i = 0; i < 17; i++) api.analyzer.processLandmarks(makeLandmarks());
    assert.equal(api.analyzer.getAggregatedMetrics(), null);
    assertEmptySummary({ emotionEvents: api.analyzer.getEvents() });
    api.analyzer.processLandmarks(makeLandmarks());
    const events = api.analyzer.getEvents();
    assert.equal(events.filter(e => e.status === 'success').length, 1);
    assert.deepEqual(api.getEmotionSummary({ emotionEvents: events }), { valence_mean: 0, arousal_mean: 0, n: 1 });
    assert.equal(api.analyzer.getAggregatedMetrics().meanValence, 0);
    api.analyzer.endSession();
  });

  it('requires explicit success and completed calibration when appending live samples', () => {
    const valid = calibrate();
    const state = { sessionData: {} };
    for (const patch of [
      { status: undefined }, { status: 'analysis_error' }, { calibrationReady: undefined },
      { calibrationReady: false }, { degraded: true }, { missingData: true },
      { staleHold: true }, { emotionInferred: false }, { confidence: 0 },
      { valence: NaN }, { arousal: Infinity }, { scores: { neutral: NaN } },
    ]) api.appendEmotionSample(state, { ...valid, ...patch });
    assertEmptySummary(state.sessionData);
    assert.equal(state.sessionData.emotionAccumulator, undefined);
  });

  it('filters explicit failures in stored samples and legacy events without inventing historical calibration', () => {
    const good = { valence: 0.4, arousal: 0.2 };
    const bad = [
      { ...good, degraded: true }, { ...good, status: 'analysis_error' },
      { ...good, calibrationReady: false }, { ...good, confidence: 0 },
      { ...good, missingData: true }, { ...good, dataQuality: 'calibrating' },
      { status: 'success', data: { baselineReady: false, affective: good } },
      { status: 'error', data: { affective: good } },
    ];
    for (const key of ['emotionSamples', 'emotion_samples', 'emotionEvents']) {
      assertEmptySummary({ [key]: bad });
      assert.deepEqual(api.getEmotionSummary({ [key]: [...bad, good] }), {
        valence_mean: 0.4, arousal_mean: 0.2, n: 1,
      });
    }
  });

  it('preserves nonzero smile measurements through accumulation and JSON recovery', async () => {
    calibrate();
    const state = { sessionData: { startTime: 1000 } };
    const smile = makeLandmarks({
      61: { x: 0.35, y: 0.59, z: 0 }, 291: { x: 0.65, y: 0.59, z: 0 },
      117: { x: 0.38, y: 0.49, z: 0 }, 346: { x: 0.62, y: 0.49, z: 0 },
    });
    let last;
    for (let i = 0; i < 6; i++) {
      last = api.getEmotionSample({ landmarks: smile });
      api.appendEmotionSample(state, last, 2000 + i * 200);
    }
    assert.equal(last.dominant, 'happiness');
    assert.ok(last.valence > 0.5);
    assert.ok(last.arousal > 0);
    const restored = JSON.parse(JSON.stringify(state.sessionData));
    const summary = api.getEmotionSummary(restored);
    assert.equal(summary.n, 6);
    assert.ok(summary.valence_mean > 0);
    assert.ok(summary.arousal_mean > 0);
    delete restored.emotionAccumulator;
    assert.deepEqual(api.getEmotionSummary(restored), summary);

    const wiring = await import(pathToFileURL(path.join(root, 'participant-web/js/emotion-stub-new.js')).href);
    const held = wiring.getEmotionSample({ landmarks: invalidInputs['NaN x']() });
    assert.equal(held.degraded, true);
    api.appendEmotionSample(state, held);
    assert.deepEqual(api.getEmotionSummary(state.sessionData), summary);
  });
});
