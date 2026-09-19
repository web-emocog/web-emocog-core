const { METRIC_CATALOG } = require('./query');
const { normalizeStimulusId, sha256 } = require('./snapshots');

const CATALOG_BY_ID = new Map((METRIC_CATALOG.metrics || []).map(metric => [metric.id, metric]));
const GAZE_ALGORITHM = Object.freeze({
  id: 'gaze-aoi',
  version: '1.0.0',
  parametersHash: sha256({ fixation: 'idt', dispersionNorm: 0.04, minDurationMs: 100, maxGapMs: 100 }),
});

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function distribution(values) {
  const numbers = values.filter(Number.isFinite);
  if (!numbers.length) return null;
  const avg = mean(numbers);
  const variance = numbers.length > 1
    ? numbers.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (numbers.length - 1)
    : 0;
  return {
    n: numbers.length,
    mean: round(avg),
    sd: round(Math.sqrt(variance)),
    median: round(quantile(numbers, 0.5)),
    q1: round(quantile(numbers, 0.25)),
    q3: round(quantile(numbers, 0.75)),
    min: round(Math.min(...numbers)),
    max: round(Math.max(...numbers)),
  };
}

function sessionDurationMs(row) {
  if (!row.started_at || !row.stopped_at) return null;
  return Math.max(0, new Date(row.stopped_at) - new Date(row.started_at));
}

function gazeAnalytics(row) {
  const value = row.features_payload?.gaze_analytics;
  return value && value.schemaVersion === 'gaze_analytics.v1' ? value : null;
}

function channelQc(row, channel) {
  const overall = String(row.qc_validity || 'not_computed').toLowerCase();
  if (channel === 'gaze') {
    const summary = gazeAnalytics(row)?.summary || null;
    const validFraction = finite(summary?.validFraction);
    const signalConfidence = finite(summary?.meanConfidence);
    let status = overall;
    const reasons = [];
    if (validFraction == null) status = 'not_computed';
    else if (validFraction < 0.6) {
      status = 'invalid';
      reasons.push('low_valid_gaze_fraction');
    } else if (validFraction < 0.8 || (signalConfidence != null && signalConfidence < 0.65)) {
      status = 'borderline';
      if (validFraction < 0.8) reasons.push('low_valid_gaze_fraction');
      if (signalConfidence != null && signalConfidence < 0.65) reasons.push('low_signal_confidence');
    } else if (!['invalid', 'borderline'].includes(overall)) {
      status = 'valid';
    }
    return {
      channel,
      status: ['valid', 'borderline', 'invalid'].includes(status) ? status : 'not_computed',
      validFraction,
      signalConfidence,
      reasons,
      ruleVersion: 'gaze-qc-1.0.0',
    };
  }
  if (channel === 'task') {
    const trials = Array.isArray(row.features_payload?.cognitiveResults)
      ? row.features_payload.cognitiveResults
      : [];
    const valid = trials.filter(trial => trial?.qualityValid !== false).length;
    const validFraction = trials.length ? valid / trials.length : null;
    let status = 'not_computed';
    const reasons = [];
    if (validFraction != null) {
      if (validFraction < 0.6) {
        status = 'invalid';
        reasons.push('low_valid_task_fraction');
      } else if (validFraction < 0.8) {
        status = 'borderline';
        reasons.push('low_valid_task_fraction');
      } else {
        status = 'valid';
      }
    }
    return {
      channel,
      status,
      validFraction,
      signalConfidence: null,
      reasons,
      ruleVersion: 'task-qc-1.1.0',
    };
  }
  const aliases = {
    blink: 'blink_summary',
    head_hands: 'body_pose_summary',
    rppg: 'rppg_summary',
    respiration: 'respiration_summary',
    face: 'emotion_summary',
  };
  const available = aliases[channel] && row.features_payload?.[aliases[channel]] != null;
  return {
    channel,
    status: available ? (overall === 'invalid' ? 'invalid' : 'valid') : 'not_computed',
    validFraction: null,
    signalConfidence: null,
    reasons: [],
    ruleVersion: `${channel}-qc-1.0.0`,
  };
}

function metricBase(metricId, row, options = {}) {
  const catalog = CATALOG_BY_ID.get(metricId) || {};
  const channel = metricId.startsWith('task.') ? 'task' : 'gaze';
  return {
    metricId,
    value: options.value ?? null,
    unit: catalog.unit ?? null,
    status: options.status || 'no_data',
    reason: options.reason || null,
    numerator: options.numerator ?? null,
    denominator: options.denominator ?? null,
    observationDurationMs: options.observationDurationMs ?? sessionDurationMs(row),
    nParticipants: options.nParticipants ?? (row?.participant_id ? 1 : 0),
    nObservations: options.nObservations ?? 0,
    signalConfidence: options.signalConfidence ?? null,
    ...(options.distribution ? { distribution: options.distribution } : {}),
    scope: {
      sessionId: row?.id ?? null,
      blockId: options.blockId ?? null,
      trialId: options.trialId ?? null,
      presentationId: options.presentationId ?? null,
      stimulusId: options.stimulusId ?? null,
      aoiId: options.aoiId ?? null,
    },
    qc: options.qc || channelQc(row, channel),
    algorithm: options.algorithm || {
      id: channel === 'task' ? 'task-performance' : 'gaze-validity',
      version: '1.0.0',
      parametersHash: null,
    },
  };
}

