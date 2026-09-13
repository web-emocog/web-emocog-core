const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAnalyticsQuery } = require('../analytics/query');
const {
  buildAoiRows,
  buildExportBundle,
  buildGroupSummary,
  buildHeatmapData,
  buildSessionMetrics,
  channelQc,
} = require('../analytics/metrics');
const {
  exportCsv,
  protectSpreadsheetCell,
  sessionAudioDetails,
  sessionQualityDetails,
  sessionTechnicalDetails,
} = require('../analytics/v1-router');

function query(overrides = {}) {
  return {
    schemaVersion: '1.0',
    mode: 'session',
    analysisLevel: 'level_1',
    projectId: 1,
    protocolId: 2,
    protocolVersion: '1.0',
    metricIds: [
      'aoi.dwell_time_ms', 'aoi.fixation_count', 'aoi.ttff_ms',
      'aoi.revisit_count', 'aoi.target_reached_pct',
      'task.accuracy_pct', 'qc.valid_gaze_pct', 'viz.heatmap',
    ],
    filters: {
      participantIds: [], sessionIds: ['session-1'], groupIds: [], conditionIds: [],
      blockIds: ['block-1'], stimulusIds: ['10'], aoiIds: [],
      qcMode: 'valid_and_borderline', qcChannels: ['task', 'gaze'],
      minValidFraction: 0.6, minSignalConfidence: 0.5,
      dateFrom: null, dateTo: null, deviceClasses: [], includeIncompleteSessions: false,
    },
    ...overrides,
  };
}

function row() {
  const presentation = (id, x, startMs) => ({
    blockId: 'block-1', trialId: id, stimulusId: '10', presentationId: id,
    stimulusName: 'Cat', stimulusType: 'image', stimulusVersion: '1',
    intrinsicWidth: 800, intrinsicHeight: 600,
    grid: { width: 2, height: 2, values: [1, 0, 0, 2] },
    fixationPoints: [{ x, y: x, startMs, durationMs: 200, signalConfidence: 0.9 }],
    validObservationDurationMs: 1000,
    meanConfidence: 0.9,
  });
  return {
    id: 7,
    session_id: 'session-1',
    participant_id: 'participant-1',
    protocol_id: 2,
    started_at: '2026-08-01T10:00:00.000Z',
    stopped_at: '2026-08-01T10:01:00.000Z',
    qc_validity: 'valid',
    features_payload: {
      cognitiveResults: [
        { blockId: 'block-1', stimulusId: '10', response: 'Space', correct: true, rt: 400, qualityValid: true },
        { blockId: 'block-1', stimulusId: '10', response: null, correct: false, rt: null, qualityValid: true },
      ],
      gaze_analytics: {
        schemaVersion: 'gaze_analytics.v1',
        summary: {
          sampleCountTotal: 100, sampleCountValid: 80, validFraction: 0.8,
          lowConfidenceCount: 5, offScreenCount: 10, outsideStimulusCount: 5,
          observationDurationMs: 2000, meanConfidence: 0.9,
        },
        presentations: [presentation('presentation-1', 0.25, 100), presentation('presentation-2', 0.75, 150)],
      },
    },
  };
}

const protocol = {
  definition: {
    blocks: [{
      id: 'block-1',
      blockConfig: {
        aoiDefinitions: {
          10: [{
            id: 'target-left', name: 'Left target', shape: 'rectangle',
            points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }],
            order: 1, isTarget: true, validityInterval: { startMs: 0, endMs: 1000 },
          }],
        },
      },
    }],
  },
};

