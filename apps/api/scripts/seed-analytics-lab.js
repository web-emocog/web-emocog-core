'use strict';

// Disposable local lab only. Importing this module never connects or loads .env.
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { validateSessionFeaturePayload } = require('../security/payload-policy');
const { assertPublishedSurveyResponses } = require('../security/survey-admission');
const { standardAoisForStimulus, AOI_SCHEMA_VERSION } = require('../../web/aoi-protocol');
const { normalizeMandatoryParticipantShell } = require('../protocol/participant-shell');
const standard = require('../../shared/standard-stimuli');

const LAB_NAME = 'Лаборатория аналитики — синтетические данные';
const METHOD = 'analytics-lab-synthetic.v1';
const DISCLAIMER = 'SYNTHETIC generated observations; no camera, microphone, model inference or scientific/clinical interpretation.';
const DEFAULT_SEED = 20261112;
const BASE_EPOCH = Date.parse('2026-10-01T09:00:00Z');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const NAMES = ['Amber', 'Birch', 'Cedar', 'Dune', 'Elm', 'Fern', 'Grove', 'Hazel', 'Iris', 'Juniper',
  'Kite', 'Larch', 'Maple', 'North', 'Opal', 'Pine', 'Quartz', 'Reed', 'Sage', 'Willow', 'Yarrow', 'Zephyr', 'Aster', 'Brook'];

function reject(code) { throw new Error(`analytics_lab_${code}`); }
function localHttp(value) {
  let url;
  try { url = new URL(value); } catch { reject('explicit_loopback_api_required'); }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) reject('explicit_loopback_api_required');
  return url;
}

function assertSafetyGuards(env = process.env) {
  if (env.NODE_ENV !== 'test' || env.ANALYTICS_LAB_ISOLATED !== 'YES') reject('isolation_required');
  if (!env.DATABASE_URL || env.DATABASE_URL !== env.ANALYTICS_LAB_DATABASE_URL) reject('database_confirmation_required');
  let db;
  try { db = new URL(env.DATABASE_URL); } catch { reject('loopback_test_database_required'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !LOOPBACK.has(db.hostname)
    || !/^\/[a-z][a-z0-9_]*_test$/.test(db.pathname) || db.search || db.hash) reject('loopback_test_database_required');
  // No fallback to an existing API on port 3000. The operator must name the isolated API.
  if (!env.ANALYTICS_LAB_API_BASE) reject('explicit_loopback_api_required');
  const api = localHttp(env.ANALYTICS_LAB_API_BASE);
  if (!env.ANALYTICS_LAB_FIXTURE || !path.isAbsolute(env.ANALYTICS_LAB_FIXTURE)
    || path.resolve(env.ANALYTICS_LAB_FIXTURE) !== env.ANALYTICS_LAB_FIXTURE) reject('absolute_fixture_path_required');
  const seed = env.ANALYTICS_LAB_SEED === undefined ? DEFAULT_SEED : Number(env.ANALYTICS_LAB_SEED);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) reject('invalid_seed');
  return { databaseUrl: env.DATABASE_URL, databaseName: db.pathname.slice(1), apiBase: api.origin,
    fixturePath: env.ANALYTICS_LAB_FIXTURE, seed };
}

async function openPrivateFixture(filename) {
  const parent = path.dirname(filename);
  if (await fs.realpath(parent) !== parent) reject('fixture_parent_must_not_be_symlink');
  const file = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.chmod(0o600);
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) reject('unsafe_fixture_file');
    return file;
  } catch (error) { await file.close(); throw error; }
}

async function writeFixture(file, fixture) {
  const bytes = Buffer.from(JSON.stringify(fixture) + '\n');
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset, offset);
    if (!bytesWritten) reject('fixture_write_failed');
    offset += bytesWritten;
  }
  await file.truncate(bytes.length);
  await file.sync();
}

