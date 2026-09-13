const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { validateSessionFeaturePayload } = require('../security/payload-policy');

const audioModuleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../participant-web/js/audio/session-audio.js'
)).href;
const browserBundleUrl = pathToFileURL(path.resolve(
  __dirname,
  '../../../Audio_detection/browser/open-vocal-biomarkers.mjs'
)).href;

function sine(sampleRate, seconds, amplitude = 0.2) {
  return Float32Array.from(
    { length: Math.round(sampleRate * seconds) },
    (_, index) => amplitude * Math.sin(2 * Math.PI * 180 * index / sampleRate)
  );
}

function syntheticSpeech(sampleRate, seconds) {
  return Float32Array.from(
    { length: Math.round(sampleRate * seconds) },
    (_, index) => {
      const t = index / sampleRate;
      const phrase = (t % 2.4) < 1.9 ? 1 : 0.02;
      const envelope = phrase * (0.35 + 0.65 * Math.sin(Math.PI * ((t % 0.22) / 0.22)) ** 2);
      const pitch = 155 + 28 * Math.sin(2 * Math.PI * 0.7 * t) + 8 * Math.sin(2 * Math.PI * 2.1 * t);
      return envelope * (
        0.12 * Math.sin(2 * Math.PI * pitch * t)
        + 0.04 * Math.sin(2 * Math.PI * 2 * pitch * t)
        + 0.018 * Math.sin(2 * Math.PI * 3 * pitch * t)
      );
    }
  );
}

function stateWithConsent(granted) {
  return {
    sessionData: {
      startTime: Date.now(),
      audioConsent: { granted },
    },
    runtime: {
      currentPhase: 'instruction',
      taskContext: {},
    },
  };
}

function fakeClock() {
  let elapsed = 0;
  return {
    now() {
      elapsed += 100;
      return {
        timeOriginMs: 1000,
        monotonicMs: 1000 + elapsed,
        sessionTimeMs: elapsed,
      };
    },
  };
}

class FakeNode {
  connect() { return this; }
  disconnect() {}
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 16000;
    this.destination = new FakeNode();
    this.state = 'running';
    this.closed = false;
    this.suspended = false;
  }
  createMediaStreamSource() { return new FakeNode(); }
  createScriptProcessor() {
    const node = new FakeNode();
    node.onaudioprocess = null;
    return node;
  }
  createGain() {
    const node = new FakeNode();
    node.gain = { value: 1 };
    return node;
  }
  async resume() { this.suspended = false; }
  async suspend() { this.suspended = true; }
  async close() { this.closed = true; this.state = 'closed'; }
}

test('browser audio bundle remains equivalent to the MIT CommonJS core', async () => {
  const browser = await import(browserBundleUrl);
  const commonjs = require('../../../Audio_detection/core/engine');
  const samples = sine(16000, 4);
  const config = {
    strict_mode: false,
    max_audio_duration_sec: 0,
    abstain_confidence_threshold: 0.35,
    abstain_quality_threshold: 0.4,
  };
  assert.deepEqual(
    browser.analyzePcmSamples(samples, 16000, config),
    commonjs.analyzePcmSamples(samples, 16000, config)
  );
});

test('audio QC rejects silence, clipping and short windows without inventing markers', async () => {
  const { analyzeAudioWindow } = await import(audioModuleUrl);
  const silence = analyzeAudioWindow(new Float32Array(16000 * 4), 16000);
  const clipping = analyzeAudioWindow(new Float32Array(16000 * 4).fill(1), 16000);
  const short = analyzeAudioWindow(sine(16000, 1), 16000);
  assert.equal(silence.accepted, false);
  assert.equal(silence.qc.silence, true);
  assert.deepEqual(silence.markers, []);
  assert.equal(clipping.accepted, false);
  assert.equal(clipping.qc.clipping, true);
  assert.equal(short.accepted, false);
  assert.equal(short.qc.short, true);
});

test('audio QC accepts a clean browser-length voiced window with finite reliability', async () => {
  const { analyzeAudioWindow } = await import(audioModuleUrl);
  const result = analyzeAudioWindow(syntheticSpeech(16000, 12), 16000);
  assert.equal(result.accepted, true);
  assert.ok(result.reliability > 0.4);
  assert.ok(result.qc.speechFraction > 0.2);
  assert.equal(result.qc.reasons.length, 0);
});

test('audio QC accepts a strong recording when only pitch-derived features are unreliable', async () => {
  const { audioWindowAcceptance } = await import(audioModuleUrl);
  const result = audioWindowAcceptance(
    {
      silence: false,
      clipping: false,
      short: false,
      unsupportedSampleRate: false,
    },
    {
      quality: { is_ood: false, score: 0.759762 },
      decision: { status: 'abstain', reasons: ['low_voiced_coverage'] },
    }
  );
  assert.equal(result.accepted, true);
  assert.equal(result.featureReliable, false);
});