function taskTrials(row, query) {
  const filters = query.filters;
  return (Array.isArray(row.features_payload?.cognitiveResults)
    ? row.features_payload.cognitiveResults
    : []).filter(trial => {
    if (filters.blockIds.length && !filters.blockIds.some(id => String(id) === String(trial?.blockId ?? trial?.block))) return false;
    if (filters.stimulusIds.length && !filters.stimulusIds.some(id => normalizeStimulusId(id) === normalizeStimulusId(trial?.stimulusId))) return false;
    return true;
  });
}

function taskMetricValues(row, query) {
  const all = taskTrials(row, query);
  const valid = all.filter(trial => trial?.qualityValid !== false);
  const excluded = all.length - valid.length;
  const correct = valid.filter(trial => trial?.correct === true).length;
  const errors = valid.filter(trial => trial?.correct === false).length;
  const omissions = valid.filter(trial => trial?.response == null).length;
  const noGo = valid.filter(trial => /no.?go/i.test(String(trial?.condition || '')));
  const commissions = noGo.filter(trial => trial?.response != null).length;
  const rtValues = valid.map(trial => finite(trial?.rt)).filter(Number.isFinite);
  return { all, valid, excluded, correct, errors, omissions, noGo, commissions, rtValues };
}

function buildTaskMetric(metricId, row, query) {
  const task = taskMetricValues(row, query);
  if (!task.all.length) return metricBase(metricId, row, { reason: 'task_data_missing' });
  const common = { status: 'computed', nObservations: task.valid.length, denominator: task.valid.length };
  switch (metricId) {
    case 'task.accuracy_pct':
      return metricBase(metricId, row, { ...common, value: task.valid.length ? round(task.correct / task.valid.length * 100) : null, numerator: task.correct });
    case 'task.rt_median_ms':
      return metricBase(metricId, row, { ...common, value: round(quantile(task.rtValues, 0.5)), denominator: task.rtValues.length, nObservations: task.rtValues.length, distribution: distribution(task.rtValues) });
    case 'task.rt_mean_ms':
      return metricBase(metricId, row, { ...common, value: round(mean(task.rtValues)), denominator: task.rtValues.length, nObservations: task.rtValues.length, distribution: distribution(task.rtValues) });
    case 'task.correct_count': return metricBase(metricId, row, { ...common, value: task.correct, numerator: task.correct });
    case 'task.error_count': return metricBase(metricId, row, { ...common, value: task.errors, numerator: task.errors });
    case 'task.omission_count': return metricBase(metricId, row, { ...common, value: task.omissions, numerator: task.omissions });
    case 'task.omission_rate_pct': return metricBase(metricId, row, { ...common, value: task.valid.length ? round(task.omissions / task.valid.length * 100) : null, numerator: task.omissions });
    case 'task.commission_count': return metricBase(metricId, row, { ...common, value: task.commissions, numerator: task.commissions, denominator: task.noGo.length });
    case 'task.commission_rate_pct': return metricBase(metricId, row, { ...common, value: task.noGo.length ? round(task.commissions / task.noGo.length * 100) : null, numerator: task.commissions, denominator: task.noGo.length, status: task.noGo.length ? 'computed' : 'not_applicable', reason: task.noGo.length ? null : 'no_nogo_trials' });
    case 'task.trial_count_valid': return metricBase(metricId, row, { ...common, value: task.valid.length, numerator: task.valid.length });
    case 'task.trial_count_excluded': return metricBase(metricId, row, { ...common, value: task.excluded, numerator: task.excluded, denominator: task.all.length, nObservations: task.all.length });
    default: return metricBase(metricId, row, { reason: 'metric_not_supported' });
  }
}

function buildQcMetric(metricId, row) {
  const analytics = gazeAnalytics(row);
  const summary = analytics?.summary;
  if (!summary) return metricBase(metricId, row, { reason: 'gaze_analytics_missing' });
  const total = finite(summary.sampleCountTotal) ?? 0;
  const valid = finite(summary.sampleCountValid) ?? 0;
  const low = finite(summary.lowConfidenceCount) ?? 0;
  const off = finite(summary.offScreenCount) ?? 0;
  const outside = finite(summary.outsideStimulusCount) ?? 0;
  if (total <= 0) {
    return metricBase(metricId, row, {
      reason: 'gaze_samples_missing',
      denominator: 0,
      nObservations: 0,
      observationDurationMs: finite(summary.observationDurationMs),
      signalConfidence: finite(summary.meanConfidence),
    });
  }
  const common = {
    status: 'computed',
    denominator: total,
    nObservations: total,
    observationDurationMs: finite(summary.observationDurationMs),
    signalConfidence: finite(summary.meanConfidence),
  };
  const values = {
    'qc.sample_count_total': [total, total],
    'qc.sample_count_valid': [valid, valid],
    'qc.valid_gaze_pct': [total ? round(valid / total * 100) : 0, valid],
    'qc.low_confidence_pct': [total ? round(low / total * 100) : 0, low],
    'qc.off_screen_pct': [total ? round(off / total * 100) : 0, off],
    'qc.outside_stimulus_pct': [total ? round(outside / total * 100) : 0, outside],
  };
  const pair = values[metricId];
  return pair
    ? metricBase(metricId, row, { ...common, value: pair[0], numerator: pair[1] })
    : metricBase(metricId, row, { reason: 'metric_not_supported' });
}

