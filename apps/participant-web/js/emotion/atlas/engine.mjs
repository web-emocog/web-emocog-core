// Browser/Node ES module. The unit of every numeric movement value is the source
// blendshape coefficient. AU and anatomy fields are catalogue references.
export const ALGORITHM_VERSION = 'wecog-facial-atlas/1.0.1-pilot';

function finite(x) { return typeof x === 'number' && Number.isFinite(x); }

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mad(values, centre) {
  return median(values.map(value => Math.abs(value - centre)));
}

function inRange(x, min, max, name) {
  if (!finite(x) || x < min || x > max) throw new RangeError('Invalid ' + name);
  return x;
}

function requiredText(x, name) {
  if (typeof x !== 'string' || !x.trim()) throw new TypeError('Missing ' + name);
  return x;
}

function flipSide(name) {
  if (name.endsWith('Left')) return name.slice(0, -4) + 'Right';
  if (name.endsWith('Right')) return name.slice(0, -5) + 'Left';
  return name;
}

function isLateral(channel) {
  return channel.side === 'left' || channel.side === 'right' ||
    channel.direction === 'left' || channel.direction === 'right' ||
    flipSide(channel.name) !== channel.name;
}

function readScores(input, names) {
  const values = Object.create(null);
  const errors = Object.create(null);
  const seen = new Set();
  const insert = (key, score) => {
    if (!names.has(key)) return;
    if (seen.has(key)) {
      errors[key] = 'duplicate_channel';
    } else if (!finite(score) || score < 0 || score > 1) {
      errors[key] = 'invalid_score';
    }
    seen.add(key);
    values[key] = errors[key] ? null : score;
  };
  const raw = input?.categories ?? input;
  if (Array.isArray(raw)) {
    for (const item of raw) insert(item?.categoryName, item?.score);
  } else if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) insert(name, value);
  }
  for (const name of names) {
    if (seen.has(name)) continue;
    values[name] = null;
    errors[name] = 'missing_channel';
  }
  return {values, errors};
}

// Half-open windows end at an actual phase boundary or sampling instant.
function largestGap(times, start, end) {
  if (!times.length) return end - start;
  let largest = Math.max(times[0] - start, end - times.at(-1));
  for (let i = 1; i < times.length; i++) largest = Math.max(largest, times[i] - times[i - 1]);
  return largest;
}

