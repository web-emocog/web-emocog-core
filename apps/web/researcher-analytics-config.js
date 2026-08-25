(function (global) {
  'use strict';

  const SCHEMA_VERSION = '1.0';
  const STORAGE_PREFIX = 'emocog_analytics_plan_';
  const LEGACY_STORAGE_PREFIX = 'emocog_analytics_config_';

  const packages = [
    {
      id: 'aoi_attention', icon: '◎', color: '#5c66bd', mandatory: false,
      label: { ru: 'AOI и внимание', en: 'AOI and attention' },
      description: { ru: 'Heatmap, взгляд на цель, dwell time, фиксации, TTFF и revisits.', en: 'Heatmap, gaze on target, dwell time, fixations, TTFF, and revisits.' },
      availability: 'aoi'
    },
    {
      id: 'task_performance', icon: '✓', color: '#0ea5e9', mandatory: false,
      label: { ru: 'Выполнение задачи', en: 'Task performance' },
      description: { ru: 'Точность, время реакции, пропуски и лишние ответы.', en: 'Accuracy, reaction time, omissions, and commissions.' },
      availability: 'task'
    },
    {
      id: 'group_descriptive', icon: '◉', color: '#8b5cf6', mandatory: false,
      label: { ru: 'Групповая аналитика', en: 'Group analytics' },
      description: { ru: 'Состав выборки, распределения и описательные сравнения.', en: 'Cohort composition, distributions, and descriptive comparisons.' },
      availability: 'always'
    },
    {
      id: 'data_quality', icon: '◆', color: '#16a34a', mandatory: true,
      label: { ru: 'Качество данных', en: 'Data quality' },
      description: { ru: 'QC по каналам, валидные данные и причины исключения.', en: 'Channel QC, valid data, and exclusion reasons.' },
      availability: 'always'
    }
  ];

  const metrics = [
    metric('viz.heatmap', 'aoi_attention', 'Тепловая карта', 'Heatmap', true, 'Распределение валидных фиксаций на stimulus.', 'Distribution of valid fixations on the stimulus.'),
    metric('aoi.gaze_on_target_pct', 'aoi_attention', 'Взгляд на целевые AOI', 'Gaze on target', true, 'Доля валидного времени взгляда внутри целевых AOI.', 'Share of valid gaze time inside target AOIs.'),
    metric('aoi.dwell_time_ms', 'aoi_attention', 'Время в AOI, мс', 'AOI dwell time, ms', true, 'Суммарная длительность валидных фиксаций внутри AOI.', 'Total duration of valid fixations inside the AOI.'),
    metric('aoi.dwell_time_pct', 'aoi_attention', 'Доля времени в AOI, %', 'AOI dwell share, %', true, 'Dwell time относительно валидного времени наблюдения.', 'Dwell time relative to valid observation time.'),
    metric('aoi.fixation_count', 'aoi_attention', 'Количество фиксаций', 'Fixation count', true, 'Количество валидных фиксаций в AOI.', 'Number of valid fixations in the AOI.'),
    metric('aoi.fixation_rate_per_min', 'aoi_attention', 'Частота фиксаций', 'Fixation rate', false, 'Количество фиксаций на минуту валидного наблюдения.', 'Fixations per minute of valid observation.'),
    metric('aoi.fixation_duration_median_ms', 'aoi_attention', 'Медианная длительность фиксации', 'Median fixation duration', true, 'Типичная длительность фиксации в AOI.', 'Typical fixation duration in the AOI.'),
    metric('aoi.fixation_duration_mean_ms', 'aoi_attention', 'Средняя длительность фиксации', 'Mean fixation duration', false, 'Дополнительное среднее значение для подробностей и export.', 'Secondary mean value for details and export.'),
    metric('aoi.ttff_ms', 'aoi_attention', 'Время до первой фиксации', 'Time to first fixation', true, 'Показывается вместе с Target reached; недостижение не равно нулю.', 'Shown with Target reached; a non-reached AOI is not zero.'),
    metric('aoi.target_reached', 'aoi_attention', 'AOI достигнута', 'AOI reached', true, 'Была ли валидная фиксация в AOI.', 'Whether a valid fixation occurred in the AOI.'),
    metric('aoi.target_reached_pct', 'aoi_attention', 'Доля достигших AOI', 'AOI reach rate', true, 'Доля валидных проб или участников, достигших AOI.', 'Share of valid trials or participants that reached the AOI.'),
    metric('aoi.visit_count', 'aoi_attention', 'Количество посещений AOI', 'AOI visit count', false, 'Число отдельных посещений AOI.', 'Number of separate AOI visits.'),
    metric('aoi.revisit_count', 'aoi_attention', 'Повторные посещения AOI', 'AOI revisits', true, 'Количество возвращений после первого посещения.', 'Returns after the first AOI visit.'),

    metric('task.accuracy_pct', 'task_performance', 'Точность ответов, %', 'Response accuracy, %', true, 'Правильные ответы относительно числа валидных возможностей.', 'Correct responses relative to valid opportunities.'),
    metric('task.rt_median_ms', 'task_performance', 'Медианное время реакции', 'Median reaction time', true, 'Основная сводка времени реакции.', 'Primary reaction-time summary.'),
    metric('task.rt_mean_ms', 'task_performance', 'Среднее время реакции', 'Mean reaction time', false, 'Дополнительное значение и export.', 'Secondary value and export.'),
    metric('task.correct_count', 'task_performance', 'Правильные ответы', 'Correct responses', true, 'Количество правильных ответов.', 'Number of correct responses.'),
    metric('task.error_count', 'task_performance', 'Ошибочные ответы', 'Incorrect responses', true, 'Количество ошибочных ответов.', 'Number of incorrect responses.'),
    metric('task.omission_count', 'task_performance', 'Пропуски', 'Omissions', true, 'Количество требуемых, но отсутствующих ответов.', 'Required responses that were not made.'),
    metric('task.omission_rate_pct', 'task_performance', 'Доля пропусков, %', 'Omission rate, %', true, 'Пропуски относительно числа возможностей.', 'Omissions relative to opportunities.'),
    metric('task.commission_count', 'task_performance', 'Лишние ответы', 'Commissions', true, 'Ответы там, где отвечать не требовалось.', 'Responses when no response was required.'),
    metric('task.commission_rate_pct', 'task_performance', 'Доля лишних ответов, %', 'Commission rate, %', true, 'Лишние ответы относительно числа возможностей.', 'Commissions relative to opportunities.'),
    metric('task.trial_count_valid', 'task_performance', 'Валидные пробы', 'Valid trials', true, 'Количество проб, включённых в расчёт.', 'Trials included in the calculation.'),
    metric('task.trial_count_excluded', 'task_performance', 'Исключённые пробы', 'Excluded trials', true, 'Количество исключённых проб с причинами.', 'Excluded trials with reasons.'),

    metric('qc.sample_count_total', 'data_quality', 'Все gaze-сэмплы', 'Total gaze samples', true, 'Общее число gaze-сэмплов.', 'Total gaze samples.', true),
    metric('qc.sample_count_valid', 'data_quality', 'Валидные gaze-сэмплы', 'Valid gaze samples', true, 'Число сэмплов, прошедших правила валидности.', 'Samples passing validity rules.', true),
    metric('qc.valid_gaze_pct', 'data_quality', 'Валидный взгляд, %', 'Valid gaze, %', true, 'Доля валидного времени gaze.', 'Share of valid gaze time.', true),
    metric('qc.low_confidence_pct', 'data_quality', 'Низкая надёжность gaze, %', 'Low-confidence gaze, %', true, 'Время с signal confidence ниже порога.', 'Time below the signal-confidence threshold.', true),
    metric('qc.off_screen_pct', 'data_quality', 'Взгляд вне экрана, %', 'Off-screen gaze, %', true, 'Корректно определённый взгляд вне viewport.', 'Validly estimated gaze outside the viewport.', true),
    metric('qc.outside_stimulus_pct', 'data_quality', 'Взгляд вне стимула, %', 'Gaze outside stimulus, %', true, 'On-screen взгляд вне content rect стимула.', 'On-screen gaze outside the stimulus content rectangle.', true)
  ];

  function metric(id, packageId, ru, en, defaultSelected, descRu, descEn, mandatory) {
    return {
      id,
      packageId,
      label: { ru, en },
      description: { ru: descRu, en: descEn },
      defaultSelected: defaultSelected === true,
      mandatory: mandatory === true
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function storageKey(experimentKey) {
    return STORAGE_PREFIX + (experimentKey || 'draft');
  }

  function blockHasAoi(block) {
    const definitions = block && block.content && block.content.aoiDefinitions;
    if (!definitions || typeof definitions !== 'object') return false;
    return Object.keys(definitions).some((key) => Array.isArray(definitions[key]) && definitions[key].length > 0);
  }

  function blockCapabilities(block) {
    return {
      aoi: blockHasAoi(block),
      task: !!(block && block.type === 'cognitive_task')
    };
  }

  function experimentCapabilities(blocks) {
    const list = Array.isArray(blocks) ? blocks : [];
    return {
      aoi: list.some(blockHasAoi),
      task: list.some((block) => block && block.type === 'cognitive_task')
    };
  }

  function isPackageAvailable(packageId, capabilities) {
    const def = packages.find((item) => item.id === packageId);
    if (!def) return false;
    if (def.availability === 'aoi') return capabilities.aoi === true;
    if (def.availability === 'task') return capabilities.task === true;
    return true;
  }

  function normalizePackages(input, capabilities) {
    const requested = Array.isArray(input) ? input : [];
    const result = packages
      .filter((item) => item.mandatory || (requested.includes(item.id) && isPackageAvailable(item.id, capabilities)))
      .map((item) => item.id);
    if (!result.includes('data_quality')) result.push('data_quality');
    return result;
  }

  function defaultPackages(capabilities) {
    return normalizePackages(packages
      .filter((item) => item.mandatory || isPackageAvailable(item.id, capabilities))
      .map((item) => item.id), capabilities);
  }

  function defaultMetricIds(packageIds) {
    const enabled = new Set(packageIds || []);
    return metrics
      .filter((item) => item.mandatory || (enabled.has(item.packageId) && item.defaultSelected))
      .map((item) => item.id);
  }

  function normalizeMetricIds(input, packageIds) {
    const enabled = new Set(packageIds || []);
    const known = new Set(metrics.map((item) => item.id));
    const allowed = new Set(metrics
      .filter((item) => item.mandatory || enabled.has(item.packageId))
      .map((item) => item.id));
    const requested = Array.isArray(input) ? input : [];
    const result = requested.filter((id, index) => known.has(id) && allowed.has(id) && requested.indexOf(id) === index);
    metrics.filter((item) => item.mandatory).forEach((item) => {
      if (!result.includes(item.id)) result.push(item.id);
    });
    return result;
  }

  function migrateLegacy(legacy, blocks) {
    if (!legacy || typeof legacy !== 'object') return null;
    const tabs = legacy.tabs || legacy;
    const capabilities = experimentCapabilities(blocks);
    const requested = ['data_quality'];
    if (tabs['session-card'] !== false) {
      if (capabilities.aoi) requested.push('aoi_attention');
      if (capabilities.task) requested.push('task_performance');
    }
    if (tabs['group-comparison'] !== false) requested.push('group_descriptive');
    const packageIds = normalizePackages(requested, capabilities);
    return {
      schemaVersion: SCHEMA_VERSION,
      defaultPackages: packageIds,
      selectedMetricIds: defaultMetricIds(packageIds),
      blockOverrides: {}
    };
  }

  function normalizePlan(raw, blocks) {
    const list = Array.isArray(blocks) ? blocks : [];
    const capabilities = experimentCapabilities(list);
    let source = raw && typeof raw === 'object' ? raw : null;
    if (source && !source.defaultPackages && (source.tabs || source['session-card'] !== undefined)) {
      source = migrateLegacy(source, list);
    }
    const packageIds = source
      ? normalizePackages(source.defaultPackages, capabilities)
      : defaultPackages(capabilities);
    const selectedMetricIds = source && Array.isArray(source.selectedMetricIds)
      ? normalizeMetricIds(source.selectedMetricIds, packageIds)
      : defaultMetricIds(packageIds);
    const blockById = new Map(list.filter(Boolean).map((block) => [String(block.id), block]));
    const overrides = {};
    const rawOverrides = source && source.blockOverrides && typeof source.blockOverrides === 'object'
      ? source.blockOverrides
      : {};
    Object.keys(rawOverrides).forEach((blockId) => {
      const block = blockById.get(String(blockId));
      if (!block) return;
      const caps = blockCapabilities(block);
      const overridePackages = normalizePackages(rawOverrides[blockId].packages, caps);
      overrides[blockId] = {
        packages: overridePackages,
        selectedMetricIds: Array.isArray(rawOverrides[blockId].selectedMetricIds)
          ? normalizeMetricIds(rawOverrides[blockId].selectedMetricIds, overridePackages)
          : defaultMetricIds(overridePackages)
      };
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      defaultPackages: packageIds,
      selectedMetricIds,
      blockOverrides: overrides
    };
  }

  function load(experimentKey, blocks, sources) {
    let raw = null;
    try { raw = JSON.parse(global.localStorage.getItem(storageKey(experimentKey)) || 'null'); } catch (_) { raw = null; }
    if (!raw) {
      const candidates = Array.isArray(sources) ? sources : [];
      raw = candidates.find((item) => item && typeof item === 'object') || null;
    }
    if (!raw) {
      try {
        const legacy = JSON.parse(global.localStorage.getItem(LEGACY_STORAGE_PREFIX + (experimentKey || 'draft')) || 'null');
        raw = migrateLegacy(legacy, blocks);
      } catch (_) { raw = null; }
    }
    return normalizePlan(raw, blocks);
  }

  function save(experimentKey, plan, blocks) {
    const normalized = normalizePlan(plan, blocks);
    global.localStorage.setItem(storageKey(experimentKey), JSON.stringify(normalized));
    return normalized;
  }

  function clearDraft() {
    global.localStorage.removeItem(storageKey('draft'));
    global.localStorage.removeItem(LEGACY_STORAGE_PREFIX + 'draft');
  }

  global.EmocogAnalyticsPlan = {
    schemaVersion: SCHEMA_VERSION,
    packages: clone(packages),
    metrics: clone(metrics),
    storageKey,
    blockCapabilities,
    experimentCapabilities,
    isPackageAvailable,
    defaultMetricIds,
    normalizeMetricIds,
    normalizePlan,
    migrateLegacy,
    load,
    save,
    clearDraft
  };
})(typeof window !== 'undefined' ? window : globalThis);
