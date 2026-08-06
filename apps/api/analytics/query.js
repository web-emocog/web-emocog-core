const METRIC_CATALOG = require('../../web/docs/analytics-contract/metric-catalog-v1.json');

const QUERY_KEYS = new Set([
  'schemaVersion', 'mode', 'analysisLevel', 'projectId', 'protocolId',
  'protocolVersion', 'metricIds', 'filters', 'comparison',
]);
const FILTER_KEYS = new Set([
  'participantIds', 'sessionIds', 'groupIds', 'conditionIds', 'blockIds',
  'stimulusIds', 'aoiIds', 'qcMode', 'qcChannels', 'minValidFraction',
  'minSignalConfidence', 'dateFrom', 'dateTo', 'deviceClasses',
  'includeIncompleteSessions',
]);
const COMPARISON_KEYS = new Set(['factorIds', 'contrastIds']);
const ID_ARRAY_KEYS = [
  'participantIds', 'sessionIds', 'groupIds', 'conditionIds', 'blockIds',
  'stimulusIds', 'aoiIds', 'deviceClasses',
];
const QC_CHANNELS = new Set([
  'task', 'gaze', 'blink', 'face', 'head_hands', 'rppg', 'respiration',
]);
const METRIC_IDS = new Set((METRIC_CATALOG.metrics || []).map(metric => metric.id));

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unknownKeys(value, allowlist) {
  return Object.keys(value || {}).filter(key => !allowlist.has(key));
}

function normalizeDatabaseId(value, field, errors) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value)
    ? Number.parseInt(value, 10)
    : value;
  if (!Number.isInteger(normalized) || normalized < 1) {
    errors.push(`${field} must be a positive integer`);
    return null;
  }
  return normalized;
}

function normalizeId(value, field, errors) {
  if (Number.isInteger(value) && value >= 1) return value;
  if (typeof value === 'string' && value.length >= 1 && value.length <= 128) return value;
  errors.push(`${field} contains an invalid identifier`);
  return null;
}

function uniqueArray(value, field, errors, maxItems = 500) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maxItems) {
    errors.push(`${field} must be an array with at most ${maxItems} items`);
    return [];
  }
  const result = [];
  const seen = new Set();
  value.forEach(item => {
    const normalized = normalizeId(item, field, errors);
    if (normalized == null) return;
    const key = `${typeof normalized}:${String(normalized)}`;
    if (seen.has(key)) {
      errors.push(`${field} must contain unique values`);
      return;
    }
    seen.add(key);
    result.push(normalized);
  });
  return result;
}

function normalizeNullableFraction(value, field, errors) {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    errors.push(`${field} must be null or a number between 0 and 1`);
    return null;
  }
  return value;
}

function normalizeDate(value, field, errors) {
  if (value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    errors.push(`${field} must be null or an ISO date-time`);
    return null;
  }
  return new Date(value).toISOString();
}

