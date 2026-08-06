const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  resolveIdempotencyKey,
  getIngestSuccessStatus,
  resolveExistingFinish,
  requireFinishIdempotencyKey,
} = require('../ingest/idempotency');

const runtimeRoot = path.resolve(
  __dirname,
  '../../participant-web/js/session-runtime'
);

async function importRuntimeModule(name) {
  return import(pathToFileURL(path.join(runtimeRoot, name)).href);
}

describe('participant session state machine', () => {
  it('allows pause only on an instruction screen and resumes only by command', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    assert.equal(machine.requestPause().accepted, true);
    assert.equal(machine.snapshot().state, 'paused');
    assert.equal(machine.resume().accepted, true);
    assert.equal(machine.snapshot().state, 'instruction');

    machine.beginBlock({ blockId: 'rt-1', blockType: 'rt' });
    assert.equal(machine.requestPause().accepted, false);
    assert.equal(machine.snapshot().state, 'running');
  });

  it('marks a block invalid and schedules a repeat after a quality error', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.beginBlock({ blockId: 'vpc-1', blockType: 'vpc' });
    machine.reportIssue({
      kind: 'quality',
      code: 'low_light',
      message: 'low light',
    });
    const result = machine.completeBlock({ success: true });
    assert.equal(result.repeatRequired, true);
    assert.equal(machine.snapshot().repeatQueue[0].blockId, 'vpc-1');
  });

  it('queues only explicitly invalid cognitive trials with issue details', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.beginBlock({ blockId: 'rt-partial', blockType: 'cognitive_task' });
    machine.reportIssue({
      kind: 'quality',
      code: 'low_light',
      message: 'Освещение недостаточно',
    });
    machine.resolveIssue('low_light');

    const result = machine.completeBlock({
      success: true,
      repeatItems: [
        { id: 'trial-2', issueCodes: ['low_light'] },
        { id: 'trial-4', issueCodes: ['low_light'] },
      ],
      totalItemCount: 5,
    });
    assert.equal(result.repeatRequired, true);
    const repeat = machine.consumeRepeat('rt-partial');
    assert.equal(repeat.repeatItemCount, 2);
    assert.equal(repeat.totalItemCount, 5);
    assert.deepEqual(repeat.repeatItems.map(item => item.id), ['trial-2', 'trial-4']);
    assert.equal(repeat.issues[0].code, 'low_light');
  });

  it('does not repeat a cognitive block when explicit per-trial quality is valid', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.beginBlock({ blockId: 'rt-valid', blockType: 'cognitive_task' });
    machine.reportIssue({
      kind: 'quality',
      code: 'head_pose',
      message: 'bad pose between trials',
    });

    const result = machine.completeBlock({
      success: true,
      repeatItems: [],
      totalItemCount: 3,
    });
    assert.equal(result.repeatRequired, false);
    assert.equal(machine.snapshot().repeatQueue.length, 0);
  });

  it('marks network and module failures as technical block errors', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.beginBlock({ blockId: 'bpm-1', blockType: 'bpm' });
    machine.reportIssue({
      kind: 'technical',
      code: 'network_offline',
      message: 'offline',
    });
    machine.reportIssue({
      kind: 'technical',
      code: 'bpm_module_failed',
      message: 'module failed',
    });
    assert.equal(machine.snapshot().state, 'technical_error');
    assert.equal(machine.completeBlock().repeatRequired, true);
  });

  it('keeps the error state aligned with remaining active issues', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.reportIssue({ kind: 'quality', code: 'low_light' });
    machine.reportIssue({ kind: 'technical', code: 'camera_failed' });
    assert.equal(machine.snapshot().state, 'technical_error');
    machine.resolveIssue('camera_failed');
    assert.equal(machine.snapshot().state, 'quality_error');
    machine.resolveIssue('low_light');
    assert.equal(machine.snapshot().state, 'instruction');
  });

  it('resumes from an instruction pause into an active error state', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.requestPause();
    machine.reportIssue({ kind: 'quality', code: 'face_missing' });
    assert.equal(machine.resume().accepted, true);
    assert.equal(machine.snapshot().state, 'quality_error');
  });

  it('keeps locally recorded block valid during a network-only outage', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.beginBlock({ blockId: 'local-rt', blockType: 'rt' });
    machine.reportIssue({
      kind: 'technical',
      code: 'network_offline',
      message: 'offline',
      invalidatesBlock: false,
    });
    assert.equal(machine.completeBlock().repeatRequired, false);
  });

  it('restores an interrupted block as invalid after reload', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const original = new SessionStateMachine();
    original.start();
    original.enterInstruction();
    original.beginBlock({ blockId: 'spatial-1', blockType: 'visuospatial' });

    const restored = new SessionStateMachine();
    restored.restore(original.snapshot());
    assert.equal(restored.snapshot().currentBlock.blockId, 'spatial-1');
    assert.equal(restored.snapshot().currentBlock.invalid, true);
    assert.equal(restored.completeBlock().repeatRequired, true);
  });

  it('restores legacy checkpoints that do not contain issue snapshots', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.restore({
      state: 'running',
      currentBlock: {
        blockId: 'legacy-rt',
        blockType: 'cognitive_task',
        attempt: 1,
        stage: 'trial',
        invalid: false,
      },
      activeIssues: [],
      repeatQueue: [],
      blockAttempts: { 'legacy-rt': 1 },
    });
    assert.doesNotThrow(() => machine.reportIssue({
      kind: 'quality',
      code: 'low_light',
      message: 'low light',
    }));
    assert.equal(machine.snapshot().currentBlock.issues[0].code, 'low_light');
  });

  it('treats repeated finish as an idempotent no-op', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    assert.equal(machine.beginFinish('finish-1'), true);
    assert.equal(machine.reportIssue({ kind: 'technical', code: 'late_module_error' }), null);
    assert.equal(machine.snapshot().state, 'finishing');
    machine.completeFinish();
    assert.equal(machine.beginFinish('finish-1'), false);
    assert.equal(machine.snapshot().state, 'completed');
    assert.equal(machine.reportIssue({ kind: 'technical', code: 'late_error' }), null);
  });

  it('does not finish or discard an active block', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.beginBlock({ blockId: 'active-vpc', blockType: 'vpc' });
    assert.equal(machine.beginFinish('finish-active'), false);
    assert.equal(machine.snapshot().state, 'running');
    assert.equal(machine.snapshot().currentBlock.blockId, 'active-vpc');
    assert.throws(() => machine.completeFinish(), /Cannot complete finish/);
  });

  it('does not finish while a required block repeat is pending', async () => {
    const { SessionStateMachine } = await importRuntimeModule('session-state-machine.mjs');
    const machine = new SessionStateMachine();
    machine.start();
    machine.enterInstruction();
    machine.beginBlock({ blockId: 'repeat-vpc', blockType: 'vpc' });
    machine.completeBlock({ success: false });
    assert.equal(machine.snapshot().repeatQueue.length, 1);
    assert.equal(machine.beginFinish('finish-before-repeat'), false);
    assert.equal(machine.snapshot().state, 'instruction');
  });
});