test('audio QC still rejects genuinely low-quality and out-of-distribution recordings', async () => {
  const { audioWindowAcceptance } = await import(audioModuleUrl);
  const qc = {
    silence: false,
    clipping: false,
    short: false,
    unsupportedSampleRate: false,
  };
  assert.equal(audioWindowAcceptance(qc, {
    quality: { is_ood: false, score: 0.2 },
    decision: { status: 'abstain', reasons: ['low_quality_score'] },
  }).accepted, false);
  assert.equal(audioWindowAcceptance(qc, {
    quality: { is_ood: true, score: 0.8 },
    decision: { status: 'abstain', reasons: ['quality_ood'] },
  }).accepted, false);
});

test('three audio task profiles produce safe local task summaries', async () => {
  const { analyzeAudioWindow, summarizeAudioTaskWindows } = await import(audioModuleUrl);
  const window = analyzeAudioWindow(syntheticSpeech(16000, 12), 16000);
  assert.equal(window.accepted, true);
  for (const testType of ['reading', 'sustained_vowel', 'oral_ddk']) {
    const summary = summarizeAudioTaskWindows([window], testType, {
      blockId: `audio-${testType}`,
      title: testType,
      durationMs: 12000,
      audioAvailable: true,
      completedAt: 12345,
    });
    assert.equal(summary.schemaVersion, 'audio_task.v1');
    assert.equal(summary.testType, testType);
    assert.equal(summary.status, 'completed');
    assert.equal(summary.acceptedWindowCount, 1);
    assert.ok(summary.metrics.completionScore > 0);
    assert.equal(summary.rawAudioStored, false);
    assert.equal(Object.hasOwn(summary, 'windows'), false);
  }
});

test('rejected audio does not publish a misleading zero reliability', async () => {
  const { analyzeAudioWindow } = await import(audioModuleUrl);
  const result = analyzeAudioWindow(new Float32Array(16000 * 12), 16000);
  assert.equal(result.accepted, false);
  assert.equal(result.reliability, null);
});

test('microphone is never requested without separate audio consent', async () => {
  const { SessionAudioCollector } = await import(audioModuleUrl);
  let requests = 0;
  const collector = new SessionAudioCollector({
    state: stateWithConsent(false),
    clock: fakeClock(),
    enabled: true,
    WorkerCtor: null,
    AudioContextCtor: FakeAudioContext,
    mediaDevices: { async getUserMedia() { requests += 1; } },
  });
  assert.equal(await collector.start(), false);
  assert.equal(requests, 0);
  const summary = await collector.stop();
  assert.equal(summary.status, 'declined');
  assert.equal(summary.rawAudioStored, false);
  assert.equal(summary.rawAudioTransmitted, false);
});

test('permission denial degrades safely and is not relabelled as completed', async () => {
  const { SessionAudioCollector } = await import(audioModuleUrl);
  const denied = new Error('denied');
  denied.name = 'NotAllowedError';
  const collector = new SessionAudioCollector({
    state: stateWithConsent(true),
    clock: fakeClock(),
    enabled: true,
    WorkerCtor: null,
    AudioContextCtor: FakeAudioContext,
    mediaDevices: { async getUserMedia() { throw denied; } },
  });
  assert.equal(await collector.start(), false);
  const summary = await collector.stop();
  assert.equal(summary.status, 'permission_denied');
  assert.equal(summary.permission, 'denied');
});

test('audio lifecycle flushes phase windows and releases every media resource', async () => {
  const { SessionAudioCollector } = await import(audioModuleUrl);
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  const collector = new SessionAudioCollector({
    state: stateWithConsent(true),
    clock: fakeClock(),
    enabled: true,
    windowSeconds: 3,
    WorkerCtor: null,
    AudioContextCtor: FakeAudioContext,
    mediaDevices: { async getUserMedia() { return stream; } },
  });
  assert.equal(await collector.start(), true);
  const context = collector.context;
  collector._capture({ inputBuffer: { getChannelData: () => sine(16000, 1) } });
  assert.equal(await collector.pause(), true);
  assert.equal(context.suspended, true);
  assert.equal(await collector.resume(), true);
  collector._capture({ inputBuffer: { getChannelData: () => sine(16000, 3.2) } });
  const first = await collector.stop('test_finish');
  const second = await collector.stop('duplicate_finish');
  assert.equal(track.stopped, true);
  assert.equal(context.closed, true);
  assert.equal(first.windowCount, 3);
  assert.deepEqual(second, first);
  assert.equal(first.rawAudioStored, false);
});

test('audio task boundary flush analyzes a short task before protocol advances', async () => {
  const { SessionAudioCollector } = await import(audioModuleUrl);
  const collector = new SessionAudioCollector({
    state: stateWithConsent(true),
    clock: fakeClock(),
    enabled: true,
    WorkerCtor: null,
    AudioContextCtor: FakeAudioContext,
    mediaDevices: {},
  });
  collector.started = true;
  collector.everStarted = true;
  collector.status = 'running';
  collector.permission = 'granted';
  collector.sampleRate = 16000;
  collector.pendingChunks = [syntheticSpeech(16000, 8)];
  collector.pendingSamples = collector.pendingChunks[0].length;
  assert.equal(await collector.flushBoundary(), 1);
  assert.equal(collector.pendingSamples, 0);
  const task = collector.summarizeTaskWindows(collector.windows, 'sustained_vowel', {
    blockId: 'audio-vowel',
    title: 'Sustained vowel',
    durationMs: 8000,
    audioAvailable: true,
  });
  assert.equal(task.windowCount, 1);
  assert.equal(task.status, 'completed');
  await collector.stop();
});

