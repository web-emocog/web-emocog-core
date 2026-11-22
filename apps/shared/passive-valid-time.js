(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WecogPassiveValidTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VERSION = 'passive_valid_time.v1';
  const MAX_SEGMENTS = 4096;
  const MAX_MS = 86400000;
  const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_MS;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
  function policyFor(block) {
    const value = block?.blockConfig?.validTime ?? block?.content?.validTime;
    return value?.enabled === true ? value : null;
  }
  function eligibleTrial(trial, metadata = null) {
    const stimulus = trial?.stimulus;
    const type = metadata?.type ?? stimulus?.type ?? trial?.stimulusType;
    const mime = metadata?.mimeType ?? metadata?.mime_type ?? stimulus?.mimeType;
    if (mime && !['image/png', 'image/jpeg', 'image/bmp'].includes(mime)) return false;
    return ['shape', 'text', 'color', 'background', 'image'].includes(type);
  }
  function validateBlock(block) {
    const values = [block?.blockConfig?.validTime, block?.content?.validTime].filter(value => value !== undefined);
    if (!values.length) return true;
    if (values.length === 2 && ['schemaVersion', 'enabled', 'maxExtensionRatio', 'minSegmentMs']
      .some(key => values[0]?.[key] !== values[1]?.[key])) return false;
    const policy = values[0];
    if (!keys(policy, ['schemaVersion', 'enabled', 'maxExtensionRatio', 'minSegmentMs'])
        || policy.schemaVersion !== VERSION || typeof policy.enabled !== 'boolean'
        || !Number.isFinite(policy.maxExtensionRatio) || policy.maxExtensionRatio < 0 || policy.maxExtensionRatio > .5
        || policy.minSegmentMs !== 1000) return false;
    if (!policy.enabled) return true;
    const cfg = { ...block?.content, ...block?.blockConfig };
    return (block?.type === 'passive' || (block?.type === 'cognitive_task' && block?.taskType === 'passive_viewing'
      && cfg.useRT === false && cfg.responseMode === 'none')) && !cfg.protocolDurationMs;
  }
  function validateResult(value) {
    if (!keys(value, ['schemaVersion', 'targetMs', 'acceptedMs', 'actualMs', 'maxDurationMs', 'extended', 'limitReached', 'acceptedSegments', 'excludedSegments'])
        || value.schemaVersion !== VERSION || !integer(value.targetMs) || value.targetMs < 1000
        || !integer(value.acceptedMs) || !integer(value.actualMs) || !integer(value.maxDurationMs)
        || value.maxDurationMs < value.targetMs || value.maxDurationMs > Math.floor(value.targetMs * 1.5)
        || value.acceptedMs > value.actualMs || value.extended !== (value.actualMs > value.targetMs)
        || value.limitReached !== (value.actualMs >= value.maxDurationMs && value.acceptedMs < value.targetMs)
        || !Array.isArray(value.acceptedSegments) || !Array.isArray(value.excludedSegments)
        || value.acceptedSegments.length > MAX_SEGMENTS || value.excludedSegments.length > MAX_SEGMENTS) return false;
    let accepted = 0;
    for (const segment of value.acceptedSegments) {
      if (!keys(segment, ['startMs', 'endMs']) || !integer(segment.startMs) || !integer(segment.endMs)
          || segment.endMs - segment.startMs < 1000 || segment.endMs > value.maxDurationMs) return false;
      accepted += segment.endMs - segment.startMs;
    }
    for (const segment of value.excludedSegments) {
      if (!keys(segment, ['startMs', 'endMs', 'reasons']) || !integer(segment.startMs) || !integer(segment.endMs)
          || segment.endMs <= segment.startMs || !Array.isArray(segment.reasons) || !segment.reasons.length
          || segment.reasons.length > 16 || segment.reasons.some(code => typeof code !== 'string' || !/^[a-zA-Z0-9_.:-]{1,80}$/.test(code))) return false;
    }
    if (accepted !== value.acceptedMs) return false;
    const segments = [...value.acceptedSegments, ...value.excludedSegments].sort((a, b) => a.startMs - b.startMs);
    let through = 0;
    for (const segment of segments) {
      if (segment.startMs !== through || segment.endMs > value.actualMs) return false;
      through = segment.endMs;
    }
    return through === value.actualMs;
  }
  function acceptedAt(value, ms) {
    return Number.isFinite(ms) && value?.acceptedSegments?.some(segment => ms >= segment.startMs && ms < segment.endMs) === true;
  }
  return { VERSION, MAX_SEGMENTS, MAX_MS, policyFor, validateBlock, eligibleTrial, validateResult, acceptedAt };
});