function buildSessionMetrics(row, query) {
  return query.metricIds
    .filter(metricId => metricId !== 'viz.heatmap' && !metricId.startsWith('aoi.'))
    .map(metricId => {
      if (metricId.startsWith('task.')) return buildTaskMetric(metricId, row, query);
      if (metricId.startsWith('qc.')) return buildQcMetric(metricId, row);
      return metricBase(metricId, row, { reason: 'metric_not_supported' });
    });
}

function pointInPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function fixationInsideAoi(fixation, aoi) {
  const points = Array.isArray(aoi?.points) ? aoi.points : [];
  if (!Number.isFinite(fixation?.x) || !Number.isFinite(fixation?.y) || points.length < 2) return false;
  if (aoi.shape === 'rectangle' && points.length >= 2) {
    const xs = points.map(point => Number(point.x));
    const ys = points.map(point => Number(point.y));
    return fixation.x >= Math.min(...xs) && fixation.x <= Math.max(...xs)
      && fixation.y >= Math.min(...ys) && fixation.y <= Math.max(...ys);
  }
  if (aoi.shape === 'ellipse' && points.length >= 2) {
    const minX = Math.min(points[0].x, points[1].x);
    const maxX = Math.max(points[0].x, points[1].x);
    const minY = Math.min(points[0].y, points[1].y);
    const maxY = Math.max(points[0].y, points[1].y);
    const rx = (maxX - minX) / 2;
    const ry = (maxY - minY) / 2;
    if (!(rx > 0 && ry > 0)) return false;
    const cx = minX + rx;
    const cy = minY + ry;
    return (((fixation.x - cx) / rx) ** 2) + (((fixation.y - cy) / ry) ** 2) <= 1;
  }
  return points.length >= 3 && pointInPolygon(fixation, points);
}

function protocolAois(protocol, query) {
  const rows = [];
  const blocks = Array.isArray(protocol?.definition?.blocks) ? protocol.definition.blocks : [];
  blocks.forEach((block, blockIndex) => {
    const blockId = String(block?.id || `block-${blockIndex + 1}`);
    if (query.filters.blockIds.length && !query.filters.blockIds.some(id => String(id) === blockId)) return;
    const definitions = block?.blockConfig?.aoiDefinitions || block?.content?.aoiDefinitions || {};
    Object.entries(definitions).forEach(([stimulusRef, aois]) => {
      const stimulusId = normalizeStimulusId(stimulusRef);
      if (query.filters.stimulusIds.length && !query.filters.stimulusIds.some(id => normalizeStimulusId(id) === stimulusId)) return;
      (Array.isArray(aois) ? aois : []).forEach((aoi, index) => {
        const id = String(aoi?.id || `${blockId}-${stimulusId}-aoi-${index + 1}`);
        if (query.filters.aoiIds.length && !query.filters.aoiIds.some(filterId => String(filterId) === id)) return;
        rows.push({
          blockId,
          blockName: block?.title || block?.label || block?.content?.title || blockId,
          stimulusId,
          aoi: { ...aoi, id, order: Number(aoi?.order || index + 1) },
        });
      });
    });
  });
  return rows;
}

function matchingPresentations(row, blockId, stimulusId) {
  const presentations = gazeAnalytics(row)?.presentations || [];
  return presentations.filter(presentation => (
    String(presentation.blockId) === String(blockId)
    && normalizeStimulusId(presentation.stimulusId) === normalizeStimulusId(stimulusId)
  ));
}

