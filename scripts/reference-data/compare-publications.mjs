// Agreement between processing configurations, NOT accuracy against a sensor.
export function comparePublications(baseline, candidate, channel = 'bpm', toleranceMs = 500) {
  if (!['bpm', 'respiration'].includes(channel) || !Number.isFinite(toleranceMs) || toleranceMs < 0 || toleranceMs > 1000) {
    throw new Error('invalid_publication_comparison');
  }
  const extract = samples => {
    if (!Array.isArray(samples) || samples.length > 7200) throw new Error('invalid_publication_series');
    const values = []; let previous = -Infinity;
    for (const sample of samples) {
      if (!sample || !Number.isFinite(sample.t) || sample.t < 0 || sample.t < previous) throw new Error('invalid_publication_clock');
      const duplicate = sample.t === previous; previous = sample.t;
      const value = channel === 'bpm' ? sample.bpm : sample.respRate;
      const published = channel === 'bpm' ? sample.published === true && sample.held !== true
        : Number.isFinite(sample.respConf) && sample.respConf >= .20;
      if (!duplicate && published && Number.isFinite(value)) values.push({ t: sample.t, value });
    }
    return values;
  };
  const a = extract(baseline), b = extract(candidate), differences = [], offsets = [];
  let cursor = 0;
  for (const sample of b) {
    while (cursor < a.length && a[cursor].t < sample.t - toleranceMs) cursor++;
    if (cursor === a.length) break;
    let best = cursor;
    while (best + 1 < a.length && Math.abs(a[best + 1].t - sample.t) < Math.abs(a[best].t - sample.t)) best++;
    const delta = Math.abs(a[best].t - sample.t);
    if (delta <= toleranceMs) {
      cursor = best + 1; differences.push(Math.abs(a[best].value - sample.value)); offsets.push(delta);
    }
  }
  return { method: 'monotone_one_to_one_nearest_publication_pts.v1', interpretation: 'configuration_agreement_not_sensor_accuracy',
    channel, toleranceMs, baselinePublications: a.length, candidatePublications: b.length, pairedPublications: differences.length,
    unmatchedBaseline: a.length - differences.length, unmatchedCandidate: b.length - differences.length,
    meanAbsDifferencePerMinute: differences.length ? differences.reduce((s, v) => s + v, 0) / differences.length : null,
    maxAbsDifferencePerMinute: differences.length ? Math.max(...differences) : null,
    meanMatchedTimeOffsetMs: offsets.length ? offsets.reduce((s, v) => s + v, 0) / offsets.length : null };
}