function createProtocolDefinition() {
  const task = (id, taskType, count, trialFor) => {
    const trials = Array.from({ length: count }, (_, i) => {
      const item = trialFor(i);
      return { id: `${id}-trial-${i + 1}`, duration: 2000, iti: 1000, repetitions: 1,
        responseMode: 'keypress', ...item, action: item.correctResponse || undefined,
        stimulus: { stimulusId: item.stimulusId, stimulusVersion: '1' } };
    });
    const ids = [...new Set(trials.map(row => row.stimulusId))];
    return { id, title: `SYNTHETIC ${id}`, type: 'cognitive_task', taskType,
      blockConfig: { useFixation: false, randomize: false, responseMode: 'keypress',
        stimulusDuration: 2000, rtWindow: 2000, selected_metrics: ['rt_mean', 'rt_median', 'rt_sd', 'omission_rate'], aoiSchemaVersion: AOI_SCHEMA_VERSION,
        aoiDefinitions: Object.fromEntries(ids.map(sid => [sid, standardAoisForStimulus(sid)])) }, trials };
  };
  const definition = normalizeMandatoryParticipantShell({ version: 'v2.0', title: LAB_NAME,
    settings: { signalProfileId: 'protocol_signals.v2', features: { audio: { enabled: true } } },
    blocks: [
      { id: 'baseline', title: 'SYNTHETIC baseline', type: 'rest', content: { durationMs: 30000 } },
      task('practice', 'simple_rt', 6, () => ({ stimulusId: 'std_simple_black_square', condition: 'practice', correctResponse: 'Space' })),
      task('main', 'simple_rt', 8, () => ({ stimulusId: 'std_simple_black_square', condition: 'main', correctResponse: 'Space' })),
      task('conditional', 'flanker', 8, i => ({ stimulusId: `std_flanker_${i % 2 ? 'right' : 'left'}_${i % 4 < 2 ? 'cong' : 'incong'}`,
        condition: i % 4 < 2 ? 'congruent' : 'incongruent', correctResponse: i % 2 ? 'ArrowRight' : 'ArrowLeft' })),
      task('nogo', 'go_nogo', 8, i => ({ stimulusId: i % 2 ? 'std_nogo_red_circle' : 'std_go_green_circle',
        condition: i % 2 ? 'nogo' : 'go', correctResponse: i % 2 ? null : 'Space' })),
      { id: 'survey', type: 'survey', content: { schemaVersion: 'protocol_survey.v1', title: 'SYNTHETIC self report',
        questions: [
          { id: 'sleepiness', text: 'SYNTHETIC sleepiness (ordinal, 1-9)', type: 'single', required: true,
            options: Array.from({ length: 9 }, (_, i) => ({ id: `level_${i + 1}`, label: String(i + 1) })) },
          { id: 'pleasantness', text: 'SYNTHETIC pleasantness (numeric text, -5 to 5)', type: 'open', required: true },
        ] } },
      { id: 'audio', title: 'SYNTHETIC audio', type: 'audio_test', content: { durationMs: 30000, testType: 'free_speech' } },
      { id: 'rest', title: 'SYNTHETIC rest', type: 'rest', content: { durationMs: 30000 } },
    ] });
  definition.blocks.find(block => block.id === 'nogo').blockConfig.selected_metrics.push('commission_rate');
  const conditional = definition.blocks.find(block => block.id === 'conditional');
  for (const stimulusId of Object.keys(conditional.blockConfig.aoiDefinitions)) {
    const base = standardAoisForStimulus(stimulusId)[0];
    conditional.blockConfig.aoiDefinitions[stimulusId] = [.2, .5, .8].map((x, index) => ({ ...base,
      id: `synthetic-zone-${index + 1}`, name: ['Левая зона', 'Центральная зона', 'Правая зона'][index],
      isTarget: true, order: index + 1, points: [{ x: x - .09, y: .35 }, { x: x + .09, y: .65 }] }));
  }
  return definition;
}

function createStimulusManifest(definition = createProtocolDefinition()) {
  const ids = [...new Set(definition.blocks.flatMap(block => (block.trials || []).map(trial => trial.stimulusId)))];
  // Virtual standards have no uploaded media version. Keep this descriptor separate
  // from the server-owned publication mediaManifest (which is empty for std_*).
  return Object.fromEntries(ids.map(id => {
    const preview = standard.standardStimulusPreview(id);
    return [id, { id, kind: 'virtual_standard', type: standard.resolveStandardStimulus(id).type,
      intrinsicWidth: preview.width, intrinsicHeight: preview.height, version: '1',
      dimensionSource: 'standardStimulusPreview' }];
  }));
}

const rounded = number => Math.round(number * 10000) / 10000;
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { mean: rounded(mean), min: sorted[0], max: sorted.at(-1), count: values.length,
    median: rounded((sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2),
    p95: sorted[Math.ceil(sorted.length * .95) - 1] };
}

function createAudioSummary(startMs, rng, profile) {
  const windows = profile === 'missing' ? [] : Array.from({ length: 3 }, (_, index) => {
    const accepted = profile !== 'low_qc' && index !== 2;
    const quality = accepted ? .9 : .12;
    return { schemaVersion: 'audio_window.v1', algorithmVersion: METHOD, index,
      blockId: 'audio', phase: 'audio_test', attempt: 1,
      startMonotonicMs: startMs + index * 10000, endMonotonicMs: startMs + (index + 1) * 10000,
      sessionStartMs: startMs + index * 10000, sessionEndMs: startMs + (index + 1) * 10000,
      durationMs: 10000, sampleRate: 16000, accepted, quality, reliability: accepted ? .86 : 0,
      qc: { valid: accepted, rms: accepted ? .12 : .001, clippingRatio: 0, qualityScore: quality,
        snrProxyDb: accepted ? 24 : 0, speechFraction: accepted ? .8 : 0,
        silence: !accepted, clipping: false, short: false, isOod: false, reasons: accepted ? [] : ['silence'] },
      biomarkers: { pitch_mean_hz: accepted ? rounded(150 + rng() * 50) : null,
        pitch_std_hz: accepted ? 18 : null, pitch_variability: accepted ? .11 : null,
        jitter_local: accepted ? .012 : null, shimmer_local: accepted ? .035 : null, hnr_db: accepted ? 22 : null,
        speech_fraction: accepted ? .8 : 0, pause_rate: accepted ? .2 : null,
        avg_pause_duration: accepted ? .5 : null, max_pause_duration: accepted ? .7 : null,
        num_pauses: accepted ? 2 : null, mean_utterance_duration: accepted ? 4 : null },
      markers: [], disclaimer: DISCLAIMER };
  });
  const accepted = windows.filter(window => window.accepted);
  return { schemaVersion: 'audio_session.v1', algorithmVersion: METHOD, status: profile === 'missing' ? 'not_recorded' : 'completed',
    enabled: true, consentGranted: true, permission: 'granted', rawAudioStored: false, rawAudioTransmitted: false,
    sampleRate: 16000, windowDurationMs: 10000, windowCount: windows.length,
    acceptedWindowCount: accepted.length, rejectedWindowCount: windows.length - accepted.length, droppedWindowCount: 0,
    durationMs: windows.length * 10000, qualityMean: windows.length ? rounded(windows.reduce((sum, w) => sum + w.quality, 0) / windows.length) : null,
    reliabilityMean: accepted.length ? .86 : null, markers: [], windows,
    provenance: { coreLicense: 'MIT', analysisLocation: 'synthetic_generator_no_capture', windowing: METHOD, debugCapture: false }, disclaimer: DISCLAIMER };
}