test('AudioWorklet setup failure falls back without disabling the session', async () => {
  const { SessionAudioCollector } = await import(audioModuleUrl);
  class WorkletFailingContext extends FakeAudioContext {
    constructor() {
      super();
      this.audioWorklet = {
        async addModule() { throw new Error('blocked by policy'); },
      };
    }
  }
  const track = { stop() {} };
  const events = [];
  const collector = new SessionAudioCollector({
    state: stateWithConsent(true),
    clock: fakeClock(),
    enabled: true,
    WorkerCtor: null,
    AudioWorkletNodeCtor: class {},
    AudioContextCtor: WorkletFailingContext,
    mediaDevices: { async getUserMedia() { return { getTracks: () => [track] }; } },
    recordEvent(type) { events.push(type); },
  });
  assert.equal(await collector.start(), true);
  assert.equal(typeof collector.processor.onaudioprocess, 'function');
  assert.ok(events.includes('audio_worklet_fallback'));
  await collector.stop();
});

test('unresponsive audio worker times out instead of blocking session finish', async () => {
  const { SessionAudioCollector } = await import(audioModuleUrl);
  const collector = new SessionAudioCollector({
    state: stateWithConsent(true),
    clock: fakeClock(),
    enabled: true,
    WorkerCtor: null,
    AudioContextCtor: FakeAudioContext,
    mediaDevices: {},
    workerTimeoutMs: 5,
  });
  collector.sampleRate = 16000;
  collector.worker = { postMessage() {} };
  const result = await collector._analyzeWindow(sine(16000, 1), {});
  assert.equal(result, null);
  assert.equal(collector.workerPending.size, 0);
});

test('finish during a pending permission prompt cancels late audio startup', async () => {
  const { SessionAudioCollector } = await import(audioModuleUrl);
  let releasePermission;
  const track = { stopped: false, stop() { this.stopped = true; } };
  const permission = new Promise(resolve => { releasePermission = resolve; });
  const collector = new SessionAudioCollector({
    state: stateWithConsent(true),
    clock: fakeClock(),
    enabled: true,
    WorkerCtor: null,
    AudioContextCtor: FakeAudioContext,
    mediaDevices: { getUserMedia() { return permission; } },
  });
  const startup = collector.start();
  await Promise.resolve();
  const summary = await collector.stop();
  assert.equal(summary.status, 'stopped');
  releasePermission({ getTracks: () => [track] });
  assert.equal(await startup, false);
  assert.equal(track.stopped, true);
  assert.equal(collector.status, 'stopped');
  assert.equal(collector.started, false);
});

test('optional microphone startup is not awaited by the continuous video pipeline', () => {
  const source = require('node:fs').readFileSync(path.resolve(
    __dirname,
    '../../participant-web/js/session-runtime/index.js'
  ), 'utf8');
  const startMethod = source.slice(
    source.indexOf('async startContinuousModules()'),
    source.indexOf('isAnalysisRunning()', source.indexOf('async startContinuousModules()'))
  );
  assert.match(startMethod, /this\.startAudioModule\(\);/);
  assert.match(startMethod, /await this\.framePipeline\.start\(\)/);
  assert.doesNotMatch(startMethod, /Promise\.all/);
});

test('ingest accepts aggregate audio but blocks raw media fields', () => {
  const payload = {
    schemaVersion: 'session_feature.v1',
    ids: { session: 'S-AUDIO' },
    lifecycle: {
      schemaVersion: 'session_lifecycle.v1',
      state: 'running',
      status: 'in_progress',
    },
    events: [],
    audio_summary: {
      schemaVersion: 'audio_session.v1',
      algorithmVersion: 'open_vocal_biomarkers.test',
      status: 'completed',
      enabled: true,
      consentGranted: true,
      permission: 'granted',
      rawAudioStored: false,
      rawAudioTransmitted: false,
      sampleRate: 16000,
      windowDurationMs: 10000,
      windowCount: 0,
      acceptedWindowCount: 0,
      rejectedWindowCount: 0,
      droppedWindowCount: 0,
      durationMs: 0,
      qualityMean: null,
      reliabilityMean: null,
      markers: [],
      windows: [],
      provenance: {},
      disclaimer: 'research only',
    },
  };
  assert.deepEqual(validateSessionFeaturePayload(payload), []);
  payload.audio_summary.windows.push({ pcmSamples: [0.1, 0.2] });
  assert.ok(validateSessionFeaturePayload(payload).some(error => error.keyword === 'rawMedia'));
});