test('analytics v1 contract and computations', async t => {
  await t.test('rejects unknown fields and invalid session selection', () => {
    const invalid = query({ unexpected: true, filters: { ...query().filters, sessionIds: [] } });
    const result = validateAnalyticsQuery(invalid);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes('unknown query fields')));
    assert.ok(result.errors.some(error => error.includes('exactly one')));
  });

  await t.test('distinguishes zero from no data and computes real task/QC values', () => {
    const metrics = buildSessionMetrics(row(), query());
    assert.equal(metrics.find(metric => metric.metricId === 'task.accuracy_pct').value, 50);
    assert.equal(metrics.find(metric => metric.metricId === 'qc.valid_gaze_pct').value, 80);
    const empty = row();
    empty.features_payload.gaze_analytics.summary.sampleCountTotal = 0;
    empty.features_payload.gaze_analytics.summary.sampleCountValid = 0;
    const noData = buildSessionMetrics(empty, query())
      .find(metric => metric.metricId === 'qc.valid_gaze_pct');
    assert.equal(noData.value, null);
    assert.equal(noData.status, 'no_data');
  });

  await t.test('keeps task QC independent from gaze-only session failures', () => {
    const source = row();
    source.qc_validity = 'invalid';
    source.features_payload.cognitiveResults = Array.from({ length: 100 }, (_, index) => ({
      qualityValid: index < 99,
      correct: index < 95,
    }));
    source.features_payload.gaze_analytics.summary.validFraction = 0.65;
    assert.equal(channelQc(source, 'task').status, 'valid');
    assert.equal(channelQc(source, 'task').validFraction, 0.99);
    assert.equal(channelQc(source, 'gaze').status, 'borderline');
  });

  await t.test('aggregates repeated presentations with presentation-relative AOI timing', () => {
    const rows = buildAoiRows(row(), protocol, query());
    assert.equal(rows.length, 1);
    const dwell = rows[0].metrics.find(metric => metric.metricId === 'aoi.dwell_time_ms');
    const reached = rows[0].metrics.find(metric => metric.metricId === 'aoi.target_reached_pct');
    assert.equal(dwell.value, 200);
    assert.equal(reached.value, 50);
    const heatmap = buildHeatmapData(row(), query());
    assert.equal(heatmap.nFixations, 2);
    assert.equal(heatmap.validObservationDurationMs, 2000);
    assert.deepEqual(heatmap.grid.values, [0.5, 0, 0, 1]);
  });

  await t.test('builds participant-equal AOI group metrics with QC and device composition', () => {
    const first = row();
    first.features_payload.meta = { tech: { deviceClass: 'desktop_webcam' } };
    const second = row();
    second.id = 8;
    second.session_id = 'session-2';
    second.participant_id = 'participant-2';
    second.features_payload.meta = { tech: { deviceClass: 'laptop_webcam' } };
    second.features_payload.gaze_analytics.presentations[0].fixationPoints[0].durationMs = 400;
    const groupQuery = query({
      mode: 'group',
      filters: { ...query().filters, sessionIds: [] },
    });
    const group = buildGroupSummary(
      [first, second],
      groupQuery,
      protocol,
      [{ sessionId: 9, reasonCode: 'gaze_qc_invalid', channel: 'gaze' }]
    );
    const dwell = group.metrics.find(metric => (
      metric.metricId === 'aoi.dwell_time_ms' && metric.scope?.aoiId === 'target-left'
    ));
    assert.equal(dwell.status, 'computed');
    assert.equal(dwell.median, 300);
    assert.equal(dwell.nParticipants, 2);
    assert.equal(dwell.nObservations, 4);
    assert.equal(dwell.participantValues[0].nObservations, 2);
    assert.equal(dwell.estimateCi95.method, 'normal_approximation_participant_means');
    assert.deepEqual(group.qcCounts, { valid: 2, borderline: 0, invalid: 0, notComputed: 0 });
    assert.equal(group.qcByChannel.find(item => item.channel === 'gaze').valid, 2);
    assert.equal(group.deviceCounts.length, 2);
    assert.ok(group.missingness.some(item => item.reasonCode === 'gaze_qc_invalid'));
  });

  await t.test('normalizes nested participant technical and QC data for researcher analytics', () => {
    const source = row();
    source.qc_score = 76.9;
    source.qc_validity = 'borderline';
    source.fail_reasons = ['low_pose_ok_pct', 'low_fps_time'];
    source.qc_payload = {
      analysisFps: 16,
      durationMs: 519843,
      passedChecks: 10,
      totalChecks: 13,
      faceVisiblePct: 98.9,
      gazeValidPct: 82.7,
      checks: { faceVisible: true, poseOk: false },
    };
    source.features_payload.meta = {
      tech: {
        screen: { width: 1512, height: 982, pixelRatio: 2 },
        camera: { width: 640, height: 480, frameRate: 30 },
        browser: { family: 'safari', language: 'ru', mobile: false, coresBucket: '5-8' },
        measuredFPS: 34,
        cameraFPS: 31,
      },
    };
    source.features_payload.experimentMeta = {
      protocolTimers: [{
        id: 'session_total',
        name: 'Total session time',
        startedAt: 1000,
        finishedAt: 61000,
        durationMs: 60000,
      }],
    };
    assert.deepEqual(sessionTechnicalDetails(source), {
      deviceClass: 'computer_webcam',
      resolution: { width: 1512, height: 982 },
      cameraResolution: { width: 640, height: 480 },
      actualFps: 34,
      cameraFps: 31,
      analysisFps: 16,
      browserFamily: 'safari',
      browserLanguage: 'ru',
      pixelRatio: 2,
      processorClass: '5-8',
      protocolTimers: [{
        id: 'session_total',
        name: 'Total session time',
        startedAt: 1000,
        finishedAt: 61000,
        durationMs: 60000,
      }],
    });
    const quality = sessionQualityDetails(source);
    assert.equal(quality.status, 'borderline');
    assert.equal(quality.score, 76.9);
    assert.deepEqual(quality.failReasons, ['low_pose_ok_pct', 'low_fps_time']);
    assert.equal(quality.percentages.faceVisible, 98.9);
    assert.equal(quality.percentages.gazeValid, 82.7);
  });

  await t.test('exposes audio test summaries without raw voice data', () => {
    const source = row();
    source.features_payload.audio_summary = {
      schemaVersion: 'audio_session.v1',
      status: 'completed',
      enabled: true,
      consentGranted: true,
      permission: 'granted',
      windowCount: 3,
      acceptedWindowCount: 2,
      rejectedWindowCount: 1,
      durationMs: 30000,
      qualityMean: 0.82,
      reliabilityMean: 0.76,
      algorithmVersion: 'open_vocal_biomarkers.1.0.0',
      rawAudioStored: false,
      rawAudioTransmitted: false,
      windows: [{ pcmSamples: [0.1, 0.2] }],
    };
    source.features_payload.experimentMeta = {
      audioTests: [{
        schemaVersion: 'audio_task.v1',
        blockId: 'audio-reading',
        title: 'Phrase reading',
        testType: 'reading',
        status: 'completed',
        durationMs: 12000,
        audioAvailable: true,
        windowCount: 1,
        acceptedWindowCount: 1,
        rejectedWindowCount: 0,
        metrics: {
          recordingQuality: 0.8,
          featureReliability: 0.75,
          speechCoverage: 0.7,
          completionScore: 0.75,
          pauseRate: 0.2,
        },
        completedAt: 12345,
      }],
    };
    const audio = sessionAudioDetails(source);
    assert.equal(audio.status, 'completed');
    assert.equal(audio.acceptedWindowCount, 2);
    assert.equal(audio.tests[0].blockId, 'audio-reading');
    assert.equal(audio.tests[0].status, 'completed');
    assert.equal(audio.tests[0].metrics.completionScore, 0.75);
    assert.equal(audio.tests[0].rawAudioStored, false);
    assert.equal(audio.rawAudioStored, false);
    assert.equal(audio.rawAudioTransmitted, false);
    assert.equal(Object.hasOwn(audio, 'windows'), false);
  });

  await t.test('shows protocol audio tasks when an older session has no audio result', () => {
    const audio = sessionAudioDetails(row(), {
      blocks: [{
        id: 'pa-ta-ka',
        type: 'audio_test',
        label: 'Па-та-ка',
        content: { testType: 'oral_ddk', durationMs: 15000 },
      }],
    });
    assert.equal(audio.status, 'not_recorded');
    assert.equal(audio.enabled, true);
    assert.equal(audio.tests.length, 1);
    assert.equal(audio.tests[0].blockId, 'pa-ta-ka');
    assert.equal(audio.tests[0].testType, 'oral_ddk');
    assert.equal(audio.tests[0].durationMs, 15000);
  });

  await t.test('honors summary and long export content without changing the snapshot', () => {
    const snapshot = {
      id: 'snapshot-test',
      datasetHash: 'sha256:test',
      queryEcho: query(),
      includedParticipantIds: ['participant-1'],
      includedSessionIds: [7],
      excludedSessions: [],
      versions: {
        frontend: 'researcher-web', backend: 'analytics-api-1.0.0',
        metricsCatalog: '1.0', qcRules: 'qc-rules-1.0.0',
      },
    };
    const hydrated = { snapshot, sessionRows: [row()], protocol };
    const summary = buildExportBundle(hydrated, 'summary');
    const long = buildExportBundle(hydrated, 'long');
    assert.equal(summary.kind, 'analytics_export');
    assert.equal(summary.content, 'summary');
    assert.ok(summary.summary.session);
    assert.equal(summary.longData, null);
    assert.match(exportCsv(summary), /aoi\.dwell_time_ms/);
    assert.equal(long.summary, null);
    assert.ok(long.longData.some(metric => metric.metricId === 'aoi.dwell_time_ms'));
    assert.ok(long.dataDictionary.every(item => Object.hasOwn(item, 'description')));
  });

  await t.test('neutralizes spreadsheet formulas in CSV exports', () => {
    assert.equal(protectSpreadsheetCell('=HYPERLINK("https://bad")'), "'=HYPERLINK(\"https://bad\")");
    assert.equal(protectSpreadsheetCell('normal'), 'normal');
  });

  await t.test('keeps the production comparison contract aligned with the UI', () => {
    const routerSource = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../analytics/v1-router.js'),
      'utf8'
    );
    assert.match(routerSource, /pValueAdjusted:/);
    assert.match(routerSource, /readinessChecks:/);
    assert.doesNotMatch(routerSource, /adjustedPValue:/);
    assert.doesNotMatch(routerSource, /\n\s+checks:\s*\[/);
  });
});