async function buildIngestPayload(sourceData, binding = {}) {
  // Use the actual producer and actual strict policy, not a permissive fixture validator.
  const { buildAggregatesPayload } = await import('../../participant-web/js/unified-aggregates-new.js');
  const source = structuredClone(sourceData);
  source.ids = { ...source.ids, ...(binding.sessionId ? { session: binding.sessionId } : {}),
    ...(binding.invitationCode ? { invitationCode: binding.invitationCode } : {}) };
  source.experimentMeta = { ...source.experimentMeta,
    ...(binding.projectId ? { projectId: binding.projectId } : {}),
    ...(binding.protocolId ? { protocolId: binding.protocolId } : {}),
    ...(binding.publicationVersion ? { publicationVersion: binding.publicationVersion } : {}) };
  if (binding.sessionId) {
    source.lifecycle.finishAttemptId = `${binding.sessionId}-finish`;
    source.events.forEach(event => { event.sessionId = binding.sessionId; });
  }
  const payload = buildAggregatesPayload(source, { forIngest: true });
  payload.delivery = { schemaVersion: 'session_delivery.v1', sequence: 1, kind: 'final' };
  const errors = validateSessionFeaturePayload(payload);
  if (errors.length) throw new Error(`analytics_lab_payload_invalid ${JSON.stringify(errors)}`);
  assertPublishedSurveyResponses(payload.events, createProtocolDefinition());
  return payload;
}

