// Identity is session-local. Never infer an attempt from a suffix in a trial ID.
const text = value => value == null ? null : String(value);
const same = (a, b) => a != null && b != null && String(a) === String(b);
const stimulus = value => String(value ?? '').replace(/^api:/, '');
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
function codes(result) {
  const values = Array.isArray(result?.qualityIssueCodes) ? result.qualityIssueCodes : [];
  // Only a known stored invalidation code is promoted; never reflect arbitrary messages.
  const invalidatedByReload = result?.qualityValid === false && result.invalidationReason === 'page_reloaded';
  const filtered = [...new Set([...(invalidatedByReload ? ['page_reloaded'] : []), ...values]
    .filter(code => typeof code === 'string').map(code => code.slice(0, 128)))].slice(0, 32);
  return !filtered.length && result?.qualityValid === false ? ['quality_invalid'] : filtered;
}

const reasonLabels = new Map([
    ['protocol_qc_fpsstable', ['Частота анализа ниже порога протокола', 'Analysis frame rate is below the protocol threshold']],
    ['protocol_qc_gazevalid', ['Доля валидного взгляда ниже порога протокола', 'Valid-gaze fraction is below the protocol threshold']],
    ['protocol_qc_facedetected', ['Лицо недостаточно видно', 'Insufficient face visibility']],
    ['protocol_qc_lighting', ['Освещение не соответствует требованиям протокола', 'Lighting is below the protocol threshold']],
    ['head_pose', ['Положение головы мешает измерению', 'Head pose interferes with measurement']],
    ['low_light', ['Недостаточное освещение', 'Insufficient lighting']],
    ['face_missing', ['Лицо не видно', 'Face is not visible']],
    ['face_occluded', ['Лицо перекрыто', 'Face is occluded']],
    ['presentation_attempt_ambiguous', ['Старые данные не позволяют разделить попытки', 'Legacy data cannot separate attempts']],
    ['trial_result_missing', ['Попытка не завершена', 'Attempt is incomplete']],
    ['page_reloaded', ['Попытка прервана перезагрузкой страницы', 'Attempt was interrupted by a page reload']],
    ['quality_invalid', ['Не выполнено правило качества', 'Quality rule was not met']],
]);
function qualityReasons(values) {
  return values.map(code => { const pair = reasonLabels.get(code.toLowerCase());
    return { code, label: { ru: pair?.[0] || `Не выполнено правило качества: ${code}`,
      en: pair?.[1] || `Quality rule was not met: ${code}` } }; });
}

function matchesTrialFilters(entry, query) {
  const filters = query?.filters || {};
  return (!(filters.blockIds?.length) || filters.blockIds.some(id => same(id, entry.blockId ?? entry.block)))
    && (!(filters.stimulusIds?.length) || filters.stimulusIds.some(id => stimulus(id) === stimulus(entry.stimulusId)))
    && (!(filters.conditionIds?.length) || filters.conditionIds.some(id => same(id, entry.condition)));
}

function trials(row, query) {
  return (Array.isArray(row.features_payload?.cognitiveResults) ? row.features_payload.cognitiveResults : [])
    .filter(result => result && typeof result === 'object' && !Array.isArray(result)
      && matchesTrialFilters(result, query));
}