function aoiMetric(metricId, row, aoiRow, presentations) {
  if (!presentations.length) return metricBase(metricId, row, {
    reason: 'gaze_presentation_missing',
    blockId: aoiRow.blockId,
    stimulusId: aoiRow.stimulusId,
    aoiId: aoiRow.aoi.id,
  });
  const validity = aoiRow.aoi.validityInterval || {};
  const start = Number.isFinite(validity.startMs) ? validity.startMs : 0;
  const end = Number.isFinite(validity.endMs) ? validity.endMs : Infinity;
  const presentationRows = presentations.map(presentation => {
    const allFixations = Array.isArray(presentation.fixationPoints) ? presentation.fixationPoints : [];
    const fixations = allFixations.filter(fixation => {
      const at = finite(fixation.startMs) ?? 0;
      return at >= start && at <= end;
    });
    const insideFlags = fixations.map(fixation => fixationInsideAoi(fixation, aoiRow.aoi));
    const inside = fixations.filter((_fixation, index) => insideFlags[index]);
    let visits = 0;
    insideFlags.forEach((isInside, index) => {
      if (isInside && (index === 0 || !insideFlags[index - 1])) visits += 1;
    });
    return {
      presentation,
      fixations,
      inside,
      visits,
      reached: inside.length > 0,
      first: inside.length ? finite(inside[0].startMs) : null,
      observation: finite(presentation.validObservationDurationMs) ?? 0,
    };
  });
  const fixations = presentationRows.flatMap(item => item.fixations);
  const inside = presentationRows.flatMap(item => item.inside);
  const durations = inside.map(fixation => finite(fixation.durationMs)).filter(Number.isFinite);
  const dwell = durations.reduce((sum, value) => sum + value, 0);
  const observation = presentationRows.reduce((sum, item) => sum + item.observation, 0);
  const confidence = mean(presentations.map(item => finite(item.meanConfidence)));
  const visits = presentationRows.reduce((sum, item) => sum + item.visits, 0);
  const revisits = presentationRows.reduce((sum, item) => sum + Math.max(0, item.visits - 1), 0);
  const reachedCount = presentationRows.filter(item => item.reached).length;
  const reached = reachedCount > 0;
  const first = quantile(presentationRows.map(item => item.first).filter(Number.isFinite), 0.5);
  if (observation <= 0) return metricBase(metricId, row, {
    reason: 'valid_observation_missing',
    blockId: aoiRow.blockId,
    stimulusId: aoiRow.stimulusId,
    aoiId: aoiRow.aoi.id,
    nObservations: 0,
  });
  const common = {
    status: 'computed',
    observationDurationMs: observation,
    nObservations: fixations.length,
    signalConfidence: confidence,
    blockId: aoiRow.blockId,
    stimulusId: aoiRow.stimulusId,
    aoiId: aoiRow.aoi.id,
    presentationId: presentations.length === 1 ? presentations[0].presentationId : null,
    algorithm: GAZE_ALGORITHM,
  };
  const values = {
    'aoi.gaze_on_target_pct': [observation ? round(dwell / observation * 100) : 0, dwell, observation],
    'aoi.dwell_time_ms': [round(dwell), dwell, observation],
    'aoi.dwell_time_pct': [observation ? round(dwell / observation * 100) : 0, dwell, observation],
    'aoi.fixation_count': [inside.length, inside.length, fixations.length],
    'aoi.fixation_rate_per_min': [observation ? round(inside.length * 60000 / observation) : 0, inside.length, observation],
    'aoi.fixation_duration_median_ms': [round(quantile(durations, 0.5)), null, durations.length],
    'aoi.fixation_duration_mean_ms': [round(mean(durations)), null, durations.length],
    'aoi.target_reached': [reached, reached ? 1 : 0, 1],
    'aoi.target_reached_pct': [round(reachedCount / presentations.length * 100), reachedCount, presentations.length],
    'aoi.visit_count': [visits, visits, fixations.length],
    'aoi.revisit_count': [revisits, revisits, fixations.length],
  };
  if (metricId === 'aoi.ttff_ms') {
    return metricBase(metricId, row, {
      ...common,
      value: first,
      status: reached ? 'computed' : 'no_event',
      reason: reached ? null : 'target_not_reached_before_presentation_end',
      numerator: first,
      denominator: 1,
    });
  }
  const value = values[metricId];
  if (!value) return metricBase(metricId, row, { ...common, reason: 'metric_not_supported' });
  return metricBase(metricId, row, {
    ...common,
    value: value[0],
    numerator: value[1],
    denominator: value[2],
    status: value[0] == null ? (inside.length ? 'failed' : 'no_event') : 'computed',
    reason: value[0] == null ? (inside.length ? 'metric_calculation_failed' : 'no_fixation_in_aoi') : null,
  });
}

function buildAoiRows(row, protocol, query) {
  return protocolAois(protocol, query).map(aoiRow => {
    const presentations = matchingPresentations(row, aoiRow.blockId, aoiRow.stimulusId);
    const requested = query.metricIds.filter(metricId => metricId.startsWith('aoi.'));
    return {
      aoi: aoiRow.aoi,
      metrics: requested.map(metricId => aoiMetric(metricId, row, aoiRow, presentations)),
      blockId: aoiRow.blockId,
      stimulusId: aoiRow.stimulusId,
      presentation: presentations[0] || null,
      presentations,
    };
  });
}

function selectPresentation(row, query) {
  const presentations = gazeAnalytics(row)?.presentations || [];
  return presentations.find(presentation => {
    const blockOk = !query.filters.blockIds.length || query.filters.blockIds.some(id => String(id) === String(presentation.blockId));
    const stimulusOk = !query.filters.stimulusIds.length || query.filters.stimulusIds.some(id => normalizeStimulusId(id) === normalizeStimulusId(presentation.stimulusId));
    return blockOk && stimulusOk;
  }) || null;
}

