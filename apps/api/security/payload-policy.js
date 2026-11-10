const TOP_LEVEL_FIELDS = new Set([
  'schemaVersion',
  'delivery',
  'ids',
  'meta',
  'precheck',
  'qcSummary',
  'attentionMetrics',
  'blink_summary',
  'perclos_summary',
  'body_pose_summary',
  'audio_summary',
  'multimodal_summary',
  'multimodal_heatmap',
  'blocks',
  'emotion_summary',
  'bpm_summary',
  'rppg_summary',
  'respiration_summary',
  'physiology_intervals',
  'experimentMeta',
  'cognitiveResults',
  'gazeValidation',
  'gaze_analytics',
  'rt_alignment',
  'events',
  'lifecycle',
  'startTime',
  'testHub',
  'gazeTests',
  'quality_assessment',
]);
const IDS_FIELDS = new Set(['session', 'participant', 'participantAlias', 'invitationCode']);
const META_FIELDS = new Set(['user', 'tech']);
const META_USER_FIELDS = new Set(['interfaceLanguage']);
const AUDIO_SUMMARY_FIELDS = new Set([
  'schemaVersion',
  'algorithmVersion',
  'status',
  'enabled',
  'consentGranted',
  'permission',
  'rawAudioStored',
  'rawAudioTransmitted',
  'sampleRate',
  'windowDurationMs',
  'windowCount',
  'acceptedWindowCount',
  'rejectedWindowCount',
  'droppedWindowCount',
  'durationMs',
  'qualityMean',
  'reliabilityMean',
  'markers',
  'windows',
  'provenance',
  'disclaimer',
]);
const MULTIMODAL_SUMMARY_FIELDS = new Set([
  'schemaVersion',
  'enabled',
  'gamerMode',
  'timebase',
  'head',
  'body',
  'eventCount',
  'rawVideoStored',
  'rawLandmarksStored',
  'disclaimer',
]);
const MULTIMODAL_HEATMAP_FIELDS = new Set([
  'schemaVersion',
  'coordinateSpace',
  'presentationCountTotal',
  'presentationCountStored',
  'presentationsTruncated',
  'alignmentP95Ms',
  'presentations',
  'legend',
  'disclaimer',
]);
const LIFECYCLE_FIELDS = new Set([
  'schemaVersion',
  'state',
  'status',
  'startedAt',
  'lastTransitionAt',
  'completedAt',
  'finishAttemptId',
  'currentBlock',
  'repeatQueue',
  'activeIssues',
  'modules',
]);
const SESSION_STATES = new Set([
  'idle',
  'starting',
  'instruction',
  'running',
  'paused',
  'quality_error',
  'technical_error',
  'finishing',
  'completed',
  'failed',
]);
const EVENT_CATEGORIES = new Set([
  'lifecycle',
  'quality',
  'technical',
  'block',
  'input',
  'upload',
  'module',
]);
const EVENT_SEVERITIES = new Set(['info', 'warning', 'error', 'fatal']);
const OPTIONAL_OBJECT_FIELDS = [
  'precheck',
  'qcSummary',
  'attentionMetrics',
  'blink_summary',
  'perclos_summary',
  'body_pose_summary',
  'audio_summary',
  'multimodal_summary',
  'multimodal_heatmap',
  'emotion_summary',
  'bpm_summary',
  'rppg_summary',
  'respiration_summary',
  'experimentMeta',
  'gazeValidation',
  'gaze_analytics',
  'testHub',
  'gazeTests',
  'quality_assessment',
];
const PII_KEY_TOKEN_PATTERN = /(?:^|_)(?:email|phone|telephone|tel|telegram|whatsapp|first_name|last_name|middle_name|full_name|surname|address|passport|snils|oms|birth_date|ip_address)(?:_|$)/i;
const EMAIL_VALUE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_PII_PATTERN = /[?&](?:email|phone|name|address|passport|snils|oms)=/i;
const PHONE_VALUE_PATTERN = /^\s*\+?(?:\d[\s().-]*){10,15}\s*$/;
const RAW_MEDIA_KEY_PATTERN = /^(?:raw_?(?:audio|video|image|frame|landmarks|samples)|pcm_?samples|audio_?(?:blob|data|bytes|base64)|video_?(?:blob|data|bytes|base64|frames)|image_?(?:blob|data|bytes|base64))$/i;

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 12,
  maxArrayLength: 5000,
  maxObjectKeys: 100000,
  maxStringLength: 4096,
  maxEvents: 250,
  maxBlocks: 200,
  maxCognitiveResults: 5000,
});

