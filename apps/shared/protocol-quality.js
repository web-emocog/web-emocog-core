(function (root, factory) {
  const commonjs = typeof module === 'object' && module.exports;
  const api = factory(commonjs ? require('./standard-stimuli') : root.StandardStimuli,
    commonjs ? require('./passive-valid-time') : root.WecogPassiveValidTime);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WecogProtocolQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (standardStimuli, passiveValidTime) {
  const METRICS = Object.freeze({ gazeValid: 'gazeValidPct', faceDetected: 'faceVisiblePct', fpsStable: 'analysisFps', lighting: 'illuminationOkPct' });
  const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const VALID_TIME_KEYS = ['schemaVersion', 'enabled', 'maxExtensionRatio', 'minSegmentMs'];
  const validTimeApi = () => passiveValidTime || globalThis.WecogPassiveValidTime;
  const standardStimuliApi = () => standardStimuli || globalThis.StandardStimuli;
  function passiveValidTimeConfig(value) {
    return validTimeApi()?.validateBlock({ type: 'passive', blockConfig: { validTime: value } }) === true
      && record(value) && typeof value.maxExtensionRatio === 'number';
  }
  function eligiblePassiveValidTimeTrial(entry, metadata) {
    const trial = record(entry) ? entry : { stimulusId: entry };
    if (trial.useRT === true || (trial.responseMode != null && trial.responseMode !== 'none')
      || trial.action || trial.correctResponse || trial.responseWindow || trial.cue
      || [trial.type, trial.mediaType, trial.stimulusType, trial.stimulus?.type].some(type => type && !['image', 'slides', 'shape', 'text', 'color', 'background'].includes(type))) return false;
    const id = String(trial.stimulusId ?? trial.stimulus_id ?? trial.id ?? trial.stimulus?.stimulusId ?? '').replace(/^api:/, '');
    if (id.startsWith('std_')) {
      const stimulus = standardStimuliApi()?.resolveStandardStimulus(id);
      return !!stimulus && validTimeApi()?.eligibleTrial({ ...trial, stimulus }) === true;
    }
    if (!record(metadata)) return false;
    const info = { ...metadata.metadata, ...metadata.media_info, ...metadata };
    const mime = info.mime_type ?? info.mimeType;
    // Animation-capable/unknown formats need a separate verified static policy.
    return validTimeApi()?.eligibleTrial(trial, { type: 'image', mimeType: mime }) === true
      && ['image/jpeg', 'image/png', 'image/bmp'].includes(mime)
      && (mime !== 'image/png' || info.codec === 'png')
      && !info.animated && !info.isAnimated && !info.is_animated
      && !(Number(info.frameCount ?? info.frame_count ?? 1) > 1)
      && !(Number(info.duration_ms ?? info.durationMs ?? 0) > 0)
      && (!info.codec || ['png', 'mjpeg', 'bmp'].includes(info.codec));
  }
  function inspectPassiveValidTimeBlock(block, { mediaManifest, allowUnresolvedMedia = true } = {}) {
    const sources = [block?.blockConfig, block?.content];
    const values = sources.filter(source => record(source) && Object.hasOwn(source, 'validTime')).map(source => source.validTime);
    const invalid = reason => ({ ok: false, config: null, reason });
    if (!values.length) return { ok: true, config: null };
    if (!values.every(passiveValidTimeConfig)) return invalid('config');
    if (values.some(value => VALID_TIME_KEYS.some(key => value[key] !== values[0][key]))) return invalid('conflict');
    const config = values[0];
    if (!config.enabled) return { ok: true, config: null };
    if (!validTimeApi()?.validateBlock(block) || [block, ...sources].some(source => source && (
      source.useRT === true || (source.responseMode != null && source.responseMode !== 'none')
      || (source.taskType && source.taskType !== 'passive_viewing') || (source.rt_task && source.rt_task !== 'passive_viewing')
      || (source.slideChangeMode && source.slideChangeMode !== 'timer')
      || (source.contentType && !['slides', 'image', 'text'].includes(source.contentType))
      || source.protocolDurationMs || source.showFeedback || source.feedbackConfig))) return invalid('block');
    const lists = [block.trials, block.content?.trials, block.content?.slides, block.blockConfig?.trials, block.blockConfig?.slides]
      .filter(list => Array.isArray(list) && list.length);
    if (!lists.length) return invalid('trials');
    for (const trial of lists.flat()) {
      const id = String(record(trial) ? trial.stimulusId ?? trial.stimulus_id ?? trial.id ?? trial.stimulus?.stimulusId ?? '' : trial).replace(/^api:/, '');
      const media = mediaManifest?.[id];
      if (eligiblePassiveValidTimeTrial(trial, media)) continue;
      if (!media && allowUnresolvedMedia && /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647
        && eligiblePassiveValidTimeTrial(trial, { mimeType: 'image/jpeg' })) continue;
      return invalid('media');
    }
    return { ok: true, config: { ...config } };
  }
  function validate(definition) {
    if (Array.isArray(definition?.blocks) && definition.blocks.some(block => !inspectPassiveValidTimeBlock(block,
      { mediaManifest: definition.mediaManifest }).ok)) return false;
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
  function cameraCadence(definition, fps, { pending = false } = {}) {
    const rule = definition?.settings?.qualityControl?.rules?.fpsStable;
    const threshold = validate(definition) && rule?.enabled && rule.threshold > 0 ? rule.threshold : null;
    const measured = Number.isFinite(fps) && fps >= 0;
    const low = measured && threshold !== null && fps < threshold;
    return { fps: measured ? fps : null, threshold, low, pending,
      blocked: threshold !== null && (pending || (low && rule.hardStop)) };
  }
  function describeFpsAdvice(threshold, diagnostics, lang = 'en') {
    if (!Number.isFinite(threshold) || threshold <= 0) return '';
    const ru = lang === 'ru';
    const camera = diagnostics?.camera?.status === 'measured' ? diagnostics.camera.fps : null;
    if (!Number.isFinite(camera)) return ru
      ? 'Проверьте свет спереди и закройте лишние приложения перед повтором.'
      : 'Check the lighting in front of you and close other apps before retrying.';
    return camera < threshold
      ? (ru ? 'Камера даёт слишком мало кадров. Добавьте свет спереди и проверьте, не использует ли камеру другое приложение.'
        : 'The camera is delivering too few frames. Add front lighting and check that another app is not using the camera.')
      : (ru ? 'Камера даёт достаточно кадров, но анализ отстаёт. Закройте лишние вкладки и приложения перед повтором.'
        : 'The camera delivers enough frames but analysis is slower. Close other tabs and apps before retrying.');
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
  function createEvaluator(definition) {
    if (!validate(definition) || !definition?.settings?.qualityControl) return () => null;
    // A published definition is immutable for an admitted run. Validate its
    // media once, then keep only an owned rules snapshot in the frame path.
    const policy = definition.settings.qualityControl;
    const selected = { settings: { qualityControl: { schemaVersion: policy.schemaVersion,
      rules: Object.fromEntries(Object.entries(policy.rules).map(([key, value]) => [key, { ...value }])) } } };
    return metrics => evaluate(selected, metrics);
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
  return { METRICS, validate, evaluate, createEvaluator, describeCheck, cameraCadence, describeFpsAdvice,
    passiveValidTimeConfig, eligiblePassiveValidTimeTrial, inspectPassiveValidTimeBlock,
    showBackupNotifications: definition => definition?.settings?.persistence?.showBackupNotifications !== false };
});
