const { validResult } = require('../security/passive-valid-time');

function validTimeMetadata(trial) {
  const present = !!trial && Object.hasOwn(trial, 'validTime');
  const valid = present && validResult(trial.validTime);
  return { validTimePresent: present, validTime: valid ? trial.validTime : null,
    actualDurationMs: valid ? trial.validTime.actualMs : null,
    ...(present && !valid ? { validTimeReason: 'valid_time_invalid' } : {}) };
}

function filterPresentation(entry, trial) {
  const metadata = validTimeMetadata(trial);
  if (!metadata.validTimePresent) return { ...entry, ...metadata };
  const unavailable = reason => ({ ...entry, ...metadata, validTimeReason: reason, gazeMissing: true,
    fixationPoints: [], fixationCountTotal: null, validObservationDurationMs: null, meanConfidence: null,
    grid: { width: 0, height: 0, values: [], maxValue: 0 } });
  if (!metadata.validTime) return unavailable('valid_time_invalid');
  if (entry.gazeMissing) return unavailable('gaze_presentation_missing');
  if (entry.fixationsTruncated === true || !Array.isArray(entry.fixationPoints)
    || Number.isFinite(entry.fixationCountTotal) && entry.fixationCountTotal > entry.fixationPoints.length) {
    return unavailable('gaze_fixations_truncated');
  }
  // Legacy offsets start at the first gaze capture, not necessarily stimulus onset.
  const offset = entry.presentationStartMs - trial.onsetMs;
  if (!Number.isFinite(entry.presentationStartMs) || !Number.isFinite(trial.onsetMs) || offset < 0) {
    return unavailable('valid_time_alignment_missing');
  }
  const segments = metadata.validTime.acceptedSegments;
  const points = [];
  for (const point of entry.fixationPoints) {
    if (![point?.startMs, point?.durationMs, point?.x, point?.y].every(Number.isFinite)
      || point.startMs < 0 || point.durationMs <= 0 || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      return unavailable('valid_time_fixation_invalid');
    }
    const startMs = point.startMs + offset, endMs = startMs + point.durationMs;
    // Capture/performance boundaries are stored at integer milliseconds. Match
    // ingest's 1 ms quantization tolerance, without clipping or resampling points.
    const index = segments.findIndex(segment => startMs >= segment.startMs - 1 && endMs <= segment.endMs + 1);
    // Never clip a fixation spanning a rejected interval into an invented fixation.
    if (index >= 0) points.push({ ...point, startMs, acceptedSegmentIndex: index });
  }
  points.sort((a, b) => a.startMs - b.startMs);
  if (points.some((point, index) => index && point.startMs < points[index - 1].startMs + points[index - 1].durationMs)) {
    return unavailable('valid_time_fixation_invalid');
  }
  if (!points.length) return unavailable('valid_time_gaze_missing');
  const observation = points.reduce((sum, point) => sum + point.durationMs, 0);
  if (observation > metadata.validTime.acceptedMs + 1) return unavailable('valid_time_fixation_invalid');
  const width = Number.isSafeInteger(entry.grid?.width) && entry.grid.width > 0 ? entry.grid.width : 32;
  const height = Number.isSafeInteger(entry.grid?.height) && entry.grid.height > 0 ? entry.grid.height : 18;
  if (width * height > 4096) return unavailable('valid_time_fixation_invalid');
  const values = Array(width * height).fill(0);
  for (const point of points) {
    const x = Math.min(width - 1, Math.floor(point.x * width));
    const y = Math.min(height - 1, Math.floor(point.y * height));
    values[y * width + x] += point.durationMs;
  }
  const confidences = points.filter(point => Number.isFinite(point.signalConfidence));
  const confidenceDuration = confidences.reduce((sum, point) => sum + point.durationMs, 0);
  return { ...entry, ...metadata, fixationPoints: points, fixationCountTotal: points.length,
    validObservationDurationMs: observation,
    meanConfidence: confidenceDuration ? confidences.reduce((sum, point) => sum + point.signalConfidence * point.durationMs, 0) / confidenceDuration : null,
    grid: { width, height, values, maxValue: Math.max(...values) },
    algorithm: { id: 'gaze-accepted-time', version: '1.0.0', parameters: {
      coordinateMappingVersion: entry.algorithm?.parameters?.coordinateMappingVersion ?? 'stage-rect.legacy',
      validTime: 'passive_valid_time.v1', observation: 'accepted_complete_fixation_duration',
      sourceVersion: entry.algorithm?.version ?? 'legacy' } } };
}

module.exports = { validTimeMetadata, filterPresentation };