const PUBLIC_VALIDATION_FIELDS = new Set([...TOP_LEVEL_FIELDS, ...IDS_FIELDS, 'sequence', 'kind']);
function collectValidationFields(rule) {
  for (const [key, child] of Object.entries(rule.properties || {})) {
    PUBLIC_VALIDATION_FIELDS.add(key);
    collectValidationFields(child);
  }
  for (const child of Object.values(rule.$defs || {})) collectValidationFields(child);
  for (const child of rule.anyOf || []) collectValidationFields(child);
  if (rule.items) collectValidationFields(rule.items);
  if (typeof rule.additionalProperties === 'object') collectValidationFields(rule.additionalProperties);
}
const { schema: sessionDataSchema, validateSessionDataSchema } = require('./session-data-schema');
collectValidationFields(sessionDataSchema);

function publicValidationPath(path) {
  // Paths may contain attacker-chosen map keys. Only expose known field names and small array indexes.
  return path.split('/').map((part, index) => index === 0 || PUBLIC_VALIDATION_FIELDS.has(part)
    || (/^(?:0|[1-9]\d{0,3})$/.test(part) && Number(part) < DEFAULT_LIMITS.maxArrayLength) ? part : '*').join('/');
}

function addError(errors, path, keyword, message) {
  errors.push({ path: path || '/', keyword, message });
}

function validateKnownObjectFields(value, allowed, path, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addError(errors, `${path}/${key}`, 'additionalProperties', 'unknown field');
    }
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateOptionalObject(payload, key, errors) {
  const value = payload[key];
  if (value !== undefined && value !== null && !isObject(value)) {
    addError(errors, `/${key}`, 'type', `${key} must be an object or null`);
  }
}

function validateOptionalString(value, path, maxLength, errors) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string') {
    addError(errors, path, 'type', 'value must be a string or null');
    return;
  }
  if (value.length > maxLength) {
    addError(errors, path, 'maxLength', `maximum string length is ${maxLength}`);
  }
}

