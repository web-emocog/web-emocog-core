import { percentile, resolveMonotonicEpochMs } from './timebase.mjs';

export const MULTIMODAL_HEATMAP_VERSION = 'multimodal_heatmap.v1';
const DEFAULT_MAX_ALIGNMENT_MS = 100;

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function mean(values) {
  const valid = (values || []).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function normalizedGaze(sample) {
  if (!sample || sample.valid === false || sample.onScreen === false) return null;
  const correctedX = finite(sample.correctedX);
  const correctedY = finite(sample.correctedY);
  const rect = sample.stimulusRect;
  const hasStimulusRect = rect
    && finite(rect.left) != null
    && finite(rect.top) != null
    && finite(rect.width) > 0
    && finite(rect.height) > 0;
  const x = hasStimulusRect && correctedX != null
    ? (correctedX - rect.left) / rect.width
    : (finite(sample.normalizedX)
      ?? (correctedX != null && finite(sample.screenWidth) > 0
        ? correctedX / sample.screenWidth
        : null));
  const y = hasStimulusRect && correctedY != null
    ? (correctedY - rect.top) / rect.height
    : (finite(sample.normalizedY)
      ?? (correctedY != null && finite(sample.screenHeight) > 0
        ? correctedY / sample.screenHeight
        : null));
  if (x == null || y == null || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

function presentationKey(sample) {
  const explicit = sample?.presentationId;
  if (explicit != null) return String(explicit);
  const stimulusId = sample?.stimulusId;
  if (stimulusId == null) return null;
  return [
    sample?.blockId ?? 'block',
    sample?.attempt ?? 'attempt',
    sample?.trialId ?? 'trial',
    stimulusId
  ].map(String).join(':');
}

function emotionValue(sample, key) {
  return finite(sample?.[key] ?? sample?.affective?.[key] ?? sample?.data?.affective?.[key]);
}

function emotionConfidence(sample) {
  if (sample?.degraded === true || sample?.missingData === true) return null;
  return finite(sample?.confidence ?? sample?.dataQualityScore);
}

function buildNearestLookup(samples) {
  const sorted = (samples || [])
    .map(sample => ({ sample, time: resolveMonotonicEpochMs(sample) }))
    .filter(item => item.time != null)
    .sort((a, b) => a.time - b.time);
  return (targetTime, maxDeltaMs) => {
    if (!sorted.length || targetTime == null) return null;
    let low = 0;
    let high = sorted.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sorted[middle].time < targetTime) low = middle + 1;
      else high = middle;
    }
    const candidates = [sorted[low - 1], sorted[low]].filter(Boolean);
    let best = null;
    for (const candidate of candidates) {
      const deltaMs = Math.abs(candidate.time - targetTime);
      if (!best || deltaMs < best.deltaMs) best = { ...candidate, deltaMs };
    }
    return best && best.deltaMs <= maxDeltaMs ? best : null;
  };
}

function fixationWeights(samples) {
  const sorted = [...samples].sort((a, b) => a.time - b.time);
  const weights = new Map();
  let cluster = [];
  const flush = () => {
    if (cluster.length < 2) {
      cluster = [];
      return;
    }
    const durationMs = Math.max(0, cluster.at(-1).time - cluster[0].time);
    if (durationMs >= 100) {
      const perSample = durationMs / cluster.length;
      for (const item of cluster) weights.set(item.sample, perSample);
    }
    cluster = [];
  };
  for (const item of sorted) {
    const previous = cluster.at(-1);
    if (!previous) {
      cluster.push(item);
      continue;
    }
    const distance = Math.hypot(item.point.x - previous.point.x, item.point.y - previous.point.y);
    const gapMs = item.time - previous.time;
    if (distance <= 0.035 && gapMs >= 0 && gapMs <= 150) cluster.push(item);
    else {
      flush();
      cluster.push(item);
    }
  }
  flush();
  return weights;
}

function normalizeLayer(cells, valueSelector) {
  const raw = cells.map(valueSelector);
  const max = Math.max(0, ...raw.filter(Number.isFinite));
  return raw.map(value => Number.isFinite(value) && max > 0 ? value / max : null);
}

function aggregatePresentation(gazeSamples, emotionSamples, options = {}) {
  const gridWidth = Math.max(4, Math.min(64, Number(options.gridWidth || 16)));
  const gridHeight = Math.max(3, Math.min(36, Number(options.gridHeight || 9)));
  const maxAlignmentMs = Number(options.maxAlignmentMs || DEFAULT_MAX_ALIGNMENT_MS);
  const minGazeConfidence = Number(options.minGazeConfidence ?? 0.35);
  const minEmotionConfidence = Number(options.minEmotionConfidence ?? 0.35);
  const findEmotion = buildNearestLookup(emotionSamples);
  const valid = gazeSamples.map(sample => {
    const point = normalizedGaze(sample);
    const confidence = finite(sample?.confidence);
    const time = resolveMonotonicEpochMs(sample);
    if (!point || time == null || (confidence != null && confidence < minGazeConfidence)) return null;
    return { sample, point, time, confidence };
  }).filter(Boolean);
  const fixations = fixationWeights(valid);
  const cells = Array.from({ length: gridWidth * gridHeight }, () => ({
    samples: 0,
    confidenceSum: 0,
    confidenceCount: 0,
    fixationDurationMs: 0,
    valenceSum: 0,
    arousalSum: 0,
    engagementSum: 0,
    emotionWeight: 0
  }));
  const alignmentErrors = [];
  let matchedEmotionSamples = 0;
  for (const item of valid) {
    const gx = Math.min(gridWidth - 1, Math.floor(item.point.x * gridWidth));
    const gy = Math.min(gridHeight - 1, Math.floor(item.point.y * gridHeight));
    const cell = cells[gy * gridWidth + gx];
    cell.samples += 1;
    if (item.confidence != null) {
      cell.confidenceSum += item.confidence;
      cell.confidenceCount += 1;
    }
    cell.fixationDurationMs += fixations.get(item.sample) || 0;
    const aligned = findEmotion(item.time, maxAlignmentMs);
    if (!aligned) continue;
    const emotion = aligned.sample;
    const confidence = emotionConfidence(emotion);
    const valence = emotionValue(emotion, 'valence');
    const arousal = emotionValue(emotion, 'arousal');
    if (confidence == null || confidence < minEmotionConfidence || valence == null || arousal == null) continue;
    const engagement = finite(emotion?.engagement)
      ?? clamp(0.55 * clamp(arousal) + 0.45 * (item.confidence ?? minGazeConfidence));
    const weight = clamp(confidence) * clamp(item.confidence ?? minGazeConfidence);
    cell.valenceSum += valence * weight;
    cell.arousalSum += arousal * weight;
    cell.engagementSum += engagement * weight;
    cell.emotionWeight += weight;
    alignmentErrors.push(aligned.deltaMs);
    matchedEmotionSamples += 1;
  }
  const sampleCount = valid.length;
  const density = normalizeLayer(cells, cell => cell.samples);
  const fixation = normalizeLayer(cells, cell => cell.fixationDurationMs);
  const weighted = selector => cells.map(cell => cell.emotionWeight > 0
    ? selector(cell) / cell.emotionWeight
    : null);
  const layer = (id, values, valueDomain, algorithm) => ({
    id,
    values,
    valueDomain,
    sampleCount: id === 'density' || id === 'fixation' ? sampleCount : matchedEmotionSamples,
    noData: values.every(value => value == null),
    algorithm
  });
  return {
    schemaVersion: MULTIMODAL_HEATMAP_VERSION,
    coordinateSpace: 'stimulus_normalized_0_1',
    grid: { width: gridWidth, height: gridHeight },
    sampleCount,
    rejectedSampleCount: Math.max(0, gazeSamples.length - sampleCount),
    confidenceMean: mean(valid.map(item => item.confidence)),
    alignment: {
      maxAllowedMs: maxAlignmentMs,
      matchedSampleCount: matchedEmotionSamples,
      p95ErrorMs: percentile(alignmentErrors, 0.95),
      maxErrorMs: alignmentErrors.length ? Math.max(...alignmentErrors) : null
    },
    layers: {
      density: layer('density', density, [0, 1], 'normalized_sample_density.v1'),
      valence: layer('valence', weighted(cell => cell.valenceSum), [-1, 1], 'confidence_weighted_mean.v1'),
      arousal: layer('arousal', weighted(cell => cell.arousalSum), [0, 1], 'confidence_weighted_mean.v1'),
      engagement: layer('engagement', weighted(cell => cell.engagementSum), [0, 1], 'arousal_gaze_confidence_proxy.v1'),
      fixation: layer('fixation', fixation, [0, 1], 'dispersion_dwell_proxy.v1')
    },
    qc: {
      minGazeConfidence,
      minEmotionConfidence,
      missingEmotionPreserved: true,
      lowConfidenceExcluded: true
    }
  };
}

export function buildMultimodalHeatmaps(input = {}, options = {}) {
  const gazeSamples = Array.isArray(input.gazeSamples) ? input.gazeSamples : [];
  const emotionSamples = Array.isArray(input.emotionSamples) ? input.emotionSamples : [];
  const grouped = new Map();
  for (const sample of gazeSamples) {
    const key = presentationKey(sample);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(sample);
  }
  const maxPresentations = Math.max(1, Math.min(100, Number(options.maxPresentations || 50)));
  const entries = [...grouped.entries()].slice(0, maxPresentations);
  const presentations = entries.map(([key, samples]) => {
    const first = samples[0] || {};
    return {
      presentationId: key,
      blockId: first.blockId ?? null,
      attempt: first.attempt ?? null,
      trialId: first.trialId ?? null,
      stimulusId: first.stimulusId ?? null,
      stimulusName: first.stimulusName ?? null,
      stimulusType: first.stimulusType ?? null,
      ...aggregatePresentation(samples, emotionSamples, options)
    };
  });
  const alignmentErrors = presentations
    .map(item => item.alignment?.p95ErrorMs)
    .filter(Number.isFinite);
  return {
    schemaVersion: MULTIMODAL_HEATMAP_VERSION,
    coordinateSpace: 'stimulus_normalized_0_1',
    presentationCountTotal: grouped.size,
    presentationCountStored: presentations.length,
    presentationsTruncated: grouped.size > presentations.length,
    alignmentP95Ms: percentile(alignmentErrors, 0.95),
    presentations,
    legend: [
      { layer: 'density', label: 'Плотность взгляда', domain: [0, 1], palette: 'amber' },
      { layer: 'valence', label: 'Валентность (модельная оценка)', domain: [-1, 1], palette: 'blue_red' },
      { layer: 'arousal', label: 'Активация (модельная оценка)', domain: [0, 1], palette: 'cyan' },
      { layer: 'engagement', label: 'Вовлечённость (proxy)', domain: [0, 1], palette: 'teal' },
      { layer: 'fixation', label: 'Фиксации (proxy)', domain: [0, 1], palette: 'outline' }
    ],
    disclaimer: 'Emotion, engagement and fixation layers are research proxies and must be interpreted with QC and sample counts.'
  };
}
