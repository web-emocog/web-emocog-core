'use strict';

const { presentationAttempts } = require('./attempts');
const { measurement } = require('../../shared/passive-metrics');
const { inconsistentFixationDuration } = require('./metrics');

const LIMITS = Object.freeze({ sessions: 100, trials: 2000, totalTrials: 40000,
  presentations: 200, fixations: 500, totalFixations: 30000, events: 2000,
  intervals: 480, blocks: 100, levels: 100, aois: 32, scales: 20, items: 100,
  moduleRows: 500, featureRows: 12000, metrics: 200, gridCells: 8192, totalGridCells: 500000 });
const SPEC = [
  ['R1', 'Вариабельность времени реакции', 'Нет сохранённых корректных ответов с числовым RT.'],
  ['R2', 'Квантили времени реакции', 'Нет сохранённых корректных ответов с числовым RT.'],
  ['R3', 'Медленные и быстрые ответы', 'Нет ответов для заданных порогов.'],
  ['R4', 'Изменение RT по ходу задания', 'Нет сохранённого порядка или времён ответов для описания тренда.'],
  ['R5', 'Скорость и точность', 'Нет совместно измеренных RT и точности.'],
  ['R6', 'Стоимость условия относительно референса', 'Нет полных пар выбранной метрики.'],
  ['R7', 'Соседние ответы после ошибки', 'Нет безопасно сопоставимых соседних корректных ответов после ошибки и после верного ответа.'],
  ['R8', 'Исходные частоты обнаружения сигнала', 'Нет ответов в явно заданных signal/noise условиях.'],
  ['G1', 'Ранжирование областей интереса', 'Нет полных фиксаций и заданных AOI.'],
  ['G2', 'Достижение заданных целей', 'Нет наблюдаемых предъявлений с явно заданными целевыми AOI.'],
  ['G3', 'Переходы между AOI', 'Нет полных упорядоченных фиксаций; усечённый ряд не восстанавливается.'],
  ['G4', 'Явно заданная последовательность целей', 'Нет полных фиксаций для явно упорядоченных целей.'],
  ['G5', 'Энтропия пространственной занятости', 'Нет сохранённой пространственной сетки; это не оценка концентрации.'],
  ['G6', 'Сбалансированная карта участников', 'Нет сопоставимых пространственных сеток участников.'],
  ['F1', 'Сохранённые оценки физиологии', 'Нет валидной сводки ЧСС или дыхания.'],
  ['F2', 'Изменение относительно базового блока', 'Нет сохранённой физиологии принятого базового блока и другого блока.'],
  ['F3', 'Минутные и блочные траектории', 'Нет сохранённых физиологических интервалов; сессионная средняя не является траекторией.'],
  ['F4', 'Изменение в интервале восстановления', 'Нет сравнимых сохранённых интервалов; непрерывное время восстановления не измерено.'],
  ['F5', 'Сохранённые характеристики морганий', 'Нет полной сохранённой сводки морганий.'],
  ['F6', 'Движение и положение корпуса', 'Нет валидной сохранённой сводки позы.'],
  ['F7', 'Мимические proxy между сессиями', 'Нет сохранённых валидных мимических proxy; истинные эмоции не измерены.'],
  ['A1', 'Акустические признаки по блокам', 'Нет принятых audioWindow с числовыми биомаркерами и блоком.'],
  ['A2', 'Траектории акустических признаков', 'Нет принятых audioWindow с сохранённым временем; ASR и стресс не оцениваются.'],
  ['A3', 'Явно заданное шкалирование анкет', 'Нет полных числовых ответов для заданных шкал.'],
  ['A4', 'Распределения и время заполнения анкет', 'Нет событий survey_response с длительностью или допустимыми ответами.'],
  ['A5', 'Сопоставление самоотчёта и метрик', 'Нет шкалы и числовой метрики в одной сессии.'],
  ['Q1', 'Завершение и потери сессий', 'Нет сессий; отказы до регистрации сессии неизвестны.'],
  ['Q2', 'Чувствительность к записанным QC', 'Нет числовых метрик для сравнения записанных QC; видео повторно не анализируется.'],
  ['Q3', 'Браузер и устройство: описательные QC', 'Нет сохранённых категорий устройства или браузера.'],
  ['Q4', 'План и зарегистрированные длительности', 'Нет presentation_plan и сопоставимых фактических длительностей.'],
  ['Q5', 'Совместная доступность каналов', 'Нет сессий для описания доступности каналов.'],
  ['Q6', 'Происхождение методов', 'Нет записанных версий методов; метод не восстанавливается по имени файла.'],
  ['Q7', 'Плоский экспорт признаков', 'Нет числовых признаков для экспорта.'],
];
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const nonnegative = v => number(v) !== null && v >= 0 ? v : null;
const id = v => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))
  && /^[\p{L}\p{N}_.: +\-]{1,128}$/u.test(String(v))
  && !['__proto__', 'prototype', 'constructor'].includes(String(v)) ? String(v) : null;
const label = (v, fallback) => typeof v === 'string' && v.length <= 120
  && !/[<>@&\x00-\x1f]|:\/\/|[\\/]/.test(v) ? v : fallback;