function selectPresentations(row, query) {
  const first = selectPresentation(row, query);
  if (!first) return [];
  return (gazeAnalytics(row)?.presentations || []).filter(presentation => (
    String(presentation.blockId) === String(first.blockId)
    && normalizeStimulusId(presentation.stimulusId) === normalizeStimulusId(first.stimulusId)
  ));
}

function aggregatePresentationGrid(presentations) {
  const first = presentations[0];
  const width = Number(first?.grid?.width || 0);
  const height = Number(first?.grid?.height || 0);
  const expected = width * height;
  if (!width || !height || !expected) return { width: 0, height: 0, values: [], maxValue: 0 };
  const values = new Array(expected).fill(0);
  presentations.forEach(presentation => {
    const grid = presentation?.grid || {};
    if (Number(grid.width) !== width || Number(grid.height) !== height || !Array.isArray(grid.values) || grid.values.length !== expected) return;
    grid.values.forEach((value, index) => { values[index] += finite(value) ?? 0; });
  });
  const maxValue = Math.max(...values, 0);
  return {
    width,
    height,
    values: maxValue > 0 ? values.map(value => round(value / maxValue, 6)) : values,
    maxValue: maxValue > 0 ? 1 : 0,
  };
}

function normalizedGrid(presentation) {
  const grid = presentation?.grid || {};
  const values = Array.isArray(grid.values) ? grid.values.map(value => finite(value) ?? 0) : [];
  const maxValue = values.length ? Math.max(...values, 0) : 0;
  return {
    width: Number(grid.width || 0),
    height: Number(grid.height || 0),
    values: maxValue > 0 ? values.map(value => round(value / maxValue, 6)) : values,
    maxValue: maxValue > 0 ? 1 : 0,
  };
}

function stimulusDescriptor(presentation) {
  const id = normalizeStimulusId(presentation?.stimulusId);
  return {
    id,
    version: String(presentation?.stimulusVersion || '1'),
    name: presentation?.stimulusName || id,
    type: presentation?.stimulusType || 'image',
    contentUrl: /^\d+$/.test(id) ? `/stimuli/${id}/content` : null,
    intrinsicWidth: finite(presentation?.intrinsicWidth),
    intrinsicHeight: finite(presentation?.intrinsicHeight),
  };
}

function buildHeatmapData(row, query) {
  const presentations = selectPresentations(row, query);
  const presentation = presentations[0] || null;
  if (!presentation) {
    return {
      status: 'no_data',
      reason: 'gaze_presentation_missing',
      aggregationLevel: 'session',
      stimulus: null,
      coordinateSpace: 'stimulus_normalized_0_1',
      normalizationMode: 'fixation_duration_weighted',
      smoothing: { method: 'none', bandwidthNorm: null },
      equalParticipantWeight: false,
      grid: { width: 0, height: 0, values: [], maxValue: 0 },
      fixationPoints: [],
      nParticipants: row.participant_id ? 1 : 0,
      nSessions: 1,
      nFixations: 0,
      validObservationDurationMs: 0,
      algorithm: GAZE_ALGORITHM,
    };
  }
  const fixations = presentations.flatMap(item => Array.isArray(item.fixationPoints) ? item.fixationPoints : [])
    .map(fixation => ({
      x: round(finite(fixation.x), 6),
      y: round(finite(fixation.y), 6),
      durationMs: round(finite(fixation.durationMs)),
      signalConfidence: round(finite(fixation.signalConfidence), 4),
      startMs: round(finite(fixation.startMs)),
    }));
  return {
    status: 'computed',
    reason: null,
    aggregationLevel: 'session',
    stimulus: stimulusDescriptor(presentation),
    coordinateSpace: 'stimulus_normalized_0_1',
    normalizationMode: 'fixation_duration_weighted',
    smoothing: { method: 'none', bandwidthNorm: null },
    equalParticipantWeight: false,
    grid: aggregatePresentationGrid(presentations),
    fixationPoints: fixations,
    nParticipants: row.participant_id ? 1 : 0,
    nSessions: 1,
    nFixations: fixations.length,
    validObservationDurationMs: presentations.reduce((sum, item) => sum + (finite(item.validObservationDurationMs) ?? 0), 0),
    algorithm: presentation.algorithm || GAZE_ALGORITHM,
  };
}