describe('continuous body posture summary', () => {
  it('uses the full-session accumulator when retained samples are capped', async () => {
    const { summarizeBodyPoseState } = await importRuntimeModule('continuous-body-pose.js');
    const state = {
      sessionData: {
        bodyPoseSamples: [
          {
            t: 9000,
            confidence: 0.7,
            movementVelocity: 0.4,
            torsoLeanDeg: 5,
            shoulderRollDeg: 4,
          },
        ],
        bodyPoseAccumulator: {
          n: 100,
          startedAt: 1000,
          updatedAt: 11000,
          confidenceSum: 80,
          movementVelocitySum: 15,
          torsoLeanAbsSum: 240,
          shoulderRollAbsSum: 120,
          movementBurstCount: 7,
        },
      },
    };
    const summary = summarizeBodyPoseState(state);
    assert.equal(summary.sampleCount, 100);
    assert.equal(summary.retainedSampleCount, 1);
    assert.equal(summary.durationMs, 10000);
    assert.equal(summary.confidenceMean, 0.8);
    assert.equal(summary.movementVelocityMean, 0.15);
    assert.equal(summary.movementBurstCount, 7);
    assert.equal(summary.torsoLeanAbsMeanDeg, 2.4);
    assert.equal(summary.shoulderRollAbsMeanDeg, 1.2);
  });
});