export function createAtlas(catalog, options = {}) {
  requiredText(catalog?.version, 'catalog.version');
  if (!Array.isArray(catalog.channels) || !catalog.channels.length || !Array.isArray(catalog.zones)) {
    throw new TypeError('Expected versioned channels and zones');
  }
  const zoneIds = new Set(catalog.zones.map(zone => requiredText(zone.id, 'zone.id')));
  const allChannels = catalog.channels.map(channel => ({...channel}));
  const names = new Set(allChannels.map(c => requiredText(c.name, 'channel.name')));
  if (zoneIds.size !== catalog.zones.length || names.size !== allChannels.length) {
    throw new TypeError('Duplicate zone or channel in catalog');
  }
  for (const channel of allChannels) {
    if (!zoneIds.has(channel.zone)) throw new RangeError('Unknown zone in catalog: ' + channel.zone);
    if (!names.has(flipSide(channel.name))) throw new RangeError('Missing contralateral channel: ' + channel.name);
  }
  const suppliedZones = options.enabledZones ?? [...zoneIds];
  if (!Array.isArray(suppliedZones) || suppliedZones.some(zone => !zoneIds.has(zone))) {
    throw new RangeError('Unknown enabled zone');
  }
  const enabled = new Set(suppliedZones);
  const channels = allChannels.filter(c => c.name !== '_neutral' && enabled.has(c.zone));
  // A new instance is the only operation that changes identity, settings or baseline.
  const expectedFps = inRange(options.expectedFps ?? 20, 1, 240, 'expectedFps');
  const neutralDurationMs = inRange(options.neutralDurationMs ?? 5000, 5000, 120000, 'neutralDurationMs');
  const minNeutralSamples = inRange(options.minNeutralSamples ?? 25, 25, 100000, 'minNeutralSamples');
  if (!Number.isInteger(minNeutralSamples)) throw new TypeError('minNeutralSamples must be an integer');
  const intervalMs = 1000 / expectedFps;
  const maxNeutralGapMs = inRange(options.maxNeutralGapMs ?? Math.max(300, 2.5 * intervalMs),
    intervalMs, neutralDurationMs, 'maxNeutralGapMs');
  // A dispersion limit is study-specific and requires empirical selection.
  const requestedMad = options.maxNeutralMadByChannel ?? {};
  if (!requestedMad || typeof requestedMad !== 'object' || Array.isArray(requestedMad)) {
    throw new TypeError('maxNeutralMadByChannel must be a map of channel names to numeric limits');
  }
  const maxNeutralMadByChannel = Object.create(null);
  for (const [name, limit] of Object.entries(requestedMad)) {
    if (!names.has(name)) throw new RangeError('Unknown channel for neutral MAD threshold: ' + name);
    maxNeutralMadByChannel[name] = inRange(limit, 0, 1, 'maxNeutralMadByChannel');
  }
  Object.freeze(maxNeutralMadByChannel);
  const inputMirrored = options.inputMirrored ?? null;
  if (inputMirrored !== null && typeof inputMirrored !== 'boolean') throw new TypeError('Invalid inputMirrored');
  const provenance = Object.freeze({
    participantId: requiredText(options.participantId, 'participantId'),
    blockId: requiredText(options.blockId, 'blockId'),
    extractorId: requiredText(options.extractorId, 'extractorId'),
    catalogVersion: catalog.version, algorithmVersion: ALGORITHM_VERSION, inputMirrored,
    expectedFps, neutralDurationMs, minNeutralSamples, maxNeutralGapMs, maxNeutralMadByChannel,
    enabledZones: Object.freeze([...enabled])
  });

  let lastTimestamp = -Infinity;
  let neutralStart = null;
  let neutralFrames = [];
  let frozen = null;

  function computeCalibration(taskTimestamp) {
    const last = neutralFrames.at(-1)?.timestampMs;
    // Count at most one sampling interval after the final neutral frame.
    const end = last === undefined ? null : Math.min(taskTimestamp, last + intervalMs);
    const start = end === null ? null : end - neutralDurationMs;
    const frames = neutralFrames.filter(frame => frame.timestampMs >= start && frame.timestampMs < end);
    const stats = new Map();
    for (const c of channels) {
      const usable = frames.filter(frame => finite(frame.values[c.name]));
      const times = usable.map(frame => frame.timestampMs);
      const vals = usable.map(frame => frame.values[c.name]);
      const enoughTime = end !== null && end - neutralStart + 1e-6 >= neutralDurationMs;
      const gap = end === null ? null : largestGap(times, start, end);
      const reasons = [];
      if (!enoughTime) reasons.push('neutral_duration');
      if (vals.length < minNeutralSamples) reasons.push('neutral_count');
      if (gap === null || gap > maxNeutralGapMs + 1e-6) reasons.push('neutral_gap');
      const observedMedian = median(vals);
      const noise = mad(vals, observedMedian);
      if (noise !== null && noise > (maxNeutralMadByChannel[c.name] ?? Infinity)) reasons.push('neutral_dispersion');
      stats.set(c.name, {n:vals.length, startMs:start, endMs:end, largestGapMs:gap,
        median:reasons.length ? null : observedMedian, observedMedian, mad:noise, reasons:Object.freeze(reasons)});
    }
    return stats;
  }

  function readiness(timestampMs = lastTimestamp) {
    const stats = frozen ?? computeCalibration(finite(timestampMs) ? timestampMs : 0);
    const readyChannels = [...stats].filter(([, state]) => !state.reasons.length).map(([name]) => name);
    return {frozen:!!frozen, readyAny:readyChannels.length > 0,
      readyAll:readyChannels.length > 0 && readyChannels.length === channels.length,
      readyCount:readyChannels.length, totalChannels:channels.length, readyChannels,
      channels:Object.fromEntries([...stats].map(([name, state]) => [name, {...state, reasons:[...state.reasons]}]))};
  }

  function calibration() {
    if (!frozen) return {frozen:false, channels:null};
    const entries = [...frozen].map(([name, stats]) => [name, {...stats, reasons:[...stats.reasons]}]);
    return {frozen:true, channels:Object.fromEntries(entries)};
  }

  function observe(frame = {}) {
    const t = frame.timestampMs;
    const scores = readScores(frame.blendshapes, names);
    const phase = frame.phase;
    const reasons = [];
    const record = {timestampMs:finite(t) ? t : null, phase:phase ?? null, provenance,
      status:'insufficient_data', reasons, raw:scores.values, observations:[]};
    if (!finite(t) || t < 0) reasons.push('invalid_timestamp');
    else if (t <= lastTimestamp) reasons.push('nonmonotonic_timestamp');
    if (phase !== 'neutral' && phase !== 'task') reasons.push('invalid_phase');
    if (frame.extractorId !== undefined && frame.extractorId !== provenance.extractorId) reasons.push('extractor_changed');
    if (frame.inputMirrored !== undefined && frame.inputMirrored !== inputMirrored) reasons.push('orientation_changed');
    if (frozen && phase === 'neutral') reasons.push('baseline_frozen');
    if (reasons.length) return record;
    lastTimestamp = t;
    if (phase === 'neutral' && neutralStart === null) neutralStart = t;
    if (phase === 'task' && !frozen) {
      frozen = computeCalibration(t);
      neutralFrames = [];
    }
    if (frame.qualityOk !== true) reasons.push(frame.qualityOk === false ? 'frame_qc_failed' : 'frame_qc_unknown');
    if (channels.length === 0) reasons.push('no_enabled_channels');
    const validNeutral = Object.create(null);
    let interpreted = 0;
    for (const c of channels) {
      const errors = [...reasons];
      const name = inputMirrored === true ? flipSide(c.name) : c.name;
      if (inputMirrored === null && isLateral(c)) errors.push('unknown_orientation');
      const zoneOk = frame.zoneQuality?.[c.zone];
      if (zoneOk !== true) errors.push(zoneOk === false ? 'zone_qc_failed' : 'zone_qc_unknown');
      if (scores.errors[name]) errors.push(scores.errors[name]);
      const absolute = errors.length ? null : scores.values[name];
      if (absolute !== null && phase === 'neutral') validNeutral[c.name] = absolute;
      const base = frozen?.get(c.name);
      if (base) errors.push(...base.reasons);
      const valid = absolute !== null && base?.median != null;
      if (valid) interpreted++;
      record.observations.push({
        channel:c.name, sourceChannel:name, zone:c.zone, side:c.side, direction:c.direction ?? null,
        proxy:c.proxy, actionUnit:c.actionUnit ?? null, absolute, baseline:base?.median ?? null,
        delta:valid ? absolute - base.median : null,
        status:errors.length ? 'insufficient_data' : (phase === 'neutral' ? 'calibrating' : 'ok'),
        reasons:errors
      });
    }
    if (phase === 'neutral') {
      // Retain a fixed time horizon and a bounded number of frames even for malformed high rates.
      const oldest = t - neutralDurationMs - intervalMs;
      while (neutralFrames.length && neutralFrames[0].timestampMs < oldest) neutralFrames.shift();
      const cap = Math.ceil((neutralDurationMs + intervalMs) * 240 / 1000) + 2;
      if (neutralFrames.length >= cap) neutralFrames.shift();
      neutralFrames.push({timestampMs:t, values:validNeutral});
      if (Object.keys(validNeutral).length) record.status = 'calibrating';
    } else if (interpreted) {
      record.status = interpreted === channels.length ? 'ok' : 'partial';
    }
    return record;
  }
  return Object.freeze({observe, readiness, calibration, provenance});
}