function buildSessionVisuals(row, protocol, query) {
  const unfilteredQuery = {
    ...query,
    filters: {
      ...query.filters,
      blockIds: [],
      stimulusIds: [],
      aoiIds: [],
    },
  };
  const contexts = new Map();
  protocolAois(protocol, unfilteredQuery).forEach(aoiRow => {
    const key = JSON.stringify([aoiRow.blockId, aoiRow.stimulusId]);
    if (!contexts.has(key)) contexts.set(key, aoiRow);
  });
  return Array.from(contexts.values()).map(context => {
    const scopedQuery = {
      ...query,
      filters: {
        ...query.filters,
        blockIds: [context.blockId],
        stimulusIds: [context.stimulusId],
        aoiIds: [],
      },
    };
    const rows = buildAoiRows(row, protocol, scopedQuery);
    const heatmap = buildHeatmapData(row, scopedQuery);
    const presentation = selectPresentation(row, scopedQuery);
    const stimulus = heatmap.stimulus || {
      id: context.stimulusId,
      version: '1',
      name: context.stimulusId,
      type: 'image',
      contentUrl: /^\d+$/.test(context.stimulusId) ? `/stimuli/${context.stimulusId}/content` : null,
      intrinsicWidth: null,
      intrinsicHeight: null,
    };
    return {
      status: heatmap.status,
      reason: heatmap.reason,
      blockId: context.blockId,
      blockName: context.blockName,
      presentationId: presentation?.presentationId || null,
      stimulus,
      coordinateSpace: 'stimulus_normalized_0_1',
      aoiRows: rows.map(item => ({ aoi: item.aoi, metrics: item.metrics })),
      heatmap: { ...heatmap, stimulus },
    };
  });
}

function numericMetricValue(metric) {
  if (typeof metric?.value === 'boolean') return metric.value ? 1 : 0;
  return finite(metric?.value);
}

function sumMetricField(records, field) {
  const values = records.map(record => finite(record.metric?.[field])).filter(Number.isFinite);
  return values.length ? round(values.reduce((sum, value) => sum + value, 0)) : null;
}

function estimateCi95(values) {
  const stats = distribution(values);
  if (!stats || stats.n < 2) {
    return {
      value: stats?.mean ?? null,
      lower: null,
      upper: null,
      confidenceLevel: 0.95,
      method: 'insufficient_participants',
    };
  }
  const margin = 1.96 * stats.sd / Math.sqrt(stats.n);
  return {
    value: stats.mean,
    lower: round(stats.mean - margin),
    upper: round(stats.mean + margin),
    confidenceLevel: 0.95,
    method: 'normal_approximation_participant_means',
  };
}

function buildGroupMetric(metricId, records, scope = null) {
  const participantRecords = new Map();
  records.forEach(record => {
    if (!participantRecords.has(record.participantId)) participantRecords.set(record.participantId, []);
    participantRecords.get(record.participantId).push(record);
  });
  const participantValues = [];
  participantRecords.forEach((participantMetrics, participantId) => {
    const usable = participantMetrics.filter(record => numericMetricValue(record.metric) != null);
    const value = mean(usable.map(record => numericMetricValue(record.metric)));
    if (value == null) return;
    participantValues.push({
      participantId,
      value: round(value),
      nObservations: usable.reduce((sum, record) => sum + (record.metric.nObservations || 0), 0),
    });
  });
  const values = participantValues.map(item => item.value);
  const stats = distribution(values);
  const firstMetric = records.find(record => record.metric)?.metric || null;
  const statuses = [...new Set(records.map(record => record.metric?.status).filter(Boolean))];
  const status = values.length
    ? 'computed'
    : (statuses.length === 1 ? statuses[0] : 'no_data');
  const reason = values.length
    ? null
    : (records.find(record => record.metric?.reason)?.metric.reason || 'metric_data_missing');
  const measurementRecords = records.filter(record => ['computed', 'no_event'].includes(record.metric?.status));
  return {
    metricId,
    unit: CATALOG_BY_ID.get(metricId)?.unit ?? null,
    status,
    reason,
    nParticipants: participantValues.length,
    nObservations: records.reduce((sum, record) => sum + (record.metric?.nObservations || 0), 0),
    numerator: sumMetricField(measurementRecords, 'numerator'),
    denominator: sumMetricField(measurementRecords, 'denominator'),
    observationDurationMs: sumMetricField(measurementRecords, 'observationDurationMs'),
    median: stats?.median ?? null,
    q1: stats?.q1 ?? null,
    q3: stats?.q3 ?? null,
    mean: stats?.mean ?? null,
    sd: stats?.sd ?? null,
    min: stats?.min ?? null,
    max: stats?.max ?? null,
    estimateCi95: estimateCi95(values),
    participantValues,
    ...(scope ? { scope } : {}),
    algorithm: firstMetric?.algorithm || {
      id: 'participant-equal-summary',
      version: '1.0.0',
      parametersHash: null,
    },
  };
}

function qcCountTemplate() {
  return { valid: 0, borderline: 0, invalid: 0, notComputed: 0 };
}

function addQcCount(counts, status) {
  const key = status === 'not_computed' ? 'notComputed' : status;
  if (Object.hasOwn(counts, key)) counts[key] += 1;
  else counts.notComputed += 1;
}

function deviceClass(row) {
  const tech = row.features_payload?.meta?.tech || {};
  return String(tech.deviceClass || tech.device || 'unknown').slice(0, 64);
}

