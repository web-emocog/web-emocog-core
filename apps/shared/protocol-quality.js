(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WecogProtocolQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const METRICS = Object.freeze({ gazeValid: 'gazeValidPct', faceDetected: 'faceVisiblePct', fpsStable: 'analysisFps', lighting: 'illuminationOkPct' });
  function validate(definition) {
    const persistence = definition?.settings?.persistence;
    if (persistence !== undefined && (!persistence || typeof persistence !== 'object' || Array.isArray(persistence)
      || Object.keys(persistence).some(key => key !== 'showBackupNotifications')
      || typeof persistence.showBackupNotifications !== 'boolean')) return false;
    const policy = definition?.settings?.qualityControl;
    if (policy === undefined) return true;
    return !!policy && typeof policy === 'object' && !Array.isArray(policy) && policy.schemaVersion === 'protocol_quality.v1'
      && !!policy.rules && typeof policy.rules === 'object' && !Array.isArray(policy.rules)
      && Object.keys(policy).every(key => ['schemaVersion', 'rules'].includes(key))
      && Object.keys(policy.rules).every(key => Object.hasOwn(METRICS, key))
      && Object.entries(policy.rules).every(([key, rule]) => rule && typeof rule.enabled === 'boolean'
        && typeof rule.hardStop === 'boolean' && typeof rule.threshold === 'number' && Number.isFinite(rule.threshold)
        && rule.threshold >= 0 && rule.threshold <= (key === 'fpsStable' ? 60 : 100)
        && Object.keys(rule).every(name => ['enabled', 'hardStop', 'threshold'].includes(name)));
  }
  function evaluate(definition, metrics) {
    const policy = definition?.settings?.qualityControl;
    if (!policy || !validate(definition)) return null;
    const checks = {};
    for (const [key, rule] of Object.entries(policy.rules)) {
      const raw = metrics?.[METRICS[key]];
      const observed = typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && (key === 'fpsStable' || raw <= 100)
        && !(key === 'gazeValid' && metrics?.gazeTotal === 0);
      checks[key] = { enabled: rule.enabled, threshold: rule.threshold, hardStop: rule.hardStop,
        value: observed ? raw : null, status: !rule.enabled ? 'disabled' : !observed ? 'no_data' : raw >= rule.threshold ? 'passed' : 'failed' };
    }
    return { schemaVersion: 'protocol_quality.v1', method: 'cumulative-observed-metrics-1.0.0', checks,
      failed: Object.keys(checks).filter(key => checks[key].status === 'failed'),
      missing: Object.keys(checks).filter(key => checks[key].status === 'no_data') };
  }
  function describeCheck(key, check, lang = 'en') {
    const ru = lang === 'ru';
    const labels = ru
      ? { gazeValid: 'Валидный взгляд', faceDetected: 'Обнаружение лица', fpsStable: 'FPS анализа', lighting: 'Допустимое освещение' }
      : { gazeValid: 'Valid gaze', faceDetected: 'Face detection', fpsStable: 'Analysis FPS', lighting: 'Acceptable lighting' };
    const label = Object.hasOwn(labels, key) ? labels[key] : (ru ? 'Показатель качества' : 'Quality metric');
    const unit = key === 'fpsStable' ? ' FPS' : '%';
    const number = value => typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 10) / 10) : null;
    const value = number(check?.value), threshold = number(check?.threshold);
    if (value === null || threshold === null) return `${label}: ${ru ? 'нет измерения' : 'no measurement'}`;
    return `${label}: ${value}${unit}; ${ru ? 'требуется не менее' : 'required minimum'} ${threshold}${unit}`;
  }
  return { METRICS, validate, evaluate, describeCheck,
    showBackupNotifications: definition => definition?.settings?.persistence?.showBackupNotifications !== false };
});
