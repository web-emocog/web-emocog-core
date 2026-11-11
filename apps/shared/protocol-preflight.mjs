import * as registryModule from './rt-registry.js';
import * as stimulusModule from './standard-stimuli.js';
import './keyboard-responses.js?v=20261025-1';

export const PREFLIGHT_VERSION = 'protocol_preflight.v1';
// Transport/runtime bounds, not scientific acceptance thresholds.
export const PUBLICATION_LIMITS = Object.freeze({ blocks: 200, trials: 5000, timerMs: 2147483647, mediaBudgetBytes: 256 * 1024 * 1024 });
// Nominal algorithm windows in rppg_alg/config.js; regression-tested against DEFAULTS.
export const PHYSIOLOGY_WINDOWS_MS = Object.freeze({ heartRate: 10000, respiration: 20000 });
const types = new Set(['consent', 'questionnaire', 'precheck', 'calibration', 'instruction', 'instructions',
  'survey', 'cognitive_task', 'stimuli', 'passive', 'rest', 'audio_test', 'timer', 'finish', 'final']);
const shellTypes = new Set(['consent', 'questionnaire', 'precheck', 'calibration']);
const tasks = registryModule.default?.RT_TASKS || globalThis.RtRegistry?.RT_TASKS;
const standard = stimulusModule.default || globalThis.StandardStimuli;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isFinite(Number(value));