async function createSyntheticSessions({ seed = DEFAULT_SEED, participantCount = 20 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) reject('invalid_seed');
  if (!Number.isInteger(participantCount) || participantCount < 16 || participantCount > 24) reject('participant_count_16_to_24_required');
  const { createSeededRng, createPresentationPlan, createPresentationRecord } = await import('../../participant-web/js/session-runtime/presentation-plan.mjs');
  const { PhysiologyIntervals } = await import('../../participant-web/js/session-runtime/physiology-intervals.mjs');
  const protocolDefinition = createProtocolDefinition();
  const sessions = [];
  for (let person = 0; person < participantCount; person++) for (let visit = 1; visit <= 2; visit++) {
    const rng = createSeededRng((seed + person * 1009 + visit * 97) >>> 0);
    const participantId = `SYN_${person % 2 ? 'B' : 'A'}_${NAMES[person]}`;
    const sessionId = `lab-${seed}-${person + 1}-visit-${visit}`;
    const startTime = BASE_EPOCH + person * 3600000 + (visit - 1) * 7 * 86400000;
    const profile = person % 10 === 8 ? 'missing' : person % 10 === 9 ? 'low_qc' : 'complete';
    const plan = createPresentationPlan({ blocks: protocolDefinition.blocks, seed: (seed + person) >>> 0 });
    plan.historyBeforePlan = 'none';
    const intervals = new PhysiologyIntervals();
    const physiologySamples = [], cognitiveResults = [], events = [], presentations = [];
    let now = 0, sequence = 0;
    const event = (type, t, details = {}, category = 'block') => events.push({ schemaVersion: 'session_event.v1',
      eventId: `${sessionId}-event-${events.length + 1}`, sessionId, type, category, severity: 'info',
      timestamp: startTime + t, monotonicMs: t, tRelMs: t, ...details });
    const measure = (blockId, attempt, start, end, status) => {
      intervals.beginBlock({ blockId, attempt }, start);
      for (let ms = start; ms < end; ms += 100) {
        // Each block has missing, explicitly rejected, held, and fresh observations.
        const phase = (ms - start) % 10000;
        const kind = profile === 'missing' || phase < 1000 ? 'missing'
          : profile === 'low_qc' || phase < 2000 ? 'rejected' : phase < 3000 ? 'held' : 'fresh';
        const valid = kind === 'fresh';
        const sample = { bpm: kind === 'missing' ? null : 68 + person + visit,
          published: valid || kind === 'held', held: kind === 'held', bpmMethodVersion: METHOD,
          respRate: kind === 'missing' ? null : 12 + person % 6, respPublished: valid || kind === 'held',
          respHeld: kind === 'held', respConf: valid ? .9 : 0, respMethodVersion: METHOD };
        physiologySamples.push({ blockId, attempt, ms, kind, ...sample });
        intervals.record(ms, sample, 10000, 20000);
      }
      intervals.endBlock(status, end);
    };
    const runTrial = (block, entry, trialIndex, attempt, forcedRejected = false) => {
      const onset = now, presentationId = `${sessionId}-presentation-${++sequence}`;
      const isNogo = entry.condition === 'nogo';
      const omission = !isNogo && trialIndex === 2;
      const error = isNogo ? trialIndex === 3 : trialIndex === 4;
      const response = omission || (isNogo && !error) ? null : error && !isNogo
        ? (entry.expectedResponse === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight') : entry.expectedResponse || 'Space';
      const rt = response === null ? null : Math.round(310 + person * 3 + rng() * 120 - (visit - 1) * 18);
      const correct = isNogo ? response === null : response !== null && response === entry.expectedResponse;
      const qualityValid = !forcedRejected && (profile !== 'low_qc' || trialIndex % 3 === 0);
      const issueCodes = qualityValid ? [] : ['fps_low'];
      const actual = createPresentationRecord(plan, { blockId: block.id, planItemId: entry.planItemId,
        presentationId, sequence, attempt, epochMs: startTime + onset, perfMs: onset,
        timeOriginMs: startTime, sessionStartEpochMs: startTime });
      const drift = sequence % 7 === 0 ? 16 : 0;
      Object.assign(actual, { status: 'completed', qualityValid, stimulusOnEpochMs: startTime + onset,
        stimulusOnPerfMs: onset, stimulusOffEpochMs: startTime + onset + 2000 + drift,
        stimulusOffPerfMs: onset + 2000 + drift, effectiveStimulusDurationMs: 2000 + drift, actualItiMs: 1000,
        deviations: [...(drift ? ['synthetic_scheduler_delay'] : []), ...(forcedRejected ? ['synthetic_quality_rejected'] : [])] });
      plan.actual.push(actual);
      const common = { blockId: block.id, trialId: entry.trialId, presentationId, stimulusId: entry.stimulusId,
        trialIndex, attempt, condition: entry.condition, expectedResponse: entry.expectedResponse,
        task_id: block.taskType, response_mode: 'keypress' };
      event('stimulus_on', onset, { ...common, timeoutMs: 2000, is_go: block.id === 'nogo' ? !isNogo : null });
      if (response !== null) event('response', onset + rt, { ...common, key: response, responded: true, rtMs: rt }, 'input');
      event('trial_end', onset + 2000 + drift, { ...common, rtMs: rt, correct, qualityValid, qualityIssueCodes: issueCodes });
      cognitiveResults.push({ blockId: block.id, block: block.id, trialId: entry.trialId, presentationId,
        stimulusId: entry.stimulusId, stimulusType: entry.condition, task_id: block.taskType,
        presentationIndex: sequence, sourceTrialIndex: trialIndex, attempt, onsetMs: onset,
        timestamp: startTime + onset + 2000 + drift, decisionTimestampMs: startTime + onset + (rt ?? 2000 + drift),
        condition: entry.condition, expectedResponse: entry.expectedResponse, responseMode: 'keypress', inputType: 'keyboard',
        response, rt, correct, qualityValid, qualityIssueCodes: issueCodes });
      const valid = profile === 'missing' || !qualityValid ? 0 : profile === 'low_qc' ? 6 : 54;
      const confidence = profile === 'missing' ? null : profile === 'low_qc' ? .25 : .92;
      const fixationPoints = !valid ? [] : profile === 'low_qc'
        ? [{ x: .5, y: .5, startMs: 100, durationMs: 150, signalConfidence: confidence }]
        : block.id === 'conditional'
        ? [.2, .5, .8].map((x, index) => ({ x, y: .5, startMs: 100 + index * 600, durationMs: 500, signalConfidence: confidence }))
        : [{ x: rounded(.42 + rng() * .16), y: rounded(.4 + rng() * .2), startMs: 100, durationMs: 600, signalConfidence: confidence }];
      const preview = standard.standardStimulusPreview(entry.stimulusId);
      presentations.push({ blockId: block.id, trialId: entry.trialId, presentationId, stimulusId: entry.stimulusId,
        attempt, presentationStartMs: onset, stimulusName: `SYNTHETIC ${entry.stimulusId}`,
        stimulusType: standard.resolveStandardStimulus(entry.stimulusId).type, stimulusVersion: '1',
        intrinsicWidth: preview.width, intrinsicHeight: preview.height,
        grid: { width: 2, height: 2, values: valid ? [1, 1, 1, 1] : [0, 0, 0, 0] },
        fixationPoints, fixationCountTotal: fixationPoints.length,
        sampleCountTotal: profile === 'missing' ? 0 : 60, sampleCountValid: valid,
        lowConfidenceCount: profile === 'missing' ? 0 : 60 - valid, offScreenCount: 0, outsideStimulusCount: 0,
        validObservationDurationMs: valid ? (profile === 'low_qc' ? 200 : 1800) : 0, meanConfidence: confidence });
      now += 3000 + drift;
    };
    for (const [blockIndex, block] of protocolDefinition.blocks.entries()) {
      event('block_start', now, { blockId: block.id, blockIndex, blockType: block.type, attempt: 1 });
      const planned = plan.blocks.find(item => item.blockId === block.id);
      if (planned) {
        let attempt = 1;
        if (block.id === 'main' && person % 4 === 0) {
          const start = now;
          runTrial(block, planned.entries[0], 0, 1, true);
          measure(block.id, 1, start, now, 'repeat_required');
          event('block_end', now, { blockId: block.id, attempt: 1, status: 'repeat_required' });
          event('block_start', now, { blockId: block.id, blockIndex, blockType: block.type, attempt: 2 });
          attempt = 2;
        }
        const start = now;
        planned.entries.forEach((entry, i) => runTrial(block, entry, i, attempt));
        measure(block.id, attempt, start, now, 'accepted');
      } else {
        const start = now;
        now += block.id === 'survey' ? 12000 : 30000;
        measure(block.id, 1, start, now, 'accepted');
        if (block.id === 'audio') event('audio_test_complete', now, { blockId: 'audio', rawAudioStored: false });
        if (block.id === 'survey') event('survey_response', now, { blockId: 'survey', responseVersion: 'survey_response.v1',
          responseCount: 2, durationMs: 12000, responses: [
            { questionId: 'sleepiness', responseType: 'single', value: `level_${2 + (person + visit) % 6}` },
            { questionId: 'pleasantness', responseType: 'open', value: String(rounded(-2 + rng() * 6)) },
          ] });
      }
      event('block_end', now, { blockId: block.id, blockIndex, blockType: block.type,
        attempt: block.id === 'main' && person % 4 === 0 ? 2 : 1, status: 'accepted' });
    }
    const physiologyIntervals = intervals.snapshot(now);
    const channels = key => physiologyIntervals.minutes.map(row => row[key]).filter(row => row.count);
    const summarize = key => {
      const rows = channels(key), count = rows.reduce((sum, row) => sum + row.count, 0);
      return { count, mean: count ? rounded(rows.reduce((sum, row) => sum + row.mean * row.count, 0) / count) : null };
    };
    const heart = summarize('heartRate'), respiration = summarize('respiration');
    const present = profile !== 'missing', n = present ? Math.floor(now / 100) : 0;
    const audioStart = events.find(item => item.type === 'block_start' && item.blockId === 'audio').tRelMs;
    const audioSummary = createAudioSummary(audioStart, rng, profile);
    const sampleCountTotal = presentations.reduce((sum, p) => sum + p.sampleCountTotal, 0);
    const sampleCountValid = presentations.reduce((sum, p) => sum + p.sampleCountValid, 0);
    const confidenceSum = presentations.reduce((sum, p) => sum + (p.meanConfidence ?? 0) * p.sampleCountValid, 0);
    const sourceData = { ids: { session: sessionId, participant: participantId, participantAlias: participantId }, startTime,
      // Simulated device categories, never observations of actual hardware.
      user: { interfaceLanguage: 'ru' }, tech: { deviceClass: 'desktop_webcam', browser: { family: ['chrome', 'firefox', 'safari'][person % 3] },
        measuredFPS: present ? profile === 'low_qc' ? 8 : 30 : null, cameraFPS: present ? 30 : null },
      experimentMeta: { source: METHOD, title: LAB_NAME, protocolName: LAB_NAME, version: 'v2.0',
        blockCount: protocolDefinition.blocks.length, presentationSequence: sequence, presentationPlan: plan,
        audioTests: [{ blockId: 'audio', testType: 'free_speech', startedAt: startTime + audioStart,
          endedAt: startTime + audioStart + 30000, durationMs: 30000, summary: audioSummary }] },
      cognitiveResults, events, physiologyIntervals, heatmaps: { perStimulus: presentations,
        accumulation: { method: METHOD, summary: { sampleCountTotal, sampleCountValid,
          lowConfidenceCount: sampleCountTotal - sampleCountValid, offScreenCount: 0,
          confidenceSum, confidenceCount: sampleCountValid, firstT: 0, lastT: present ? now : 0 } } },
      qcSummary: { durationMs: now, totalFrames: n, qcScore: present ? profile === 'low_qc' ? 18 : 94 : null,
        validity: profile === 'complete' ? 'valid' : 'invalid', failReasons: profile === 'complete' ? [] : ['synthetic_signal_unavailable'],
        faceVisiblePct: present ? profile === 'low_qc' ? 30 : 98 : null, gazeTotal: presentations.reduce((sum, p) => sum + p.sampleCountTotal, 0),
        gazeValidPct: present ? profile === 'low_qc' ? 10 : 90 : null, analysisFps: present ? profile === 'low_qc' ? 8 : 30 : null,
        illuminationOkPct: present ? profile === 'low_qc' ? 35 : 98 : null },
      attentionMetrics: { sampleCounts: { eyeSignals: n }, global: { eyeDurationMs: present ? now : 0 } },
      blinkSummary: present ? { algorithmVersion: METHOD, blinkCount: 38 + person, blinkRatePerMin: rounded((38 + person) * 60000 / now),
        meanDurationMs: 170 + person, incompleteBlinkRate: .12, incompleteAmplitudeThreshold: .65,
        durationMs: stats([100, 140, 180, 200, 230]), amplitude: stats([.6, .8, .9, 1]),
        closureSpeed: stats([2.1, 2.4, 2.8]), openingSpeed: stats([1.6, 1.8, 2.2]), closureEventsCount: 38 + person } : null,
      perclosSummary: present ? { windows: { '60s': { meanPct: 4 + person % 5 } } } : null,
      bodyPoseSummary: { version: METHOD, source: 'synthetic_no_capture', coordinateSpace: 'torso_normalized', enabled: present,
        sampleCount: n, validSampleCount: present ? profile === 'low_qc' ? 0 : n - 20 : 0,
        oodSampleCount: profile === 'low_qc' ? n : present ? 10 : 0, occludedSampleCount: present && profile !== 'low_qc' ? 10 : 0,
        retainedSampleCount: Math.min(300, n), retainedValidSampleCount: present && profile !== 'low_qc' ? 280 : 0,
        durationMs: now, confidenceMean: present ? profile === 'low_qc' ? .1 : .93 : null,
        movementVelocityMean: present ? rounded(.03 + rng() * .05) : null, movementVelocityP95: present ? .14 : null,
        movementVelocityP95Scope: 'retained_samples', movementBurstCount: present ? 3 : 0,
        torsoLeanAbsMeanDeg: present ? 3 : null, shoulderRollAbsMeanDeg: present ? 2 : null,
        shoulderRollSampleCount: present && profile !== 'low_qc' ? n - 20 : 0,
        shoulderRollLegacySampleCount: 0, shoulderRollMethod: METHOD },
      emotionAccumulator: present ? { n, valenceSum: n * .15, arousalSum: n * .35 } : { n: 0, valenceSum: 0, arousalSum: 0 },
      emotionSummary: { algorithmVersion: METHOD, quality: present ? profile === 'low_qc' ? .1 : .9 : null,
        confidence: present ? profile === 'low_qc' ? .1 : .9 : null },
      bpmSummary: { bpmMean: heart.mean, sampleCount: heart.count, validSampleCount: heart.count, methodVersion: METHOD },
      respirationSummary: { resp_rate_mean: respiration.mean, resp_sample_count: respiration.count,
        resp_available: respiration.count > 0, methodVersion: METHOD }, audioSummary,
      lifecycle: { schemaVersion: 'session_lifecycle.v1', state: 'completed', status: 'completed', startedAt: startTime,
        completedAt: startTime + now, finishAttemptId: `${sessionId}-finish` } };
    sessions.push({ sessionId, participantId, participantName: NAMES[person], group: person % 2 ? 'B' : 'A', visit, profile,
      sourceData, observations: { physiologySamples }, payload: await buildIngestPayload(sourceData) });
  }
  return sessions;
}

function dashboardSelection(projectId, protocolId, publicationVersion, sessionDbId, sessions) {
  const protocolVersion = `publication:${publicationVersion}`;
  const query = { schemaVersion: '1.0', mode: 'group', analysisLevel: 'level_1', projectId, protocolId, protocolVersion,
    metricIds: ['task.rt_median_ms', 'task.accuracy_pct', 'physiology.bpm_mean', 'physiology.respiration_mean'],
    filters: { participantIds: [], sessionIds: [], groupIds: [], conditionIds: [], blockIds: [], stimulusIds: [], aoiIds: [],
      qcMode: 'all', qcChannels: [], minValidFraction: null, minSignalConfidence: null,
      dateFrom: null, dateTo: null, deviceClasses: [], includeIncompleteSessions: false } };
  return { query, route: '/apps/web/researcher.html#/analytics/group-comparison',
    // Current dashboard reads storage, not project/protocol URL query parameters.
    requiresLandingIntegration: true,
    localStorage: { emocog_selected_project_id: String(projectId), emocog_selected_protocol_id: String(protocolId),
      emocog_selected_session_db_id: String(sessionDbId),
      emocog_analytics_query_draft_v1: JSON.stringify({ mode: 'group', protocolVersion, qcMode: 'all', qcChannels: ['task'],
        minValidFraction: '', minSignalConfidence: '' }) },
    groups: Object.fromEntries(['A', 'B'].map(group => [group, [...new Set(sessions.filter(row => row.group === group).map(row => row.participantId))]])) };
}

async function apiResponse(apiBase, route, { body, token, headers = {}, expected = [200, 201], timeoutMs = 30000 } = {}) {
  const base = localHttp(apiBase);
  if (!route.startsWith('/') || route.startsWith('//')) reject('invalid_api_route');
  const target = new URL(route, base);
  if (target.origin !== base.origin) reject('invalid_api_route');
  const response = await fetch(target, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs), headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  // Never echo response bodies, URL codes, auth headers, DB errors or credentials.
  if (!expected.includes(response.status)) reject(`http_${response.status}`);
  return response;
}

async function apiRequest(apiBase, route, options) {
  const response = await apiResponse(apiBase, route, options);
  return response.status === 204 ? null : response.json();
}

async function awaitApi(apiBase) {
  for (let attempt = 0; attempt < 60; attempt++) {
    let health;
    try { health = await apiRequest(apiBase, '/health', { timeoutMs: 1000, expected: [200] }); } catch {
      await new Promise(resolve => setTimeout(resolve, 1000)); continue;
    }
    if (health.node_env !== 'test') reject('api_must_report_test_environment');
    try { await apiRequest(apiBase, '/ready', { expected: [200], timeoutMs: 1000 }); } catch {
      await new Promise(resolve => setTimeout(resolve, 1000)); continue;
    }
    return;
  }
  reject('api_start_timeout');
}

async function main(env = process.env) {
  const config = assertSafetyGuards(env);
  const sessions = await createSyntheticSessions({ seed: config.seed });
  const file = await openPrivateFixture(config.fixturePath);
  const fixture = { schemaVersion: 'analytics_lab_fixture.v1', synthetic: true, scientificInterpretation: DISCLAIMER,
    seed: config.seed, name: LAB_NAME, status: 'preparing', stage: 'api_readiness', apiBase: config.apiBase, users: {}, sessions: [],
    surveySemantics: { sleepiness: { kind: 'ordinal', wireType: 'single', values: 'level_1..level_9', numericMeanAllowed: false },
      pleasantness: { kind: 'numeric', wireType: 'open', wireValue: 'decimal string', unit: 'synthetic_index', range: [-5, 5] } },
    stimulusManifest: createStimulusManifest(),
    conditionalTargetMap: Object.fromEntries(createProtocolDefinition().blocks.find(block => block.id === 'conditional').trials
      .map(trial => [trial.stimulusId, { expectedResponse: trial.correctResponse, aoiId: 'synthetic-zone-2' }])) };
  let client;
  try {
    await writeFixture(file, fixture);
    await awaitApi(config.apiBase);
    fixture.stage = 'bootstrap_accounts';
    const { Client } = require('pg');
    const bcrypt = require('bcryptjs');
    client = new Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000,
      statement_timeout: 10000, application_name: 'analytics-lab-isolated-seeder' });
    await client.connect();
    const actual = (await client.query('SELECT current_database() AS name')).rows[0];
    if (actual.name !== config.databaseName) reject('database_identity_mismatch');
    await client.query('BEGIN');
    const namespace = randomUUID();
    fixture.namespace = namespace;
    for (const kind of ['researcher', 'otherResearcher']) {
      const name = kind === 'researcher' ? LAB_NAME : `${LAB_NAME} (privacy negative)`;
      const slug = `analytics-lab-${kind.toLowerCase()}-${namespace}`;
      const orgId = (await client.query('INSERT INTO organizations(name,slug) VALUES ($1,$2) RETURNING id', [name, slug])).rows[0].id;
      const projectId = (await client.query('INSERT INTO projects(organization_id,name,slug) VALUES ($1,$2,$3) RETURNING id', [orgId, name, slug])).rows[0].id;
      const email = `lab-${kind === 'researcher' ? 'researcher' : 'other'}-${namespace}@example.test`;
      const password = randomBytes(32).toString('base64url');
      const id = (await client.query("INSERT INTO users(email,password_hash,role,display_name) VALUES ($1,$2,'researcher',$3) RETURNING id",
        [email, await bcrypt.hash(password, 10), `SYNTHETIC ${kind}`])).rows[0].id;
      await client.query('INSERT INTO user_organizations(user_id,organization_id) VALUES ($1,$2)', [id, orgId]);
      await client.query('INSERT INTO user_projects(user_id,project_id) VALUES ($1,$2)', [id, projectId]);
      fixture.users[kind] = { id, email, password };
      Object.assign(fixture, kind === 'researcher' ? { organizationId: orgId, projectId } : { otherOrganizationId: orgId, otherProjectId: projectId });
    }
    fixture.status = 'accounts_prepared';
    // Persist recovery credentials before committing any new accounts. No deletes on failure.
    await writeFixture(file, fixture);
    await client.query('COMMIT');
    fixture.stage = 'login_and_bind_database';
    const tokens = {};
    for (const kind of ['researcher', 'otherResearcher']) {
      const { email, password, id } = fixture.users[kind];
      const login = await apiRequest(config.apiBase, '/auth/login', { body: { email, password }, expected: [200] });
      if (Number(login.user?.id) !== id || login.user?.email !== email || !login.token) reject('api_database_binding_failed');
      tokens[kind] = login.token;
    }
    for (const kind of ['researcher', 'otherResearcher']) {
      const projectId = kind === 'researcher' ? fixture.projectId : fixture.otherProjectId;
      fixture.stage = 'create_protocol';
      const protocol = await apiRequest(config.apiBase, '/protocols', { token: tokens[kind], expected: [201],
        body: { project_id: projectId, name: kind === 'researcher' ? LAB_NAME : `${LAB_NAME} (privacy negative)`,
          definition: createProtocolDefinition(), save_mode: 'publish' } });
      fixture.stage = 'publish_invitation';
      const invitation = await apiRequest(config.apiBase, '/invitations', { token: tokens[kind], expected: [201],
        body: { protocol_id: protocol.id, max_runs: sessions.length + 1, expected_updated_at: protocol.updated_at } });
      if (!Number.isSafeInteger(invitation.publication_version) || invitation.publication_version !== 1 || !invitation.code) reject('publication_not_created');
      const binding = { projectId, protocolId: protocol.id, invitationId: invitation.id,
        invitationCode: invitation.code, publicationVersion: invitation.publication_version };
      Object.assign(fixture, kind === 'researcher' ? binding : { otherProtocolId: protocol.id, otherInvitationId: invitation.id });
      // Capture the actual pinned snapshot, not a fabricated published definition.
      const stored = (await client.query('SELECT protocol_definition, publication_version FROM invitations WHERE id=$1 AND protocol_id=$2',
        [invitation.id, protocol.id])).rows[0];
      if (stored?.publication_version !== binding.publicationVersion || !stored.protocol_definition?.blocks?.length) reject('api_database_binding_failed');
      if (kind === 'researcher') fixture.publishedDefinition = stored.protocol_definition;
      fixture.status = 'seeding_sessions';
      fixture.stage = 'admission_and_ingest';
      await writeFixture(file, fixture);
      const records = kind === 'researcher' ? sessions : [sessions[0]];
      for (const record of records) {
        const sessionId = `lab-${namespace}-${kind === 'researcher' ? '' : 'x-'}${records.indexOf(record) + 1}`;
        const payload = await buildIngestPayload(record.sourceData, { ...binding, sessionId });
        assertPublishedSurveyResponses(payload.events, stored.protocol_definition);
        const admission = await apiRequest(config.apiBase, `/invitations/by-code/${encodeURIComponent(invitation.code)}/ingest-token`,
          { body: { session_id: sessionId, consent_receipt: { informedConsentVersion: 'informed-consent-v1.0', privacyPolicyVersion: 'privacy-policy-v1.0' } }, expected: [200] });
        if (!admission.admitted || admission.session_created !== true || admission.session_id !== sessionId || !admission.token) reject('new_admission_not_confirmed');
        // Admission uses server wall time. Rebase only this newly admitted, bound lab row
        // to the fixed synthetic epoch so stored started_at <= stopped_at is reproducible.
        const started = await client.query(`UPDATE sessions SET started_at=$1 WHERE session_id=$2
          AND invitation_id=$3 AND project_id=$4 AND protocol_id=$5 AND stopped_at IS NULL RETURNING id`,
        [new Date(record.sourceData.startTime), sessionId, invitation.id, projectId, protocol.id]);
        if (started.rowCount !== 1) reject('admitted_binding_mismatch');
        await apiRequest(config.apiBase, '/ingest', { token: admission.token, body: payload,
          headers: { 'Idempotency-Key': payload.lifecycle.finishAttemptId } });
        const persisted = (await client.query(`SELECT s.id, s.project_id, s.protocol_id, s.invitation_id, s.stopped_at,
          i.publication_version, f.payload FROM sessions s JOIN invitations i ON i.id=s.invitation_id
          JOIN session_features f ON f.session_id=s.id WHERE s.session_id=$1`, [sessionId])).rows[0];
        if (!persisted?.stopped_at || persisted.project_id !== projectId || persisted.protocol_id !== protocol.id
          || persisted.invitation_id !== invitation.id || persisted.publication_version !== binding.publicationVersion
          || persisted.payload.experimentMeta?.publicationVersion !== binding.publicationVersion) reject('persisted_binding_mismatch');
        const result = { ...record, sessionId, sessionDbId: persisted.id, projectId, protocolId: protocol.id,
          invitationId: invitation.id, publicationVersion: binding.publicationVersion,
          // Both original observations and the submitted packet are retained, never overwritten by derived metrics.
          payload };
        if (kind === 'researcher') fixture.sessions.push(result);
        else fixture.otherSession = result;
      }
    }
    fixture.dashboard = dashboardSelection(fixture.projectId, fixture.protocolId, fixture.publicationVersion, fixture.sessions[0].sessionDbId, fixture.sessions);
    fixture.query = fixture.dashboard.query;
    let verification;
    if (env.ANALYTICS_LAB_VERIFY === 'YES') {
      fixture.stage = 'verify_analytics';
      const { verifyAnalyticsLab } = require('./verify-analytics-lab');
      verification = await verifyAnalyticsLab(fixture, (route, body, token, status = 200) =>
        apiResponse(config.apiBase, route, { body, token, expected: [status] }), tokens);
    }
    fixture.status = 'complete';
    fixture.stage = 'complete';
    await writeFixture(file, fixture);
    return verification ? { ...fixture, verification } : fixture;
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    fixture.status = 'failed';
    fixture.failure = /^analytics_lab_http_\d{3}$/.test(error.message) ? error.message : 'analytics_lab_seed_failed';
    await writeFixture(file, fixture).catch(() => {});
    throw error;
  } finally {
    if (client) await client.end().catch(() => {});
    await file.close();
  }
}

module.exports = { LAB_NAME, DEFAULT_SEED, assertSafetyGuards, createProtocolDefinition, createStimulusManifest, createSyntheticSessions,
  buildIngestPayload, dashboardSelection, apiRequest, openPrivateFixture, writeFixture, main };

if (require.main === module) main().then(fixture => {
  process.stdout.write(`Seeded ${fixture.sessions.length} synthetic lab sessions and one foreign-tenant session. Credentials only in ANALYTICS_LAB_FIXTURE.\n`);
  if (fixture.verification) process.stdout.write(`Verified ${fixture.verification.exercisedSummaries} synthetic analytics summaries, export and access isolation.\n`);
}).catch(() => {
  process.stderr.write('Analytics lab seed failed closed. Check isolation flags, explicit API base, fixture permissions, test migrations and API readiness. No existing rows were deleted.\n');
  process.exitCode = 1;
});