function isValidTimestamp(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
  return typeof value === 'string'
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function validateLifecycle(lifecycle, errors) {
  if (!isObject(lifecycle)) {
    addError(errors, '/lifecycle', 'required', 'lifecycle object is required');
    return;
  }
  validateKnownObjectFields(lifecycle, LIFECYCLE_FIELDS, '/lifecycle', errors);
  if (lifecycle.schemaVersion !== 'session_lifecycle.v1') {
    addError(
      errors,
      '/lifecycle/schemaVersion',
      'const',
      'session_lifecycle.v1 is required'
    );
  }
  if (!SESSION_STATES.has(lifecycle.state)) {
    addError(errors, '/lifecycle/state', 'enum', 'invalid session state');
  }
  const expectedStatus = lifecycle.state === 'completed'
    ? 'completed'
    : (lifecycle.state === 'failed' ? 'failed' : 'in_progress');
  if (lifecycle.status !== expectedStatus) {
    addError(
      errors,
      '/lifecycle/status',
      'stateStatusMismatch',
      `status must be ${expectedStatus} when state is ${String(lifecycle.state)}`
    );
  }
  for (const field of ['startedAt', 'lastTransitionAt', 'completedAt']) {
    if (!isValidTimestamp(lifecycle[field])) {
      addError(
        errors,
        `/lifecycle/${field}`,
        'format',
        `${field} must be a finite non-negative number, ISO date string, or null`
      );
    }
  }
  validateOptionalString(
    lifecycle.finishAttemptId,
    '/lifecycle/finishAttemptId',
    128,
    errors
  );
  if (
    lifecycle.state === 'completed'
    && (
      typeof lifecycle.finishAttemptId !== 'string'
      || !lifecycle.finishAttemptId.trim()
      || lifecycle.completedAt === undefined
      || lifecycle.completedAt === null
    )
  ) {
    addError(
      errors,
      '/lifecycle',
      'required',
      'completed lifecycle requires finishAttemptId and completedAt'
    );
  }
  if (
    lifecycle.currentBlock !== undefined
    && lifecycle.currentBlock !== null
    && !isObject(lifecycle.currentBlock)
  ) {
    addError(
      errors,
      '/lifecycle/currentBlock',
      'type',
      'currentBlock must be an object or null'
    );
  }
  for (const field of ['repeatQueue', 'activeIssues']) {
    if (lifecycle[field] !== undefined && !Array.isArray(lifecycle[field])) {
      addError(errors, `/lifecycle/${field}`, 'type', `${field} must be an array`);
    }
  }
  if (
    lifecycle.modules !== undefined
    && lifecycle.modules !== null
    && !isObject(lifecycle.modules)
  ) {
    addError(errors, '/lifecycle/modules', 'type', 'modules must be an object or null');
  }
}

function validateEvents(events, limits, errors) {
  if (!Array.isArray(events)) {
    addError(errors, '/events', 'type', 'events must be an array');
    return;
  }
  if (events.length > limits.maxEvents) {
    addError(errors, '/events', 'maxItems', `maximum events is ${limits.maxEvents}`);
  }
  events.forEach((event, index) => {
    const path = `/events/${index}`;
    if (!isObject(event)) {
      addError(errors, path, 'type', 'event must be an object');
      return;
    }
    if (event.schemaVersion !== 'session_event.v1') {
      addError(
        errors,
        `${path}/schemaVersion`,
        'const',
        'session_event.v1 is required'
      );
    }
    for (const field of ['eventId', 'type']) {
      if (
        typeof event[field] !== 'string'
        || !event[field].trim()
        || event[field].length > 128
      ) {
        addError(
          errors,
          `${path}/${field}`,
          'type',
          `${field} must be a non-empty string of at most 128 characters`
        );
      }
    }
    if (!EVENT_CATEGORIES.has(event.category)) {
      addError(errors, `${path}/category`, 'enum', 'invalid event category');
    }
    if (!EVENT_SEVERITIES.has(event.severity)) {
      addError(errors, `${path}/severity`, 'enum', 'invalid event severity');
    }
    if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp)) {
      addError(errors, `${path}/timestamp`, 'type', 'timestamp must be a finite number');
    }
    if (
      event.tRelMs !== undefined
      && event.tRelMs !== null
      && (
        typeof event.tRelMs !== 'number'
        || !Number.isFinite(event.tRelMs)
        || event.tRelMs < 0
      )
    ) {
      addError(
        errors,
        `${path}/tRelMs`,
        'minimum',
        'tRelMs must be a finite non-negative number or null'
      );
    }
    validateOptionalString(event.sessionId, `${path}/sessionId`, 64, errors);
    validateOptionalString(event.phase, `${path}/phase`, 128, errors);
  });
}

function isPiiKey(key) {
  const normalized = String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
  return PII_KEY_TOKEN_PATTERN.test(normalized);
}

function normalizedKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
}