function buildGroupSummary(rows, query, protocol = null, excludedSessions = []) {
  const participantMap = new Map();
  rows.forEach(row => {
    const participant = String(row.participant_id || `session-${row.id}`);
    if (!participantMap.has(participant)) participantMap.set(participant, []);
    participantMap.get(participant).push(row);
  });
  const metricRecords = [];
  const metrics = query.metricIds.filter(id => id !== 'viz.heatmap' && !id.startsWith('aoi.')).map(metricId => {
    const records = rows.map(row => ({
      participantId: String(row.participant_id || `session-${row.id}`),
      metric: buildSessionMetrics(row, { ...query, metricIds: [metricId] })[0],
    }));
    metricRecords.push(...records);
    return buildGroupMetric(metricId, records);
  });

  if (protocol) {
    const aoiMetricIds = query.metricIds.filter(metricId => metricId.startsWith('aoi.'));
    const groupedAoiRecords = new Map();
    const aoiRows = protocolAois(protocol, query);
    aoiRows.forEach(aoiRow => aoiMetricIds.forEach(metricId => {
      groupedAoiRecords.set(JSON.stringify([
        metricId, aoiRow.blockId, aoiRow.stimulusId, aoiRow.aoi.id,
      ]), []);
    }));
    rows.forEach(row => {
      const participantId = String(row.participant_id || `session-${row.id}`);
      buildAoiRows(row, protocol, query).forEach(aoiRow => aoiRow.metrics.forEach(metric => {
        const key = JSON.stringify([
          metric.metricId, aoiRow.blockId, aoiRow.stimulusId, aoiRow.aoi.id,
        ]);
        groupedAoiRecords.get(key)?.push({ participantId, metric });
      }));
    });
    aoiRows.forEach(aoiRow => {
      aoiMetricIds.forEach(metricId => {
        const key = JSON.stringify([
          metricId, aoiRow.blockId, aoiRow.stimulusId, aoiRow.aoi.id,
        ]);
        const records = groupedAoiRecords.get(key) || [];
        metricRecords.push(...records);
        metrics.push(buildGroupMetric(metricId, records, {
          sessionId: null,
          blockId: aoiRow.blockId,
          trialId: null,
          presentationId: null,
          stimulusId: aoiRow.stimulusId,
          aoiId: aoiRow.aoi.id,
        }));
      });
    });
  }

  const qcCounts = qcCountTemplate();
  rows.forEach(row => addQcCount(qcCounts, String(row.qc_validity || 'not_computed').toLowerCase()));
  const qcByChannel = query.filters.qcChannels.map(channel => {
    const counts = { channel, ...qcCountTemplate() };
    rows.forEach(row => addQcCount(counts, channelQc(row, channel).status));
    return counts;
  });

  const devices = new Map();
  rows.forEach(row => {
    const key = deviceClass(row);
    if (!devices.has(key)) devices.set(key, { participants: new Set(), sessions: 0 });
    const bucket = devices.get(key);
    bucket.participants.add(String(row.participant_id || `session-${row.id}`));
    bucket.sessions += 1;
  });
  const deviceCounts = Array.from(devices, ([key, value]) => ({
    deviceClass: key,
    participantCount: value.participants.size,
    sessionCount: value.sessions,
  }));

  const missingReasons = new Map();
  const countMissing = reason => {
    if (!reason) return;
    missingReasons.set(reason, (missingReasons.get(reason) || 0) + 1);
  };
  metricRecords.forEach(record => {
    if (record.metric?.status !== 'computed') countMissing(record.metric?.reason || record.metric?.status);
  });
  excludedSessions.forEach(item => countMissing(item?.reasonCode));
  const missingness = Array.from(missingReasons, ([reasonCode, count]) => ({ reasonCode, count }));

  return {
    nParticipants: participantMap.size,
    nSessions: rows.length,
    nObservations: metrics.reduce((maximum, metric) => Math.max(maximum, metric.nObservations || 0), 0),
    qcCounts,
    qcByChannel,
    deviceCounts,
    missingness,
    metrics,
  };
}