describe('quality detector', () => {
  it('ignores brief head motion and raises a sustained pose issue', async () => {
    let now = 1000;
    const { SessionQualityDetector } = await importRuntimeModule('quality-detector.mjs');
    const detector = new SessionQualityDetector({ now: () => now });
    const badPose = {
      face: { detected: true },
      illumination: { status: 'optimal' },
      pose: { status: 'unstable', isStable: false },
      visibility: { isComplete: true, issues: [] },
    };

    assert.equal(detector.update(badPose).raised.length, 0);
    now += 1200;
    assert.equal(detector.update(badPose).raised.length, 0);
    now += 1400;
    assert.equal(detector.update(badPose).raised[0].code, 'head_pose');

    const goodFrame = {
      face: { detected: true },
      illumination: { status: 'optimal' },
      pose: { status: 'stable', isStable: true },
      visibility: { isComplete: true, issues: [] },
    };
    assert.deepEqual(detector.update(goodFrame).resolved, ['head_pose']);
  });

  it('classifies repeated analyzer error payloads as a technical failure', async () => {
    const { SessionQualityDetector } = await importRuntimeModule('quality-detector.mjs');
    const detector = new SessionQualityDetector();
    const errorFrame = {
      error: 'MediaPipe inference failed',
      face: { detected: false },
      illumination: { status: 'unknown' },
      pose: { status: 'error' },
    };
    assert.equal(detector.update(errorFrame).raised.length, 0);
    assert.equal(detector.update(errorFrame).raised.length, 0);
    const raised = detector.update(errorFrame).raised;
    assert.equal(raised[0].kind, 'technical');
    assert.equal(raised[0].code, 'frame_analysis_failed');
  });

  it('uses critical FaceSegmenter hand occlusion without low-skin false positives', async () => {
    let now = 1000;
    const { SessionQualityDetector } = await importRuntimeModule('quality-detector.mjs');
    const detector = new SessionQualityDetector({ now: () => now });
    const goodFrame = {
      face: { detected: true },
      illumination: { status: 'optimal' },
      pose: { status: 'stable', isStable: true },
    };
    const lowSkin = {
      faceVisibility: { isComplete: false, issues: ['low_skin_visibility'] },
      issues: ['low_skin_visibility'],
    };
    detector.update(goodFrame, lowSkin);
    now += 2500;
    assert.equal(detector.update(goodFrame, lowSkin).raised.length, 0);

    const hand = {
      faceVisibility: { isComplete: false, handDetected: true, issues: ['hand_on_face'] },
      issues: ['hand_on_face'],
    };
    detector.update(goodFrame, hand);
    now += 2100;
    assert.equal(detector.update(goodFrame, hand).raised[0].code, 'face_occluded');
  });

  it('ignores brief FPS drops and raises a sustained low FPS issue', async () => {
    let now = 1000;
    const { SessionQualityDetector } = await importRuntimeModule('quality-detector.mjs');
    const detector = new SessionQualityDetector({ now: () => now });
    const goodFrame = {
      face: { detected: true },
      illumination: { status: 'optimal' },
      pose: { status: 'stable', isStable: true },
    };

    assert.equal(detector.update(goodFrame, null, now, { cameraFps: 8 }).raised.length, 0);
    now += 2000;
    assert.equal(detector.update(goodFrame, null, now, { cameraFps: 8 }).raised.length, 0);
    now += 1100;
    assert.equal(
      detector.update(goodFrame, null, now, { cameraFps: 8 }).raised[0].code,
      'low_fps'
    );
    now += 100;
    assert.deepEqual(
      detector.update(goodFrame, null, now, { cameraFps: 24 }).resolved,
      ['low_fps']
    );
  });
});