function canonicalAU(id) {
  const match = typeof id === 'string' && /^AU0*(\d+)$/i.exec(id);
  return match ? 'AU' + Number(match[1]) : null;
}

// Materialise labels only when displaying/exporting an annotated view.
export function annotateObservations(record, catalog) {
  if (record.provenance.catalogVersion !== catalog.version) throw new RangeError('Catalog version mismatch');
  const channelByName = new Map(catalog.channels.map(c => [c.name, c]));
  const byAU = new Map((catalog.anatomy ?? []).map(a => [canonicalAU(a.au), a]).filter(([key]) => key));
  // These are catalogue cross-references to contexts studied in the literature.
  // A shared AU ID does not constitute detection of a complete pattern or an affect.
  const references = (catalog.reactionEvidence ?? []).map(reference => ({
    reference, auIds:new Set((reference.pattern.match(/AU[0-9]+/gi) ?? []).map(canonicalAU))
  }));
  return record.observations.map(obs => {
    const au = canonicalAU(obs.actionUnit);
    return {
      ...obs, channelReference:channelByName.get(obs.channel) ?? null,
      anatomyReference:byAU.get(au) ?? null,
      protocolReferences:references.filter(entry => entry.auIds.has(au)).map(entry => entry.reference)
    };
  });
}

