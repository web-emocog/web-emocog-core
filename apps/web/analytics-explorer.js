(function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const groups = [
    ['R', 'Реакция', 'Response', '#26816c'], ['G', 'Взгляд', 'Gaze', '#4d98b2'],
    ['F', 'Состояние', 'Signals', '#bf8b35'], ['A', 'Голос и опросы', 'Voice & surveys', '#bf765f'],
    ['S', 'Сравнения', 'Comparisons', '#709646'], ['Q', 'Надёжность', 'Data integrity', '#6b8791']
  ];
  const titles = {
    R1: ['Стабильность реакции','Response consistency'], R2: ['Быстрые и медленные ответы','Response distribution'],
    R3: ['Ответы за выбранными границами','Response thresholds'], R4: ['Изменение в ходе задания','Time on task'],
    R5: ['Скорость и точность','Speed and accuracy'], R6: ['Стоимость условия','Condition difference'],
    R7: ['После ошибки','After an error'], R8: ['Попадания и ложные тревоги','Signal detection'],
    G1: ['Какие зоны замечают','Areas of interest'], G2: ['Достижение цели','Target reach'],
    G3: ['Переходы взгляда','Gaze transitions'], G4: ['Порядок посещения зон','AOI sequence'],
    G5: ['Распределение просмотра','Viewing distribution'], G6: ['Карты групп','Group maps'],
    F1: ['Пульс и дыхание','Heart rate & respiration'], F2: ['Относительно исходного уровня','Baseline differences'],
    F3: ['Динамика сигналов','Signal trajectories'], F4: ['Возврат к исходному уровню','Return to baseline'],
    F5: ['Моргания','Blinks'], F6: ['Движение и поза','Movement and posture'], F7: ['Показатели мимики','Facial proxies'],
    A1: ['Голос по блокам','Voice by block'], A2: ['Изменение голоса','Voice trajectories'],
    A3: ['Баллы опросников','Questionnaire scores'], A4: ['Ответы на вопросы','Survey answers'], A5: ['Самооценка и измерения','Self-report and measures'],
    S1: ['Различия между условиями','Condition comparisons'], S2: ['Ранговые сравнения','Rank comparisons'],
    S3: ['Размер эффекта','Effect sizes'], S4: ['Повторная выборка','Resampling'], S5: ['Связи показателей','Associations'],
    S6: ['Множественные сравнения','Multiple comparisons'], S7: ['Повторные измерения','Repeated measurement reliability'],
    Q1: ['Путь участника','Participant flow'], Q2: ['Устойчивость к фильтрам','Filter sensitivity'], Q3: ['Устройства и браузеры','Devices and browsers'],
    Q4: ['План и предъявление','Planned and actual timing'], Q5: ['Полнота данных','Data completeness'],
    Q6: ['Как получен результат','Methods and provenance'], Q7: ['Данные для своей статистики','Analysis-ready data']
  };
  const labels = { participant: ['Участник','Participant'], participantId: ['Участник','Participant'], sessionId: ['Сессия','Session'],
    blockId: ['Блок','Block'], block: ['Блок','Block'], condition: ['Условие','Condition'], metricId: ['Показатель','Metric'],
    value: ['Значение','Value'], mean: ['Среднее','Mean'], median: ['Медиана','Median'], sd: ['Разброс','SD'], mad: ['Устойчивый разброс','MAD'],
    reference: ['Исходное условие','Reference'], comparison: ['Сравнение','Comparison'], difference: ['Разность','Difference'],
    count: ['Количество','Count'], n: ['Наблюдений','Observations'], rate: ['Доля','Rate'], durationMs: ['Длительность, мс','Duration, ms'],
    startMs: ['Начало, мс','Start, ms'], endMs: ['Конец, мс','End, ms'], time: ['Время','Time'], x: ['Первый показатель','First measure'],
    y: ['Второй показатель','Second measure'], label: ['Название','Label'], unit: ['Единица','Unit'], status: ['Доступность','Availability'],
    p: ['Значение p','p value'], pAdjusted: ['p с поправкой','Adjusted p'], from: ['Откуда','From'], to: ['Куда','To'],
    proportion: ['Доля','Proportion'], coveragePct: ['Наблюдаемое время, %','Observed time, %'] };
  const metricNames = { 'rt.mean': ['Средняя реакция','Mean response'], 'rt.median': ['Медианная реакция','Median response'],
    'rt.cv': ['Вариативность реакции','Response variability'], 'task.accuracy': ['Верные ответы','Correct answers'],
    'physiology.bpm': ['Пульс','Heart rate'], 'physiology.respiration': ['Дыхание','Respiration'],
    'blink.rate': ['Частота морганий','Blink rate'], 'blink.count': ['Моргания','Blink count'],
    'face.valence': ['Баланс мимики','Facial expression balance'], 'face.arousal': ['Активность мимики','Facial activity'],
    'channels.available': ['Доступность каналов','Channel availability'], difference: ['Разность B − A','Difference B − A'],
    effect: ['Разность B − A','Difference B − A'], participantsA: ['Участники A','Participants A'], participantsB: ['Участники B','Participants B'],
    participants: ['Участников','Participants'], p: ['Значение p','p value'], lower: ['Нижняя граница 95%','95% lower bound'],
    upper: ['Верхняя граница 95%','95% upper bound'], standardized: ['Стандартизованный эффект','Standardized effect'],
    statistic: ['Статистика проверки','Test statistic'], hypotheses: ['Гипотез в семействе','Hypotheses in family'],
    available: ['Доступно значений p','Available p values'], rho: ['Связь Спирмена','Spearman association'], r: ['Связь Пирсона','Pearson association'],
    icc: ['Согласованность повторов','Repeat agreement'], dPrime: ['Чувствительность d′','Sensitivity d′'], criterion: ['Критерий ответа','Response criterion'] };
  function guidance(module, h) {
    if (module.status !== 'needs_configuration') return h.tr('Нужные наблюдения не сохранены или не прошли проверку. Подробности — в описании метода.','Required observations are absent or failed checks. See the method for details.');
    return ({ R3: h.tr('Задайте границы быстрых и медленных ответов.','Choose fast and slow response boundaries.'),
      R6: h.tr('Выберите исходное условие и условие сравнения.','Choose reference and comparison conditions.'),
      R8: h.tr('Укажите условия с ответом и без ответа.','Identify respond and withhold conditions.'),
      F2: h.tr('Выберите исходный блок для сравнения сигналов.','Choose a signal baseline block.'),
      F4: h.tr('Выберите исходный блок и блок восстановления.','Choose reference and recovery blocks.'),
      A3: h.tr('Выберите вопросы и правила подсчёта баллов.','Choose items and scoring rules.'),
      A5: h.tr('Настройте шкалу опросника и выберите показатель.','Configure a scale and select a measure.'),
      G4: h.tr('В протоколе должны быть цели с заданным порядком.','The protocol must define ordered targets.'),
      S5: h.tr('Выберите два разных показателя для сравнения.','Select two distinct measures.'),
      S6: h.tr('Задайте семейство проверяемых показателей.','Prespecify the family of measures.'),
      S7: h.tr('Назначьте две сопоставимые сессии каждого участника повторам A и B.','Assign two comparable sessions per participant to visits A and B.') })[module.id]
      || h.tr('Выберите сравниваемые условия или состав групп.','Choose conditions or group membership.');
  }
  const pending = new Map();
  const explanations = {
    R1: ['Насколько устойчиво участники отвечают: среднее время и разброс реакции.', 'How consistent responses are: mean response time and variability.'],
    R2: ['Показывает, как различаются медианы реакции сохранённых сессий. Это не распределение отдельных проб.', 'Shows the distribution of recorded session response medians, not individual trials.'],
    R5: ['Сопоставляет скорость ответа и долю правильных ответов. Быстрее не всегда означает лучше.', 'Relates response speed to accuracy. Faster does not always mean better.'],
    G1: ['Какие зоны интереса посещали взглядом и сколько времени в них проводили.', 'Which areas were visited and how long gaze remained there.'],
    G3: ['Показывает переходы взгляда между зонами одного стимула. Толщина связи отражает число переходов.', 'Shows gaze transitions within one stimulus. Ribbon width represents transition counts.'],
    F1: ['Сводка доступных оценок пульса и дыхания. Эти оценки не заменяют медицинские измерения.', 'Summarizes available heart rate and respiration estimates, not medical measurements.'],
    F3: ['Изменение одного показателя в одной сессии по сохранённым интервалам. Пропуски остаются пропусками.', 'One measure in one session over retained intervals. Missing observations remain missing.'],
    S1: ['Сравнение заранее выбранных условий у тех же участников или в независимых группах.', 'Compares prespecified conditions within participants or between independent groups.'],
    S7: ['Согласованность двух заранее назначенных сопоставимых сессий каждого участника.', 'Agreement between two explicitly assigned comparable sessions per participant.'],
    Q5: ['Какие каналы представлены в записи. Наличие данных не подтверждает точность измерений.', 'Which channels are present. Data availability does not establish measurement accuracy.']
  };
  function explanation(module, h) {
    return explanations[module.id]?.[h.en ? 1 : 0] || ({
      R: h.tr('Сводка ответов и времени реакции по выбранной выборке.', 'Summarizes responses and response times in the selection.'),
      G: h.tr('Сводка сохранённых наблюдений взгляда и зон интереса. Проверяйте точность калибровки.', 'Summarizes stored gaze and area observations. Check calibration accuracy.'),
      F: h.tr('Доступные показатели состояния за сохранённые интервалы. Не медицинское заключение.', 'Available state estimates over retained intervals, not a medical assessment.'),
      A: h.tr('Голос и ответы опросников по выбранным записям. Баллы требуют заданного ключа.', 'Voice and questionnaire results. Scores require an explicit scoring key.'),
      S: h.tr('Статистическое сравнение участников по заданному плану. Связь не означает причинность.', 'Participant-level comparison under the analysis plan. Association is not causation.'),
      Q: h.tr('Полнота записи, условия получения данных и ограничения отчёта.', 'Recording completeness, acquisition conditions and report limitations.')
    })[module.id[0]];
  }
  let generation = 0;
  ['wecog:researcherauthenticated', 'wecog:staffsessionblocked', 'wecog:projectchange'].forEach(name =>
    global.addEventListener(name, () => { generation++; pending.clear(); }));
  function helpers(en) {
    const tr = (a, b) => en ? b : a;
    const num = (value, probability = false) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      if (value !== 0 && Math.abs(value) < 1e-4) {
        const [base, exponent] = value.toExponential(2).split('e');
        return (en ? base : base.replace('.', ',')) + ' × 10^' + Number(exponent);
      }
      return new Intl.NumberFormat(en ? 'en' : 'ru', { maximumFractionDigits: probability ? 5 : Math.abs(value) < .01 && value !== 0 ? 5 : 2 }).format(value);
    };
    return { tr, en: !!en, title: id => titles[id]?.[en ? 1 : 0] || id,
      metricLabel: item => metricNames[item?.id]?.[en ? 1 : 0] || item?.label || '',
      field: key => labels[key]?.[en ? 1 : 0] || ({ rtMean: tr('Время реакции, мс','Response time, ms'),
        accuracy: tr('Доля верных ответов','Correct response fraction'), elapsedMs: tr('Время, мс','Elapsed time, ms'),
        dwellMs: tr('Время в зоне, мс','AOI dwell time, ms'), aoi: tr('Зона интереса','Area of interest'),
        available: tr('Есть измерение','Measurement available'), channel: tr('Канал','Channel'),
        completed: tr('Завершена','Completed'), interrupted: tr('Прервана','Interrupted'),
        acceptedTrials: tr('Засчитано проб','Accepted trials'), recordedTrials: tr('Всего проб','Recorded trials'),
        fixationCount: tr('Фиксаций','Fixations'), delta: tr('Изменение','Difference'), coverage: tr('Наблюдаемая доля','Observed fraction'),
        startRt: tr('Первый ответ, мс','First response, ms'), endRt: tr('Последний ответ, мс','Last response, ms'),
        meanRt: tr('Средняя реакция','Mean response time'), defaultMean: tr('Все записи','All recordings'),
        recordedValidOnlyMean: tr('Качественные записи','Quality-passed recordings'), referenceValue: tr('Исходное значение','Reference value'),
        comparisonValue: tr('Сравниваемое значение','Comparison value'), selfReport: tr('Самооценка','Self-report'),
        nParticipants: tr('Участников','Participants'), metric: tr('Показатель','Measure'), kind: tr('Интервал','Interval') })[key] || tr('Сведения','Details'),
      num,
      metricNumber: item => num(item?.unit === 'fraction' && typeof item.value === 'number' ? item.value * 100 : item?.value, ['p','pAdjusted'].includes(item?.id)),
      unit: unit => ({ fraction: '%', ratio: '', ms: tr('мс','ms'), bpm: tr('уд/мин','bpm'),
        'breaths/min': tr('дых/мин','breaths/min'), 'blinks/min': tr('морг/мин','blinks/min'), count: tr('набл.','obs.'), index: tr('индекс','index') })[unit] ?? unit ?? '',
      value: item => typeof item?.value === 'number' && item.unit === 'fraction' ? item.value * 100 : item?.value };
  }
  function post(path, body, blob = false) {
    const base = String(global.API_BASE || '').replace(/\/$/, '');
    return global.WecogHttp[blob ? 'blob' : 'json'](base + path, {
      method: 'POST', credentials: 'include', redirect: 'error',
      headers: global.apiRequestHeaders(true), body: JSON.stringify(body)
    }, { scope: 'workspace', timeoutMs: 30000 });
  }
  function fetchReport(snapshot, plan) {
    const key = snapshot.id + ':' + JSON.stringify(plan);
    if (!pending.has(key)) {
      if (pending.size > 8) pending.delete(pending.keys().next().value);
      pending.set(key, post('/analytics/v1/extensions/run', { snapshot_id: snapshot.id, plan }).then(report => {
        if (report?.kind !== 'extension_report' || report.snapshot?.id !== snapshot.id
          || report.snapshot?.datasetHash !== snapshot.datasetHash || report.data?.schemaVersion !== 'analytics-extensions.v1'
          || !Array.isArray(report.data.modules)) throw new Error('Incompatible analysis response');
        return report;
      }).catch(error => { pending.delete(key); throw error; }));
    }
    return pending.get(key);
  }
  function polar(r, a) { return [150 + r * Math.cos(a), 150 + r * Math.sin(a)]; }
  function wedge(inner, outer, start, end) {
    const [a, b, c, d] = [polar(outer, start), polar(outer, end), polar(inner, end), polar(inner, start)];
    return `M${a} A${outer},${outer} 0 ${end - start > Math.PI ? 1 : 0} 1 ${b} L${c} A${inner},${inner} 0 ${end - start > Math.PI ? 1 : 0} 0 ${d} Z`;
  }
  function ring(data, h, selected) {
    const complete = data.modules.filter(module => module.status === 'computed').length;
    return `<svg viewBox="0 0 300 300" class="ax-ring" role="group" aria-label="${h.tr('Доступные сводки — выбрать расчёт','Available summaries — select an analysis')}">
      ${groups.map(([prefix, , , color], layer) => {
        const modules = data.modules.filter(module => module.id.startsWith(prefix));
        const inner = 49 + layer * 14;
        return modules.map((module, i) => `<path class="ax-ring-sector ${module.status === 'computed' ? 'is-ready' : ''} ${selected === module.id ? 'is-selected' : ''}"
          d="${wedge(inner, inner + 10, -Math.PI / 2 + i * Math.PI * 2 / modules.length + .018, -Math.PI / 2 + (i + 1) * Math.PI * 2 / modules.length - .018)}"
          style="--ax-color:${color}" role="button" tabindex="0" data-preview-module="${esc(module.id)}" aria-pressed="${selected === module.id}" aria-label="${esc(h.title(module.id))}"></path>`).join('');
      }).join('')}<text x="150" y="149" class="ax-ring-value">${complete}</text><text x="150" y="168" class="ax-ring-label">${h.tr('из','of')} ${data.modules.length}</text></svg>`;
  }
  function ringContent(module, h) {
    return `<span class="ax-eyebrow">${h.tr('Выбранная сводка','Selected summary')}</span><h3>${esc(h.title(module.id))}</h3>
      <span class="ax-availability ${module.status === 'computed' ? 'is-ready' : ''}">${module.status === 'computed' ? h.tr('Есть результат','Result available') : module.status === 'needs_configuration' ? h.tr('Нужны настройки','Settings needed') : h.tr('Нет данных','No data')}</span>
      <p>${esc(explanation(module, h))}</p>
      ${module.status === 'computed' ? `<dl>${(module.metrics || []).filter(item => Number.isFinite(item.value)).slice(0, 3).map(item => `<div><dt>${esc(h.metricLabel(item))}</dt><dd>${h.metricNumber(item)} <small>${esc(h.unit(item.unit))}</small></dd></div>`).join('')}</dl>` : `<p>${esc(guidance(module, h))}</p>`}`;
  }
  function ringPanel(module, h) {
    if (!module) return '';
    return `<div class="ax-orbit-copy" tabindex="0">${ringContent(module,h)}</div>
      <button class="ax-primary" data-open-preview="${esc(module.id)}">${h.tr('Открыть сводку','Open summary')} ↗</button>`;
  }
  function viewportState(host) {
    const scrolls = [];
    for (let node = host.parentElement; node; node = node.parentElement) scrolls.push([node, node.scrollLeft, node.scrollTop]);
    const active = host.contains(document.activeElement) ? document.activeElement : null;
    const attributes = ['id', 'name', 'data-module', 'data-preview-module', 'data-category', 'data-point', 'data-chart-series', 'data-chart-kind', 'data-row-page'];
    const attr = active && attributes.find(name => active.hasAttribute(name));
    const match = attr ? `[${attr}="${CSS.escape(active.getAttribute(attr))}"]` : null;
    const parent = active?.closest('.ax-detail') ? '.ax-detail ' : active?.closest('.ax-settings') ? '.ax-settings ' : '';
    const open = [...host.querySelectorAll('details[open]')].map(node => node.className);
    const table = host.querySelector('.ax-table-wrap'), tableScroll = table ? [table.scrollLeft, table.scrollTop] : null;
    const x = global.scrollX, y = global.scrollY;
    return () => {
      open.forEach(name => [...host.querySelectorAll('details')].find(node => node.className === name)?.setAttribute('open', ''));
      if (match) host.querySelector(parent + match)?.focus({ preventScroll: true });
      if (tableScroll) { const next = host.querySelector('.ax-table-wrap'); if (next) { next.scrollLeft = tableScroll[0]; next.scrollTop = tableScroll[1]; } }
      scrolls.forEach(([node, left, top]) => { node.scrollLeft = left; node.scrollTop = top; });
      global.scrollTo({ left: x, top: y, behavior: 'instant' });
    };
  }
  function person(h) {
    return `<svg viewBox="0 0 190 385" class="ax-person" role="group" aria-label="${h.tr('Показатели человека','Participant measures')}">
      <defs><linearGradient id="axBodyInk" x2=".8" y2="1"><stop stop-color="var(--ax-body-light,#4c786a)"/><stop offset="1" stop-color="var(--ax-body-dark,#264b40)"/></linearGradient></defs>
      <ellipse cx="95" cy="178" rx="75" ry="132" class="ax-person-halo"/>
      <path fill="url(#axBodyInk)" d="M95 13 C76 13 72 25 72 42 C68 45 70 57 76 60 L78 73 C69 82 51 83 42 96 C34 109 36 135 31 156 L28 195 L31 236 C29 247 34 258 39 257 L42 246 L42 221 L46 193 L51 158 L57 138 L59 181 C54 201 58 219 60 240 L66 302 L70 351 L63 362 C59 369 63 374 73 373 L87 369 L87 348 L86 302 L88 242 L95 215 L102 242 L104 302 L103 348 L103 369 L117 373 C127 374 131 369 127 362 L120 351 L124 302 L130 240 C132 219 136 201 131 181 L133 138 L139 158 L144 193 L148 221 L148 246 L151 257 C156 258 161 247 159 236 L162 195 L159 156 C154 135 156 109 148 96 C139 83 121 82 112 73 L114 60 C120 57 122 45 118 42 C118 25 114 13 95 13 Z"/>
      ${[['G1', 95, 43, 'Взгляд', 'Gaze'], ['F7', 106, 61, 'Мимика', 'Face'], ['A1', 95, 82, 'Голос', 'Voice'],
        ['F1', 104, 115, 'Пульс', 'Heart rate'], ['F3', 84, 140, 'Дыхание', 'Respiration'], ['F6', 53, 96, 'Движение плеч и корпуса', 'Shoulder and torso movement']]
        .map(([id, x, y, ru, en]) => `<g role="button" tabindex="0" class="ax-hotspot" data-module="${id}" aria-label="${h.tr(ru, en)}"><circle cx="${x}" cy="${y}" r="12"/><circle cx="${x}" cy="${y}" r="4"/><title>${h.tr(ru, en)}</title></g>`).join('')}</svg>`;
  }
  function chart(module, h, selected = -1) {
    const custom = global.WecogAnalyticsCharts?.render(module, h, selected);
    if (custom) return custom;
    const rows = (module.rows || []).slice(0, 200);
    if (!rows.length) return `<div class="ax-chart-empty">${h.tr('Для этого результата нет отдельного ряда наблюдений.','No observation series is available for this result.')}</div>`;
    const numeric = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key =>
      !/^(?:id|index|attempt|participantId|sessionId|blockId|source|version)/i.test(key) && rows.some(row => typeof row[key] === 'number' && Number.isFinite(row[key])));
    const categorical = Object.keys(rows[0]).find(key => typeof rows[0][key] === 'string' && !/Id$/.test(key));
    const requested = module.chart || {};
    const categoryKey = typeof requested.x === 'string' && rows.some(row => typeof row[requested.x] === 'string') ? requested.x : null;
    const yKey = numeric.includes(requested.y) ? requested.y : numeric.find(key => !/^(start|end|time|order)/i.test(key)) || numeric[0];
    const xKey = numeric.includes(requested.x) && requested.x !== yKey ? requested.x : numeric.find(key => key !== yKey && /time|start|order|index/i.test(key));
    const points = rows.map((row, index) => ({ row, index, x: xKey && typeof row[xKey] === 'number' ? row[xKey] : index + 1,
      y: yKey === 'accuracy' && Number.isFinite(row[yKey]) ? row[yKey] * 100 : row[yKey], label: categoryKey ? observationValue(row[categoryKey], categoryKey, row, h) : row[categorical] || `${h.tr('Наблюдение','Observation')} ${index + 1}` })).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!points.length) return `<div class="ax-chart-empty">${h.tr('Доступна таблица категориальных результатов ниже.','Categorical results are available in the table below.')}</div>`;
    const values = points.map(point => point.y), xs = points.map(point => point.x);
    const type = requested.type || (/^R[24]|F[34]|A2/.test(module.id) ? 'line' : 'bar');
    const low = Math.min(...values, ...(type === 'bar' ? [0] : [])), high = Math.max(...values, ...(type === 'bar' ? [0] : [])), xmin = Math.min(...xs), xmax = Math.max(...xs);
    const x = value => xmax === xmin ? 390 : (type === 'bar' ? 85 : 55) + (value - xmin) / (xmax - xmin) * (type === 'bar' ? 620 : 650);
    const y = value => high === low ? 148 : 247 - (value - low) / (high - low) * 198;
    const ticks = high === low ? [low] : Array.from({ length: 5 }, (_, i) => low + (high - low) * i / 4);
    const yLabel = value => h.num(value) + (yKey === 'accuracy' ? '%' : '');
    const grid = ticks.map(value => `<path d="M55 ${y(value)} H730" class="ax-grid-line"/><text x="46" y="${y(value) + 4}" text-anchor="end">${yLabel(value)}</text>`).join('');
    const marks = points.map(point => {
      const label = `${point.label}: ${yLabel(point.y)}`;
      const mark = type === 'bar' ? `<rect x="${x(point.x) - Math.min(16, 250 / points.length)}" y="${Math.min(y(point.y), y(0))}" width="${Math.min(32, 500 / points.length)}" height="${Math.max(1, Math.abs(y(0) - y(point.y)))}" rx="3"/>`
        : `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="${selected === point.index ? 7 : 4}"/>`;
      return `<g class="ax-mark ${selected === point.index ? 'is-selected' : ''}" data-point="${point.index}" role="button" tabindex="0" aria-label="${esc(label)}">${mark}<title>${esc(label)}</title></g>`;
    }).join('');
    const ordered = points.slice().sort((a, b) => a.x - b.x);
    const line = type === 'line' ? `<path class="ax-line" d="${ordered.map((point, i) => {
      const previous = ordered[i - 1];
      const connected = previous && point.index === previous.index + 1
        && (typeof previous.row.endMs !== 'number' || point.x <= previous.row.endMs + 1);
      return `${connected ? 'L' : 'M'}${x(point.x)},${y(point.y)}`;
    }).join(' ')}"/>` : '';
    const axis = categoryKey && type === 'bar' ? points.filter((_, i) => points.length <= 8 || i === 0 || i === points.length - 1)
      .map(point => `<text x="${x(point.x)}" y="274" text-anchor="middle">${esc(String(point.label).slice(0, 30))}</text>`).join('')
      : xmin === xmax ? `<text x="${x(xmin)}" y="274" text-anchor="middle">${h.num(xmin)}</text>`
        : Array.from({ length: type === 'scatter' ? 5 : 2 }, (_, i) => i).map((_, i, list) => {
          const t = i / (list.length - 1), tick = xmin*(1-t) + xmax*t;
          return `<text x="${x(tick)}" y="274" text-anchor="${i === 0 ? 'start' : i === list.length - 1 ? 'end' : 'middle'}">${h.num(tick)}</text>`;
        }).join('');
    return `<svg class="ab-chart ax-chart" viewBox="0 0 760 300" role="group" aria-label="${esc(h.title(module.id))}">${grid}${line}${marks}${axis}
      <text x="390" y="294" text-anchor="middle">${esc(categoryKey ? h.field(categoryKey) : xKey ? h.field(xKey) : h.tr('Порядок наблюдения','Observation order'))}</text>
      <text x="55" y="20">${esc(h.field(yKey))}</text></svg>`;
  }
  function chartView(module, h, selected, series, kind, onSeries) {
    const rows = module.rows || [], groups = new Map();
    const split = row => module.id === 'G6' ? [row.blockId, row.stimulusId, row.map, row.gridWidth, row.gridHeight].join('|') : ['G1','G2','G3'].includes(module.id)
      ? [row.blockId, row.stimulusId].join('|')
      : row.metricId ? [row.metricId, ...(['F3','A2'].includes(module.id) ? [row.sessionId, row.kind] : [])].join('|') : '';
    rows.forEach((row, index) => {
      if (module.id === 'G3' && (!row.from || !row.to)) return;
      const key = split(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push({ row, index });
    });
    if (module.id === 'G3' && !groups.size) return `<div class="ax-chart-empty">${h.tr('В сохранённых наблюдениях переходов между разными зонами нет.','No between-area transitions are present in the retained observations.')}</div>`;
    const key = groups.has(series) ? series : groups.keys().next().value;
    let items = groups.get(key) || [];
    const distribution = ['R1','F1','F5','F6','F7'].includes(module.id) && items.some(item => Number.isFinite(item.row.value));
    const view = distribution ? (kind || 'histogram') : '';
    if (distribution) {
      const seen = new Set();
      // A module can retain a summary and a range row for the same session/measure.
      items = items.filter(item => {
        if (!item.row.sessionId) return true;
        if (seen.has(item.row.sessionId)) return false;
        seen.add(item.row.sessionId); return true;
      });
    }
    const subset = { ...module, rows: items.map(item => item.row) };
    if (distribution) subset.chart = { ...module.chart, type: ['histogram','box'].includes(view) ? view : 'bar', y: view === 'box' ? undefined : 'value', x: undefined, value: 'value' };
    const local = items.findIndex(item => item.index === selected);
    const svg = chart(subset, h, local).replace(/data-point="(\d+)"/g, (_, i) => `data-point="${items[Number(i)]?.index ?? -1}"`);
    const histogram = svg.includes('class="ax-histogram-observations"');
    const caption = values => { const row = values[0].row; return [row.label || h.names?.get(row.metricId) || row.block || h.names?.get(row.blockId),
      row.stimulusId ? h.stimulus?.(row.stimulusId) : '', row.map || '',
      ['F3','A2'].includes(module.id) && row.sessionId ? h.names?.get('session:' + row.sessionId) : '', row.kind === 'minute' ? h.tr('по минутам','by minute') : row.kind === 'block' ? h.tr('по блокам','by block') : ''].filter(Boolean).join(' · ') || h.tr('Выбранные наблюдения','Selected observations'); };
    const collator = new Intl.Collator(h.en ? 'en' : 'ru', { numeric: true, sensitivity: 'base' });
    if (onSeries && items.length) {
      const valueKey = distribution ? 'value' : module.chart?.y;
      const ordered = ['F3','A2'].includes(module.id);
      if (valueKey && ['R1','R4','F1','F3','F5','F6','F7','A2'].includes(module.id)) {
        const rows = items.map(item => item.row);
        if (ordered) rows.sort((a,b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
        const unit = rows.find(row => row.unit)?.unit;
        const points = rows.flatMap((row, i) => {
          const x = ordered ? row.startMs : i;
          const y = Number.isFinite(row[valueKey]) ? row[valueKey] * (unit === 'fraction' ? 100 : 1) : null;
          const previous = rows[i-1];
          if (ordered && Number.isFinite(previous?.endMs) && x > previous.endMs + 100) {
            return [{ x: (previous.endMs + x) / 2, y: null }, { x, y }];
          }
          return [{ x, y }];
        });
        onSeries({ en: h.en, ordered, points, unit: h.unit(unit),
          title: h.title(module.id) + ' · ' + caption(items),
          xLabel: ms => Math.floor(ms / 60000) + ':' + String(Math.floor(ms / 1000) % 60).padStart(2,'0') });
      }
    }
    const explanation = module.id === 'G3'
      ? h.tr('Линия соединяет две области. Стрелка показывает, куда переместился взгляд; толщина показывает число переходов.', 'Each line connects two areas. The arrow shows where gaze moved next; line width shows the number of transitions.')
      : distribution ? h.tr('По одной сохранённой оценке на сессию. Повторные сессии одного участника не являются независимыми участниками.','One retained estimate per session. Repeat sessions are not independent participants.') : '';
    return `<div data-chart-module="${esc(module.id)}"><div class="ax-chart-controls">${groups.size > 1 ? `<label class="ax-series-label">${h.tr('Показать на графике','Show in chart')}<select data-chart-series>${[...groups].sort((a, b) => collator.compare(caption(a[1]), caption(b[1]))).map(([k, v]) => `<option value="${esc(k)}"${key === k ? ' selected' : ''}>${esc(caption(v))}</option>`).join('')}</select></label>` : ''}${distribution ? `<label class="ax-series-label">${h.tr('Вид графика','Chart view')}<select data-chart-kind><option value="histogram"${view === 'histogram' ? ' selected' : ''}>${h.tr('Распределение','Distribution')}</option><option value="box"${view === 'box' ? ' selected' : ''}>${h.tr('Разброс и медиана','Box plot')}</option><option value="bar"${view === 'bar' ? ' selected' : ''}>${h.tr('По сессиям','By session')}</option></select></label>` : ''}${histogram ? `<label class="ax-series-label ax-observation-toggle"><input type="checkbox" data-chart-dots checked> ${h.tr('Отдельные наблюдения','Individual observations')}</label>` : ''}</div>${explanation ? `<p class="ax-chart-context">${explanation}</p>` : ''}${svg}${histogram ? `<p class="ax-chart-context">${h.tr('Столбец — число значений в интервале. Точка — одно наблюдение; её высота нужна только для разнесения точек.', 'A bar counts values in a bin. A dot is one observation; vertical offsets only separate dots.')}</p>` : ''}</div>`;
  }
  function table(rows, h, selected) {
    if (!rows?.length) return '';
    const start = selected >= 0 ? Math.floor(selected / 100) * 100 : 0;
    const page = rows.slice(start, start + 100);
    const columns = [...new Set(page.flatMap(row => Object.keys(row)))].filter(key => !['diagnostics', 'algorithmVersion', 'methodVersion', 'weighting', 'axis', 'presentationId', 'trialId'].includes(key)).slice(0, 9);
    const body = page.map((row, localIndex) => {
      const i = start + localIndex;
      return `<tr data-point="${i}" tabindex="0"${selected === i ? ' class="is-selected"' : ''}>${columns.map(key => `<td>${esc(observationValue(row[key], key, row, h))}</td>`).join('')}</tr>`;
    }).join('');
    return `<div data-ax-table-viz></div><div class="ax-table-page"><span>${h.tr('Строки','Rows')} ${start + 1}–${Math.min(start + 100, rows.length)} ${h.tr('из','of')} ${rows.length}</span><button data-row-page="${start - 100}" ${start === 0 ? 'disabled' : ''}>←</button><button data-row-page="${start + 100}" ${start + 100 >= rows.length ? 'disabled' : ''}>→</button></div><div class="ax-table-wrap"><table><thead><tr>${columns.map(key => `<th>${esc(h.field(key))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function observationValue(value, key, row, h) {
    if (value == null) return '—';
    if (key === 'unit') return h.unit(value);
    if (typeof value === 'number' && !/Id$/.test(key)) return ['p','pAdjusted'].includes(key)
      ? h.metricNumber({ id: key, value }) : key === 'accuracy' ? h.num(value * 100) + '%'
        : h.num(key === 'value' && row.unit === 'fraction' ? value * 100 : value);
    if (typeof value === 'boolean') return h.tr(value ? 'Да' : 'Нет', value ? 'Yes' : 'No');
    if (typeof value === 'object') return '';
    if (key === 'stimulusId') return h.stimulus?.(value) || h.tr('Стимул','Stimulus');
    if (/^(aoiId|aoi|target|from|to)$/.test(key) && ['target','face','eyes','mouth'].includes(value)) return ({ target: h.tr('Целевая зона','Target'), face: h.tr('Лицо','Face'), eyes: h.tr('Глаза','Eyes'), mouth: h.tr('Рот','Mouth') })[value];
    const name = h.names?.get((key === 'sessionId' ? 'session:' : '') + value);
    if (name) return name;
    if (/Id$/.test(key)) return h.field(key);
    return String(value);
  }
  function pointText(row, h) {
    return Object.entries(row || {}).filter(([key, value]) => !['axis','weighting','presentationId','trialId','methodVersion'].includes(key)
      && (value === null || typeof value !== 'object')).slice(0, 10)
      .map(([key, value]) => `${h.field(key)}: ${observationValue(value, key, row, h)}`).join(' · ');
  }
  function choices(rows, selected, placeholder, locale = document.documentElement.lang || 'ru') {
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    return `<option value="">${esc(placeholder)}</option>` + [...(rows || [])].sort((a, b) => collator.compare(a.label || a.name || a.id, b.label || b.name || b.id)).map(row => `<option value="${esc(row.id)}"${String(row.id) === String(selected) ? ' selected' : ''}>${esc(row.label || row.name || row.id)}</option>`).join('');
  }
  function form(data, plan, h) {
    const options = data.options || {}, levels = plan.axis === 'block' ? options.blocks : options.conditions;
    const select = (name, label, rows, value) => `<label>${label}<select name="${name}">${choices(rows, value, h.tr('Выбрать','Choose'), h.en ? 'en' : 'ru')}</select></label>`;
    return `<details class="ax-settings"><summary>${h.tr('Настройки расчёта','Analysis settings')}</summary><form id="axPlanForm">
      <div class="ax-form-grid">
      ${select('baselineBlockId', h.tr('Исходный блок для сигналов','Signal baseline block'), options.blocks, plan.baselineBlockId)}
      <label>${h.tr('Сравнение','Design')}<select name="design"><option value="paired"${plan.design !== 'independent' ? ' selected' : ''}>${h.tr('Те же участники','Same participants')}</option><option value="independent"${plan.design === 'independent' ? ' selected' : ''}>${h.tr('Независимые группы','Independent groups')}</option></select></label>
      <label>${h.tr('Уровни','Levels')}<select name="axis"><option value="condition"${plan.axis !== 'block' ? ' selected' : ''}>${h.tr('Условия','Conditions')}</option><option value="block"${plan.axis === 'block' ? ' selected' : ''}>${h.tr('Блоки','Blocks')}</option></select></label>
      ${select('referenceId', h.tr('Исходное условие A','Reference A'), levels, plan.referenceId)}
      ${select('comparisonId', h.tr('Условие сравнения B','Comparison B'), levels, plan.comparisonId)}
      ${select('metricId', h.tr('Показатель','Measure'), options.metrics, plan.metricId || 'rt.mean')}
      ${select('secondMetricId', h.tr('Второй показатель для связи','Second association measure'), options.metrics, plan.secondMetricId || 'physiology.bpm')}
      <label>${h.tr('Связь показателей','Association method')}<select name="method"><option value="spearman">${h.tr('Ранговая — Спирмен','Rank — Spearman')}</option><option value="pearson"${plan.method === 'pearson' ? ' selected' : ''}>${h.tr('Линейная — Пирсон','Linear — Pearson')}</option></select></label>
      <label>${h.tr('Граница быстрых ответов, мс','Fast response boundary, ms')}<input name="fastThresholdMs" type="number" min="1" max="600000" value="${esc(plan.fastThresholdMs ?? '')}" placeholder="${h.tr('Не задана','Not set')}"></label>
      <label>${h.tr('Граница медленных ответов, мс','Slow response boundary, ms')}<input name="slowThresholdMs" type="number" min="1" max="600000" value="${esc(plan.slowThresholdMs ?? '')}" placeholder="${h.tr('Не задана','Not set')}"></label>
      <label>${h.tr('Поправка для семейства','Family correction')}<select name="correction"><option value="holm">Holm</option><option value="bh"${plan.correction === 'bh' ? ' selected' : ''}>Benjamini–Hochberg</option><option value="bonferroni"${plan.correction === 'bonferroni' ? ' selected' : ''}>Bonferroni</option></select></label>
      </div><fieldset><legend>${h.tr('Семейство сравнений: выберите до расчёта','Comparison family: choose before calculating')}</legend><div class="ax-checks">${(options.metrics || []).map(item => `<label><input type="checkbox" name="familyMetricIds" value="${esc(item.id)}"${plan.familyMetricIds?.includes(item.id) ? ' checked' : ''}>${esc(item.label)}</label>`).join('')}</div></fieldset>
      <details><summary>${h.tr('Три условия и более','Three or more levels')}</summary><p>${h.tr('Для общего рангового сравнения. У парного варианта нужны полные наблюдения каждого участника во всех выбранных условиях.','For an omnibus rank comparison. The paired design requires complete observations for each participant at every selected level.')}</p><div class="ax-checks" data-levels>${(levels || []).map(item => `<label><input type="checkbox" name="levels" value="${esc(item.id)}"${plan.levels?.includes(item.id) ? ' checked' : ''}>${esc(item.label)}</label>`).join('')}</div></details>
      <details><summary>${h.tr('Задания с ответом и без ответа','Respond / withhold conditions')}</summary><p>${h.tr('Укажите, в каких условиях нужно отвечать. Это необходимо для расчёта попаданий и ложных тревог.','Identify conditions requiring a response. These are needed to calculate hits and false alarms.')}</p><div class="ax-checks">${(options.conditions || []).map(item => `<label>${esc(item.label)}<select data-signal="${esc(item.id)}"><option value="">—</option><option value="signal"${plan.signalConditions?.signal?.includes(item.id) ? ' selected' : ''}>${h.tr('Отвечать','Respond')}</option><option value="noise"${plan.signalConditions?.noise?.includes(item.id) ? ' selected' : ''}>${h.tr('Не отвечать','Withhold')}</option></select></label>`).join('')}</div></details>
      <details><summary>${h.tr('Подсчёт баллов опросника','Questionnaire scoring')}</summary><p>${h.tr('Выберите вопросы и явно задайте баллы вариантов. Число в текстовом ответе учитывается только с вашим разрешением и заданными границами.','Choose items and assign option scores explicitly. Numeric text is used only with your permission and explicit bounds.')}</p><div class="ax-scale-items">${(options.questions || []).map(question => scoringItem(question, plan, h)).join('') || h.tr('В выбранном протоколе нет вопросов для шкалы.','This protocol has no questionnaire items.')}</div></details>
      <details><summary>${h.tr('Состав независимых групп','Independent group membership')}</summary><div class="ax-checks ax-people">${(options.participants || []).map((person, index) => `<label>${esc(person.label || h.tr('Участник','Participant') + ' ' + (index + 1))}<select data-person="${esc(person.id)}"><option value="">—</option><option value="A"${plan.referenceParticipantIds?.includes(person.id) ? ' selected' : ''}>A</option><option value="B"${plan.comparisonParticipantIds?.includes(person.id) ? ' selected' : ''}>B</option></select></label>`).join('')}</div></details>
      <details><summary>${h.tr('Сопоставимые повторные сессии','Comparable repeated sessions')}</summary><p>${h.tr('Назначение не подтверждает сопоставимость само по себе. Выбирайте завершённые сессии одного протокола и версии с одинаковым смыслом измерений.','Assignment alone does not establish comparability. Choose completed sessions with the same protocol/version and measurement meaning.')}</p><div class="ax-checks ax-people">${(options.sessions || []).map(session => `<label>${esc(session.label)}<select data-visit="${esc(session.id)}"><option value="">—</option><option value="A"${plan.repeatVisits?.some(item => item.sessionId === session.id && item.visit === 'A') ? ' selected' : ''}>A</option><option value="B"${plan.repeatVisits?.some(item => item.sessionId === session.id && item.visit === 'B') ? ' selected' : ''}>B</option></select></label>`).join('')}</div></details>
      <div class="ax-form-actions"><button type="submit" class="ax-primary">${h.tr('Рассчитать по этим настройкам','Calculate with these settings')}</button><button type="button" data-cancel-plan>${h.tr('Отменить изменения','Discard changes')}</button><span class="ax-request-status" role="status"></span></div>
      </form></details>`;
  }
  function scoringItem(question, plan, h) {
    const item = plan.surveyScoring?.[0]?.items?.find(item => item.questionId === question.id);
    return `<div data-question="${esc(question.id)}"><label><input type="checkbox" name="scaleItem"${item ? ' checked' : ''}>${esc(question.label)}</label>
      <label>${h.tr('Обратный','Reversed')}<input type="checkbox" name="reverse"${item?.reverse ? ' checked' : ''}></label>
      <label>${h.tr('От','Minimum')}<input name="min" type="number" step="any" value="${esc(item?.min ?? '')}"></label><label>${h.tr('До','Maximum')}<input name="max" type="number" step="any" value="${esc(item?.max ?? '')}"></label>
      ${question.type === 'open' ? `<label class="ax-score-options"><input type="checkbox" name="numericText"${item?.numericText ? ' checked' : ''}>${h.tr('Ответ является числом в заданных границах','Response is numeric within the specified bounds')}</label>` : ''}
      ${question.type === 'single' ? `<div class="ax-score-options">${(question.options || []).map(option => `<label>${esc(option.label)}<input type="number" step="any" data-option-score="${esc(option.id)}" value="${esc(item?.values?.find(entry => entry.optionId === option.id)?.value ?? '')}" placeholder="${h.tr('Балл','Score')}"></label>`).join('')}</div>` : ''}</div>`;
  }
  function mount(host, state, options = {}) {
    host.__analyticsMountAbort?.abort();
    const controller = new AbortController();
    host.__analyticsMountAbort = controller;
    const h = helpers(options.en);
    const snapshot = state.snapshot;
    const epoch = generation;
    let report, plan = {}, category = options.tab === 'data-quality' ? 'Q' : options.tab === 'connectedness' ? 'S' : '', selected = '', preview = 'R2', selectedPoint = -1, busy = false, settingsDirty = false;
    const plotSeries = {}, plotKinds = {}, hiddenDots = new Set();
    try { plan = { ...(state.extendedPlan || global.WECOG_ANALYTICS_LAB_PLAN || {}) }; } catch (_) {}
    const account = global.WecogStaffSession?.getAccountId?.();
    const viewKey = account ? 'wecog_analytics_explorer_view_v1:' + account + ':' + (options.tab || '') : null;
    const viewFingerprint = () => JSON.stringify([snapshot?.datasetHash, snapshot?.queryEcho, plan]);
    function persistView() {
      if (!viewKey || !current()) return;
      try { global.sessionStorage.setItem(viewKey, JSON.stringify({ fingerprint: viewFingerprint(), at: Date.now(),
        category, selected, preview, selectedPoint, plotSeries, plotKinds })); } catch (_) {}
    }
    function restoreView() {
      if (!viewKey) return;
      try {
        const saved = JSON.parse(global.sessionStorage.getItem(viewKey) || 'null');
        if (!saved || Date.now() - saved.at > 30 * 60 * 1000 || saved.fingerprint !== viewFingerprint()) return;
        if (['','R','G','F','A','S','Q'].includes(saved.category)) category = saved.category;
        const known = new Set(report.data.modules.map(module => module.id));
        if (known.has(saved.selected)) selected = saved.selected;
        if (known.has(saved.preview)) preview = saved.preview;
        const rows = report.data.modules.find(module => module.id === selected)?.rows || [];
        if (Number.isInteger(saved.selectedPoint) && saved.selectedPoint >= 0 && saved.selectedPoint < rows.length) selectedPoint = saved.selectedPoint;
        for (const id of known) {
          if (typeof saved.plotSeries?.[id] === 'string' && saved.plotSeries[id].length < 1024) plotSeries[id] = saved.plotSeries[id];
          if (['histogram','box','bar'].includes(saved.plotKinds?.[id])) plotKinds[id] = saved.plotKinds[id];
        }
      } catch (_) {}
    }
    host.className = 'ax-explorer';
    host.innerHTML = `<div class="ax-loading" role="status">${h.tr('Готовим сводки по вашей выборке…','Preparing summaries for your selection…')}</div>`;
    const current = () => !controller.signal.aborted && host.isConnected && generation === epoch && state.snapshot === snapshot && !state.dirty;
    function draw() {
      if (!current() || !report) return;
      const restore = viewportState(host);
      const zoom = global.WecogAnalyticsVisualizations?.zoomState(host);
      const data = report.data, all = data.modules;
      const compact = ['data-quality', 'connectedness'].includes(options.tab);
      const showHero = !compact && !category && all.some(module => module.status === 'computed');
      const countText = data.counts?.participants > 0
        ? (data.counts.participants + ' ' + h.tr('участников','participants'))
        : h.tr('Участники не указаны','Participants not identified');
      const heading = compact ? (options.tab === 'data-quality' ? h.tr('Качество данных','Data quality') : h.tr('Связи показателей','Associations')) : h.tr('Из данных — в наблюдения','From data to observations');
      h.names = new Map([...(data.options?.participants || []), ...(data.options?.blocks || []), ...(data.options?.conditions || []), ...(data.options?.metrics || []), ...(data.options?.questions || [])].map(item => [String(item.id), item.label]));
      h.stimulus = id => options.labels?.stimulus?.(id) || h.tr('Стимул','Stimulus');
      [...new Set((data.featureRows || []).map(row => row.sessionId))].forEach((id, i) => h.names.set('session:' + id, h.tr('Сессия','Session') + ' ' + (i + 1)));
      h.name = id => metricNames[id]?.[options.en ? 1 : 0] || h.names.get('session:' + id) || h.names.get(id)
        || ({ gaze: h.tr('Взгляд','Gaze'), task: h.tr('Задание','Task'), blink: h.tr('Моргания','Blinks'),
          face: h.tr('Мимика','Facial activity'), body: h.tr('Корпус','Body'), audio: h.tr('Голос','Voice'),
          perclos: h.tr('Закрытие глаз','Eye closure') })[id] || id;
      const visible = category ? all.filter(module => module.id.startsWith(category)) : all.filter(module => module.status === 'computed').slice(0, 8);
      const chosen = all.find(module => module.id === selected);
      let visualizationSource = null;
      const headline = { R1: 'rt.mean', R5: 'task.accuracy', F1: 'physiology.bpm', Q5: 'channels.available' };
      const valueOf = id => { const metrics = all.find(module => module.id === id)?.metrics || []; return metrics.find(item => item.id === headline[id] && typeof item.value === 'number') || metrics.find(item => typeof item.value === 'number'); };
      const kpis = [['R1', h.tr('Реакция','Reaction')], ['R5', h.tr('Ответы','Responses')], ['F1', h.tr('Пульс и дыхание','Pulse & respiration')], ['Q5', h.tr('Полнота','Completeness')]];
      host.innerHTML = `<header class="ax-heading"><div><span class="ax-eyebrow">WECog / ${h.tr('Исследовательская аналитика','Research analytics')}</span><h2>${heading}</h2><p>${countText} · ${data.counts?.sessions || 0} ${h.tr('сессий в выбранной выборке','sessions in your selection')}</p></div><div class="ax-actions"><button data-export="json">JSON</button><button data-export="csv">CSV</button><button data-export="pdf">PDF</button><span class="ax-export-status" role="status"></span></div></header>
        <p class="ax-pdf-plan" hidden>${esc(h.tr('Настройки расширенного отчёта','Extended report settings'))}: ${esc(plan.design || 'paired')} · ${esc(h.names.get(plan.metricId || 'rt.mean'))} · A: ${esc(h.names.get(plan.referenceId) || '—')} · B: ${esc(h.names.get(plan.comparisonId) || '—')} · ${esc(plan.correction || 'holm')} · ${h.tr('Исходный блок','Baseline')}: ${esc(h.names.get(plan.baselineBlockId) || '—')}. ${h.tr('Полный план и ограничения доступны в JSON.','Full plan and limitations are available in JSON.')}</p>
        ${data.availability?.truncated ? `<p class="ax-limit-note">${h.tr('Детализация ограничена объёмом выборки. Для полного просмотра отдельных записей уточните выборку; ограничения сохранены в экспорте.','Detail is limited by selection size. Narrow the selection to inspect individual recordings; limits are included in the export.')}</p>` : ''}
        ${data.availability?.unidentifiedSessions ? `<p class="ax-limit-note">${h.tr('Часть записей не привязана к участникам. Они доступны как отдельные сессии, но не включены в сравнения между участниками.','Some recordings have no participant identity. They remain available as sessions but are excluded from participant-level comparisons.')}</p>` : ''}
        ${showHero ? `<div class="ax-hero"><section class="ax-profile"><div><span class="ax-eyebrow">${h.tr('Профиль наблюдений','Observation profile')}</span><h3>${data.counts?.participants === 1 ? h.tr('Профиль участника','Participant profile') : h.tr('Показатели выборки','Selection measures')}</h3><p>${h.tr('Выберите канал для просмотра','Choose a channel to explore')}</p></div>${person(h)}<div class="ax-profile-key">${[['G1','Взгляд','Gaze'],['F1','Пульс','Pulse'],['F3','Дыхание','Respiration'],['A1','Голос','Voice']].map(([id,ru,en]) => `<button data-module="${id}">${h.tr(ru,en)} <span>↗</span></button>`).join('')}</div></section>
        <section class="ax-orbit"><div class="ax-orbit-heading"><span class="ax-eyebrow">${h.tr('Карта аналитики','Analysis map')}</span><h3>${h.tr('Что доступно в записи','Available in this recording')}</h3><p>${h.tr('Наведите на сектор, чтобы увидеть пояснение.','Point to a sector to see its explanation.')}</p></div><div class="ax-orbit-layout"><div>${ring(data, h, preview)}<div class="ax-ring-key">${groups.map(([prefix,ru,en,color]) => `<button data-preview-module="${all.find(module => module.id.startsWith(prefix))?.id || ''}"><i style="background:${color}"></i>${h.tr(ru,en)}</button>`).join('')}</div></div><aside class="ax-orbit-panel" aria-live="polite" aria-atomic="true">${ringPanel(all.find(module => module.id === preview), h)}</aside></div></section>
        <section class="ax-kpi-grid">${kpis.map(([id, label]) => { const item = valueOf(id); return `<button class="ax-kpi" data-module="${id}"><span>${label}</span><strong>${h.metricNumber(item)}<small>${esc(h.unit(item?.unit))}</small></strong><em>${esc(h.metricLabel(item) || h.tr('Нет доступной оценки','No estimate available'))}</em><b>↗</b></button>`; }).join('')}</section></div>` : ''}
        ${form(data, plan, h)}<nav class="ax-sections" aria-label="${h.tr('Сводки','Summaries')}"><button data-category="" aria-pressed="${category === ''}">${h.tr('Обзор','Overview')}</button>${groups.map(([id, ru, en]) => `<button data-category="${id}" aria-pressed="${category === id}">${h.tr(ru,en)}</button>`).join('')}</nav>
        ${!category ? `<div class="ax-overview-plots">${['R2','F1','R5','G3'].map(id => all.find(module => module.id === id)).filter(module => module?.status === 'computed').map(module => `<section><header><h3>${esc(h.title(module.id))}</h3><button data-module="${module.id}">${h.tr('Подробнее','Explore')} ↗</button></header>${chartView(module, h, -1, plotSeries[module.id])}</section>`).join('')}</div>` : ''}
        <div class="ax-cards">${visible.map(module => `<button class="ax-card ${selected === module.id ? 'is-active' : ''} ${module.status === 'computed' ? '' : 'is-empty'}" data-module="${esc(module.id)}"><span class="ax-card-heading">${esc(h.title(module.id))}<b>↗</b></span>${module.status === 'computed'
          ? `<strong>${h.metricNumber(valueOf(module.id))}<small>${esc(h.unit(valueOf(module.id)?.unit))}</small></strong><span class="ax-card-caption">${esc(h.metricLabel(valueOf(module.id)) || h.tr('Открыть график и наблюдения','View chart and observations'))}</span>`
          : `<strong class="ax-unavailable">${module.status === 'needs_configuration' ? h.tr('Настроить','Configure') : h.tr('Нет данных','No data')}</strong><span class="ax-card-caption">${esc(guidance(module, h))}</span>`}</button>`).join('')}</div>
        ${chosen ? `<section class="ax-detail" tabindex="-1"><header><div><span class="ax-eyebrow">${esc(groups.find(group => chosen.id.startsWith(group[0]))?.[options.en ? 2 : 1] || '')}</span><h3>${esc(h.title(chosen.id))}</h3></div><button data-close-detail aria-label="${h.tr('Закрыть подробности','Close details')}">×</button></header>${chosen.status === 'computed'
          ? `<div class="ax-result-strip">${(chosen.metrics || []).slice(0, 6).map(item => `<div><span>${esc(h.metricLabel(item))}</span><strong>${h.metricNumber(item)}<small>${esc(h.unit(item.unit))}</small></strong></div>`).join('')}</div>${chartView(chosen, h, selectedPoint, plotSeries[chosen.id], plotKinds[chosen.id], value => { visualizationSource = value; })}<div class="ax-chart-actions"><button data-export="png">${h.tr('Скачать график','Download chart')}</button></div>${options.visualizations && visualizationSource ? '<div data-ax-viz></div>' : ''}<div class="ax-point-detail" aria-live="polite">${selectedPoint >= 0 ? esc(pointText(chosen.rows[selectedPoint], h)) : h.tr('Выберите точку, столбец или строку для подробностей.','Select a point, bar or row for details.')}</div>${table(chosen.rows, h, selectedPoint)}`
          : `<div class="ax-no-data"><h4>${chosen.status === 'needs_configuration' ? h.tr('Нужны ваши настройки','Your settings are needed') : h.tr('В этой записи нет нужных данных','Required data is absent from this recording')}</h4><p>${esc(guidance(chosen, h))}</p><button data-open-settings>${h.tr('Открыть настройки','Open settings')}</button></div>`}
          <details class="ax-method"><summary>${h.tr('Метод и ограничения','Method and limitations')}</summary><p>${esc(chosen.method || h.tr('Описательная сводка сохранённых наблюдений.','Descriptive summary of stored observations.'))}</p>${chosen.reason ? `<p>${esc(chosen.reason)}</p>` : ''}<p>${h.tr('Нет данных — не ноль. Наличие записи не подтверждает точность измерения.','Missing data is not zero. Recording availability does not validate measurement accuracy.')}</p>${data.availability?.truncated ? `<p>${h.tr('Достигнут лимит детализации: часть строк не включена. Это также отмечено в экспорте.','Detail limits were reached: some rows are omitted. This is recorded in the export as well.')}</p>` : ''}</details></section>` : ''}`;
      if (showHero && chosen && options.tab === 'group-comparison') {
        const detail = host.querySelector('.ax-detail');
        if (detail) host.querySelector('.ax-hero').after(detail);
      }
      options.visualizations?.attach(host.querySelector('[data-ax-viz]'), visualizationSource);
      const tableChart = host.querySelector('[data-ax-table-viz]');
      if (tableChart && chosen?.rows?.length) {
        const shown = Array.from(host.querySelectorAll('.ax-table-wrap thead th'), node => node.textContent);
        const fields = ['rtMs','rtMean','startMs','endMs','durationMs','count','coverage','accuracy','value','difference','n'];
        const scopes = new Map();
        chosen.rows.forEach(row => {
          const key = JSON.stringify([row.metricId, row.unit, row.blockId, row.stimulusId, row.aoiId, row.condition, row.group, row.kind]);
          if (!scopes.has(key)) scopes.set(key, []);
          scopes.get(key).push(row);
        });
        const columns = [];
        for (const rows of scopes.values()) {
          if (columns.length >= 150) break;
          const sample = rows[0];
          const scope = [sample.label || h.names?.get(sample.metricId), sample.block || h.names?.get(sample.blockId),
            sample.stimulusId && h.stimulus?.(sample.stimulusId), sample.aoiId && h.names?.get(sample.aoiId),
            h.names?.get(sample.condition), ['A','B'].includes(sample.group) && sample.group].filter(Boolean).join(' · ');
          fields.forEach(field => {
            if (!shown.includes(h.field(field)) || !rows.some(row => Number.isFinite(row[field]))) return;
            const fraction = field === 'accuracy' || (field === 'value' && sample.unit === 'fraction');
            const unit = fraction ? '%' : field === 'value' ? h.unit(sample.unit) : /Ms$|^rtMean$/.test(field) ? h.tr('мс','ms') : '';
            columns.push({ label: [h.field(field), scope, unit].filter(Boolean).join(' · '), unit,
              values: rows.map(row => Number.isFinite(row[field]) ? row[field] * (fraction ? 100 : 1) : null) });
          });
        }
        options.visualizations?.attachTable(tableChart, { title: h.title(chosen.id), en: h.en, columns });
      }
      host.querySelectorAll('[data-chart-dots]').forEach(input => {
        const group = input.closest('[data-chart-module]').querySelector('.ax-histogram-observations');
        const key = input.closest('[data-chart-module]').dataset.chartModule;
        const sync = () => { group.style.display = input.checked ? '' : 'none'; };
        input.checked = !hiddenDots.has(key);
        input.addEventListener('change', () => { if (input.checked) hiddenDots.delete(key); else hiddenDots.add(key); sync(); });
        sync();
      });
      global.WecogAnalyticsVisualizations?.zoomWithin(host, h.tr, zoom);
      const pdfSource = { extendedReport: report, tab: options.tab, labels: options.labels, helpers: h,
        chartHtml: module => chartView(module, h, -1, plotSeries[module.id], plotKinds[module.id]), plan };
      host.__analyticsPdfSource = pdfSource;
      host.__analyticsPdfPending = false;
      const body = host.closest('#analyticsProductionBody');
      if (body) body.__analyticsPdfSource = pdfSource;
      restore();
      persistView();
      host.dispatchEvent(new CustomEvent('wecog:analytics-rendered', { bubbles: true }));
      host.querySelector('#axPlanForm').addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        const formNode = event.currentTarget, values = new FormData(formNode), next = {};
        for (const key of ['axis','design','metricId','secondMetricId','baselineBlockId','referenceId','comparisonId','correction','method']) if (values.get(key)) next[key] = values.get(key);
        for (const key of ['fastThresholdMs','slowThresholdMs']) if (values.get(key)) next[key] = Number(values.get(key));
        next.familyMetricIds = values.getAll('familyMetricIds');
        next.levels = values.getAll('levels');
        const signal = { signal: [], noise: [] };
        formNode.querySelectorAll('[data-signal]').forEach(select => { if (select.value) signal[select.value].push(select.dataset.signal); });
        if (signal.signal.length || signal.noise.length) next.signalConditions = signal;
        const items = [];
        formNode.querySelectorAll('[data-question]').forEach(row => {
          if (!row.querySelector('[name=scaleItem]').checked) return;
          const item = { questionId: row.dataset.question, reverse: row.querySelector('[name=reverse]').checked };
          for (const key of ['min','max']) if (row.querySelector(`[name=${key}]`).value !== '') item[key] = Number(row.querySelector(`[name=${key}]`).value);
          if (row.querySelector('[name=numericText]')?.checked) item.numericText = true;
          const scores = [...row.querySelectorAll('[data-option-score]')].filter(input => input.value !== '').map(input => ({ optionId: input.dataset.optionScore, value: Number(input.value) }));
          if (scores.length) item.values = scores;
          items.push(item);
        });
        if (items.length) next.surveyScoring = [{ id: plan.surveyScoring?.[0]?.id || 'researcher_scale', items }];
        next.referenceParticipantIds = []; next.comparisonParticipantIds = [];
        next.repeatVisits = [];
        formNode.querySelectorAll('[data-visit]').forEach(select => { if (select.value) next.repeatVisits.push({ sessionId: select.dataset.visit, visit: select.value }); });
        formNode.querySelectorAll('[data-person]').forEach(select => { if (select.value === 'A') next.referenceParticipantIds.push(select.dataset.person); if (select.value === 'B') next.comparisonParticipantIds.push(select.dataset.person); });
        const status = formNode.querySelector('[role=status]'), button = formNode.querySelector('[type=submit]');
        busy = true; button.disabled = true; status.textContent = h.tr('Рассчитываем…','Calculating…');
        host.__analyticsPdfPending = true;
        host.querySelectorAll('.ax-cards,.ax-detail,.ax-hero').forEach(node => { node.hidden = true; });
        try { const incoming = await fetchReport(snapshot, next); if (!current()) return; plan = next; state.extendedPlan = next; report = incoming; settingsDirty = false; draw(); }
        catch (error) { if (status.isConnected) status.textContent = error.status === 422 ? h.tr('Проверьте настройки: группы не должны пересекаться, границы ответов должны различаться.','Check the settings: groups must be disjoint and response boundaries must differ.') : h.tr('Не удалось рассчитать. Настройки сохранены на экране, попробуйте ещё раз.','Calculation failed. Your settings remain on screen; retry.'); }
        finally { busy = false; if (button.isConnected) button.disabled = false; }
      });
      host.querySelector('[name=axis]').addEventListener('change', event => {
        const items = event.target.value === 'block' ? data.options.blocks : data.options.conditions;
        for (const key of ['referenceId','comparisonId']) host.querySelector(`[name=${key}]`).innerHTML = choices(items, null, h.tr('Выбрать','Choose'), h.en ? 'en' : 'ru');
        host.querySelector('[data-levels]').innerHTML = (items || []).map(item => `<label><input type="checkbox" name="levels" value="${esc(item.id)}">${esc(item.label)}</label>`).join('');
      });
    }
    host.addEventListener('click', async event => {
      const target = event.target.closest('[data-module],[data-preview-module],[data-open-preview],[data-category],[data-point],[data-close-detail],[data-open-settings],[data-export],[data-cancel-plan],[data-row-page]');
      if (!target || !host.contains(target) || !report) return;
      if (target.hasAttribute('data-cancel-plan')) { settingsDirty = false; draw(); return; }
      if (settingsDirty) { host.querySelector('.ax-settings').open = true; host.querySelector('.ax-request-status').textContent = h.tr('Сначала рассчитайте изменённые настройки или отмените изменения.','Calculate with the changed settings or discard changes first.'); return; }
      if (target.dataset.rowPage !== undefined) { selectedPoint = Math.max(0, Number(target.dataset.rowPage)); draw(); return; }
      if (target.dataset.previewModule) {
        updatePreview(target.dataset.previewModule);
        if (options.tab === 'group-comparison') openDetail(target.dataset.previewModule);
        return;
      }
      if (target.dataset.openPreview) openDetail(target.dataset.openPreview);
      else if (target.dataset.module) openDetail(target.dataset.module);
      else if (target.hasAttribute('data-category')) { category = target.dataset.category; selected = ''; draw(); }
      else if (target.dataset.point !== undefined) { selected = target.closest('[data-chart-module]')?.dataset.chartModule || selected; selectedPoint = Number(target.dataset.point); draw(); }
      else if (target.hasAttribute('data-close-detail')) { selected = ''; draw(); }
      else if (target.hasAttribute('data-open-settings')) { host.querySelector('.ax-settings').open = true; host.querySelector('.ax-settings').scrollIntoView({ block: 'nearest' }); }
      else if (target.dataset.export) {
        if (target.dataset.export === 'pdf') {
          const button = host.closest('#analyticsProductionBody')?.querySelector('#analyticsPdfDownload');
          if (!button || button.disabled) host.querySelector('.ax-export-status').textContent = h.tr('Дождитесь завершения загрузки отчёта.','Wait for the report to finish loading.');
          else button.click();
          return;
        }
        const status = host.querySelector('.ax-export-status'); target.disabled = true;
        const exportPlan = plan;
        const exportCurrent = () => current() && !settingsDirty && exportPlan === plan;
        try {
          if (target.dataset.export === 'png') {
            await post('/analytics/v1/extensions/export', { snapshot_id: snapshot.id, plan, format: 'json' }, true);
            const svg = host.querySelector('.ax-detail svg.ax-chart');
            if (!svg || !exportCurrent()) throw new Error('Chart unavailable');
            const graphic = await global.EmocogAnalyticsPdf.chartImage(svg, false);
            if (!exportCurrent() || !(graphic instanceof Blob)) throw new Error('Chart unavailable');
            const url = URL.createObjectURL(graphic), link = document.createElement('a'); link.href = url; link.download = `wecog-${selected}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            status.textContent = h.tr('График скачан','Chart downloaded'); return;
          }
          const format = target.dataset.export;
          const savedCharts = host.closest('#analyticsProductionBody')?.__chartManifest?.() || [];
          let blob = await post('/analytics/v1/extensions/export' + (h.en ? '?lang=en' : ''), { snapshot_id: snapshot.id, plan, format }, true);
          if (format === 'json') {
            const data = JSON.parse(await blob.text());
            const summary = { participants: data.data.counts?.participants, sessions: data.data.counts?.sessions,
              charts: savedCharts, summaries: data.data.modules.map(item => ({ name: h.title(item.id), status: item.status,
                metrics: item.metrics.map(metric => ({ name: h.metricLabel(metric), value: metric.value, unit: h.unit(metric.unit) })) })) };
            blob = new Blob([JSON.stringify({ overview: summary, ...data }, null, 2)], { type: 'application/json' });
          }
          if (!exportCurrent()) return;
          const url = URL.createObjectURL(blob), link = document.createElement('a');
          link.href = url; link.download = format === 'csv' ? 'wecog-participants.csv' : 'wecog-analysis.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          status.textContent = h.tr('Отчёт скачан','Report downloaded');
        } catch (_) { if (status.isConnected) status.textContent = h.tr('Не удалось скачать. Проверьте право экспорта.','Download failed. Check export permissions.'); }
        finally { if (target.isConnected) target.disabled = false; }
      }
    }, { signal: controller.signal });
    function openDetail(id) {
      selected = id;
      selectedPoint = -1;
      draw();
      host.querySelector('.ax-detail')?.scrollIntoView({ block: 'nearest' });
    }
    function updatePreview(id) {
      if (!current() || !report || settingsDirty) return;
      const module = report.data.modules.find(item => item.id === id);
      if (!module || preview === id) return;
      preview = id;
      host.querySelectorAll('.ax-ring-sector').forEach(node => {
        const active = node.dataset.previewModule === id;
        node.classList.toggle('is-selected', active); node.setAttribute('aria-pressed', String(active));
      });
      const copy = host.querySelector('.ax-orbit-copy');
      const button = host.querySelector('.ax-orbit-panel [data-open-preview]');
      if (copy && button) {
        copy.innerHTML = ringContent(module,h);
        copy.scrollTop = 0;
        button.dataset.openPreview = module.id;
      }
      persistView();
    }
    host.addEventListener('focusin', event => { if (event.target.dataset.previewModule) updatePreview(event.target.dataset.previewModule); }, { signal: controller.signal });
    host.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch' && event.target.dataset.previewModule) updatePreview(event.target.dataset.previewModule);
    }, { signal: controller.signal });
    host.addEventListener('input', event => {
      if (!event.target.closest('#axPlanForm')) return;
      settingsDirty = true;
      host.__analyticsPdfPending = true;
      host.dispatchEvent(new CustomEvent('wecog:analytics-rendered', { bubbles: true }));
      host.querySelector('.ax-request-status').textContent = h.tr('Настройки изменены. Нажмите «Рассчитать», чтобы обновить результаты.','Settings changed. Select Calculate to update results.');
      host.querySelectorAll('.ax-cards,.ax-detail,.ax-hero,.ax-overview-plots').forEach(node => { node.hidden = true; });
    }, { signal: controller.signal });
    host.addEventListener('change', event => {
      if (!event.target.matches('[data-chart-series],[data-chart-kind]')) return;
      const id = event.target.closest('[data-chart-module]').dataset.chartModule;
      if (event.target.matches('[data-chart-kind]')) plotKinds[id] = event.target.value; else plotSeries[id] = event.target.value; selectedPoint = -1; draw();
    }, { signal: controller.signal });
    host.addEventListener('keydown', event => { if (['Enter',' '].includes(event.key) && event.target.matches('svg [role=button], tr[data-point]')) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); } }, { signal: controller.signal });
    fetchReport(snapshot, plan).then(result => { if (!current()) return; report = result; restoreView(); draw(); }).catch(error => {
      if (!current()) return;
      host.innerHTML = `<div class="ax-unready" role="status"><strong>${h.tr('Расширенные сводки пока недоступны','Extended summaries are unavailable')}</strong><p>${error.status === 404 ? h.tr('Для этой функции нужен обновлённый API. Основной отчёт ниже доступен.','This feature needs an updated API. The standard report below remains available.') : h.tr('Не удалось получить расчёт. Основные данные не удалены; повторите применение выборки.','Calculation could not be loaded. Existing data is preserved; apply the selection again.')}</p></div>`;
      host.dispatchEvent(new CustomEvent('wecog:analytics-rendered', { bubbles: true }));
    });
  }
  global.WecogAnalyticsExplorer = { mount, chart, titles };
})(window);