function validateAnalyticsQuery(input) {
  const errors = [];
  if (!plainObject(input)) return { ok: false, errors: ['body must be an object'] };
  const extra = unknownKeys(input, QUERY_KEYS);
  if (extra.length) errors.push(`unknown query fields: ${extra.join(', ')}`);

  if (input.schemaVersion !== '1.0') errors.push('schemaVersion must equal 1.0');
  if (!['session', 'group'].includes(input.mode)) errors.push('mode must be session or group');
  if (!['level_1', 'level_2', 'level_3'].includes(input.analysisLevel)) {
    errors.push('analysisLevel is invalid');
  }
  const projectId = normalizeDatabaseId(input.projectId, 'projectId', errors);
  const protocolId = normalizeDatabaseId(input.protocolId, 'protocolId', errors);
  const protocolVersion = typeof input.protocolVersion === 'string'
    ? input.protocolVersion.trim()
    : '';
  if (!protocolVersion || protocolVersion.length > 64) errors.push('protocolVersion is invalid');

  if (!Array.isArray(input.metricIds) || input.metricIds.length < 1 || input.metricIds.length > 50) {
    errors.push('metricIds must contain 1-50 values');
  }
  const metricIds = [];
  const seenMetrics = new Set();
  (Array.isArray(input.metricIds) ? input.metricIds : []).forEach(metricId => {
    if (typeof metricId !== 'string' || !METRIC_IDS.has(metricId)) {
      errors.push(`unknown metricId: ${String(metricId)}`);
    } else if (seenMetrics.has(metricId)) {
      errors.push('metricIds must contain unique values');
    } else {
      seenMetrics.add(metricId);
      metricIds.push(metricId);
    }
  });

  const sourceFilters = plainObject(input.filters) ? input.filters : {};
  if (!plainObject(input.filters)) errors.push('filters must be an object');
  const extraFilters = unknownKeys(sourceFilters, FILTER_KEYS);
  if (extraFilters.length) errors.push(`unknown filter fields: ${extraFilters.join(', ')}`);
  const filters = {};
  ID_ARRAY_KEYS.forEach(key => {
    filters[key] = uniqueArray(sourceFilters[key], `filters.${key}`, errors);
  });
  filters.qcMode = sourceFilters.qcMode;
  if (!['valid_only', 'valid_and_borderline', 'all'].includes(filters.qcMode)) {
    errors.push('filters.qcMode is invalid');
  }
  filters.qcChannels = uniqueArray(sourceFilters.qcChannels, 'filters.qcChannels', errors, 7)
    .map(String);
  if (!Array.isArray(sourceFilters.qcChannels)) errors.push('filters.qcChannels is required');
  filters.qcChannels.forEach(channel => {
    if (!QC_CHANNELS.has(channel)) errors.push(`unknown QC channel: ${channel}`);
  });
  filters.minValidFraction = normalizeNullableFraction(
    sourceFilters.minValidFraction,
    'filters.minValidFraction',
    errors
  );
  filters.minSignalConfidence = normalizeNullableFraction(
    sourceFilters.minSignalConfidence,
    'filters.minSignalConfidence',
    errors
  );
  filters.dateFrom = normalizeDate(sourceFilters.dateFrom, 'filters.dateFrom', errors);
  filters.dateTo = normalizeDate(sourceFilters.dateTo, 'filters.dateTo', errors);
  filters.includeIncompleteSessions = sourceFilters.includeIncompleteSessions === true;
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    errors.push('filters.dateFrom must not be later than filters.dateTo');
  }
  if (input.mode === 'session' && filters.sessionIds.length !== 1) {
    errors.push('session mode requires exactly one filters.sessionIds value');
  }

  let comparison;
  if (input.comparison != null) {
    if (!plainObject(input.comparison)) {
      errors.push('comparison must be an object');
    } else {
      const extraComparison = unknownKeys(input.comparison, COMPARISON_KEYS);
      if (extraComparison.length) errors.push(`unknown comparison fields: ${extraComparison.join(', ')}`);
      comparison = {
        factorIds: uniqueArray(input.comparison.factorIds, 'comparison.factorIds', errors, 20).map(String),
        contrastIds: uniqueArray(input.comparison.contrastIds, 'comparison.contrastIds', errors, 20).map(String),
      };
      if (!comparison.factorIds.length || !comparison.contrastIds.length) {
        errors.push('comparison requires factorIds and contrastIds');
      }
    }
  }
  if (input.analysisLevel === 'level_2' && !comparison) {
    errors.push('level_2 analysis requires comparison');
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: '1.0',
      mode: input.mode,
      analysisLevel: input.analysisLevel,
      projectId,
      protocolId,
      protocolVersion,
      metricIds,
      filters,
      ...(comparison ? { comparison } : {}),
    },
  };
}

module.exports = {
  METRIC_CATALOG,
  METRIC_IDS,
  QC_CHANNELS,
  validateAnalyticsQuery,
};