describe('per-trial quality repeats', () => {
  it('repeats exactly three invalid trials in their original order', async () => {
    const { buildTrialRepeatPlan } = await importRuntimeModule('trial-quality.mjs');
    const activeTrialPlan = Array.from({ length: 10 }, (_, index) => ({
      trialId: `trial-${index + 1}`,
      sourceIndex: index,
    }));
    const invalidIds = new Set(['trial-2', 'trial-6', 'trial-9']);
    const attemptResults = activeTrialPlan.map(item => ({
      trialId: item.trialId,
      qualityValid: !invalidIds.has(item.trialId),
      qualityIssueCodes: invalidIds.has(item.trialId)
        ? ['low_light', 'low_light']
        : [],
    }));

    const plan = buildTrialRepeatPlan(activeTrialPlan, attemptResults);
    assert.equal(plan.invalidResults.length, 3);
    assert.deepEqual(
      plan.repeatTrialPlan.map(item => item.trialId),
      ['trial-2', 'trial-6', 'trial-9']
    );
    assert.deepEqual(
      plan.repeatItems,
      [
        { id: 'trial-2', issueCodes: ['low_light'] },
        { id: 'trial-6', issueCodes: ['low_light'] },
        { id: 'trial-9', issueCodes: ['low_light'] },
      ]
    );
  });

  it('attributes issues only to the trial interval and active boundaries', async () => {
    const { collectTrialQualityIssues } = await importRuntimeModule('trial-quality.mjs');
    const lowLight = { issueId: 'q-1', code: 'low_light' };
    const priorPose = { issueId: 'q-2', code: 'head_pose' };
    const lowFps = { issueId: 'q-3', code: 'low_fps' };
    const issues = collectTrialQualityIssues({
      activeAtStart: [lowLight],
      blockIssues: [priorPose, lowLight, lowFps],
      issueStartIndex: 2,
      activeNow: [lowFps],
    });
    assert.deepEqual(issues.map(issue => issue.code), ['low_light', 'low_fps']);
  });
});

describe('session checkpoint', () => {
  it('persists and restores a checkpoint without IndexedDB', async () => {
    const { SessionCheckpointStore } = await importRuntimeModule('checkpoint-store.mjs');
    const storage = new Map();
    const sessionStorage = {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    };
    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage });
    await store.save('S-1', { ids: { session: 'S-1' } }, { state: 'running' });
    const restored = await store.load('S-1');
    assert.equal(restored.sessionData.ids.session, 'S-1');
    assert.equal(restored.machineSnapshot.state, 'running');
  });

  it('redacts direct identifiers and snapshots by value', async () => {
    const {
      SessionCheckpointStore,
      buildCheckpointSessionData,
    } = await importRuntimeModule('checkpoint-store.mjs');
    const original = {
      ids: { session: 'S-PRIVATE', invitationCode: 'INV-1' },
      user: { email: 'person@example.test', age: 30 },
      tech: { browser: { userAgent: 'fingerprint', family: 'chromium' } },
      consent: { ipAddress: '192.0.2.1' },
      events: [{ message: 'person@example.test' }],
    };
    const safe = buildCheckpointSessionData(original);
    assert.equal(safe.user.email, undefined);
    assert.equal(safe.user.age, 30);
    assert.equal(safe.tech.browser.userAgent, undefined);
    assert.equal(safe.consent.ipAddress, undefined);
    assert.equal(safe.events[0].message, '[redacted]');
    assert.equal(safe.ids.invitationCode, 'INV-1');

    const store = new SessionCheckpointStore({ indexedDB: null, sessionStorage: null });
    await store.save('S-PRIVATE', original, { state: 'running' });
    original.user.age = 99;
    const restored = await store.load('S-PRIVATE');
    assert.equal(restored.schemaVersion, 3);
    assert.equal(restored.sessionData.user.age, 30);
  });
});