export function inspectProtocolPreflight(definition, { mediaReport = null } = {}) {
  const errors = [], warnings = [], blockDurations = [];
  const issue = (list, code, path, ru, en) => list.push({ code, path, message: { ru, en } });
  const fail = (code, path, ru, en) => issue(errors, code, path, ru, en);
  const warn = (code, path, ru, en) => issue(warnings, code, path, ru, en);
  const result = () => ({ schemaVersion: PREFLIGHT_VERSION, ok: errors.length === 0, errors, warnings,
    duration: { plannedMaximumMs: blockDurations.reduce((sum, item) => sum + item.maximumMs, 0),
      excludesPreparationInstructionsPausesAndRetries: true, blocks: blockDurations },
    mediaCheck: mediaReport ? (mediaReport.ok ? 'passed' : 'failed') : 'server_check_required',
    scientificValidation: 'not_established' });
  if (!record(definition) || !Array.isArray(definition.blocks) || !definition.blocks.length) {
    fail('blocks_required', '/blocks', 'Добавьте блоки протокола.', 'Add protocol blocks.');
    return result();
  }
  if (definition.blocks.length > PUBLICATION_LIMITS.blocks) {
    fail('block_limit', '/blocks', 'Превышен лимит итогового пакета: 200 блоков.', 'The final packet supports at most 200 blocks.');
  }
  const profile = definition.settings?.signalProfileId ?? definition.signalProfileId;
  if (definition.version != null && !/^(?:v[12](?:[._-]|$)|1\.0\.0$)/.test(String(definition.version)))
    fail('protocol_version_unsupported', '/version', 'Неподдерживаемая версия формата протокола.', 'Unsupported protocol format version.');
  if (profile != null && !['protocol_signals.v1', 'protocol_signals.v2'].includes(profile)) {
    fail('signal_profile_unsupported', '/settings/signalProfileId', 'Неизвестный профиль измерений.', 'Unsupported signal profile.');
  }
  if (definition.testHubMetrics != null && (!Array.isArray(definition.testHubMetrics)
    || definition.testHubMetrics.some(id => !['rt', 'tracking', 'vpc', 'visuospatial'].includes(id))))
    fail('hub_test_unsupported', '/testHubMetrics', 'Выбран неподдерживаемый тест.', 'An unsupported hub test is selected.');
  if (definition.testHubMetrics?.includes('vpc') || definition.testHubMetrics?.includes('visuospatial'))
    warn('gaze_task_research_only', '/testHubMetrics', 'VPC и рисование взглядом — исследовательские задачи, не диагностические тесты.', 'VPC and gaze drawing are research tasks, not diagnostic tests.');
  if (!definition.blocks.some(block => block && !shellTypes.has(block.type) && block.type !== 'final') && !definition.testHubMetrics?.length)
    fail('execution_required', '/blocks', 'После подготовки нет выполняемых блоков или выбранных тестов.', 'There are no executable blocks or selected tests after preparation.');
  const flags = { ...definition.settings?.featureFlags, ...definition.featureFlags };
  const features = { ...definition.settings?.features, ...definition.features };
  const audioEnabled = (features.audio ?? definition.audio)?.enabled ?? flags.audio ?? false;
  const multimodalEnabled = (features.multimodal ?? definition.multimodal)?.enabled ?? flags.multimodal ?? true;
  const v2 = String(definition.version || '').startsWith('v2')
    || definition.blocks.some(block => block?.taskType || block?.blockConfig || Array.isArray(block?.trials));
  let trialCount = 0;
  const ids = new Set();
  function time(value, path, { zero = false, fallback = null, max = PUBLICATION_LIMITS.timerMs } = {}) {
    if (value == null && fallback !== null) value = fallback;
    if (!number(value) || !Number.isInteger(Number(value)) || Number(value) < (zero ? 0 : 1) || Number(value) > max) {
      fail('timing_invalid', path, 'Длительность должна быть целым числом в пределах таймера; скрытое обрезание недопустимо.',
        'Duration must be an integer within the runtime timer bounds; silent clamping is not supported.');
      return 0;
    }
    return Number(value);
  }
  for (const [index, block] of definition.blocks.slice(0, PUBLICATION_LIMITS.blocks + 1).entries()) {
    const path = `/blocks/${index}`;
    if (!record(block) || !types.has(block.type)) {
      fail('block_unsupported', path + '/type', 'Этот тип блока не выполняется в протоколе участника.', 'This block type is not supported by the participant runtime.');
      continue;
    }
    for (const key of ['content', 'params', 'blockConfig']) {
      if (block[key] != null && !record(block[key])) fail('block_config_invalid', `${path}/${key}`,
        'Настройки блока должны быть объектом.', 'Block configuration must be an object.');
    }
    if (block.id != null) {
      if (typeof block.id !== 'string' || !block.id.trim() || ids.has(block.id))
        fail('block_id_invalid', path + '/id', 'Укажите непустой уникальный ID блока.', 'Use a non-empty unique block ID.');
      ids.add(block.id);
    }
    if (shellTypes.has(block.type)) continue;
    const content = v2 ? (block.content || {}) : (block.params || {});
    const config = block.type === 'passive' ? { ...content, ...block.blockConfig } : (block.blockConfig || block.params || {});
    if (block.type === 'audio_test' && audioEnabled !== true)
      fail('audio_channel_required', path, 'Для аудиотеста включите аудиоканал и согласие на микрофон.', 'Enable the audio channel and microphone consent for an audio test.');
    if (['rest', 'audio_test'].includes(block.type)) {
      let duration;
      if (content.durationMs != null) duration = time(content.durationMs, path + '/content/durationMs', { max: 3600000 });
      else {
        const raw = content.duration ?? (block.type === 'audio_test' ? 12 : 30);
        const ms = number(raw) ? Number(raw) * (content.durationUnit === 'seconds' || Number(raw) < 1000 ? 1000 : 1) : NaN;
        duration = time(ms, path + '/content/duration', { max: 3600000 });
      }
      if (duration > 0 && duration < 1000)
        fail('timed_block_clamped', path, 'Данный блок выполняется минимум 1 секунду.', 'This timed block runs for at least one second.');
      blockDurations.push({ index, maximumMs: duration });
      continue;
    }
    if (!['cognitive_task', 'stimuli', 'passive'].includes(block.type)) continue;
    if (!v2 && block.type === 'passive') {
      fail('legacy_passive_unsupported', path, 'Пересохраните пассивный блок в конструкторе v2.', 'Save the passive block with the v2 builder.');
      continue;
    }
    const task = block.type === 'passive' ? 'passive_viewing' : (block.taskType || config.taskType || block.content?.taskType || 'other');
    if (!Object.hasOwn(tasks, task) && !['passive_viewing', 'simple', 'choice'].includes(task))
      fail('task_unsupported', path + '/taskType', 'Неизвестная задача: нельзя незаметно заменить её простой реакцией.', 'Unsupported task: it cannot silently fall back to simple RT.');
    let trials = v2 ? block.trials : block.params?.trials;
    if (block.type === 'passive') trials = block.trials?.length ? block.trials : content.trials?.length ? content.trials : content.slides;
    if (!v2 && !trials?.length && Array.isArray(block.params?.stimuli_ids)) trials = block.params.stimuli_ids.map(stimulusId => ({ stimulusId }));
    if (!Array.isArray(trials) || !trials.length) {
      fail('trials_required', path + '/trials', 'Добавьте явный список проб/слайдов; автоматические примеры не публикуются.', 'Provide explicit trials/slides; synthesized example trials cannot be published.');
      continue;
    }
    let maximumMs = 0;
    let shortestItiMs = Infinity;
    let blockTrialCount = 0;
    const mediaSizes = new Map();
    for (const [trialIndex, entry] of trials.slice(0, PUBLICATION_LIMITS.trials + 1).entries()) {
      const trial = record(entry) ? entry : (block.type === 'passive' ? { stimulusId: entry } : {});
      const p = `${path}/trials/${trialIndex}`;
      const sid = String(trial.stimulusId ?? trial.stimulus_id ?? (block.type === 'passive' ? trial.id : null) ?? trial.stimulus?.stimulusId ?? '').replace(/^api:/, '');
      const legacyInline = !v2 && ['shape', 'text'].includes(trial.stimulus?.type);
      const databaseId = /^[1-9]\d*$/.test(sid) && Number(sid) <= 2147483647;
      if (!legacyInline && !(databaseId || standard.resolveStandardStimulus(sid)))
        fail('stimulus_required', p + '/stimulusId', 'Выберите встроенный или сохранённый на сервере стимул.', 'Select a built-in or server-stored stimulus.');
      const media = definition.mediaManifest?.[sid];
      if (databaseId && media) {
        if (!Number.isSafeInteger(media.sizeBytes) || media.sizeBytes <= 0 || !/^[a-f\d]{64}$/i.test(media.sha256 || ''))
          fail('media_manifest_invalid', p, 'Нужен проверенный размер и контрольная сумма файла.', 'A verified file size and checksum are required.');
        else mediaSizes.set(sid, media.sizeBytes);
      }
      const repetitions = trial.repetitions == null ? 1 : time(trial.repetitions, p + '/repetitions', { max: PUBLICATION_LIMITS.trials });
      blockTrialCount += repetitions;
      const duration = time(trial.duration, p + '/duration', { fallback: Number(config.slideDuration || config.stimulusDuration || config.stimulus_ms || (config.duration_sec ? config.duration_sec * 1000 : 1000)) });
      const fixation = config.useFixation === false ? 0 : time(trial.fixationMax ?? config.fixation?.duration ?? config.fixation_ms,
        p + '/fixationMax', { zero: true, fallback: block.type === 'passive' && config.useFixation !== true ? 0 : 500 });
      const iti = time(config.randomInterStimulus === true ? config.interStimulusMaxMs : trial.randomItiMax,
        p + '/randomItiMax', { zero: true, fallback: 0 });
      const betweenTrials = time(trial.iti, p + '/iti', { zero: true, fallback: 200 }) || 200;
      shortestItiMs = Math.min(shortestItiMs, betweenTrials);
      for (const [min, max] of [[trial.fixationMin, trial.fixationMax], [trial.randomItiMin, trial.randomItiMax],
        [config.interStimulusMinMs, config.interStimulusMaxMs]]) {
        if ((min != null && (!number(min) || Number(min) < 0)) || (min != null && max != null && Number(min) > Number(max)))
          fail('timing_range_invalid', p, 'Минимум интервала должен быть неотрицательным и не больше максимума.', 'Interval minimum must be non-negative and not exceed its maximum.');
      }
      const mode = trial.responseMode || config.responseMode;
      if (mode != null && !['keypress', 'click', 'pointer_intent', 'none'].includes(mode))
        fail('response_mode_unsupported', p + '/responseMode', 'Неподдерживаемый способ ответа.', 'Unsupported response mode.');
      const action = trial.action || trial.correctResponse;
      if (action && !globalThis.WecogKeyboardResponses.normalize(action)
        && !['Click', 'mouse_click', 'PointerIntent', 'pointer_intent', 'mouse_intent'].includes(action))
        fail('response_key_unsupported', p + '/action', 'Выбранная клавиша не поддерживается обработчиком ответов.', 'The response key is not supported by the input collector.');
      maximumMs += repetitions * (duration + fixation + iti + betweenTrials + (config.showFeedback || config.feedbackConfig ? time(trial.feedbackDuration, p + '/feedbackDuration', { zero: true, fallback: 500 }) : 0));
    }
    let residentBytes = 0;
    for (const size of [...mediaSizes.values()].sort((a, b) => b - a)) {
      // Same cold-load order and 3x transient workspace as createMediaCache.acquire.
      if (residentBytes + 3 * size > PUBLICATION_LIMITS.mediaBudgetBytes) {
        fail('block_media_budget', path, 'Файлы блока превышают бюджет подготовки 256 МиБ с рабочей памятью. Уменьшите файлы или разделите блок.',
          'Block media exceeds the 256 MiB preparation budget including workspace. Reduce files or split the block.');
        break;
      }
      residentBytes += size;
    }
    if (trials.length > PUBLICATION_LIMITS.trials) trialCount = PUBLICATION_LIMITS.trials + 1;
    if (config.protocolDurationMs != null) {
      const deadline = time(config.protocolDurationMs, path + '/blockConfig/protocolDurationMs', { zero: true });
      if (deadline > 0) {
        // Timed tasks cycle their saved order until the deadline; the first response can be immediate.
        maximumMs = deadline;
        blockTrialCount = Math.max(blockTrialCount, Math.ceil(deadline / shortestItiMs));
      }
    }
    trialCount += blockTrialCount;
    blockDurations.push({ index, maximumMs });
    if (multimodalEnabled && maximumMs < PHYSIOLOGY_WINDOWS_MS.respiration)
      warn('short_physiology_window', path, 'Короткий блок не даёт самостоятельной оценки физиологии: окна ЧСС 10 с, дыхания 20 с. Это параметры алгоритма, не гарантия точности.',
        'Short blocks do not provide independent physiology estimates: heart-rate windows are 10 s, respiration windows 20 s. These are algorithm settings, not accuracy guarantees.');
    if (config.useAOI && definition.participantShell?.calibration === false)
      fail('gaze_calibration_required', path, 'Для анализа взгляда/AOI нужна калибровка.', 'Gaze/AOI analysis requires calibration.');
    if (task === 'passive_viewing' && config.slideChangeMode && config.slideChangeMode !== 'timer')
      fail('manual_slides_unsupported', path, 'Ручная смена слайдов не реализована в опубликованном протоколе.', 'Manual slide changes are not supported by the published runtime.');
  }
  if (trialCount > PUBLICATION_LIMITS.trials)
    fail('trial_limit', '/blocks', 'Превышен лимит 5000 результатов проб. Разделите протокол.', 'The plan exceeds 5000 trial results. Split the protocol.');
  else if (trialCount * 3 > PUBLICATION_LIMITS.trials)
    warn('retry_payload_capacity', '/blocks', 'Повторные попытки могут превысить лимит итогового пакета 5000 проб. Разделите протокол.', 'Retries may exceed the final packet limit of 5000 trials. Split the protocol.');
  if (mediaReport && !mediaReport.ok)
    fail('media_unavailable', '/blocks', 'Файлы недоступны, повреждены или не разрешены текущему исследователю.', 'Media files are unavailable, corrupt or not accessible to this researcher.');
  warn('report_retention_limits', '/blocks', 'В отчётах сохраняется до 200 попыток RT для связности, 480 минут и 400 попыток блоков для физиологии. Повторы и паузы могут приблизить эти пределы.',
    'Reports retain up to 200 RT attempts for connectedness and 480 minutes and 400 block attempts for physiology. Retries and pauses may reach these limits sooner.');
  if (trialCount > 200) warn('result_packet_size', '/blocks', 'Число проб — не гарантия загрузки. На размер итогового пакета влияют повторы и включённые каналы. Проверьте полный тестовый прогон до набора участников.',
    'Trial count alone does not guarantee delivery. Retries and enabled channels affect result size. Run the full protocol before recruiting participants.');
  warn('research_only', '/', 'Сохранённая запись не означает достоверность всех каналов. Webcam-метрики исследовательские; независимая научная валидация не завершена.',
    'A saved recording does not establish validity of every channel. Webcam metrics are research-only; independent scientific validation is incomplete.');
  warn('duration_scope', '/blocks', 'Расчёт времени исключает подготовку, чтение инструкций, опросы, паузы и повторы. Длительная работа на конкретном устройстве не гарантируется.',
    'Timing excludes preparation, instructions, surveys, pauses and retries. Long-session performance on a particular device is not guaranteed.');
  return result();
}