// Summaries use accepted delta values only. A global or local missing signal
// decreases effective coverage. All records must belong to one frozen block.
export function summarizeWindow(records, {endMs, durationMs, expectedFps, minCoverage = 0.65, maxGapMs} = {}) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (!finite(endMs) || ![1000, 2000].includes(durationMs)) throw new RangeError('Use a 1 s or 2 s window');
  const startMs = endMs - durationMs;
  const rows = records.filter(r => r.phase === 'task' && finite(r.timestampMs) &&
    r.timestampMs >= startMs && r.timestampMs < endMs && !r.reasons?.includes('nonmonotonic_timestamp'));
  if (!rows.length) return {startMs,endMs,durationMs,status:'insufficient_data',reasons:['empty_window'],channels:[]};
  const p = rows[0].provenance;
  const identity = JSON.stringify(p);
  if (rows.some(r => JSON.stringify(r.provenance) !== identity)) throw new RangeError('Mixed provenance or block');
  const fps = inRange(expectedFps ?? p.expectedFps, 1, 240, 'expectedFps');
  const interval = 1000 / fps;
  const gapLimit = inRange(maxGapMs ?? Math.min(durationMs, Math.max(250, 2.5 * interval)), interval, durationMs, 'maxGapMs');
  inRange(minCoverage, Number.EPSILON, 1, 'minCoverage');
  const nExpected = Math.ceil(durationMs * fps / 1000);
  const nRequired = Math.ceil(nExpected * minCoverage);
  const ordered = [...rows].sort((a, b) => a.timestampMs - b.timestampMs);
  if (ordered.some((row, i) => i && row.timestampMs === ordered[i-1].timestampMs)) {
    throw new RangeError('Repeated window timestamp');
  }
  const series = new Map();
  for (const row of ordered) {
    for (const obs of row.observations) {
      if (!series.has(obs.channel)) series.set(obs.channel, []);
      if (obs.status === 'ok' && finite(obs.delta)) series.get(obs.channel).push([row.timestampMs, obs.delta]);
    }
  }
  const channels = [];
  for (const [channel, samples] of series) {
    const n = samples.length;
    const times = samples.map(s => s[0]);
    const deltas = samples.map(s => s[1]);
    const gap = largestGap(times, startMs, endMs);
    const reasons = [];
    if (n < nRequired) reasons.push('window_count');
    if (gap > gapLimit + 1e-6) reasons.push('window_gap');
    const centre = reasons.length ? null : median(deltas);
    channels.push({channel, n, nExpected, nRequired, coverage:Math.min(1, n / nExpected), largestGapMs:gap,
      medianDelta:centre, madDelta:centre === null ? null : mad(deltas, centre), reasons});
  }
  const valid = channels.filter(c => !c.reasons.length).length;
  return {startMs,endMs,durationMs,expectedFps:fps,minCoverage,maxGapMs:gapLimit,provenance:p,
    status:!valid ? 'insufficient_data' : (valid === channels.length ? 'ok' : 'partial'),
    reasons:valid ? [] : ['no_valid_channel'], channels};
}