function validateResearchExtensions(payload, errors) {
  if (isObject(payload.audio_summary)) {
    validateKnownObjectFields(
      payload.audio_summary,
      AUDIO_SUMMARY_FIELDS,
      '/audio_summary',
      errors
    );
    if (payload.audio_summary.schemaVersion !== 'audio_session.v1') {
      addError(errors, '/audio_summary/schemaVersion', 'const', 'audio_session.v1 is required');
    }
    if (
      payload.audio_summary.rawAudioStored !== false
      || payload.audio_summary.rawAudioTransmitted !== false
    ) {
      addError(errors, '/audio_summary', 'privacy', 'raw audio storage and transmission must be false');
    }
    if (
      Array.isArray(payload.audio_summary.windows)
      && payload.audio_summary.windows.length > 360
    ) {
      addError(errors, '/audio_summary/windows', 'maxItems', 'maximum audio windows is 360');
    }
  }
  if (isObject(payload.multimodal_summary)) {
    validateKnownObjectFields(
      payload.multimodal_summary,
      MULTIMODAL_SUMMARY_FIELDS,
      '/multimodal_summary',
      errors
    );
    if (payload.multimodal_summary.schemaVersion !== 'multimodal_session.v1') {
      addError(
        errors,
        '/multimodal_summary/schemaVersion',
        'const',
        'multimodal_session.v1 is required'
      );
    }
    if (
      payload.multimodal_summary.rawVideoStored !== false
      || payload.multimodal_summary.rawLandmarksStored !== false
    ) {
      addError(errors, '/multimodal_summary', 'privacy', 'raw video and landmarks storage must be false');
    }
  }
  if (isObject(payload.multimodal_heatmap)) {
    validateKnownObjectFields(
      payload.multimodal_heatmap,
      MULTIMODAL_HEATMAP_FIELDS,
      '/multimodal_heatmap',
      errors
    );
    if (payload.multimodal_heatmap.schemaVersion !== 'multimodal_heatmap.v1') {
      addError(
        errors,
        '/multimodal_heatmap/schemaVersion',
        'const',
        'multimodal_heatmap.v1 is required'
      );
    }
    if (
      Array.isArray(payload.multimodal_heatmap.presentations)
      && payload.multimodal_heatmap.presentations.length > 50
    ) {
      addError(
        errors,
        '/multimodal_heatmap/presentations',
        'maxItems',
        'maximum multimodal presentations is 50'
      );
    }
  }
}

function walkPayload(value, path, depth, counters, limits, errors, key = '') {
  if (errors.length >= 100) return;
  if (depth > limits.maxDepth) {
    addError(errors, path, 'maxDepth', `maximum depth is ${limits.maxDepth}`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > limits.maxStringLength) {
      addError(errors, path, 'maxLength', `maximum string length is ${limits.maxStringLength}`);
    }
    if (EMAIL_VALUE_PATTERN.test(value) || URL_PII_PATTERN.test(value)) {
      addError(errors, path, 'pii', 'email or PII-bearing URL is not allowed');
    }
    if (PHONE_VALUE_PATTERN.test(value)) {
      addError(errors, path, 'pii', 'phone-like value is not allowed');
    }
    if (/^\s*(?:data:|blob:)|;base64,/i.test(value)) {
      addError(errors, path, 'rawMedia', 'embedded media is not accepted');
    }
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    addError(errors, path, 'type', 'numbers must be finite');
  }
  if (value == null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    const maxItems = Math.min(limits.maxArrayLength, ({ '/events': limits.maxEvents, '/blocks': limits.maxBlocks,
      '/cognitiveResults': limits.maxCognitiveResults })[path] ?? Infinity);
    if (value.length > maxItems) {
      addError(errors, path, 'maxItems', `maximum array length is ${maxItems}`);
      return;
    }
    value.forEach((item, index) => {
      walkPayload(item, `${path}/${index}`, depth + 1, counters, limits, errors, key);
    });
    return;
  }

  const entries = Object.entries(value);
  counters.objectKeys += entries.length;
  if (counters.objectKeys > limits.maxObjectKeys) {
    if (!counters.objectKeysExceeded) {
      counters.objectKeysExceeded = true;
      addError(
        errors,
        path,
        'maxProperties',
        `maximum object key count is ${limits.maxObjectKeys}`
      );
    }
    return;
  }
  for (const [childKey, childValue] of entries) {
    const childPath = `${path}/${/^[A-Za-z0-9_:.-]{1,128}$/.test(childKey) ? childKey : '*'}`;
    if (['__proto__', 'prototype', 'constructor'].includes(childKey)) {
      addError(errors, childPath, 'additionalProperties', 'unsafe property name');
      continue;
    }
    if (isPiiKey(childKey)) {
      addError(errors, childPath, 'pii', 'PII field is not allowed');
      continue;
    }
    if (RAW_MEDIA_KEY_PATTERN.test(normalizedKey(childKey))) {
      addError(errors, childPath, 'rawMedia', 'raw media payload is not accepted');
      continue;
    }
    walkPayload(childValue, childPath, depth + 1, counters, limits, errors, childKey);
  }
}