describe('participant API origin and retry policy', () => {
  it('rejects arbitrary API overrides and allows explicit HTTPS origins', async () => {
    const { resolveParticipantApiBase } = await importRuntimeModule('api-base.mjs');
    const runtime = {
      location: { href: 'https://wecog.ru/participant/index.html' },
      WECOG_API_BASE: 'https://attacker.test/api',
      localStorage: { getItem: () => 'https://attacker.test/api' },
    };
    assert.equal(
      resolveParticipantApiBase({ runtime }),
      'https://wecog.ru/api'
    );
    assert.equal(
      resolveParticipantApiBase({
        runtime,
        allowedOrigins: ['https://api.wecog.ru'],
        configuredBase: 'https://api.wecog.ru/v1',
      }),
      'https://api.wecog.ru/v1'
    );
    assert.equal(
      resolveParticipantApiBase({
        runtime,
        allowedOrigins: ['http://api.wecog.ru'],
        configuredBase: 'http://api.wecog.ru/v1',
      }),
      'https://wecog.ru/api'
    );
  });

  it('retries 408/425/429/5xx and parses Retry-After', async () => {
    const { __test } = await importRuntimeModule('ingest-transport.mjs');
    assert.equal(__test.isRetryable({ httpStatus: 408 }), true);
    assert.equal(__test.isRetryable({ httpStatus: 425 }), true);
    assert.equal(__test.isRetryable({ httpStatus: 429 }), true);
    assert.equal(__test.isRetryable({ httpStatus: 503 }), true);
    assert.equal(__test.isRetryable({ httpStatus: 409 }), false);
    assert.equal(__test.parseRetryAfter('2'), 2000);
    assert.equal(
      __test.parseRetryAfter('Thu, 01 Jan 2026 00:00:02 GMT', Date.parse('2026-01-01T00:00:00Z')),
      2000
    );
  });

  it('admits an invited participant before the experiment starts', async () => {
    const { primeParticipantSession } = await importRuntimeModule('ingest-transport.mjs');
    const previousFetch = global.fetch;
    const previousSessionStorage = global.sessionStorage;
    const storage = new Map();
    const calls = [];
    global.sessionStorage = {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    };
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ token: 'admitted-token', admitted: true }),
      };
    };
    try {
      const first = await primeParticipantSession({
        apiBase: 'https://api.wecog.test',
        sessionId: 'S-ADMISSION',
        invitationCode: 'INV-ADMISSION',
      });
      const replay = await primeParticipantSession({
        apiBase: 'https://api.wecog.test',
        sessionId: 'S-ADMISSION',
        invitationCode: 'INV-ADMISSION',
      });
      assert.equal(first.admitted, true);
      assert.equal(replay.cached, true);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/invitations\/by-code\/INV-ADMISSION\/ingest-token$/);
      assert.deepEqual(JSON.parse(calls[0].options.body), { session_id: 'S-ADMISSION' });
    } finally {
      global.fetch = previousFetch;
      global.sessionStorage = previousSessionStorage;
    }
  });

  it('honors Retry-After and clears a completed participant token', async () => {
    const { sendSessionFeature } = await importRuntimeModule('ingest-transport.mjs');
    const previousFetch = global.fetch;
    const previousSessionStorage = global.sessionStorage;
    const storage = new Map();
    const calls = [];
    const delays = [];
    global.sessionStorage = {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    };
    global.fetch = async (url) => {
      calls.push(url);
      if (url.endsWith('/ingest-token')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ token: 'participant-token' }),
        };
      }
      if (calls.filter(call => call.endsWith('/ingest')).length === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: name => name === 'Retry-After' ? '2' : null },
          json: async () => ({ error: 'busy' }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ ingested: true }),
      };
    };
    try {
      const result = await sendSessionFeature({
        schemaVersion: 'session_feature.v1',
        ids: {
          session: 'S-RETRY',
          participant: 'P-RETRY',
          invitationCode: 'INV-RETRY',
        },
        lifecycle: {
          schemaVersion: 'session_lifecycle.v1',
          state: 'completed',
          status: 'completed',
        },
        events: [],
      }, {
        apiBase: 'https://api.wecog.test',
        retries: 2,
        backoffMs: 10,
        random: () => 0,
        sleep: async ms => delays.push(ms),
      });
      assert.equal(result.ok, true);
      assert.deepEqual(delays, [2000]);
      assert.equal(calls.filter(url => url.endsWith('/ingest-token')).length, 1);
      assert.equal(calls.filter(url => url.endsWith('/ingest')).length, 2);
      assert.equal(storage.size, 0);
    } finally {
      global.fetch = previousFetch;
      global.sessionStorage = previousSessionStorage;
    }
  });

  it('refreshes a rejected participant token only once', async () => {
    const { sendSessionFeature } = await importRuntimeModule('ingest-transport.mjs');
    const previousFetch = global.fetch;
    const previousSessionStorage = global.sessionStorage;
    const storage = new Map();
    let tokenRequests = 0;
    let ingestRequests = 0;
    global.sessionStorage = {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    };
    global.fetch = async (url, options) => {
      if (url.endsWith('/ingest-token')) {
        tokenRequests += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ token: `token-${tokenRequests}` }),
        };
      }
      ingestRequests += 1;
      const expected = ingestRequests === 1 ? 'Bearer token-1' : 'Bearer token-2';
      assert.equal(options.headers.Authorization, expected);
      return {
        ok: ingestRequests > 1,
        status: ingestRequests > 1 ? 200 : 401,
        headers: { get: () => null },
        json: async () => ingestRequests > 1
          ? ({ ingested: true })
          : ({ error: 'expired' }),
      };
    };
    try {
      const result = await sendSessionFeature({
        schemaVersion: 'session_feature.v1',
        ids: {
          session: 'S-REFRESH',
          participant: 'P-REFRESH',
          invitationCode: 'INV-REFRESH',
        },
        lifecycle: {
          schemaVersion: 'session_lifecycle.v1',
          state: 'running',
          status: 'in_progress',
        },
        events: [],
      }, {
        apiBase: 'https://api.wecog.test',
        retries: 2,
        backoffMs: 0,
        sleep: async () => {},
      });
      assert.equal(result.ok, true);
      assert.equal(tokenRequests, 2);
      assert.equal(ingestRequests, 2);
    } finally {
      global.fetch = previousFetch;
      global.sessionStorage = previousSessionStorage;
    }
  });
});