function buildGroupHeatmap(rows, query) {
  const participantGrids = new Map();
  let template = null;
  rows.forEach(row => {
    const presentation = selectPresentation(row, query);
    const sessionHeatmap = buildHeatmapData(row, query);
    if (!presentation || sessionHeatmap.status !== 'computed') return;
    const grid = sessionHeatmap.grid;
    if (!grid.width || !grid.height || !grid.values.length) return;
    if (!template) template = { presentation, grid };
    if (grid.width !== template.grid.width || grid.height !== template.grid.height) return;
    const participant = String(row.participant_id || `session-${row.id}`);
    if (!participantGrids.has(participant)) participantGrids.set(participant, []);
    participantGrids.get(participant).push(grid.values);
  });
  if (!template) {
    return {
      ...buildHeatmapData(rows[0] || { features_payload: {} }, query),
      aggregationLevel: 'group',
      equalParticipantWeight: true,
      nParticipants: 0,
      nSessions: rows.length,
    };
  }
  const perParticipant = [];
  participantGrids.forEach(grids => {
    perParticipant.push(template.grid.values.map((_value, index) => mean(grids.map(grid => grid[index])) || 0));
  });
  const values = template.grid.values.map((_value, index) => mean(perParticipant.map(grid => grid[index])) || 0);
  const maxValue = Math.max(...values, 0);
  return {
    status: 'computed',
    reason: null,
    aggregationLevel: 'group',
    stimulus: stimulusDescriptor(template.presentation),
    coordinateSpace: 'stimulus_normalized_0_1',
    normalizationMode: 'fixation_duration_weighted',
    smoothing: { method: 'none', bandwidthNorm: null },
    equalParticipantWeight: true,
    grid: {
      width: template.grid.width,
      height: template.grid.height,
      values: maxValue ? values.map(value => round(value / maxValue, 6)) : values,
      maxValue: maxValue ? 1 : 0,
    },
    fixationPoints: [],
    nParticipants: perParticipant.length,
    nSessions: rows.length,
    nFixations: rows.reduce((sum, row) => sum + (selectPresentation(row, query)?.fixationPoints?.length || 0), 0),
    validObservationDurationMs: rows.reduce((sum, row) => sum + (finite(selectPresentation(row, query)?.validObservationDurationMs) || 0), 0),
    algorithm: { ...GAZE_ALGORITHM, id: 'participant-equal-heatmap' },
  };
}

function exportMetric(metric, sourceKind, context = {}) {
  return {
    metricId: metric.metricId,
    value: metric.value ?? metric.median ?? null,
    unit: metric.unit ?? null,
    status: metric.status,
    reason: metric.reason ?? null,
    numerator: metric.numerator ?? null,
    denominator: metric.denominator ?? null,
    nParticipants: metric.nParticipants ?? null,
    nObservations: metric.nObservations ?? null,
    observationDurationMs: metric.observationDurationMs ?? null,
    scope: metric.scope || null,
    algorithm: metric.algorithm || null,
    sourceKind,
    ...context,
  };
}

function buildExportBundle(hydrated, content = 'both') {
  const { snapshot, sessionRows, protocol } = hydrated;
  const query = snapshot.queryEcho;
  const sessions = sessionRows.map(row => ({
    sessionId: Number(row.id),
    participantId: row.participant_id || null,
    metrics: buildSessionMetrics(row, query),
    aoiRows: buildAoiRows(row, protocol, query).map(item => ({ aoi: item.aoi, metrics: item.metrics })),
  }));
  const group = query.mode === 'group'
    ? buildGroupSummary(sessionRows, query, protocol, snapshot.excludedSessions)
    : null;
  const dataDictionary = query.metricIds.map(metricId => {
    const metric = CATALOG_BY_ID.get(metricId) || {};
    return {
      metricId,
      label: metric.label || { ru: metricId, en: metricId },
      unit: metric.unit ?? null,
      description: metric.description || null,
    };
  });
  const observations = sessions.reduce((sum, session) => (
    sum + session.metrics.reduce((metricSum, metric) => metricSum + (metric.nObservations || 0), 0)
  ), 0);
  return {
    contractVersion: '1.0',
    kind: 'analytics_export',
    generatedAt: new Date().toISOString(),
    content,
    snapshot,
    counts: {
      participants: snapshot.includedParticipantIds.length,
      sessions: snapshot.includedSessionIds.length,
      observations: group?.nObservations ?? observations,
    },
    summary: content === 'long' ? null : {
      session: query.mode === 'session' ? (sessions[0] || null) : null,
      group,
      modelResult: null,
    },
    longData: content === 'summary' ? null : [
      ...sessions.flatMap(session => [
        ...session.metrics.map(metric => exportMetric(metric, 'session_summary', {
          sessionId: session.sessionId,
          participantId: session.participantId,
        })),
        ...session.aoiRows.flatMap(aoiRow => aoiRow.metrics.map(metric => exportMetric(metric, 'session_aoi', {
          sessionId: session.sessionId,
          participantId: session.participantId,
          aoiId: aoiRow.aoi.id,
          aoiName: aoiRow.aoi.name,
          aoiOrder: aoiRow.aoi.order,
        }))),
      ]),
      ...(group ? group.metrics.map(metric => exportMetric(metric, 'group_summary', {
        statistic: 'participant_median',
      })) : []),
    ],
    dataDictionary,
    provenance: {
      source: 'analysis_snapshot',
      frontend: snapshot.versions.frontend,
      exportContract: '1.0',
      backend: snapshot.versions.backend,
      metricsCatalog: snapshot.versions.metricsCatalog,
      qcRules: snapshot.versions.qcRules,
    },
  };
}

module.exports = {
  CATALOG_BY_ID,
  GAZE_ALGORITHM,
  buildAoiRows,
  buildExportBundle,
  buildGroupHeatmap,
  buildGroupSummary,
  buildHeatmapData,
  buildSessionVisuals,
  buildSessionMetrics,
  channelQc,
  distribution,
  finite,
  fixationInsideAoi,
  metricBase,
  normalizedGrid,
  protocolAois,
  quantile,
  round,
  selectPresentation,
  selectPresentations,
};