function validateSessionFeaturePayload(payload, customLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [{ path: '/', keyword: 'type', message: 'payload must be an object' }];
  }

  walkPayload(payload, '', 0, { objectKeys: 0, objectKeysExceeded: false }, limits, errors);
  // Bound work before validators that inspect whole arrays or nested modules.
  if (errors.some(error => ['maxDepth', 'maxItems', 'maxProperties'].includes(error.keyword))) return errors.slice(0, 100);

  validateKnownObjectFields(payload, TOP_LEVEL_FIELDS, '', errors);
  if (payload.delivery !== undefined) {
    const delivery = payload.delivery;
    validateKnownObjectFields(delivery, new Set(['schemaVersion', 'sequence', 'kind']), '/delivery', errors);
    if (!isObject(delivery) || delivery.schemaVersion !== 'session_delivery.v1'
      || !Number.isInteger(delivery.sequence) || delivery.sequence < 1 || delivery.sequence > 2147483647
      || !['checkpoint', 'final'].includes(delivery.kind)
      || (delivery.kind === 'final') !== (payload.lifecycle?.status === 'completed')
      || (delivery.kind === 'checkpoint' && payload.lifecycle?.status !== 'in_progress')) {
      addError(errors, '/delivery', 'type', 'invalid delivery sequence or lifecycle');
    }
  }
  validateKnownObjectFields(payload.ids, IDS_FIELDS, '/ids', errors);
  validateKnownObjectFields(payload.meta, META_FIELDS, '/meta', errors);
  validateKnownObjectFields(payload.meta?.user, META_USER_FIELDS, '/meta/user', errors);

  if (payload.schemaVersion !== 'session_feature.v1') {
    addError(errors, '/schemaVersion', 'const', 'session_feature.v1 is required');
  }
  if (!isObject(payload.ids)) {
    addError(errors, '/ids', 'required', 'ids object is required');
  } else if (typeof payload.ids.session !== 'string' || !payload.ids.session.trim()) {
    addError(errors, '/ids/session', 'required', 'non-empty session id is required');
  } else if (payload.ids.session.length > 64) {
    addError(errors, '/ids/session', 'maxLength', 'maximum string length is 64');
  }
  if (isObject(payload.ids)) {
    validateOptionalString(payload.ids.participant, '/ids/participant', 64, errors);
    validateOptionalString(payload.ids.participantAlias, '/ids/participantAlias', 64, errors);
    if (
      typeof payload.ids.participantAlias === 'string'
      && !/^[\p{L}\p{N}_-]{1,64}$/u.test(payload.ids.participantAlias)
    ) {
      addError(
        errors,
        '/ids/participantAlias',
        'pattern',
        'participant alias may contain only letters, numbers, hyphens, and underscores'
      );
    }
    validateOptionalString(payload.ids.invitationCode, '/ids/invitationCode', 64, errors);
  }
  if (payload.meta !== undefined && payload.meta !== null && !isObject(payload.meta)) {
    addError(errors, '/meta', 'type', 'meta must be an object or null');
  }
  if (
    payload.meta?.user !== undefined
    && payload.meta.user !== null
    && !isObject(payload.meta.user)
  ) {
    addError(errors, '/meta/user', 'type', 'meta.user must be an object or null');
  }
  if (
    payload.meta?.tech !== undefined
    && payload.meta.tech !== null
    && !isObject(payload.meta.tech)
  ) {
    addError(errors, '/meta/tech', 'type', 'meta.tech must be an object or null');
  }
  if (payload.meta?.tech?.gazeFeatureMethod !== undefined
    && payload.meta.tech.gazeFeatureMethod !== 'same_eye_iris.v2') {
    addError(errors, '/meta/tech/gazeFeatureMethod', 'const', 'unsupported gaze feature method');
  }
  if (payload.meta?.tech?.gazeCalibrationSampling !== undefined
    && payload.meta.tech.gazeCalibrationSampling !== 'open_eye_calibration.v1') {
    addError(errors, '/meta/tech/gazeCalibrationSampling', 'const', 'unsupported gaze calibration sampling');
  }
  if (payload.meta?.tech?.gazeQcSignalMethod !== undefined
    && payload.meta.tech.gazeQcSignalMethod !== 'corrected_validity.v1') {
    addError(errors, '/meta/tech/gazeQcSignalMethod', 'const', 'unsupported gaze QC signal method');
  }
  validateOptionalString(
    payload.meta?.user?.interfaceLanguage,
    '/meta/user/interfaceLanguage',
    32,
    errors
  );
  for (const field of OPTIONAL_OBJECT_FIELDS) {
    validateOptionalObject(payload, field, errors);
  }
  for (const field of ['blocks', 'cognitiveResults']) {
    if (payload[field] !== undefined && !Array.isArray(payload[field])) {
      addError(errors, `/${field}`, 'type', `${field} must be an array`);
    }
  }
  if (Array.isArray(payload.blocks) && payload.blocks.length > limits.maxBlocks) {
    addError(errors, '/blocks', 'maxItems', `maximum blocks is ${limits.maxBlocks}`);
  }
  if (
    Array.isArray(payload.cognitiveResults)
    && payload.cognitiveResults.length > limits.maxCognitiveResults
  ) {
    addError(
      errors,
      '/cognitiveResults',
      'maxItems',
      `maximum cognitive results is ${limits.maxCognitiveResults}`
    );
  }
  if (
    payload.startTime !== undefined
    && payload.startTime !== null
    && !isValidTimestamp(payload.startTime)
  ) {
    addError(
      errors,
      '/startTime',
      'format',
      'startTime must be a finite non-negative number, ISO date string, or null'
    );
  }
  validateLifecycle(payload.lifecycle, errors);
  validateEvents(payload.events, limits, errors);
  validateResearchExtensions(payload, errors);
  errors.push(...require('./gaze-validation').validateGazeValidation(payload.gazeValidation));
  errors.push(...require('./gaze-validation').validateGazePresentationTiming(payload.gaze_analytics));
  if (payload.rt_alignment !== undefined) {
    errors.push(...require('../analytics/connectedness').validateAlignment(payload.rt_alignment));
  }
  if (payload.physiology_intervals !== undefined) {
    errors.push(...require('./physiology-intervals').validatePhysiologyIntervals(payload.physiology_intervals));
  }
  errors.push(...validateSessionDataSchema(payload));
  return errors.slice(0, 100);
}

function requireSessionFeaturePayload(req, res, next) {
  const errors = validateSessionFeaturePayload(req.body);
  if (errors.length) {
    const pii = errors.some(error => error.keyword === 'pii');
    return res.status(422).json({
      error: pii ? 'PII is not accepted by ingest' : 'Payload schema validation failed',
      code: pii ? 'pii_forbidden' : 'payload_schema_invalid',
      errors: errors.map(item => ({ ...item, path: item.path === '/' ? '/' : publicValidationPath(item.path) })),
    });
  }
  return next();
}

module.exports = {
  DEFAULT_LIMITS,
  LIFECYCLE_FIELDS,
  TOP_LEVEL_FIELDS,
  isPiiKey,
  validateSessionFeaturePayload,
  requireSessionFeaturePayload,
};
