const express = require('express');
const { pool } = require('../db');
const {
  OPERATIONS,
  hasProjectMembership,
  requireOperation,
} = require('../middleware/auth');
const { HttpError } = require('../security/http-error');
const { validateAnalyticsQuery } = require('./query');
const {
  collectProtocolOptions,
  createSnapshot,
  hydrateSnapshot,
  loadProtocol,
  loadSnapshot,
  protocolVersion,
} = require('./snapshots');
const {
  buildAoiRows,
  buildExportBundle,
  buildGroupHeatmap,
  buildGroupSummary,
  buildHeatmapData,
  buildSessionMetrics,
  channelQc,
} = require('./metrics');

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function responseError(res, error) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code || 'analytics_request_rejected',
    });
  }
  if (error?.code === '22P02') {
    return res.status(400).json({ error: 'Invalid identifier', code: 'analytics_invalid_id' });
  }
  console.error(error);
  return res.status(500).json({ error: 'Analytics request failed', code: 'analytics_internal_error' });
}

async function requireSnapshot(req) {
  const snapshotId = String(req.query.snapshot_id || '').trim();
  if (!UUID_PATTERN.test(snapshotId)) {
    throw new HttpError(400, 'snapshot_id must be a UUID', 'analytics_snapshot_id_invalid');
  }
  const row = await loadSnapshot(pool, snapshotId);
  if (!row) throw new HttpError(404, 'Analysis snapshot not found', 'analytics_snapshot_not_found');
  if (!(await hasProjectMembership(pool, row.project_id, req.user))) {
    throw new HttpError(404, 'Analysis snapshot not found', 'analytics_snapshot_not_found');
  }
  return hydrateSnapshot(pool, row);
}

function envelope(kind, snapshot, data) {
  return {
    contractVersion: '1.0',
    kind,
    generatedAt: new Date().toISOString(),
    snapshot,
    data,
  };
}