const mean = values => {
  const xs = values.filter(v => number(v) !== null);
  const result = xs.length ? xs.reduce((sum, v) => sum + v / xs.length, 0) : null;
  return number(result);
};
const sum = xs => xs.reduce((a, b) => a + b, 0);
const quantile = (values, q) => {
  const xs = values.slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const at = (xs.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return xs[lo] * (1 - (at - lo)) + xs[hi] * (at - lo);
};
const groups = (values, key) => {
  const out = new Map();
  for (const value of values) {
    const k = key(value);
    if (k == null) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(value);
  }
  return out;
};
const blocked = v => v?.qualityValid === false || v?.valid === false || v?.accepted === false
  || v?.held === true || v?.published === false || v?.skippedMedia === true
  || v?.invalidationReason === 'page_reloaded'
  || ['rejected', 'excluded', 'interrupted', 'repeat_required', 'in_progress', 'held', 'invalid', 'ambiguous', 'incomplete'].includes(v?.status);
const rtValues = trials => trials.filter(t => !blocked(t) && t.correct === true)
  .map(t => nonnegative(t.rt)).filter(v => v !== null);
const taskValues = trials => {
  const rt = rtValues(trials), avg = mean(rt);
  const sd = rt.length > 1 ? Math.sqrt(sum(rt.map(v => ((v - avg) / Math.sqrt(rt.length - 1)) ** 2))) : null;
  const scored = trials.filter(t => !blocked(t) && typeof t.correct === 'boolean');
  return { 'rt.mean': avg, 'rt.median': quantile(rt, .5), 'rt.sd': number(sd),
    'rt.cv': avg > 0 && sd !== null ? number(sd / avg) : null,
    'rt.q10': quantile(rt, .1), 'rt.q25': quantile(rt, .25), 'rt.q75': quantile(rt, .75),
    'rt.q90': quantile(rt, .9),
    'task.accuracy': scored.length ? scored.filter(t => t.correct).length / scored.length : null };
};

function inside(point, aoi) {
  const ps = Array.isArray(aoi.points) ? aoi.points.slice(0, 32) : [];
  if (ps.length < 2 || ps.some(p => number(p?.x) === null || number(p?.y) === null)) return false;
  const xs = ps.map(p => p.x), ys = ps.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if (aoi.shape === 'rectangle') return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
  if (aoi.shape === 'ellipse') {
    const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2;
    return rx > 0 && ry > 0 && ((point.x - (minX + rx)) / rx) ** 2 + ((point.y - (minY + ry)) / ry) ** 2 <= 1;
  }
  if (aoi.shape !== 'polygon' || ps.length < 3) return false;
  let hit = false;
  for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
    const a = ps[i], b = ps[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function coarsenGrid(width, height, values, maxCells) {
  const w = Math.min(width, maxCells, Math.max(1, Math.floor(Math.sqrt(maxCells * width / height))));
  const h = Math.min(height, Math.max(1, Math.floor(maxCells / w)));
  const out = Array(w * h).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const xx = Math.min(w - 1, Math.floor((x + .5) * w / width));
    const yy = Math.min(h - 1, Math.floor((y + .5) * h / height));
    out[yy * w + xx] += values[y * width + x];
  }
  return { width: w, height: h, values: out };
}

/** Pure projection of already-authorized, publication-pinned persisted session rows.
 * Values are session estimates, averaged equally within participant and then participant-equally.
 * No inference, hypothesis tests, raw-text reflection, or signal reconstruction occurs here.
 */
function buildFeatureReport(sourceRows, settings = {}) {
  const definition = object(settings?.definition), plan = object(settings?.plan);
  const modules = SPEC.map(([moduleId, title, reason]) => ({ id: moduleId, title, status: 'no_data', reason, metrics: [], rows: [] }));
  const byModule = new Map(modules.map(m => [m.id, m]));
  const moduleValues = new Map(), catalog = new Map(), featureRows = [], states = [], gazeGroups = new Map();
  const filters = object(plan.filters), axis = plan.axis === 'condition' ? 'condition' : 'block';
  const availability = { schemaVersion: 'extended_features.v1', aggregation: 'equal_session_then_equal_participant',
    rtPopulation: 'correct_nonnegative_rt_accepted_attempts', accuracyUnit: 'fraction', cvUnit: 'ratio', axis,
    limits: { ...LIMITS }, truncated: false, truncationReasons: [], excludedAttempts: 0,
    unidentifiedSessions: 0, duplicateSessions: 0, channels: {}, moduleStatuses: {},
    limitations: ['Описательные признаки, не клинические состояния.',
      'Доступность каналов не является когнитивным баллом.',
      'Отсутствие значения не заменяется нулём; неизвестное качество не считается прошедшим QC.'] };
  const truncate = reason => {
    availability.truncated = true;
    if (!availability.truncationReasons.includes(reason)) availability.truncationReasons.push(reason);
  };
  const list = (v, max, reason) => {
    if (!Array.isArray(v)) return [];
    if (v.length > max) truncate(reason);
    return v.slice(0, max).filter(v => v && typeof v === 'object' && !Array.isArray(v));
  };
  const selected = (values, value) => !Array.isArray(values) || !values.length || values.slice(0, 100).some(v => id(v) === id(value));
  const trialFilter = t => selected(filters.blockIds, t.blockId ?? t.block)
    && selected(filters.conditionIds, t.condition)
    && selected(filters.stimulusIds, typeof t.stimulusId === 'string' ? t.stimulusId.replace(/^api:/, '') : t.stimulusId);
  const fineScope = ['conditionIds', 'stimulusIds', 'aoiIds'].some(k => Array.isArray(filters[k]) && filters[k].length);
  const blockScope = Array.isArray(filters.blockIds) && filters.blockIds.length > 0;
  const wholeScope = !fineScope && !blockScope;
  const blocks = list(definition.blocks, LIMITS.blocks, 'definition_blocks');
  const scaleSpecs = list(plan.surveyScoring, LIMITS.scales, 'survey_scales').map((scale, index) => {
    const items = list(scale.items, LIMITS.items, 'scale_items');
    const valid = id(scale.id) && items.length && Array.isArray(scale.items) && items.length === scale.items.length
      && new Set(items.map(i => id(i.questionId))).size === items.length && items.every(i => id(i.questionId)
        && (i.reverse === undefined || typeof i.reverse === 'boolean')
        && (i.numericText === undefined || typeof i.numericText === 'boolean')
        && (!i.numericText || number(i.min) !== null && number(i.max) !== null && i.min < i.max)
        && (i.values === undefined || Array.isArray(i.values) && i.values.length > 0 && i.values.length <= 100
          && i.values.every(v => v && typeof v === 'object' && id(v.optionId) && number(v.value) !== null)
          && new Set(i.values.map(v => v.optionId)).size === i.values.length)
        && (i.min === undefined || number(i.min) !== null) && (i.max === undefined || number(i.max) !== null)
        && (i.min === undefined || i.max === undefined || i.min < i.max)
        && (!i.reverse || number(i.min) !== null && number(i.max) !== null && i.min < i.max));
    return { id: id(scale.id), items, valid, label: `Шкала ${index + 1}` };
  });
  const blockOptions = blocks.map((b, i) => ({ id: id(b.id), label: label(b.title ?? b.label ?? b.content?.title ?? b.name, `Блок ${i + 1}`) })).filter(b => b.id);
  const blockNames = new Map(blockOptions.map(b => [b.id, b.label]));
  const questionOptions = [];
  for (const b of blocks) for (const q of list(b.content?.questions ?? b.params?.questions, LIMITS.items, 'survey_questions')) {
    if (!id(q.id) || questionOptions.length >= LIMITS.items) continue;
    questionOptions.push({ id: id(q.id), questionId: id(q.id), blockId: id(b.id),
      label: label(q.text ?? q.label, `Вопрос ${questionOptions.length + 1}`),
      type: ['single', 'multiple', 'open'].includes(q.type) ? q.type : 'unknown',
      min: number(q.min), max: number(q.max),
      options: list(q.options, 100, 'question_options').filter(o => id(o.id))
        .map((o, i) => ({ id: id(o.id), label: label(o.label, `Вариант ${i + 1}`) })) });
  }
  const conditionNames = new Map();
  for (const c of list(definition.conditions, LIMITS.levels, 'definition_conditions')) {
    if (id(c.id)) conditionNames.set(id(c.id), label(c.label ?? c.title ?? c.name, `Условие ${conditionNames.size + 1}`));
  }
  const nameBlock = key => blockNames.get(key) || 'Блок без названия';
  const nameCondition = key => {
    if (!conditionNames.has(key) && conditionNames.size < LIMITS.levels) conditionNames.set(key, `Условие ${conditionNames.size + 1}`);
    return conditionNames.get(key) || 'Условие без названия';
  };
  for (const b of blocks) for (const t of list(b.trials, LIMITS.trials, 'definition_trials')) {
    if (id(t.condition)) nameCondition(id(t.condition));
  }
  const configure = (key, reason) => Object.assign(byModule.get(key), { status: 'needs_configuration', reason });
  const row = (key, value, computed = true) => {
    const m = byModule.get(key);
    if (['G1', 'G2', 'G3'].includes(key) && (value.aoiId || value.fromId)) {
      if (value.participantId === null) return;
      const groupKey = JSON.stringify([key, value.blockId, value.stimulusId, value.aoiId, value.fromId, value.toId]);
      if (!gazeGroups.has(groupKey)) {
        if (gazeGroups.size >= LIMITS.moduleRows) { truncate('gaze_groups'); return; }
        gazeGroups.set(groupKey, { key, example: value, people: new Map(), count: 0 });
      }
      const group = gazeGroups.get(groupKey);
      if (!group.people.has(value.participantId)) group.people.set(value.participantId, new Map());
      const sessions = group.people.get(value.participantId);
      if (!sessions.has(value.sessionId)) sessions.set(value.sessionId, { n: 0, dwell: 0, fixations: 0, reached: 0 });
      const session = sessions.get(value.sessionId); session.n++;
      session.dwell += value.dwellMs || 0; session.fixations += value.fixationCount || 0; session.reached += value.reached || 0;
      group.count += value.count || 0;
      m.status = 'computed'; m.reason = null;
      return;
    }
    if (m.rows.length < LIMITS.moduleRows) m.rows.push(value);
    else truncate('module_rows_' + key);
    if (computed && m.status !== 'needs_configuration') { m.status = 'computed'; m.reason = null; }
  };
  const register = (metricId, metricLabel, unit) => {
    if (!catalog.has(metricId) && catalog.size < LIMITS.metrics) catalog.set(metricId, { id: metricId, label: metricLabel, unit });
  };
  const emit = (key, s, metricId, metricLabel, value, unit, level = null, extra = {}) => {
    value = number(value);
    register(metricId, metricLabel, unit);
    const levelId = id(level);
    const target = levelId === null ? s.metrics : (() => {
      if (!s.conditions.has(levelId)) {
        if (s.conditions.size >= LIMITS.levels) { truncate('condition_levels'); return new Map(); }
        s.conditions.set(levelId, new Map());
      }
      return s.conditions.get(levelId);
    })();
    if (value !== null) {
      if (!target.has(metricId)) target.set(metricId, []);
      target.get(metricId).push(value);
    }
    const item = { participantId: s.participantId, sessionId: s.sessionId,
      blockId: extra.blockId ?? (axis === 'block' ? levelId : null), axis, levelId,
      conditionId: axis === 'condition' ? levelId : null, metricId, value, unit,
      status: value === null ? 'no_data' : 'computed' };
    if (featureRows.length < LIMITS.featureRows) featureRows.push(item); else truncate('feature_rows');
    if (value !== null) {
      if (!moduleValues.has(key)) moduleValues.set(key, []);
      moduleValues.get(key).push({ ...item, levelId });
      // Condition features remain in the export and participant model; do not
      // mix them into a session-wide distribution as extra independent records.
      if (levelId === null && key !== 'G3') row(key, { ...item, label: metricLabel, ...extra }, true);
      else if (key === 'G3') { byModule.get(key).status = 'computed'; byModule.get(key).reason = null; }
    }
  };
  const note = (key, text) => {
    const m = byModule.get(key);
    m.reason = m.reason ? `${m.reason} ${text}` : text;
  };
  const sessionArray = Array.isArray(sourceRows) ? sourceRows : [];
  if (sessionArray.length > LIMITS.sessions) truncate('sessions');
  let trialBudget = LIMITS.totalTrials, fixationBudget = LIMITS.totalFixations, gridBudget = LIMITS.totalGridCells;
  const seenSessions = new Set();
  for (const input of sessionArray.slice(0, LIMITS.sessions)) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue;
    const sessionId = id(input.session_id) ?? id(input.id);
    // Snapshot filters carry database IDs; the public UUID is the export identity.
    if (sessionId === null || !selected(filters.sessionIds, input.id ?? sessionId)) continue;
    if (seenSessions.has(sessionId)) { availability.duplicateSessions++; continue; }
    const participantId = Object.hasOwn(input, 'participant_key') ? id(input.participant_key) : id(input.participant_id);
    if (!selected(filters.participantIds, participantId)) continue;
    seenSessions.add(sessionId);
    const p = object(input.features_payload);
    const historyIncomplete = p.experimentMeta?.storageRecovery?.signalSeriesIncomplete === true
      || p.experimentMeta?.checkpointBuild?.signalSeriesIncomplete === true;
    const sourceTask = list(p.cognitiveResults, Math.min(LIMITS.trials, trialBudget), 'task_trials').filter(trialFilter);
    const task = filters.aoiIds?.length ? [] : sourceTask;
    trialBudget -= sourceTask.length;
    const attemptKey = t => id(t.presentationId) ? 'p:' + id(t.presentationId)
      : id(t.trialId) && Number.isSafeInteger(t.attempt) ? JSON.stringify([id(t.blockId ?? t.block), id(t.trialId), t.attempt]) : null;
    const duplicates = groups(task, attemptKey);
    const invalid = t => blocked(t) || (attemptKey(t) !== null && duplicates.get(attemptKey(t))?.length > 1);
    const valid = task.filter(t => !invalid(t));
    availability.excludedAttempts += task.length - valid.length;
    const s = { participantId, sessionId, metrics: new Map(), conditions: new Map(), row: input, payload: p,
      task, valid, historyIncomplete, invalid, channels: new Set(), grids: [] };
    states.push(s);
    if (participantId === null) availability.unidentifiedSessions++;
    for (const t of task) if (id(t.condition)) nameCondition(id(t.condition));

    const tv = taskValues(valid);
    const taskMetric = (scopeTrials, level = null) => {
      const values = taskValues(scopeTrials);
      for (const [metricId, metricLabel, unit, key] of [
        ['rt.mean', 'Среднее RT корректных ответов', 'ms', 'R1'], ['rt.sd', 'Стандартное отклонение RT', 'ms', 'R1'],
        ['rt.cv', 'Коэффициент вариации RT', 'ratio', 'R1'], ['rt.median', 'Медиана RT', 'ms', 'R2'],
        ['rt.q10', 'RT: 10-й процентиль', 'ms', 'R2'], ['rt.q25', 'RT: 25-й процентиль', 'ms', 'R2'],
        ['rt.q75', 'RT: 75-й процентиль', 'ms', 'R2'], ['rt.q90', 'RT: 90-й процентиль', 'ms', 'R2'],
        ['task.accuracy', 'Доля правильных ответов среди оценённых', 'fraction', 'R5'],
      ]) emit(key, s, metricId, metricLabel, values[metricId], unit, level);
    };
    taskMetric(valid);
    for (const [level, ts] of [...groups(valid, t => id(axis === 'condition' ? t.condition : t.blockId ?? t.block))].slice(0, LIMITS.levels)) taskMetric(ts, level);
    if (valid.some(t => number(t.rt) !== null || typeof t.correct === 'boolean')) s.channels.add('task');
    if (tv['rt.mean'] !== null && tv['task.accuracy'] !== null) row('R5', { participantId, sessionId,
      rtMean: tv['rt.mean'], accuracy: tv['task.accuracy'], nCorrectRt: rtValues(valid).length,
      nScored: valid.filter(t => typeof t.correct === 'boolean').length });

    const slow = nonnegative(plan.slowThresholdMs), fast = nonnegative(plan.fastThresholdMs), rt = rtValues(valid);
    if ((slow !== null || fast !== null) && !(slow !== null && fast !== null && fast >= slow)) {
      if (rt.length && slow !== null) emit('R3', s, 'rt.slowFraction', 'Доля RT строго выше заданного порога', rt.filter(v => v > slow).length / rt.length, 'fraction');
      if (rt.length && fast !== null) emit('R3', s, 'rt.fastFraction', 'Доля RT строго ниже заданного порога', rt.filter(v => v < fast).length / rt.length, 'fraction');
    }

    // Never turn an unknown order, filtered gap, retry, or reload into a neighboring trial.
    const reload = list(p.events, LIMITS.events, 'events').some(e => ['session_restored_after_reload',
      'session_reload_recovery_acknowledged', 'cognitive_task_resume_after_reload'].includes(e.type));
    const timed = valid.filter(t => t.correct === true && nonnegative(t.rt) !== null && nonnegative(t.onsetMs) !== null);
    for (const [blockId, ts] of groups(timed, t => id(t.blockId ?? t.block))) {
      if (ts.length < 2 || reload) continue;
      const sorted = ts.slice().sort((a, b) => a.onsetMs - b.onsetMs);
      const x = sorted.map(t => (t.onsetMs - sorted[0].onsetMs) / 60000), y = sorted.map(t => t.rt);
      const mx = mean(x), my = mean(y), variance = sum(x.map(v => (v - mx) ** 2));
      if (!(variance > 0)) continue;
      const slope = sum(x.map((v, i) => (v - mx) * (y[i] - my))) / variance;
      row('R4', { participantId, sessionId, blockId, block: nameBlock(blockId), startRt: y[0], endRt: y.at(-1),
        deltaMs: y.at(-1) - y[0], slopeMsPerMinute: number(slope), n: y.length, elapsedMs: sorted.at(-1).onsetMs - sorted[0].onsetMs });
      emit('R4', s, 'rt.timeSlope', 'Линейный описательный тренд RT', slope, 'ms/min');
    }
    if (!reload && !p.rt_alignment?.truncated && !historyIncomplete) {
      const strata = new Map();
      for (let i = 1; i < task.length; i++) {
        const previous = task[i - 1], current = task[i];
        if (invalid(previous) || invalid(current) || current.correct !== true || typeof previous.correct !== 'boolean'
          || nonnegative(current.rt) === null || !id(current.condition) || !id(current.blockId ?? current.block)
          || id(current.condition) !== id(previous.condition) || id(current.blockId ?? current.block) !== id(previous.blockId ?? previous.block)
          || !Number.isSafeInteger(current.attempt) || current.attempt !== previous.attempt
          || !Number.isSafeInteger(current.presentationIndex) || current.presentationIndex !== previous.presentationIndex + 1
          || (number(current.onsetMs) !== null && number(previous.onsetMs) !== null && current.onsetMs <= previous.onsetMs)
          || (number(current.sourceTrialIndex) !== null && number(previous.sourceTrialIndex) !== null
            && current.sourceTrialIndex !== previous.sourceTrialIndex + 1)) continue;
        const key = JSON.stringify([id(current.blockId ?? current.block), id(current.condition), current.attempt]);
        if (!strata.has(key)) strata.set(key, { afterError: [], afterCorrect: [], blockId: id(current.blockId ?? current.block), conditionId: id(current.condition) });
        strata.get(key)[previous.correct ? 'afterCorrect' : 'afterError'].push(current.rt);
      }
      const deltas = [];
      for (const v of strata.values()) if (v.afterError.length && v.afterCorrect.length) {
        const delta = mean(v.afterError) - mean(v.afterCorrect); deltas.push(delta);
        row('R7', { participantId, sessionId, blockId: v.blockId, block: nameBlock(v.blockId), conditionId: v.conditionId,
          condition: nameCondition(v.conditionId), afterErrorRt: mean(v.afterError), afterCorrectRt: mean(v.afterCorrect),
          deltaMs: delta, nAfterError: v.afterError.length, nAfterCorrect: v.afterCorrect.length });
      }
      if (deltas.length) emit('R7', s, 'rt.postErrorDelta', 'RT после ошибки минус RT после верного ответа', mean(deltas), 'ms');
    }
    const signal = Array.isArray(plan.signalConditions?.signal) ? plan.signalConditions.signal.slice(0, 100).map(id).filter(Boolean) : [];
    const noise = Array.isArray(plan.signalConditions?.noise) ? plan.signalConditions.noise.slice(0, 100).map(id).filter(Boolean) : [];
    if (signal.length && noise.length && !signal.some(c => noise.includes(c))) {
      const counts = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 };
      let n = 0;
      for (const t of valid) {
        const c = id(t.condition);
        if ((!signal.includes(c) && !noise.includes(c)) || !Object.hasOwn(t, 'response') || t.response === undefined) continue;
        counts[signal.includes(c) ? t.response == null ? 'misses' : 'hits' : t.response == null ? 'correctRejections' : 'falseAlarms']++; n++;
      }
      if (n) {
        row('R8', { participantId, sessionId, ...counts, observations: n });
        for (const [key, metricLabel] of [['hits', 'Попадания'], ['misses', 'Пропуски'], ['falseAlarms', 'Ложные тревоги'], ['correctRejections', 'Правильные отвержения']]) {
          emit('R8', s, key, metricLabel, counts[key], 'count');
        }
      }
    }

    const passive = [
      ['F1', 'physiology.bpm', 'physiology.bpm_mean', 'Средняя сохранённая ЧСС', 'bpm'],
      ['F1', 'physiology.respiration', 'physiology.respiration_mean', 'Средняя сохранённая частота дыхания', 'breaths/min'],
      ['F5', 'blink.rate', 'blink.rate_per_min', 'Частота морганий', 'blinks/min'],
      ['F5', 'blink.count', 'blink.count', 'Количество морганий', 'count'],
      ['F6', 'body.velocity', 'body.velocity_mean', 'Средняя скорость движения корпуса', 'torso/s'],
      ['F6', 'body.velocityP95', 'body.velocity_p95', 'P95 скорости в сохранённом окне', 'torso/s'],
      ['F7', 'face.valence', 'face.valence_mean', 'Сохранённая мимическая валентность (proxy)', 'index'],
      ['F7', 'face.arousal', 'face.arousal_mean', 'Сохранённая мимическая активность (proxy)', 'index'],
    ];
    for (const [key, metricId, sourceId, metricLabel, unit] of passive) {
      if (!wholeScope) continue;
      const source = metricId.startsWith('physiology.bpm') ? p.bpm_summary : metricId.startsWith('physiology.respiration') ? p.respiration_summary
        : metricId.startsWith('blink.') ? p.blink_summary : metricId.startsWith('body.') ? p.body_pose_summary : p.emotion_summary;
      if (blocked(source) || (key === 'F7' && (source?.degraded === true || source?.dataSource === 'landmarks'))) continue;
      const m = measurement(p, sourceId);
      emit(key, s, metricId, metricLabel, m?.value, unit);
      if (m?.value !== null && number(m?.value) !== null) {
        s.channels.add(key === 'F1' ? metricId : key === 'F5' ? 'blink' : key === 'F6' ? 'body' : 'face');
        if (key === 'F1') {
          const low = metricId === 'physiology.bpm' ? 45 : 6, high = metricId === 'physiology.bpm' ? 180 : 24;
          const min = number(metricId === 'physiology.bpm' ? p.bpm_summary?.bpmMin : p.respiration_summary?.resp_rate_min);
          const max = number(metricId === 'physiology.bpm' ? p.bpm_summary?.bpmMax : p.respiration_summary?.resp_rate_max);
          row('F1', { participantId, sessionId, metricId, label: metricLabel, value: m.value, count: m.n,
            min: min !== null && min >= low && min <= m.value ? min : null,
            max: max !== null && max <= high && max >= m.value ? max : null, unit });
        }
      }
    }
    const blink = object(p.blink_summary ?? p.attentionMetrics?.global?.blinkDynamics);
    if (wholeScope && !historyIncomplete && !blocked(blink) && nonnegative(blink.blinkCount) !== null) {
      for (const [metricId, metricLabel, value, unit] of [
        ['blink.duration', 'Средняя сохранённая длительность моргания', blink.blinkCount > 0 ? blink.durationMs?.mean ?? blink.meanDurationMs : null, 'ms'],
        ['blink.incompletePct', 'Доля неполных морганий по записанному правилу', blink.incompleteBlinkRate <= 100 ? blink.incompleteBlinkRate : null, 'pct'],
        ['blink.amplitude', 'Средняя сохранённая амплитуда моргания', blink.blinkCount > 0 ? blink.amplitude?.mean : null, 'index'],
      ]) emit('F5', s, metricId, metricLabel, nonnegative(value), unit);
    }
    const body = object(p.body_pose_summary);
    if (wholeScope && body.enabled !== false && !blocked(body) && body.validSampleCount > 0) {
      for (const [metricId, metricLabel, value, unit] of [
        ['body.lean', 'Средний абсолютный наклон корпуса', body.torsoLeanAbsMeanDeg, 'deg'],
        ['body.shoulders', 'Средний абсолютный наклон плеч', body.shoulderRollSampleCount > 0 ? body.shoulderRollAbsMeanDeg : null, 'deg'],
        ['body.bursts', 'Сохранённое количество всплесков движения', body.movementBurstCount, 'count'],
      ]) emit('F6', s, metricId, metricLabel, nonnegative(value), unit);
    }

    const intervalPayload = object(p.physiology_intervals);
    const intervalRows = [];
    if (intervalPayload.schemaVersion === 'physiology_intervals.v1' && !fineScope) {
      for (const [kind, entries] of [['minute', blockScope ? [] : intervalPayload.minutes], ['block', intervalPayload.blocks]]) {
        for (const entry of list(entries, LIMITS.intervals, 'physiology_intervals')) {
          if (blocked(entry) || kind === 'block' && (entry.status !== 'accepted' || !selected(filters.blockIds, entry.blockId))) continue;
          if (nonnegative(entry.startMs) === null || nonnegative(entry.endMs) === null || entry.endMs <= entry.startMs) continue;
          for (const [channel, metricId, metricLabel, unit, min, max] of [
            ['heartRate', 'physiology.bpm', 'ЧСС', 'bpm', 45, 180], ['respiration', 'physiology.respiration', 'Частота дыхания', 'breaths/min', 6, 24],
          ]) {
            const c = entry[channel];
            if (blocked(c) || !Number.isSafeInteger(c?.count) || c.count <= 0 || c.count > 10000000
              || number(c.mean) === null || c.mean < min || c.mean > max || number(c.observedMs) === null || !(c.observedMs >= 1000)
              || c.observedMs > entry.endMs - entry.startMs) continue;
            const blockId = kind === 'block' ? id(entry.blockId) : null;
            if (kind === 'block' && (!blockId || !Number.isSafeInteger(entry.attempt) || entry.attempt < 1)) continue;
            const v = { participantId, sessionId, blockId, block: blockId ? nameBlock(blockId) : 'Минутный интервал',
              kind, metricId, label: metricLabel, value: c.mean, unit, startMs: entry.startMs, endMs: entry.endMs,
              count: c.count, observedMs: c.observedMs, coverage: c.observedMs / (entry.endMs - entry.startMs),
              attempt: kind === 'block' ? entry.attempt : null, methodVersion: id(c.methodVersion) ?? 'legacy_summary' };
            intervalRows.push(v); row('F3', v); s.channels.add(metricId);
          }
        }
      }
    }
    const blockPhysio = groups(intervalRows.filter(v => v.kind === 'block'), v => JSON.stringify([v.blockId, v.metricId]));
    const blockMeans = [];
    for (const vs of blockPhysio.values()) {
      const first = vs[0], count = sum(vs.map(v => v.count));
      const value = sum(vs.map(v => v.value * (v.count / count)));
      const methods = new Set(vs.map(v => v.methodVersion));
      blockMeans.push({ ...first, value, startMs: Math.min(...vs.map(v => v.startMs)), endMs: Math.max(...vs.map(v => v.endMs)),
        methodVersion: methods.size === 1 ? first.methodVersion : 'mixed_methods' });
      if (axis === 'block') emit('F3', s, first.metricId, first.label, value, first.unit, first.blockId);
    }
    for (const metricId of ['physiology.bpm', 'physiology.respiration']) {
      const vs = blockMeans.filter(v => v.metricId === metricId);
      const baseline = vs.find(v => v.blockId === id(plan.baselineBlockId));
      if (baseline && baseline.methodVersion !== 'mixed_methods') for (const v of vs) {
        if (v.blockId === baseline.blockId || v.methodVersion !== baseline.methodVersion) continue;
        row('F2', { participantId, sessionId, blockId: v.blockId, block: nameBlock(v.blockId), baselineBlockId: baseline.blockId,
          metricId, label: v.label, baseline: baseline.value, value: v.value, delta: v.value - baseline.value, unit: v.unit });
        emit('F2', s, metricId + '.baselineDelta', v.label + ': изменение от базового блока', v.value - baseline.value, v.unit);
      }
      const reference = vs.find(v => v.blockId === id(plan.referenceId));
      const recovery = vs.find(v => v.blockId === id(plan.comparisonId));
      if (reference && recovery && plan.axis === 'block' && reference.blockId !== recovery.blockId
        && recovery.startMs >= reference.endMs && reference.methodVersion === recovery.methodVersion && reference.methodVersion !== 'mixed_methods') {
        row('F4', { participantId, sessionId, metricId, referenceBlockId: reference.blockId, comparisonBlockId: recovery.blockId,
          referenceMean: reference.value, comparisonMean: recovery.value, delta: recovery.value - reference.value,
          resolution: 'stored_block_mean', continuousRecoveryMs: null, unit: reference.unit });
      }
    }

    const audio = object(p.audio_summary);
    const audioAttempt = w => {
      const candidates = task.filter(t => id(w.presentationId) ? id(t.presentationId) === id(w.presentationId)
        : id(w.trialId) && id(t.trialId) === id(w.trialId) && id(t.blockId ?? t.block) === id(w.blockId)
          && (w.attempt == null || t.attempt === w.attempt));
      if (candidates.length > 1 || candidates.some(invalid)) return null;
      if (candidates.length === 1) return { ...w, condition: candidates[0].condition };
      if (task.some(t => id(t.blockId ?? t.block) === id(w.blockId) && id(t.trialId) === id(w.trialId))) return null;
      return task.length && id(w.presentationId) ? null : w;
    };
    const audioWindows = list(audio.windows, 360, 'audio_windows').map(audioAttempt).filter(w => w && w.accepted === true && !blocked(w)
      && w.qc?.valid !== false && w.qc?.isOod !== true && w.qc?.silence !== true && w.qc?.clipping !== true && w.qc?.short !== true
      && trialFilter(w) && id(w.blockId));
    const AUDIO = [
      ['pitch_mean_hz', 'audio.pitch', 'Средняя частота основного тона', 'Hz'],
      ['pitch_std_hz', 'audio.pitchSd', 'Разброс частоты основного тона', 'Hz'],
      ['pitch_variability', 'audio.pitchVariability', 'Вариабельность основного тона', 'ratio'],
      ['jitter_local', 'audio.jitter', 'Локальный jitter', 'ratio'], ['shimmer_local', 'audio.shimmer', 'Локальный shimmer', 'ratio'],
      ['hnr_db', 'audio.hnr', 'Отношение гармоник к шуму', 'dB'], ['speech_fraction', 'audio.speechFraction', 'Доля речи', 'fraction'],
      ['pause_rate', 'audio.pauseRate', 'Частота пауз', '1/s'], ['avg_pause_duration', 'audio.pauseDuration', 'Средняя длительность пауз', 's'],
    ];
    if (audio.enabled !== false && audio.consentGranted !== false && !blocked(audio)) for (const [field, metricId, metricLabel, unit] of AUDIO) {
      const accepted = audioWindows.filter(w => number(w.biomarkers?.[field]) !== null);
      for (const [blockId, ws] of groups(accepted, w => id(w.blockId))) {
        const value = mean(ws.map(w => w.biomarkers[field]));
        row('A1', { participantId, sessionId, blockId, block: nameBlock(blockId), metricId, label: metricLabel, value, unit, windowCount: ws.length });
        if (axis === 'block') emit('A1', s, metricId, metricLabel, value, unit, blockId);
      }
      if (accepted.length) { emit('A1', s, metricId, metricLabel, mean(accepted.map(w => w.biomarkers[field])), unit); s.channels.add('audio'); }
      for (const w of accepted) if (nonnegative(w.sessionStartMs) !== null && nonnegative(w.sessionEndMs) !== null && w.sessionEndMs > w.sessionStartMs) {
        row('A2', { participantId, sessionId, blockId: id(w.blockId), block: nameBlock(id(w.blockId)), metricId, label: metricLabel,
          startMs: w.sessionStartMs, endMs: w.sessionEndMs, value: w.biomarkers[field], unit });
      }
    }

    const events = list(p.events, LIMITS.events, 'events');
    const surveys = events.filter(e => e.type === 'survey_response' && !blocked(e) && selected(filters.blockIds, e.blockId));
    const surveyByBlock = groups(surveys, e => id(e.blockId));
    const uniqueSurveys = [...surveyByBlock.values()].filter(v => v.length === 1).map(v => v[0]);
    const responseIndex = new Map();
    for (const e of uniqueSurveys) {
      const blockId = id(e.blockId), responses = list(e.responses, LIMITS.items, 'survey_responses');
      if (nonnegative(e.durationMs) !== null) {
        emit('A4', s, 'survey.duration', 'Время заполнения анкеты', e.durationMs, 'ms');
        row('A4', { participantId, sessionId, blockId, block: nameBlock(blockId), durationMs: e.durationMs, responseCount: responses.length });
      }
      const declared = blocks.find(b => id(b.id) === blockId)?.content?.questions;
      for (const r of responses) {
        const questionId = id(r.questionId);
        if (!questionId) continue;
        if (!responseIndex.has(questionId)) responseIndex.set(questionId, []);
        responseIndex.get(questionId).push(r);
        if (number(r.value) !== null) row('A4', { participantId, sessionId, blockId, block: nameBlock(blockId), questionId,
          question: `Числовой вопрос ${responseIndex.size}`, value: r.value, count: 1 });
        else if (r.responseType !== 'open' && Array.isArray(declared)) {
          const q = declared.slice(0, 100).find(q => id(q?.id) === questionId);
          const options = list(q?.options, 100, 'survey_options');
          const values = Array.isArray(r.value) ? r.value.slice(0, 100) : [r.value];
          for (const v of new Set(values)) {
            const option = options.find(o => id(o.id) === id(v));
            if (option) row('A4', { participantId, sessionId, blockId, block: nameBlock(blockId), questionId,
              optionId: id(option.id), option: label(option.label, 'Вариант ответа'), count: 1 });
          }
        }
      }
      s.channels.add('survey');
    }
    for (const scale of scaleSpecs.filter(v => v.valid)) {
      const scaleId = scale.id, items = scale.items;
      const values = items.map(item => {
        const candidates = responseIndex.get(id(item.questionId)) || [];
        const response = candidates.length === 1 ? candidates[0] : null;
        const declaredQuestion = questionOptions.find(question => question.id === item.questionId);
        let raw = response ? number(response.value) : null;
        if (raw === null && response?.responseType === 'open' && item.numericText === true
          && number(item.min) !== null && number(item.max) !== null && item.min < item.max
          && typeof response.value === 'string' && /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(response.value.trim())) {
          raw = number(Number(response.value.trim().replace(',', '.')));
        }
        if (raw === null && response?.responseType === 'single' && Array.isArray(item.values)
          && declaredQuestion?.options.some(option => option.id === response.value)) {
          raw = number(item.values.find(entry => entry.optionId === response.value)?.value);
        }
        return raw === null || number(item.min) !== null && raw < item.min || number(item.max) !== null && raw > item.max
          ? null : item.reverse ? item.min + (item.max - raw) : raw;
      });
      const missing = values.filter(v => v === null).length, value = missing ? null : number(sum(values));
      row('A3', { participantId, sessionId, scaleId, scale: scale.label,
        value, missingItems: missing, totalItems: items.length, reversedItems: items.filter(i => i.reverse).length,
        scoring: 'sum_complete_items', status: missing ? 'no_data' : 'computed' }, value !== null);
      emit('A3', s, 'survey.score.' + scaleId, `Сумма: ${scale.label}`, value, 'score');
    }

    // Match attempts with the existing presentation identity rules, on bounded copies only.
    const presentations = list(p.gaze_analytics?.presentations, LIMITS.presentations, 'gaze_presentations');
    const boundedRow = { features_payload: { cognitiveResults: sourceTask,
      experimentMeta: { presentationSequence: p.experimentMeta?.presentationSequence },
      gaze_analytics: { schemaVersion: p.gaze_analytics?.schemaVersion, presentations } } };
    const contexts = presentationAttempts(boundedRow).filter(e => e.includedInDefault && !blocked(e) && !e.gazeMissing && trialFilter(e));
    const gazeFailed = p.gazeValidation?.passed === false;
    for (const entry of gazeFailed ? [] : contexts) {
      if (!(entry.validObservationDurationMs > 0)) continue;
      const blockId = id(entry.blockId), stimulusId = id(String(entry.stimulusId ?? '').replace(/^api:/, ''));
      const block = blocks.find(b => id(b.id) === blockId);
      const aoiDefinitions = object(block?.blockConfig?.aoiDefinitions ?? block?.content?.aoiDefinitions);
      const aois = list(aoiDefinitions[stimulusId] ?? aoiDefinitions['api:' + stimulusId], LIMITS.aois, 'aois')
        .filter(a => id(a.id) && selected(filters.aoiIds, a.id));
      const rawFixations = list(entry.fixationPoints, Math.min(LIMITS.fixations, fixationBudget), 'fixations');
      fixationBudget -= rawFixations.length;
      const complete = entry.fixationsTruncated !== true && Array.isArray(entry.fixationPoints)
        && entry.fixationPoints.length === rawFixations.length;
      const fixations = rawFixations.filter(f => !blocked(f) && number(f.x) !== null && number(f.y) !== null
        && f.x >= 0 && f.x <= 1 && f.y >= 0 && f.y <= 1 && nonnegative(f.durationMs) !== null);
      const ordered = complete && fixations.length === rawFixations.length && fixations.every(f => nonnegative(f.startMs) !== null);
      if (inconsistentFixationDuration(entry, fixations)) continue;
      const ranking = [];
      if (complete) for (const [index, aoi] of aois.entries()) {
        const validity = object(aoi.validityInterval);
        const fs = fixations.filter(f => inside(f, aoi) && (number(validity.startMs) === null && number(validity.endMs) === null
          || nonnegative(f.startMs) !== null && f.startMs >= (number(validity.startMs) ?? 0) && f.startMs <= (number(validity.endMs) ?? Infinity)));
        ranking.push({ participantId, sessionId, blockId, block: nameBlock(blockId), stimulusId,
          presentationId: id(entry.presentationId), aoiId: id(aoi.id), aoi: label(aoi.name ?? aoi.label, `Область ${index + 1}`),
          dwellMs: sum(fs.map(f => f.durationMs)), fixationCount: fs.length });
        if (aoi.isTarget === true) row('G2', { participantId, sessionId, blockId, stimulusId, aoiId: id(aoi.id),
          target: label(aoi.name ?? aoi.label, `Цель ${index + 1}`), reached: fs.length ? 1 : 0, observed: 1 });
      }
      ranking.sort((a, b) => b.dwellMs - a.dwellMs).forEach((r, i) => row('G1', { ...r, rank: i + 1 }));
      if (ordered && aois.length) {
        const orderedFixations = fixations.slice().sort((a, b) => a.startMs - b.startMs);
        const visits = orderedFixations.map(f => {
          const matches = aois.filter(a => inside(f, a) && f.startMs >= (number(a.validityInterval?.startMs) ?? 0)
            && f.startMs <= (number(a.validityInterval?.endMs) ?? Infinity));
          return matches.length === 1 ? id(matches[0].id) : null;
        });
        const transitions = new Map();
        for (let i = 1; i < visits.length; i++) if (visits[i] && visits[i - 1] && visits[i] !== visits[i - 1]) {
          const k = JSON.stringify([visits[i - 1], visits[i]]); transitions.set(k, (transitions.get(k) || 0) + 1);
        }
        emit('G3', s, 'gaze.transitionCount', 'Среднее число переходов между AOI за предъявление', sum([...transitions.values()]), 'count');
        for (const [k, count] of transitions) {
          const [fromId, toId] = JSON.parse(k);
          const aoiName = key => label(aois.find(a => id(a.id) === key)?.name, `Область ${aois.findIndex(a => id(a.id) === key) + 1}`);
          row('G3', { participantId, sessionId, blockId, stimulusId, fromId, toId, from: aoiName(fromId), to: aoiName(toId), count });
        }
        const targets = aois.filter(a => a.isTarget === true);
        if (targets.length > 1 && targets.every(a => number(a.order) !== null)
          && new Set(targets.map(a => a.order)).size === targets.length) {
          const targetIds = targets.slice().sort((a, b) => a.order - b.order).map(a => id(a.id));
          const firstVisits = [...new Set(visits.filter(v => targetIds.includes(v)))];
          const next = firstVisits.findIndex((v, i) => v !== targetIds[i]);
          const matchedTargets = next < 0 ? firstVisits.length : next;
          row('G4', { participantId, sessionId, blockId, stimulusId, presentationId: id(entry.presentationId),
            reachedInOrder: matchedTargets === targets.length ? 1 : 0, orderedTargets: targets.length, matchedTargets,
            method: 'first_target_visit_order' });
        }
      }
      const grid = object(entry.grid), width = grid.width, height = grid.height;
      if (Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width * height <= LIMITS.gridCells
        && Array.isArray(grid.values) && grid.values.length === width * height && grid.values.every(v => nonnegative(v) !== null)) {
        if (gridBudget < grid.values.length) { truncate('grid_cells'); continue; }
        gridBudget -= grid.values.length;
        const total = sum(grid.values);
        if (total > 0 && Number.isFinite(total)) {
          const probabilities = grid.values.map(v => v / total);
          const entropy = -sum(probabilities.filter(v => v > 0).map(v => v * Math.log2(v)));
          emit('G5', s, 'gaze.spatialEntropy', 'Энтропия сохранённой пространственной сетки', entropy, 'bit');
          const coarse = coarsenGrid(width, height, probabilities, 400);
          s.grids.push({ width: coarse.width, height: coarse.height, probabilities: coarse.values, sourceWidth: width, sourceHeight: height,
            mapping: id(entry.algorithm?.parameters?.coordinateMappingVersion) ?? 'legacy',
            version: id(entry.algorithm?.version) ?? 'legacy', stimulusId, blockId });
        }
      }
      s.channels.add('gaze');
    }

    const presentationPlan = object(p.presentation_plan ?? p.experimentMeta?.presentationPlan);
    if (presentationPlan.schemaVersion === 'presentation_plan.v1') {
      const expected = new Map(), ambiguousPlanItems = new Set();
      for (const b of list(presentationPlan.blocks, LIMITS.blocks, 'presentation_plan_blocks')) {
        for (const e of list(b.entries, LIMITS.trials, 'presentation_plan_entries')) if (id(e.planItemId)) {
          if (expected.has(id(e.planItemId))) ambiguousPlanItems.add(id(e.planItemId));
          expected.set(id(e.planItemId), { ...e, blockId: e.blockId ?? b.blockId });
        }
      }
      for (const actual of list(presentationPlan.actual, LIMITS.trials, 'presentation_plan_actual')) {
        if (blocked(actual) || actual.status !== 'completed' || !trialFilter(actual)) continue;
        const e = expected.get(id(actual.planItemId));
        if (!e || ambiguousPlanItems.has(id(actual.planItemId))
          || id(e.blockId) && id(e.blockId) !== id(actual.blockId)
          || task.some(t => id(t.presentationId) && id(t.presentationId) === id(actual.presentationId) && invalid(t))) continue;
        const expectedMs = nonnegative(e?.stimulusDurationMs);
        const perf = number(actual.stimulusOnPerfMs) !== null && number(actual.stimulusOffPerfMs) !== null;
        const epoch = number(actual.stimulusOnEpochMs) !== null && number(actual.stimulusOffEpochMs) !== null;
        const actualMs = perf ? nonnegative(actual.stimulusOffPerfMs - actual.stimulusOnPerfMs)
          : epoch ? nonnegative(actual.stimulusOffEpochMs - actual.stimulusOnEpochMs) : null;
        if (expectedMs === null || actualMs === null) continue;
        row('Q4', { participantId, sessionId, blockId: id(actual.blockId), block: nameBlock(id(actual.blockId)),
          presentationId: id(actual.presentationId), expectedMs, actualMs, deltaMs: actualMs - expectedMs,
          effectivePlannedMs: nonnegative(actual.effectiveStimulusDurationMs),
          clock: perf ? 'performance' : 'epoch', timing: 'browser_recorded_duration_not_physical_onset' });
      }
    }
    const tech = object(p.meta?.tech);
    const browser = ['chrome', 'chromium', 'firefox', 'safari', 'webkit', 'edge'].find(v => String(tech.browser?.family ?? tech.browser ?? tech.browserName ?? '').toLowerCase() === v) ?? null;
    const device = ['desktop', 'laptop', 'mobile', 'tablet', 'desktop_webcam', 'laptop_webcam', 'phone', 'mobile_browser', 'computer_webcam', 'desktop_browser'].find(v => String(tech.deviceClass ?? tech.device ?? '').toLowerCase() === v) ?? null;
    if (browser || device) row('Q3', { sessionId, browser: browser ?? 'Не указан', device: device ?? 'Не указано',
      qc: ['valid', 'borderline', 'invalid'].includes(input.qc_validity) ? input.qc_validity : 'unknown',
      measuredFps: nonnegative(tech.measuredFPS ?? tech.fpsMean), count: 1 });
    const methods = [
      ['physiology.bpm', p.bpm_summary?.methodVersion], ['physiology.respiration', p.respiration_summary?.methodVersion],
      ['blink', p.blink_summary?.algorithmVersion ?? p.blink_summary?.version], ['body', p.body_pose_summary?.version],
      ['face', p.emotion_summary?.algorithmVersion ?? p.emotion_summary?.methodVersion], ['audio', p.audio_summary?.algorithmVersion],
      ['gaze', p.gaze_analytics?.schemaVersion], ['rt_alignment', p.rt_alignment?.algorithmVersion],
    ];
    for (const [channel, version] of methods) if (typeof version === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(version)) {
      row('Q6', { sessionId, channel, methodVersion: version, independentlyValidated: false });
    }
    s.sourceTruncated = historyIncomplete || intervalPayload.truncated === true || p.rt_alignment?.truncated === true
      || p.gaze_analytics?.summary?.presentationsTruncated === true || presentations.some(e => e.fixationsTruncated === true)
      || (audio.windowCount > audioWindows.length && audio.windowCount > 360) || audio.droppedWindowCount > 0;
    if (s.sourceTruncated) {
      availability.limitations.push(...(availability.limitations.includes('Сохранённые ряды усечены или неполны; доступны только оставшиеся наблюдения.') ? []
        : ['Сохранённые ряды усечены или неполны; доступны только оставшиеся наблюдения.']));
    }
  }

  for (const group of gazeGroups.values()) {
    const { participantId, sessionId, presentationId, dwellMs, fixationCount, reached, observed, count, ...context } = group.example;
    const personMean = field => mean([...group.people.values()].map(sessions => mean([...sessions.values()].map(session => session[field] / session.n))));
    const result = { ...context, nParticipants: group.people.size, weighting: 'equal_session_then_equal_participant' };
    if (group.key === 'G1') Object.assign(result, { dwellMs: personMean('dwell'), fixationCount: personMean('fixations'), unit: 'ms' });
    if (group.key === 'G2') Object.assign(result, { reached: personMean('reached'), observed: 1, unit: 'fraction' });
    if (group.key === 'G3') Object.assign(result, { count: group.count, weighting: 'pooled_recorded_transitions' });
    byModule.get(group.key).rows.push(result);
  }
  const collapse = map => Object.fromEntries([...map].map(([key, values]) => [key, mean(values)]).filter(([, v]) => v !== null));
  const startedMs = s => {
    const raw = s.row.started_at;
    if (!(raw instanceof Date) && typeof raw !== 'string') return null;
    const value = new Date(raw).getTime();
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const sessionMetadata = (s, visitIndex) => {
    const publicationVersion = id(s.row.publication_version ?? s.payload.experimentMeta?.publicationVersion);
    const protocolId = id(s.row.protocol_id ?? s.payload.experimentMeta?.protocolId);
    const methods = [s.payload.bpm_summary?.methodVersion, s.payload.respiration_summary?.methodVersion,
      s.payload.body_pose_summary?.version, s.payload.emotion_summary?.methodVersion, s.payload.audio_summary?.algorithmVersion].map(id);
    const completed = !s.payload.experimentMeta?.protocolTermination
      && (s.payload.lifecycle?.status === 'completed' || (!s.payload.lifecycle?.status && !!s.row.stopped_at));
    const comparableKey = publicationVersion && protocolId ? JSON.stringify([protocolId, publicationVersion, axis,
      ['blockIds', 'conditionIds', 'stimulusIds', 'aoiIds'].map(k => Array.isArray(filters[k]) ? filters[k].slice(0, 100).map(id).sort() : []), methods]) : null;
    const visit = Array.isArray(plan.repeatVisits) ? plan.repeatVisits.find(item => item.sessionId === s.sessionId)?.visit : null;
    const eligible = !!comparableKey && completed && !s.historyIncomplete && !s.sourceTruncated && ['A', 'B'].includes(visit);
    return { comparableKey, comparable: { eligible, key: comparableKey, visit: eligible ? visit : null,
      reason: eligible ? null : visit ? 'incomplete_or_incomparable_recording' : 'shared_visit_identity_not_recorded' },
    publicationVersion, protocolId,
    publicationSource: s.row.publication_version != null ? 'server_session_row' : publicationVersion ? 'stored_experiment_metadata' : 'unknown',
    startedAtMs: startedMs(s), visitIndex, visitId: null, visitSource: visitIndex === null ? 'not_recorded' : 'recorded_session_start_order',
    complete: completed, sourceTruncated: s.sourceTruncated };
  };
  const personStates = groups(states.filter(s => s.participantId !== null), s => s.participantId);
  const participants = [...personStates].map(([participantId, sessions]) => {
    const metrics = new Map(), conditions = new Map();
    for (const s of sessions) {
      for (const [metricId, value] of Object.entries(collapse(s.metrics))) {
        if (!metrics.has(metricId)) metrics.set(metricId, []); metrics.get(metricId).push(value);
      }
      for (const [level, entries] of s.conditions) {
        if (!conditions.has(level)) conditions.set(level, new Map());
        for (const [metricId, value] of Object.entries(collapse(entries))) {
          const target = conditions.get(level);
          if (!target.has(metricId)) target.set(metricId, []); target.get(metricId).push(value);
        }
      }
    }
    return { id: participantId, metrics: collapse(metrics), conditions: Object.fromEntries([...conditions].map(([key, value]) => [key, collapse(value)])),
      sessions: sessions.slice().sort((a, b) => (startedMs(a) ?? Infinity) - (startedMs(b) ?? Infinity)).map((s, index, ordered) => ({
        id: s.sessionId, sessionId: s.sessionId, ...sessionMetadata(s, startedMs(s) !== null
          && ordered.filter(other => startedMs(other) === startedMs(s)).length === 1 ? index + 1 : null), metrics: collapse(s.metrics),
        conditions: Object.fromEntries([...s.conditions].map(([key, value]) => [key, collapse(value)])) })) };
  });

  const referenceId = id(plan.referenceId), comparisonId = id(plan.comparisonId), chosenMetric = id(plan.metricId);
  if (!referenceId || !comparisonId || referenceId === comparisonId || !['block', 'condition'].includes(plan.axis) || !chosenMetric) {
    configure('R6', 'Задайте ось, разные референс и сравнение и числовую метрику.');
  } else for (const participant of participants) {
    const reference = participant.conditions[referenceId]?.[chosenMetric], comparison = participant.conditions[comparisonId]?.[chosenMetric];
    if (number(reference) === null || number(comparison) === null) continue;
    row('R6', { participantId: participant.id, metricId: chosenMetric, referenceId, comparisonId,
      reference: plan.axis === 'block' ? nameBlock(referenceId) : nameCondition(referenceId),
      comparison: plan.axis === 'block' ? nameBlock(comparisonId) : nameCondition(comparisonId),
      referenceValue: reference, comparisonValue: comparison, delta: comparison - reference, unit: catalog.get(chosenMetric)?.unit ?? 'index' });
  }
  if (nonnegative(plan.slowThresholdMs) === null && nonnegative(plan.fastThresholdMs) === null
    || nonnegative(plan.slowThresholdMs) !== null && nonnegative(plan.fastThresholdMs) !== null && plan.fastThresholdMs >= plan.slowThresholdMs) {
    configure('R3', 'Явно задайте быстрый и/или медленный порог в мс; быстрый должен быть меньше медленного.');
  }
  const signal = object(plan.signalConditions);
  if (!Array.isArray(signal.signal) || !signal.signal.length || !Array.isArray(signal.noise) || !signal.noise.length
    || signal.signal.some(c => !id(c) || signal.noise.includes(c)) || signal.noise.some(c => !id(c))) {
    configure('R8', 'Явно задайте непересекающиеся списки условий signal и noise; d-prime считает статистический модуль.');
  }
  if (!id(plan.baselineBlockId)) configure('F2', 'Явно выберите базовый блок; базовый уровень не угадывается.');
  if (!referenceId || !comparisonId || referenceId === comparisonId || plan.axis !== 'block') {
    configure('F4', 'Выберите референсный блок и блок восстановления как comparisonId, axis=block.');
  }
  if (!scaleSpecs.some(s => s.valid)) {
    configure('A3', 'Задайте шкалы с уникальными questionId; для обратного пункта обязательны min и max.');
    configure('A5', 'Для сопоставления задайте шкалу и числовую metricId.');
  } else if (!chosenMetric || chosenMetric.startsWith('survey.')) configure('A5', 'Выберите числовую метрику другого канала для сопоставления со шкалой.');
  else for (const s of states) {
    const metrics = collapse(s.metrics);
    if (number(metrics[chosenMetric]) === null) continue;
    for (const [metricId, value] of Object.entries(metrics)) if (metricId.startsWith('survey.score.')) row('A5', {
      participantId: s.participantId, sessionId: s.sessionId, scaleId: metricId, selfReport: value,
      metricId: chosenMetric, metric: catalog.get(chosenMetric)?.label ?? 'Числовая метрика', value: metrics[chosenMetric] });
  }
  const explicitTargets = blocks.some(b => Object.values(object(b.blockConfig?.aoiDefinitions ?? b.content?.aoiDefinitions))
    .slice(0, 100).some(xs => Array.isArray(xs) && xs.slice(0, LIMITS.aois).filter(a => a?.isTarget === true && number(a.order) !== null).length > 1));
  if (!explicitTargets) configure('G4', 'В закреплённом протоколе нужны целевые AOI с явно заданными различными order; порядок массива не используется.');

  // Compare normalized session maps within participant before giving each participant one vote.
  const heatGroups = new Map();
  for (const [participantId, sessions] of personStates) {
    const maps = new Map();
    for (const s of sessions) for (const [key, grids] of groups(s.grids, g => JSON.stringify([g.width, g.height, g.mapping, g.version, g.stimulusId, g.blockId]))) {
      if (!maps.has(key)) maps.set(key, []);
      maps.get(key).push(grids[0].probabilities.map((_, i) => mean(grids.map(g => g.probabilities[i]))));
    }
    for (const [key, sessionMaps] of maps) {
      if (!heatGroups.has(key)) heatGroups.set(key, []);
      heatGroups.get(key).push({ participantId, values: sessionMaps[0].map((_, i) => mean(sessionMaps.map(g => g[i]))) });
    }
  }
  const displayedMaps = [...heatGroups].slice(0, 20);
  if (heatGroups.size > displayedMaps.length) truncate('heatmap_groups');
  for (const [mapIndex, [key, maps]] of displayedMaps.entries()) {
    const [width, height, , , stimulusId, blockId] = JSON.parse(key);
    const balanced = Array.from({ length: width * height }, (_, i) => mean(maps.map(m => m.values[i])));
    const grid = coarsenGrid(width, height, balanced, Math.floor(LIMITS.moduleRows / displayedMaps.length));
    for (let i = 0; i < grid.values.length; i++) row('G6', { x: i % grid.width, y: Math.floor(i / grid.width), blockId, stimulusId,
      map: `Карта ${mapIndex + 1}`, gridWidth: grid.width, gridHeight: grid.height, fullGrid: true,
      value: grid.values[i], nParticipants: maps.length, weighting: 'equal_session_then_equal_participant', downsample: 'mass_preserving_cell_centres' });
  }
  for (const s of states) {
    const lifecycle = s.payload.lifecycle?.status;
    const completed = !s.payload.experimentMeta?.protocolTermination && (lifecycle === 'completed' || (!lifecycle && !!s.row.stopped_at));
    const interrupted = !!s.payload.experimentMeta?.protocolTermination || ['failed', 'aborted', 'interrupted'].includes(lifecycle);
    row('Q1', { sessionId: s.sessionId, participantId: s.participantId, completed: completed ? 1 : 0,
      interrupted: interrupted ? 1 : 0, completion: completed ? 'Завершена' : interrupted ? 'Прервана' : 'Завершение не подтверждено',
      recordedTrials: s.task.length, acceptedTrials: s.valid.length });
    const channels = ['task', 'gaze', 'physiology.bpm', 'physiology.respiration', 'blink', 'body', 'face', 'audio', 'survey'];
    for (const channel of channels) {
      if (!availability.channels[channel]) availability.channels[channel] = { sessions: 0, totalSessions: states.length };
      availability.channels[channel].sessions += s.channels.has(channel) ? 1 : 0;
      row('Q5', { sessionId: s.sessionId, channel, available: s.channels.has(channel) ? 1 : 0,
        sourceTruncated: s.sourceTruncated, jointChannels: s.channels.size, historyIncomplete: s.historyIncomplete });
    }
  }
  for (const metricId of [...catalog.keys()].slice(0, 60)) {
    const all = [], validOnly = [];
    for (const sessions of personStates.values()) {
      const value = mean(sessions.map(s => collapse(s.metrics)[metricId]));
      const strict = mean(sessions.filter(s => s.row.qc_validity === 'valid').map(s => collapse(s.metrics)[metricId]));
      if (value !== null) all.push(value);
      if (strict !== null) validOnly.push(strict);
    }
    if (all.length) row('Q2', { metricId, label: catalog.get(metricId)?.label, defaultMean: mean(all),
      recordedValidOnlyMean: mean(validOnly), delta: validOnly.length ? mean(validOnly) - mean(all) : null,
      defaultParticipants: all.length, validOnlyParticipants: validOnly.length, filter: 'stored_session_qc_validity_valid', rerunVision: false });
  }

  for (const m of modules) {
    const entries = moduleValues.get(m.id) || [];
    for (const [metricId, values] of groups(entries.filter(v => v.levelId === null && v.participantId !== null), v => v.metricId)) {
      const participantValues = [...groups(values, v => v.participantId).values()].map(vs =>
        mean([...groups(vs, v => v.sessionId).values()].map(session => mean(session.map(v => v.value)))));
      const d = catalog.get(metricId);
      m.metrics.push({ id: metricId, label: d.label, value: mean(participantValues), unit: d.unit });
    }
  }
  const detection = byModule.get('R8');
  if (detection.status === 'computed') detection.metrics = ['hits', 'misses', 'falseAlarms', 'correctRejections'].map(metricId => ({
    ...catalog.get(metricId), value: sum((moduleValues.get('R8') || []).filter(v => v.metricId === metricId).map(v => v.value)) }));
  const r6 = byModule.get('R6');
  if (r6.status === 'computed') r6.metrics.push({ id: 'comparison.delta', label: 'Средняя парная разность участников', value: mean(r6.rows.map(r => r.delta)), unit: catalog.get(chosenMetric)?.unit ?? 'index' });
  const q1 = byModule.get('Q1');
  if (states.length) q1.metrics.push({ id: 'sessions.completionFraction', label: 'Доля сессий с подтверждённым завершением',
    value: q1.rows.filter(r => r.completed).length / states.length, unit: 'fraction' });
  if (states.length) byModule.get('Q5').metrics.push({ id: 'channels.available', label: 'Доля доступных ячеек сессия × канал',
    value: sum(states.map(s => s.channels.size)) / (states.length * 9), unit: 'fraction' });
  for (const item of featureRows.slice(0, LIMITS.moduleRows)) row('Q7', { ...item }, item.value !== null);
  byModule.get('Q7').metrics.push({ id: 'export.rows', label: 'Строк в ограниченном экспорте', value: featureRows.length, unit: 'count' });
  note('R4', 'Описательное изменение RT, не показатель утомления; после reload тренд не вычисляется.');
  note('R7', 'Только соседние presentationIndex, одинаковые блок, condition и attempt. Сессии с reload, усечением RT или неполной историей исключены; legacy без порядка недоступен.');
  note('R8', 'Счётчики модуля — исходные суммы сессий, не средние участника; нулевая ячейка не заменяет отсутствующее условие.');
  note('G1', 'Среднее время фиксаций в зоне на предъявление: сначала равно взвешены сессии одного участника, затем участники.');
  note('G2', 'Доля предъявлений с достигнутой целью: сессии и участники взвешены поровну.');
  note('G3', 'Ширина связи отражает сумму сохранённых переходов, не корреляцию и не причинное влияние.');
  note('F4', 'Доступно только изменение сохранённых блочных средних, не латентность и не непрерывная длительность восстановления.');
  note('F7', 'Записанные мимические proxy не являются истинными эмоциями.');
  if (displayedMaps.length) note('G6', 'Каждая карта полная; ячейки укрупнены с сохранением суммарной массы. Разные карты не накладываются друг на друга.');
  note('Q1', 'Только выбранные зарегистрированные сессии; отказы до начала и полная воронка приглашений неизвестны.');
  note('Q4', 'Это длительности браузерных записей, не аппаратная точность физического появления стимула.');
  if (availability.truncated) note('Q7', 'Достигнут лимит отчёта: экспорт или отображаемые строки могут быть неполными.');
  for (const [key, chart] of [
    ['R4', { type: 'bar', x: 'block', y: 'slopeMsPerMinute' }], ['R5', { type: 'scatter', x: 'rtMean', y: 'accuracy' }],
    ['G1', { type: 'bar', x: 'aoi', y: 'dwellMs' }], ['G3', { type: 'matrix', x: 'from', y: 'to' }],
    ['G6', { type: 'matrix', x: 'x', y: 'y', series: 'map' }], ['F3', { type: 'line', x: 'startMs', y: 'value', series: 'label' }],
    ['A2', { type: 'line', x: 'startMs', y: 'value', series: 'label' }], ['A5', { type: 'scatter', x: 'selfReport', y: 'value' }],
    ['Q5', { type: 'matrix', x: 'sessionId', y: 'channel' }],
  ]) if (byModule.get(key).status === 'computed') {
    const m = byModule.get(key);
    m.rows = m.rows.filter(r => r[chart.x] != null && r[chart.y] != null);
    if (m.rows.length) m.chart = chart;
  }
  for (const m of modules) availability.moduleStatuses[m.id] = m.status;
  const options = { blocks: blockOptions,
    conditions: [...conditionNames].map(([key, value]) => ({ id: key, label: value })),
    participants: participants.map((p, i) => ({ id: p.id, label: `Участник ${i + 1}` })),
    metrics: [...catalog.values()], questions: questionOptions,
    sessions: participants.flatMap((person, personIndex) => person.sessions.map((session, index) => ({
      id: session.sessionId, participantId: person.id, label: `Участник ${personIndex + 1} · сессия ${index + 1}` }))) };
  return { modules, participants, featureRows, availability, options };
}

module.exports = { buildFeatureReport, LIMITS };