function presentationAttempts(row) {
  const results = trials(row);
  const sequence = row.features_payload?.experimentMeta?.presentationSequence;
  const resultsTracked = Number.isSafeInteger(sequence) && sequence > 0;
  const analytics = row.features_payload?.gaze_analytics;
  const entries = analytics?.schemaVersion === 'gaze_analytics.v1' && Array.isArray(analytics.presentations)
    ? analytics.presentations.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry)) : [];
  const trialKey = entry => JSON.stringify([text(entry.blockId ?? entry.block), text(entry.trialId), stimulus(entry.stimulusId)]);
  const byTrial = new Map();
  for (const result of results) {
    if (result.trialId == null) continue;
    const key = trialKey(result);
    if (!byTrial.has(key)) byTrial.set(key, { all: [], withoutId: [], byId: new Map() });
    const group = byTrial.get(key);
    group.all.push(result);
    if (result.presentationId == null) group.withoutId.push(result);
    else {
      const id = text(result.presentationId);
      if (!group.byId.has(id)) group.byId.set(id, []);
      group.byId.get(id).push(result);
    }
  }
  const covered = new Set();
  const uses = new Map();
  const exactUses = new Set();
  const scopes = entries.map(entry => {
    const group = byTrial.get(trialKey(entry));
    const id = text(entry.presentationId);
    const exact = group?.byId.get(id) || [];
    exact.forEach(result => exactUses.add(result));
    return { hasScoped: Boolean(group), fallback: (id === null ? group?.all : group?.withoutId) || [], exact };
  });
  const matches = entries.map((entry, index) => {
    const { hasScoped, fallback, exact } = scopes[index];
    // Fall back only when an identity is absent, never when two recorded IDs disagree.
    const candidates = exact.length ? exact : fallback.filter(result =>
      !exactUses.has(result)
      && (entry.attempt == null || same(result.attempt, entry.attempt)));
    candidates.forEach(result => uses.set(result, (uses.get(result) || 0) + 1));
    return { hasScoped, candidates };
  });
  const mapped = entries.map((entry, index) => {
    const { hasScoped, candidates } = matches[index];
    const ambiguous = candidates.length > 1 || candidates.some(result => uses.get(result) > 1);
    candidates.forEach(result => covered.add(result));
    const result = !ambiguous && candidates.length === 1 ? candidates[0] : null;
    const incomplete = !result && (hasScoped || resultsTracked);
    const qualityValid = ambiguous ? null : typeof result?.qualityValid === 'boolean' ? result.qualityValid : null;
    const qualityIssueCodes = ambiguous ? ['presentation_attempt_ambiguous'] : incomplete ? ['trial_result_missing']
      : qualityValid === false && !codes(result).length ? ['quality_invalid'] : codes(result);
    return { ...entry, presentationId: text(entry.presentationId), trialId: text(entry.trialId),
      condition: text(result?.condition),
      attempt: number(entry.attempt) ?? number(result?.attempt),
      sourceTrialIndex: number(result?.sourceTrialIndex),
      presentationIndex: number(result?.presentationIndex),
      presentationStartMs: number(result?.onsetMs) ?? number(entry.presentationStartMs),
      attemptStatus: ambiguous ? 'ambiguous' : incomplete ? 'incomplete' : qualityValid === false ? 'excluded' : qualityValid === true ? 'accepted' : 'unknown',
      qualityValid, qualityIssueCodes, qualityReasons: qualityReasons(qualityIssueCodes),
      includedInDefault: !ambiguous && !incomplete && qualityValid !== false,
      attemptMethod: 'presentation_attempts.v1', originalIndex: index };
  });
  results.forEach((result, index) => {
    if (covered.has(result) || (result.trialId == null && result.presentationId == null)
      || result.stimulusId == null || (result.blockId ?? result.block) == null) return;
    const qualityValid = typeof result.qualityValid === 'boolean' ? result.qualityValid : null;
    const reasons = codes(result);
    mapped.push({ blockId: text(result.blockId ?? result.block), trialId: text(result.trialId),
      condition: text(result.condition),
      stimulusId: text(result.stimulusId), presentationId: text(result.presentationId) ?? `no-gaze-result-${index + 1}`,
      attempt: number(result.attempt), sourceTrialIndex: number(result.sourceTrialIndex),
      presentationIndex: number(result.presentationIndex), presentationStartMs: number(result.onsetMs),
      qualityValid, attemptStatus: qualityValid === false ? 'excluded' : qualityValid === true ? 'accepted' : 'unknown',
      qualityIssueCodes: reasons, qualityReasons: qualityReasons(reasons), includedInDefault: false,
      gazeMissing: true, attemptMethod: 'presentation_attempts.v1', originalIndex: entries.length + index });
  });
  return mapped.sort((a, b) => (a.presentationStartMs ?? Infinity) - (b.presentationStartMs ?? Infinity)
    || a.originalIndex - b.originalIndex)
    .map((entry, index) => ({ ...entry, presentationIndex: entry.presentationIndex ?? index + 1 }));
}

function attemptMetadata(entry) {
  return Object.fromEntries(['presentationId', 'trialId', 'attempt', 'sourceTrialIndex', 'presentationIndex',
    'presentationStartMs', 'attemptStatus', 'qualityValid', 'qualityIssueCodes', 'qualityReasons', 'includedInDefault', 'attemptMethod']
    .map(key => [key, entry?.[key] ?? null]));
}

function trialSummary(row, query, presentations = presentationAttempts(row)) {
  const all = trials(row);
  const selected = all.map((result, index) => ({ result, index }))
    .filter(({ result }) => matchesTrialFilters(result, query));
  const keyed = new Map();
  const key = (entry, field) => JSON.stringify([
    text(entry.blockId ?? entry.block), text(entry.trialId), stimulus(entry.stimulusId), field, text(entry[field])
  ]);
  for (const entry of presentations) {
    if (entry.blockId == null || entry.trialId == null) continue;
    for (const field of ['presentationId', 'attempt']) {
      if (entry[field] == null) continue;
      const id = key(entry, field);
      if (!keyed.has(id)) keyed.set(id, []);
      keyed.get(id).push(entry);
    }
  }
  const excluded = selected.filter(({ result }) => result.qualityValid === false);
  return {
    counts: { valid: selected.length - excluded.length, excluded: excluded.length, total: selected.length },
    exclusions: excluded.map(({ result, index }) => {
      const field = result.presentationId != null ? 'presentationId' : 'attempt';
      const matches = keyed.get(key(result, field)) || [];
      const match = matches.length === 1 && matches[0].attemptStatus !== 'ambiguous' ? matches[0] : null;
      const issueCodes = codes(result);
      return { ...attemptMetadata(match), attemptStatus: 'excluded', qualityValid: false, includedInDefault: false,
        presentationId: text(result.presentationId) ?? match?.presentationId ?? null,
        presentationIndex: number(result.presentationIndex) ?? match?.presentationIndex ?? null,
        presentationStartMs: number(result.onsetMs) ?? match?.presentationStartMs ?? null,
        level: 'trial', entityId: text(result.trialId) ?? text(result.presentationId) ?? `legacy-result-${index + 1}`, trialId: text(result.trialId),
        blockId: text(result.blockId ?? result.block), stimulusId: text(result.stimulusId),
        attempt: number(result.attempt), sourceTrialIndex: number(result.sourceTrialIndex),
        qualityIssueCodes: issueCodes, qualityReasons: qualityReasons(issueCodes.length ? issueCodes : ['quality_invalid']),
        reasonCode: issueCodes[0] || 'quality_invalid', channel: 'task' };
    }),
  };
}

module.exports = { presentationAttempts, attemptMetadata, trialSummary, taskTrials: trials, matchesTrialFilters };