function selectedSession(hydrated, sessionRef) {
  const row = hydrated.sessionRows.find(session => (
    String(session.id) === String(sessionRef) || String(session.session_id) === String(sessionRef)
  ));
  if (!row) throw new HttpError(404, 'Session is not included in the snapshot', 'analytics_session_not_in_snapshot');
  return row;
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function sessionTechnicalDetails(row) {
  const payload = row?.features_payload || {};
  const tech = payload?.meta?.tech || payload?.tech || {};
  const screen = tech.screen && typeof tech.screen === 'object' ? tech.screen : {};
  const camera = tech.camera && typeof tech.camera === 'object' ? tech.camera : {};
  const browser = tech.browser && typeof tech.browser === 'object' ? tech.browser : {};
  const screenWidth = finiteNumber(tech.screenWidth, screen.width);
  const screenHeight = finiteNumber(tech.screenHeight, screen.height);
  const cameraWidth = finiteNumber(tech.cameraWidth, camera.width);
  const cameraHeight = finiteNumber(tech.cameraHeight, camera.height);
  const mobile = browser.mobile === true || tech.mobile === true;
  const protocolTimers = Array.isArray(payload?.experimentMeta?.protocolTimers)
    ? payload.experimentMeta.protocolTimers.slice(0, 20).map(timer => ({
      id: String(timer?.id || '').slice(0, 128),
      name: String(timer?.name || timer?.id || 'Timer').slice(0, 255),
      durationMs: finiteNumber(timer?.durationMs),
      startedAt: finiteNumber(timer?.startedAt),
      finishedAt: finiteNumber(timer?.finishedAt),
    }))
    : [];
  const inferredDevice = mobile
    ? 'mobile_browser'
    : (cameraWidth && cameraHeight ? 'computer_webcam' : 'desktop_browser');
  return {
    deviceClass: String(tech.deviceClass || tech.device || inferredDevice).slice(0, 64),
    resolution: screenWidth && screenHeight
      ? { width: screenWidth, height: screenHeight }
      : null,
    cameraResolution: cameraWidth && cameraHeight
      ? { width: cameraWidth, height: cameraHeight }
      : null,
    actualFps: finiteNumber(
      tech.fpsMean,
      tech.measuredFPS,
      tech.renderFPS,
      tech.cameraFPS,
      row?.qc_payload?.analysisFps,
      camera.frameRate
    ),
    cameraFps: finiteNumber(tech.cameraFPS, tech.cameraFPSDetails?.fps, camera.frameRate),
    analysisFps: finiteNumber(row?.qc_payload?.analysisFps),
    browserFamily: browser.family ? String(browser.family).slice(0, 64) : null,
    browserLanguage: browser.language ? String(browser.language).slice(0, 16) : null,
    pixelRatio: finiteNumber(tech.pixelRatio, screen.pixelRatio),
    processorClass: browser.coresBucket ? String(browser.coresBucket).slice(0, 16) : null,
    protocolTimers,
  };
}

function protocolAudioTests(definition) {
  const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
  return blocks
    .filter(block => String(block?.type || '').toLowerCase() === 'audio_test')
    .slice(0, 50)
    .map((block, index) => ({
      schemaVersion: 'audio_task.v1',
      blockId: String(block?.id || `audio_test_${index}`).slice(0, 128),
      title: String(block?.content?.taskName || block?.label || 'Audio test').slice(0, 255),
      testType: String(block?.content?.testType || 'audio_test').slice(0, 64),
      status: 'not_recorded',
      durationMs: finiteNumber(block?.content?.durationMs, block?.content?.duration),
      audioAvailable: false,
      windowCount: 0,
      acceptedWindowCount: 0,
      rejectedWindowCount: 0,
      completedAt: null,
      metrics: {},
      rawAudioStored: false,
      rawAudioTransmitted: false,
    }));
}

function sessionAudioDetails(row, protocolDefinition = null) {
  const payload = row?.features_payload || {};
  const summary = payload?.audioSummary || payload?.audio_summary;
  const recordedTests = Array.isArray(payload?.experimentMeta?.audioTests)
    ? payload.experimentMeta.audioTests.slice(0, 50).map(test => ({
      schemaVersion: String(test?.schemaVersion || 'audio_task.v1').slice(0, 64),
      blockId: String(test?.blockId || '').slice(0, 128),
      title: String(test?.title || '').slice(0, 255),
      testType: String(test?.testType || 'audio_test').slice(0, 64),
      status: String(test?.status || 'not_computed').slice(0, 64),
      durationMs: finiteNumber(test?.durationMs),
      audioAvailable: test?.audioAvailable === true,
      windowCount: finiteNumber(test?.windowCount),
      acceptedWindowCount: finiteNumber(test?.acceptedWindowCount),
      rejectedWindowCount: finiteNumber(test?.rejectedWindowCount),
      completedAt: finiteNumber(test?.completedAt),
      metrics: {
        recordingQuality: finiteNumber(test?.metrics?.recordingQuality),
        featureReliability: finiteNumber(test?.metrics?.featureReliability),
        speechCoverage: finiteNumber(test?.metrics?.speechCoverage),
        completionScore: finiteNumber(test?.metrics?.completionScore),
        rmsMean: finiteNumber(test?.metrics?.rmsMean),
        clippingRatioMean: finiteNumber(test?.metrics?.clippingRatioMean),
        pitchMeanHz: finiteNumber(test?.metrics?.pitchMeanHz),
        pitchStdHz: finiteNumber(test?.metrics?.pitchStdHz),
        pitchVariability: finiteNumber(test?.metrics?.pitchVariability),
        jitterLocal: finiteNumber(test?.metrics?.jitterLocal),
        shimmerLocal: finiteNumber(test?.metrics?.shimmerLocal),
        hnrDb: finiteNumber(test?.metrics?.hnrDb),
        pauseRate: finiteNumber(test?.metrics?.pauseRate),
        averagePauseDuration: finiteNumber(test?.metrics?.averagePauseDuration),
        meanUtteranceDuration: finiteNumber(test?.metrics?.meanUtteranceDuration),
      },
      rawAudioStored: false,
      rawAudioTransmitted: false,
    }))
    : [];
  const recordedIds = new Set(recordedTests.map(test => test.blockId).filter(Boolean));
  const tests = [
    ...recordedTests,
    ...protocolAudioTests(protocolDefinition).filter(test => !recordedIds.has(test.blockId)),
  ].slice(0, 50);
  if ((!summary || typeof summary !== 'object') && tests.length === 0) return null;
  return {
    status: String(summary?.status || (recordedTests.length ? 'completed' : 'not_recorded')).slice(0, 64),
    enabled: summary?.enabled === true || tests.length > 0,
    consentGranted: summary?.consentGranted === true,
    permission: String(summary?.permission || 'not_requested').slice(0, 64),
    rawAudioStored: false,
    rawAudioTransmitted: false,
    windowCount: finiteNumber(summary?.windowCount),
    acceptedWindowCount: finiteNumber(summary?.acceptedWindowCount),
    rejectedWindowCount: finiteNumber(summary?.rejectedWindowCount),
    droppedWindowCount: finiteNumber(summary?.droppedWindowCount),
    durationMs: finiteNumber(summary?.durationMs),
    qualityMean: finiteNumber(summary?.qualityMean),
    reliabilityMean: finiteNumber(summary?.reliabilityMean),
    algorithmVersion: summary?.algorithmVersion ? String(summary.algorithmVersion).slice(0, 128) : null,
    disclaimer: summary?.disclaimer ? String(summary.disclaimer).slice(0, 500) : null,
    tests,
  };
}

function sessionQualityDetails(row) {
  const qc = row?.qc_payload && typeof row.qc_payload === 'object' ? row.qc_payload : {};
  return {
    status: String(row?.qc_validity || 'not_computed'),
    score: finiteNumber(row?.qc_score),
    passedChecks: finiteNumber(qc.passedChecks),
    totalChecks: finiteNumber(qc.totalChecks),
    durationMs: finiteNumber(qc.durationMs),
    checks: qc.checks && typeof qc.checks === 'object' ? qc.checks : {},
    percentages: {
      faceVisible: finiteNumber(qc.faceVisiblePct),
      faceOk: finiteNumber(qc.faceOkPct),
      poseOk: finiteNumber(qc.poseOkPct),
      illuminationOk: finiteNumber(qc.illuminationOkPct),
      eyesOpen: finiteNumber(qc.eyesOpenPct),
      gazeValid: finiteNumber(qc.gazeValidPct),
      gazeOnScreen: finiteNumber(qc.gazeOnScreenPct),
      lowFps: finiteNumber(qc.lowFpsPct),
    },
    failReasons: Array.isArray(row?.fail_reasons) ? row.fail_reasons.map(String) : [],
  };
}

router.get('/filter-options', async (req, res) => {
  try {
    const projectId = parsePositiveInt(req.query.project_id);
    const protocolId = parsePositiveInt(req.query.protocol_id);
    if (!projectId || !protocolId) {
      return res.status(400).json({ error: 'project_id and protocol_id are required', code: 'analytics_filter_invalid' });
    }
    if (!(await hasProjectMembership(pool, projectId, req.user))) {
      return res.status(404).json({ error: 'Protocol not found', code: 'analytics_protocol_not_found' });
    }
    const protocol = await loadProtocol(pool, projectId, protocolId);
    if (!protocol) return res.status(404).json({ error: 'Protocol not found', code: 'analytics_protocol_not_found' });
    if (req.query.protocol_version && String(req.query.protocol_version) !== protocolVersion(protocol.definition)) {
      return res.status(409).json({ error: 'Protocol version does not match', code: 'analytics_protocol_version_mismatch' });
    }
    return res.json(collectProtocolOptions(protocol.definition));
  } catch (error) {
    return responseError(res, error);
  }
});

router.post('/snapshots', async (req, res) => {
  try {
    const validated = validateAnalyticsQuery(req.body);
    if (!validated.ok) {
      return res.status(422).json({
        error: 'Analytics query validation failed',
        code: 'analytics_query_invalid',
        details: validated.errors,
      });
    }
    if (!(await hasProjectMembership(pool, validated.value.projectId, req.user))) {
      return res.status(404).json({ error: 'Project not found', code: 'analytics_project_not_found' });
    }
    const snapshot = await createSnapshot(pool, validated.value, req.user.sub);
    return res.status(201).json(snapshot);
  } catch (error) {
    return responseError(res, error);
  }
});

router.get('/sessions/:sessionRef/summary', async (req, res) => {
  try {
    const hydrated = await requireSnapshot(req);
    const row = selectedSession(hydrated, req.params.sessionRef);
    const technical = sessionTechnicalDetails(row);
    const data = {
      session: {
        sessionId: Number(row.id),
        participantAlias: row.participant_id || null,
        startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
        completedAt: row.stopped_at ? new Date(row.stopped_at).toISOString() : null,
        completionStatus: row.stopped_at ? 'completed' : 'in_progress',
        protocolId: Number(row.protocol_id),
        protocolVersion: hydrated.snapshot.queryEcho.protocolVersion,
        ...technical,
      },
      quality: sessionQualityDetails(row),
      audio: sessionAudioDetails(row, hydrated.protocol?.definition),
      qcChannels: hydrated.snapshot.queryEcho.filters.qcChannels.map(channel => channelQc(row, channel)),
      metrics: buildSessionMetrics(row, hydrated.snapshot.queryEcho),
      exclusions: (Array.isArray(row.features_payload?.cognitiveResults)
        ? row.features_payload.cognitiveResults
        : [])
        .filter(trial => trial?.qualityValid === false)
        .map(trial => ({
          level: 'trial',
          entityId: String(trial.trialId || trial.sourceTrialIndex || ''),
          reasonCode: trial.qualityIssueCodes?.[0] || 'quality_invalid',
          channel: 'task',
        })),
    };
    return res.json(envelope('session_summary', hydrated.snapshot, data));
  } catch (error) {
    return responseError(res, error);
  }
});

router.get('/sessions/:sessionRef/aoi', async (req, res) => {
  try {
    const hydrated = await requireSnapshot(req);
    const row = selectedSession(hydrated, req.params.sessionRef);
    const rows = buildAoiRows(row, hydrated.protocol, hydrated.snapshot.queryEcho);
    const first = rows[0] || null;
    const data = {
      status: rows.length ? 'computed' : 'no_data',
      reason: rows.length ? null : 'aoi_not_configured_or_gaze_missing',
      sessionId: Number(row.id),
      blockId: first?.blockId || hydrated.snapshot.queryEcho.filters.blockIds[0] || null,
      presentationId: first?.presentation?.presentationId || null,
      stimulus: first?.presentation ? {
        id: String(first.stimulusId),
        version: String(first.presentation.stimulusVersion || '1'),
        name: first.presentation.stimulusName || String(first.stimulusId),
        type: first.presentation.stimulusType || 'image',
        contentUrl: /^\d+$/.test(String(first.stimulusId)) ? `/stimuli/${first.stimulusId}/content` : null,
        intrinsicWidth: first.presentation.intrinsicWidth || null,
        intrinsicHeight: first.presentation.intrinsicHeight || null,
      } : null,
      coordinateSpace: 'stimulus_normalized_0_1',
      aoiRows: rows.map(item => ({ aoi: item.aoi, metrics: item.metrics })),
    };
    return res.json(envelope('session_aoi', hydrated.snapshot, data));
  } catch (error) {
    return responseError(res, error);
  }
});

router.get('/sessions/:sessionRef/heatmap', async (req, res) => {
  try {
    const hydrated = await requireSnapshot(req);
    const row = selectedSession(hydrated, req.params.sessionRef);
    return res.json(envelope('heatmap', hydrated.snapshot, buildHeatmapData(row, hydrated.snapshot.queryEcho)));
  } catch (error) {
    return responseError(res, error);
  }
});

router.get('/groups/summary', async (req, res) => {
  try {
    const hydrated = await requireSnapshot(req);
    return res.json(envelope(
      'group_summary',
      hydrated.snapshot,
      buildGroupSummary(
        hydrated.sessionRows,
        hydrated.snapshot.queryEcho,
        hydrated.protocol,
        hydrated.snapshot.excludedSessions
      )
    ));
  } catch (error) {
    return responseError(res, error);
  }
});

router.get('/groups/heatmap', async (req, res) => {
  try {
    const hydrated = await requireSnapshot(req);
    return res.json(envelope(
      'heatmap',
      hydrated.snapshot,
      buildGroupHeatmap(hydrated.sessionRows, hydrated.snapshot.queryEcho)
    ));
  } catch (error) {
    return responseError(res, error);
  }
});

router.get('/comparisons/:comparisonId', async (req, res) => {
  try {
    const hydrated = await requireSnapshot(req);
    const options = collectProtocolOptions(hydrated.protocol.definition);
    const comparison = options.comparisons.find(item => item.id === String(req.params.comparisonId));
    const configured = Boolean(comparison);
    const data = {
      comparisonId: String(req.params.comparisonId),
      metricId: comparison?.metricId || null,
      modelId: 'not_executed',
      modelVersion: '1.0.0',
      effectUnit: null,
      effectLabel: null,
      referenceLevel: null,
      comparisonLevel: null,
      readiness: configured ? 'insufficient_data' : 'not_configured',
      reason: configured ? 'statistical_model_requires_approved_backend_method' : 'comparison_not_configured',
      formula: null,
      effect: null,
      estimateCi95: { value: null, lower: null, upper: null, confidenceLevel: 0.95, method: 'not_computed' },
      pValueAdjusted: null,
      adjustmentMethod: 'not_computed',
      nParticipants: hydrated.snapshot.includedParticipantIds.length,
      nObservations: 0,
      warnings: configured ? ['model_not_executed'] : [],
      readinessChecks: [{
        id: 'pre_registered_comparison',
        status: configured ? 'pass' : 'blocked',
        reason: configured ? null : 'comparison_not_configured',
      }],
    };
    return res.json(envelope('model_result', hydrated.snapshot, data));
  } catch (error) {
    return responseError(res, error);
  }
});

function protectSpreadsheetCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function escapeCsv(value) {
  const text = protectSpreadsheetCell(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv(bundle) {
  const header = [
    'rowType', 'snapshotId', 'datasetHash', 'sessionId', 'participantId',
    'aoiId', 'metricId', 'value', 'unit', 'status', 'reason', 'numerator',
    'denominator', 'nParticipants', 'nSessions', 'nObservations', 'details',
  ];
  const rows = [];
  rows.push([
    'counts', bundle.snapshot.id, bundle.snapshot.datasetHash, '', '', '', '', '', '',
    'computed', '', '', '', bundle.counts.participants, bundle.counts.sessions,
    bundle.counts.observations,
    { queryEcho: bundle.snapshot.queryEcho, versions: bundle.snapshot.versions, provenance: bundle.provenance },
  ]);
  bundle.dataDictionary.forEach(item => rows.push([
    'dictionary', bundle.snapshot.id, bundle.snapshot.datasetHash, '', '', '', item.metricId,
    '', item.unit, 'computed', '', '', '', '', '', '', item,
  ]));
  const sessionSummary = bundle.summary?.session;
  const summaryMetrics = bundle.longData || [
    ...(sessionSummary?.metrics || []).map(metric => ({
      ...metric,
      sessionId: sessionSummary.sessionId,
      participantId: sessionSummary.participantId,
      sourceKind: 'session_summary',
    })),
    ...(sessionSummary?.aoiRows || []).flatMap(aoiRow => (aoiRow.metrics || []).map(metric => ({
      ...metric,
      sessionId: sessionSummary.sessionId,
      participantId: sessionSummary.participantId,
      aoiId: aoiRow.aoi?.id,
      sourceKind: 'session_aoi',
    }))),
    ...(bundle.summary?.group?.metrics || []).map(metric => ({
      ...metric,
      value: metric.median,
      sourceKind: 'group_summary',
      statistic: 'participant_median',
    })),
  ];
  summaryMetrics.forEach(metric => rows.push([
    'metric', bundle.snapshot.id, bundle.snapshot.datasetHash, metric.sessionId || '',
    metric.participantId || '', metric.aoiId || '', metric.metricId, metric.value,
    metric.unit, metric.status, metric.reason, metric.numerator, metric.denominator,
    metric.nParticipants, metric.sessionId ? 1 : bundle.counts.sessions,
    metric.nObservations,
    { algorithm: metric.algorithm, scope: metric.scope, sourceKind: metric.sourceKind, statistic: metric.statistic },
  ]));
  return [header, ...rows].map(row => row.map(escapeCsv).join(',')).join('\r\n');
}

router.get('/exports', requireOperation(OPERATIONS.EXPORT_READ), async (req, res) => {
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    const content = String(req.query.content || 'both').toLowerCase();
    if (!['json', 'csv'].includes(format) || !['summary', 'long', 'both'].includes(content)) {
      return res.status(400).json({ error: 'Invalid export options', code: 'analytics_export_options_invalid' });
    }
    const hydrated = await requireSnapshot(req);
    const bundle = buildExportBundle(hydrated, content);
    const protocolVersionValue = String(bundle.snapshot.queryEcho.protocolVersion).replace(/[^a-zA-Z0-9_.-]/g, '-');
    const filename = `emocog-analytics-v${protocolVersionValue}-${bundle.snapshot.id}.${format}`;
    res.setHeader('X-Analysis-Snapshot-Id', bundle.snapshot.id);
    res.setHeader('X-Dataset-Hash', bundle.snapshot.datasetHash);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (format === 'csv') {
      res.type('text/csv; charset=utf-8');
      return res.send(`\uFEFF${exportCsv(bundle)}`);
    }
    res.type('application/json; charset=utf-8');
    return res.send(JSON.stringify(bundle));
  } catch (error) {
    return responseError(res, error);
  }
});

module.exports = router;
module.exports.escapeCsv = escapeCsv;
module.exports.exportCsv = exportCsv;
module.exports.protectSpreadsheetCell = protectSpreadsheetCell;
module.exports.sessionQualityDetails = sessionQualityDetails;
module.exports.sessionTechnicalDetails = sessionTechnicalDetails;
module.exports.sessionAudioDetails = sessionAudioDetails;