describe('ingest idempotency contract', () => {
  it('accepts matching finish keys and returns 200 for an existing session', () => {
    assert.deepEqual(
      resolveIdempotencyKey('finish-1', { finishAttemptId: 'finish-1' }),
      { ok: true, key: 'finish-1' }
    );
    assert.equal(getIngestSuccessStatus(true), 200);
    assert.equal(getIngestSuccessStatus(false), 201);
  });

  it('rejects conflicting idempotency keys', () => {
    const result = resolveIdempotencyKey('finish-1', { finishAttemptId: 'finish-2' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
  });

  it('requires an idempotency key for completed payloads', () => {
    const missing = requireFinishIdempotencyKey({ status: 'completed' }, null);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 400);
    assert.deepEqual(
      requireFinishIdempotencyKey({ status: 'completed' }, 'finish-1'),
      { ok: true }
    );
  });

  it('replays the same completed finish without changing stored data', () => {
    assert.deepEqual(resolveExistingFinish('finish-1', 'finish-1'), { action: 'replay' });
    const conflict = resolveExistingFinish('finish-1', 'finish-2');
    assert.equal(conflict.action, 'conflict');
    assert.equal(conflict.status, 409);
    const sealedLegacy = resolveExistingFinish(null, 'finish-new');
    assert.equal(sealedLegacy.action, 'conflict');
    assert.equal(sealedLegacy.status, 409);
  });
});

describe('SessionFeature API schemas', () => {
  it('publishes versioned lifecycle, event and feature contracts', () => {
    const contractsRoot = path.resolve(__dirname, '../../../packages/shared/contracts');
    const feature = require(path.join(contractsRoot, 'session-feature.v1.schema.json'));
    const event = require(path.join(contractsRoot, 'session-event.v1.schema.json'));
    const lifecycle = require(path.join(contractsRoot, 'session-lifecycle.v1.schema.json'));
    const response = require(path.join(contractsRoot, 'ingest-session-feature-response.v1.schema.json'));
    assert.equal(feature.$id, 'session_feature.v1');
    assert.equal(event.$id, 'session_event.v1');
    assert.equal(lifecycle.$id, 'session_lifecycle.v1');
    assert.equal(response.$id, 'ingest_session_feature_response.v1');
    assert.ok(feature.required.includes('lifecycle'));
    assert.ok(feature.required.includes('events'));
  });

  it('does not allow payload fields to override canonical event typing', async () => {
    const { createSessionEvent } = await importRuntimeModule('contracts.mjs');
    const event = createSessionEvent({
      type: 'test',
      schemaVersion: 'legacy',
      timestamp: 100,
    });
    assert.equal(event.schemaVersion, 'session_event.v1');
    assert.equal(event.timestamp, 100);
  });
});

describe('measurement clock', () => {
  it('starts at continuous measurement and remains stable across restarts', async () => {
    const { ensureMeasurementStart } = await importRuntimeModule('measurement-clock.mjs');
    const sessionData = { startTime: null };

    assert.equal(ensureMeasurementStart(sessionData, 1_000), 1_000);
    assert.equal(sessionData.startTime, 1_000);
    assert.equal(ensureMeasurementStart(sessionData, 2_000), 1_000);
  });

  it('preserves a restored measurement epoch and rejects invalid input', async () => {
    const { ensureMeasurementStart } = await importRuntimeModule('measurement-clock.mjs');

    assert.equal(ensureMeasurementStart({ startTime: 750 }, 1_000), 750);
    assert.throws(() => ensureMeasurementStart(null, 1_000), /sessionData is required/);
    assert.throws(
      () => ensureMeasurementStart({ startTime: null }, Number.NaN),
      /positive timestamp/
    );
  });
});
