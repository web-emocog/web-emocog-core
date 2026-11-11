(function (global) {
  'use strict';

  const PAGE = 80;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const finite = Number.isFinite;
  const list = value => Array.isArray(value) ? value : [];

  function helpers(en) {
    const tr = (ru, english) => en ? english : ru;
    const formatter = new Intl.NumberFormat(en ? 'en' : 'ru', { maximumFractionDigits: 2 });
    const number = v => finite(v) ? formatter.format(v) : tr('Нет данных', 'No data');
    const time = (ms, precise = false) => {
      if (!finite(ms)) return '—';
      const seconds = Math.floor(ms / 1000);
      return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
        + (precise ? '.' + String(Math.floor(ms % 1000)).padStart(3, '0') : '');
    };
    return { tr, number, time };
  }

  function select(id, label, rows, selected) {
    return `<label class="ab-field">${esc(label)}<select id="${id}">${rows.map(([value, text]) =>
      `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  }

  function shell(kind, title, sub, content) {
    return `<section class="ab-dashboard" data-ab-dashboard="${kind}">
      <header class="ab-heading"><h2>${esc(title)}</h2><p>${esc(sub)}</p></header>
      ${content}</section>`;
  }

  function detail(title, values) {
    return `<div class="ab-detail" aria-live="polite"><strong>${esc(title)}</strong><dl>${values.map(([label, value]) =>
      `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></div>`;
  }

  function scale(values, from, to) {
    let min = Infinity, max = -Infinity;
    for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
    return { min, max, at: value => max > min ? from + (value - min) / (max - min) * (to - from) : (from + to) / 2 };
  }

  function marker(x, y, index, active, label, series = '', end = null) {
    return `<g class="ab-mark ${series}${active ? ' is-active' : ''}" data-ab-point="${index}">
      ${end !== null ? `<line class="ab-range-hit" x1="${x}" x2="${end}" y1="${y}" y2="${y}"/><line class="ab-segment" x1="${x}" x2="${end}" y1="${y}" y2="${y}"/>` : ''}
      <circle class="ab-hit" cx="${x}" cy="${y}" r="12"/><circle class="ab-dot" cx="${x}" cy="${y}" r="${active ? 6 : 3.8}"/>
      <title>${esc(label)}</title></g>`;
  }

  function svg(caption, inner) {
    return `<svg class="ab-chart" viewBox="0 0 640 225" role="img" aria-label="${esc(caption)}">${inner}</svg>`;
  }

  function histogram(values, unit, state, helpers, name) {
    const { tr, number } = helpers;
    const domain = scale(values, 74, 610);
    const count = domain.min === domain.max ? 1 : Math.min(12, Math.max(3, Math.ceil(Math.sqrt(values.length))));
    const span = (domain.max - domain.min) / count;
    const bins = Array.from({ length: count }, (_, i) => ({ from: domain.min + span * i,
      to: i === count - 1 ? domain.max : domain.min + span * (i + 1), count: 0 }));
    values.forEach(value => bins[span ? Math.min(count - 1, Math.floor((value - domain.min) / span)) : 0].count++);
    const peak = Math.max(...bins.map(bin => bin.count));
    const width = 536 / count;
    const selected = bins[Number(state.point)] || bins[0];
    const label = bin => count === 1 ? `${number(bin.from)} ${unit}` : `${number(bin.from)}–${number(bin.to)} ${unit}`;
    const caption = name + ' · ' + tr('распределение', 'distribution');
    const chart = svg(caption, `<text x="74" y="18">${tr('Количество', 'Count')}</text>
      <path class="ab-grid" d="M74 35H610"/><path class="ab-axis" d="M74 30V182H610"/>
      <text x="64" y="42" text-anchor="end">${peak}</text><text x="64" y="182" text-anchor="end">0</text>
      ${bins.map((bin, i) => {
        const height = bin.count / peak * 142;
        return `<g data-ab-point="${i}" class="ab-bin${i === Number(state.point) ? ' is-active' : ''}">
          <rect class="ab-bin-hit" x="${74 + i * width}" y="28" width="${width}" height="154"/>
          <rect class="ab-bin-bar" x="${75 + i * width}" y="${182 - height}" width="${Math.max(1, width - 3)}" height="${height}"/>
          <title>${esc(label(bin))}: ${bin.count}</title></g>`;
      }).join('')}
      ${count === 1 ? `<text x="342" y="207" text-anchor="middle">${esc(label(bins[0]))}</text>`
        : `<text x="74" y="207">${esc(number(domain.min))}</text><text x="610" y="207" text-anchor="end">${esc(number(domain.max) + ' ' + unit)}</text>`}`);
    return { chart, bins, selected, label };
  }

  function rtDistribution(root, report, options) {
    const h = helpers(options.en), { tr } = h;
    const values = list(report?.trials).filter(trial => trial.qualityValid === true && trial.correct === true
      && finite(trial.rtMs) && trial.rtMs >= 0).map(trial => trial.rtMs);
    if (!values.length) return;
    const state = { point: '0' };
    browse(root, state, () => {
      const plot = histogram(values, tr('мс', 'ms'), state, h, tr('Время реакции', 'Reaction time'));
      return shell('rt', tr('Как распределено время реакции?', 'How are reaction times distributed?'),
        tr(`Правильные ответы, прошедшие проверку качества: ${values.length}`, `Correct responses that passed quality checks: ${values.length}`),
        chartPanel(select('abRtRange', tr('Диапазон времени', 'Reaction-time range'), plot.bins.map((bin, i) => [String(i), plot.label(bin)]), state.point),
          plot.chart, report.truncated
            ? tr('По сохранённым попыткам, не по всей сессии. Нажмите на столбец.', 'Retained attempts only, not the full session. Click a bar.')
            : tr('Нажмите на столбец, чтобы увидеть число ответов в диапазоне.', 'Click a bar to see how many responses fall in the range.'))
        + detail(plot.label(plot.selected), [[tr('Ответов в диапазоне', 'Responses in range'), plot.selected.count]]));
    }, { abRtRange: 'point' });
  }

  function group(root, data, options) {
    const h = helpers(options.en), { tr, number } = h;
    const metrics = list(data.metrics).filter(metric => metric.status === 'computed' && list(metric.participantValues).some(row => finite(row.value)));
    if (!metrics.length) return;
    const state = { metric: '0', view: 'people', point: '0', page: '0' };
    browse(root, state, () => {
      const metric = metrics[Number(state.metric)];
      const name = options.metricLabel(metric.metricId);
      const unit = options.unitLabel(metric.unit);
      const values = metric.participantValues.filter(row => finite(row.value));
      const controls = select('abGroupMetric', tr('Показатель', 'Metric'), metrics.map((item, i) =>
        [String(i), options.metricLabel(item.metricId) + (item.scope?.aoiId ? ' · ' + (options.labels?.area?.(item.scope.aoiId) || item.scope.aoiId) : '')]), state.metric)
        + select('abGroupView', tr('График', 'Chart'), [['people', tr('Участники', 'Participants')], ['hist', tr('Распределение', 'Distribution')]], state.view);
      const stats = detail(name, [[tr('Участников', 'Participants'), values.length],
        [tr('Медиана', 'Median'), finite(metric.median) ? number(metric.median) + ' ' + unit : number(null)],
        [tr('Средние 50% значений', 'Middle 50% of values'), finite(metric.q1) && finite(metric.q3)
          ? `${number(metric.q1)}–${number(metric.q3)} ${unit}` : number(null)]]);
      if (state.view === 'hist') {
        const plot = histogram(values.map(row => row.value), unit, state, h, name);
        return shell('group', tr('Как различаются результаты участников?', 'How do participant results vary?'),
          tr('Один участник — одно значение. Повторные наблюдения не увеличивают число участников.', 'One value per participant. Repeated observations do not increase the number of participants.'),
          stats + chartPanel(controls + select('abPoint', tr('Диапазон', 'Range'), plot.bins.map((bin, i) => [String(i), plot.label(bin)]), state.point), plot.chart,
            tr('Высота столбца показывает число участников, а не число проб.', 'Bar height is the number of participants, not the number of trials.'))
          + detail(plot.label(plot.selected), [[tr('Участников в диапазоне', 'Participants in range'), plot.selected.count]]));
      }
      const page = Number(state.page), index = Number(state.point);
      const rows = values.slice(page * PAGE, (page + 1) * PAGE);
      const x = scale(values.map(row => row.value), 60, 601);
      const person = id => options.labels?.participant?.(id) || id;
      const label = row => `${person(row.participantId)}: ${number(row.value)} ${unit}`.trim();
      const iqr = finite(metric.q1) && finite(metric.q3) ? `<rect class="ab-iqr" x="${x.at(metric.q1)}" y="43" width="${Math.max(1, x.at(metric.q3) - x.at(metric.q1))}" height="115" rx="5"/>` : '';
      const median = finite(metric.median) ? `<path class="ab-median" d="M${x.at(metric.median)} 40V160"/>` : '';
      const ticks = x.min === x.max ? [x.min] : Array.from({ length: 5 }, (_, i) => x.min + (x.max - x.min) * i / 4);
      const placed = [];
      const marks = rows.map((row, i) => {
        const px = x.at(row.value);
        const lanes = [101, 85, 117, 69, 133, 53, 149];
        const y = lanes.find(lane => !placed.some(point => point.y === lane && Math.abs(point.x - px) < 13)) ?? lanes[i % lanes.length];
        placed.push({ x: px, y });
        return marker(px, y, i, index === i, label(row));
      });
      const plot = svg(name, `${iqr}${median}<path class="ab-axis" d="M60 169H601"/>
        ${ticks.map(value => `<path class="ab-axis" d="M${x.at(value)} 169v6"/><text x="${x.at(value)}" y="196" text-anchor="middle">${esc(number(value))}</text>`).join('')}
        ${marks.join('')}<text x="601" y="221" text-anchor="end">${esc(unit)}</text>`);
      const pages = pageOptions(values.length, tr);
      return shell('group', tr('Как различаются результаты участников?', 'How do participant results vary?'),
        tr('Точка — участник. Полоса — средние 50% значений. Вертикальная линия — медиана.', 'A dot is one participant. The band shows the middle 50% of values. The vertical line marks the median.'),
        stats + chartPanel(controls + (pages.length > 1 ? select('abPage', tr('Участники', 'Participants'), pages, state.page) : '')
          + select('abPoint', tr('Выбранный участник', 'Selected participant'), rows.map((row, i) => [String(i), person(row.participantId)]), state.point),
          plot, tr('Нажмите на точку, чтобы посмотреть результат. Высота точки нужна только для разнесения меток.', 'Click a dot for its result. Vertical offset only separates marks.'),
          pointNavigation(index, rows.length, tr)) + detail(label(rows[index]), [[tr('Значение', 'Value'), number(rows[index].value) + ' ' + unit]]));
    }, { abGroupMetric: 'metric', abGroupView: 'view', abPage: 'page', abPoint: 'point' });
  }

  function participantRelation(root, data, options) {
    const h = helpers(options.en), { tr, number } = h;
    const metrics = list(data.metrics).filter(metric => metric.status === 'computed'
      && list(metric.participantValues).some(row => row.participantId != null && finite(row.value)));
    if (metrics.length < 2) return;
    const state = { x: '0', y: '1', point: '0', page: '0' };
    const metricName = metric => {
      const name = options.metricLabel(metric.metricId), unit = options.unitLabel?.(metric.unit) || metric.unit;
      const hasUnit = unit && [`, ${unit}`, `(${unit})`].some(suffix => name.endsWith(suffix));
      return name + (unit && !hasUnit ? `, ${unit}` : '')
        + (metric.scope?.aoiId ? ' · ' + (options.labels?.area?.(metric.scope.aoiId) || metric.scope.aoiId) : '');
    };
    const person = id => options.labels?.participant?.(id) || id;
    const metricOptions = metrics.map((metric, index) => [String(index), metricName(metric)]);
    const byPerson = metric => new Map(list(metric.participantValues).filter(row =>
      row.participantId != null && row.participantId !== '' && finite(row.value)).map(row => [String(row.participantId), row.value]));
    browse(root, state, () => {
      const left = metrics[Number(state.x)], right = metrics[Number(state.y)];
      const x = byPerson(left), y = byPerson(right);
      const pairs = state.x === state.y ? [] : [...x].filter(([id]) => y.has(id)).map(([id, value]) => ({ id, x: value, y: y.get(id) }));
      const controls = select('abRelationX', tr('Горизонтальная ось', 'Horizontal axis'), metricOptions, state.x)
        + select('abRelationY', tr('Вертикальная ось', 'Vertical axis'), metricOptions, state.y);
      const caption = tr('Связь показателей между участниками', 'Association between participants');
      const hint = tr('Одна точка — один участник с обоими измерениями.', 'One point per participant with both measurements.');
      if (!pairs.length) return shell('relation', caption, hint, chartPanel(controls, `<p class="ab-empty">${state.x === state.y
        ? tr('Выберите два разных показателя.', 'Select two different metrics.')
        : tr('Нет участников с обоими показателями.', 'No participants have both metrics.')}</p>`, ''));
      const page = Number(state.page), index = Number(state.point);
      const rows = pairs.slice(page * PAGE, (page + 1) * PAGE);
      const xs = scale(pairs.map(pair => pair.x), 77, 598), ys = scale(pairs.map(pair => pair.y), 177, 30);
      const xLabel = metricName(left), yLabel = metricName(right);
      const pages = pageOptions(pairs.length, tr);
      const coefficient = global.EmocogConnectedness.spearman(pairs);
      const graph = svg(`${xLabel} × ${yLabel}`, `<path class="ab-axis" d="M77 26V181H598"/>
        <text x="65" y="35" text-anchor="end">${esc(number(ys.max))}</text>
        ${ys.min !== ys.max ? `<text x="65" y="180" text-anchor="end">${esc(number(ys.min))}</text>` : ''}
        <text x="77" y="205">${esc(number(xs.min))}</text><text x="598" y="205" text-anchor="end">${esc(number(xs.max))}</text>
        ${rows.map((pair, i) => marker(xs.at(pair.x), ys.at(pair.y), i, i === index, person(pair.id))).join('')}`);
      const selected = rows[index];
      return shell('relation', caption, hint,
        chartPanel(controls + (pages.length > 1 ? select('abRelationPage', tr('Участники', 'Participants'), pages, state.page) : '')
          + select('abRelationPoint', tr('Участник', 'Participant'), rows.map((pair, i) => [String(i), person(pair.id)]), state.point), graph,
          tr('Коэффициент Спирмена описательный: он не показывает причину и не проверяет гипотезу.', 'Spearman’s coefficient is descriptive, not a causal or hypothesis test.'))
        + detail(tr('Совпавшие измерения', 'Matched measurements'), [
          [tr('Участников с обоими показателями', 'Participants with both metrics'), pairs.length],
          [tr('Коэффициент Спирмена', 'Spearman coefficient'), coefficient == null ? tr('Не рассчитан', 'Not computed') : number(coefficient)],
          [xLabel, number(selected.x)], [yLabel, number(selected.y)],
        ]));
    }, { abRelationX: 'x', abRelationY: 'y', abRelationPoint: 'point', abRelationPage: 'page' });
  }

  function chartPanel(controls, chart, description, pager = '') {
    return `<div class="ab-card"><div class="ab-controls">${controls}</div>${chart}${pager}<p class="ab-note">${esc(description)}</p>
      ${chart.includes('<svg ') ? `<button class="ab-chart-download" type="button" data-ab-save-chart>${esc(document.documentElement.lang === 'en' ? 'Download chart PNG' : 'График в PNG')}</button><span class="ab-chart-status" role="status"></span>` : ''}</div>`;
  }

  function pointNavigation(index, total, tr) {
    if (total < 2) return '';
    return `<div class="ab-point-nav">
      <button type="button" id="abPreviousPoint" data-ab-point="${index - 1}" aria-label="${tr('Предыдущее наблюдение', 'Previous observation')}" ${index === 0 ? 'disabled' : ''}>←</button>
      <span>${tr('Наблюдение', 'Observation')} <strong>${index + 1} / ${total}</strong></span>
      <button type="button" id="abNextPoint" data-ab-point="${index + 1}" aria-label="${tr('Следующее наблюдение', 'Next observation')}" ${index + 1 === total ? 'disabled' : ''}>→</button>
    </div>`;
  }

  function browse(root, state, paint, config = {}) {
    function render(focusId) {
      root.innerHTML = paint();
      if (!focusId) return;
      const target = root.querySelector('#' + focusId);
      (target && !target.disabled ? target : root.querySelector('#abPoint, #abRtRange, #abRelationPoint'))?.focus({ preventScroll: true });
    }
    root.onchange = event => {
      const control = event.target;
      const key = config[control.id];
      if (!key) return;
      state[key] = control.value;
      if (key !== 'channel') {
        if (key !== 'page' && key !== 'point') state.page = '0';
        if (key !== 'point') state.point = '0';
      }
      render(control.id);
    };
    root.onclick = event => {
      const channel = event.target.closest('[data-ab-channel]');
      const point = event.target.closest('[data-ab-point]');
      if (channel) {
        state.channel = channel.dataset.abChannel;
        if (state.mode === 'trials') {
          state.mode = state.intervalMode;
          state.page = '0';
          state.point = '0';
        }
        render(channel.id || 'abChannel');
      } else if (point && !point.disabled) {
        state.point = point.dataset.abPoint;
        render(point.id || (root.querySelector('#abRtRange') ? 'abRtRange' : 'abPoint'));
      }
    };
    render();
  }

  function pageOptions(count, tr) {
    return Array.from({ length: Math.ceil(count / PAGE) }, (_, index) =>
      [String(index), tr(`Строки ${index * PAGE + 1}–${Math.min(count, (index + 1) * PAGE)}`,
        `Rows ${index * PAGE + 1}–${Math.min(count, (index + 1) * PAGE)}`)]);
  }

  function participantMap(tr, channel, selected, number) {
    const value = key => {
      const mean = selected?.row?.[key]?.mean;
      return finite(mean) ? number(mean) + (key === 'heartRate' ? tr(' уд/мин', ' bpm') : tr(' дых/мин', ' breaths/min')) : number(null);
    };
    return `<aside class="ab-card ab-map">
      <h3>${tr('Каналы участника', 'Participant channels')}</h3>
      <svg viewBox="0 0 140 172" aria-hidden="true" focusable="false">
        <circle class="ab-body" cx="70" cy="37" r="25"/>
        <path class="ab-body" d="M50 66h40l19 18 13 54-18 5-10-36v54H46v-54l-10 36-18-5 13-54z"/>
        <path class="ab-outline" d="M58 37h24M70 91v53"/>
        <circle class="ab-pin" data-ab-channel="heartRate" cx="56" cy="101" r="8"/>
        <circle class="ab-pin ab-pin-secondary" data-ab-channel="respiration" cx="82" cy="126" r="8"/>
      </svg>
      <div class="ab-map-actions">
        <button type="button" id="abMapHeartRate" data-ab-channel="heartRate" aria-pressed="${channel === 'heartRate'}">${tr('ЧСС', 'Heart rate')}<br><strong>${esc(value('heartRate'))}</strong></button>
        <button type="button" id="abMapRespiration" data-ab-channel="respiration" aria-pressed="${channel === 'respiration'}">${tr('Дыхание', 'Respiration')}<br><strong>${esc(value('respiration'))}</strong></button>
      </div><p class="ab-note">${tr('Схема каналов, не изображение участника.', 'Channel diagram, not an image of the participant.')}</p></aside>`;
  }

  function session(root, data, options) {
    const { tr, number, time } = helpers(options.en);
    const intervals = data.physiologyIntervals;
    const rowsFor = {
      blocks: list(intervals?.blocks),
      minutes: list(intervals?.minutes),
      trials: options.hasAoiFilter ? [] : list(data.connectedness?.trials),
    };
    const modes = [['blocks', tr('Блоки и попытки', 'Blocks and attempts')], ['minutes', tr('Минуты', 'Minutes')], ['trials', tr('Пробы RT', 'RT trials')]];
    const state = { mode: modes.find(([key]) => rowsFor[key].length)?.[0] || 'blocks',
      intervalMode: rowsFor.blocks.length || !rowsFor.minutes.length ? 'blocks' : 'minutes', channel: 'heartRate', block: '', page: '0', point: '0' };
    const blockName = options.labels.block;
    const status = value => ({
      accepted: tr('Принята', 'Accepted'), repeat_required: tr('Потребовался повтор', 'Repeat required'),
      in_progress: tr('В процессе', 'In progress'),
      interrupted: tr('Прервана', 'Interrupted'), incomplete: tr('Не завершена', 'Incomplete'),
      responded: tr('Есть ответ', 'Responded'), no_response: tr('Без ответа', 'No response'),
    })[value] || value || '—';
    browse(root, state, () => {
      const trial = state.mode === 'trials';
      if (!trial) state.intervalMode = state.mode;
      const channel = trial ? null : state.channel;
      const isMinute = state.mode === 'minutes';
      const all = rowsFor[state.mode];
      const blockIds = [...new Set(all.map(row => row.blockId).filter(id => id != null).map(String))];
      const rows = (isMinute || !state.block ? all : all.filter(row => String(row.blockId) === state.block))
        .map((row, order) => ({ row, order, x: trial ? row.onsetMs : row.startMs, y: trial ? row.rtMs : row[channel]?.mean }))
        .sort((a, b) => (finite(a.x) ? a.x : Infinity) - (finite(b.x) ? b.x : Infinity) || a.order - b.order);
      const pages = pageOptions(rows.length, tr);
      const page = Number(state.page);
      const items = rows.slice(page * PAGE, (page + 1) * PAGE);
      const index = Number(state.point);
      const selected = items[index];
      const unit = trial ? tr('мс', 'ms') : channel === 'heartRate' ? tr('уд/мин', 'bpm') : tr('дых/мин', 'breaths/min');
      const label = item => isMinute ? time(item.x)
        : trial ? `${tr('Проба', 'Trial')} ${item.order + 1} · ${options.labels.stimulus(item.row.stimulusId)}`
          : `${blockName(item.row.blockId)} · ${tr('попытка', 'attempt')} ${item.row.attempt ?? '—'}`;
      const observed = items.filter(item => finite(item.x) && finite(item.y));
      const xs = scale(items.flatMap(item => [item.x, trial ? item.x : item.row.endMs]).filter(finite), 72, 615);
      const ys = scale(observed.map(item => item.y), 180, 25);
      const caption = `${modes.find(([key]) => key === state.mode)[1]} · ${unit}`;
      const grid = [65, 105, 145].map(y => `<path class="ab-grid" d="M72 ${y}H615"/>`).join('');
      const graph = observed.length ? svg(caption,
        `${grid}<path class="ab-axis" d="M72 22V181H615"/><text x="68" y="204">${time(xs.min)}</text><text x="615" y="204" text-anchor="end">${time(xs.max)}</text>
        <text x="62" y="30" text-anchor="end">${esc(number(ys.max))}</text>${ys.min !== ys.max ? `<text x="62" y="181" text-anchor="end">${esc(number(ys.min))}</text>` : ''}
        ${items.map((item, i) => {
          if (!finite(item.x) || !finite(item.y)) return '';
          const x = xs.at(item.x), y = ys.at(item.y), end = item.row.endMs;
          const tone = (trial ? item.row.qualityValid === false : !isMinute && item.row.status !== 'accepted') ? 'ab-muted-mark' : '';
          return marker(x, y, i, index === i, `${label(item)}: ${number(item.y)} ${unit}`, tone, !trial && finite(end) ? xs.at(end) : null);
        }).join('')}`) : `<p class="ab-empty">${trial && items.length
          ? tr('В этих пробах нет измеренного времени реакции. Ниже можно посмотреть исход каждой пробы.', 'No reaction times were measured in these trials. Trial outcomes are available below.')
          : tr('В этом разделе нет измерений.', 'There are no measurements in this view.')}</p>`;
      const signal = selected && !trial ? selected.row[channel] : null;
      const fields = selected ? [
        [tr('Оценка', 'Estimate'), finite(selected.y) ? `${number(selected.y)} ${unit}` : number(null)],
        [tr('Начало', 'Start'), time(selected.x, trial)],
        ...(trial ? [[tr('Блок', 'Block'), blockName(selected.row.blockId)],
          [tr('Попытка', 'Attempt'), selected.row.attempt ?? '—'],
          [tr('Качество пробы', 'Trial quality'), selected.row.qualityValid === false ? tr('Не засчитана', 'Excluded') : selected.row.qualityValid === true ? tr('Засчитана', 'Eligible') : '—'],
          [tr('Исход', 'Outcome'), selected.row.status === 'no_response'
            ? selected.row.correct === true ? tr('Правильно: без нажатия', 'Correct: no response') : tr('Без ответа', 'No response')
            : selected.row.correct === true ? tr('Верный ответ', 'Correct response') : selected.row.correct === false ? tr('Неверный ответ', 'Incorrect response') : status(selected.row.status)]]
          : [[tr('Конец', 'End'), time(selected.row.endMs)],
            [tr('Валидное время канала', 'Valid channel time'), finite(signal?.observedMs) ? `${number(signal.observedMs / 1000)} ${tr('с', 's')}` : number(null)],
            [tr('Измерений', 'Measurements'), number(signal?.count)]]),
        ...(!isMinute && !trial ? [[tr('Статус', 'Status'), status(selected.row.status)]] : []),
      ] : [];
      const controls = select('abMode', tr('Срез', 'View'), modes, state.mode)
        + (!trial ? select('abChannel', tr('Канал', 'Channel'), [['heartRate', tr('ЧСС', 'Heart rate')], ['respiration', tr('Дыхание', 'Respiration')]], channel) : '')
        + (!isMinute && blockIds.length ? select('abBlock', tr('Блок', 'Block'), [['', tr('Все из выборки', 'All in selection')], ...blockIds.map(id => [id, blockName(id)])], state.block) : '')
        + (pages.length > 1 ? select('abPage', tr('Диапазон', 'Range'), pages, state.page) : '')
        + (items.length ? select('abPoint', tr('Наблюдение', 'Observation'), items.map((item, i) => [String(i), label(item)]), state.point) : '');
      const note = trial ? tr('Отдельные RT-попытки; приглушённые точки не прошли проверку качества.', 'Individual RT attempts; muted points failed quality checks.')
        + (data.connectedness?.truncated ? tr(' Хранится только часть попыток.', ' Only a subset of attempts is retained.') : '')
        : tr('Интервальные оценки, не исходный сигнал. Попытки после проверки качества не являются запланированными повторами.',
          'Interval estimates, not a raw signal. QC retries are not planned repetitions.')
          + (intervals?.truncated ? tr(' Хранится только часть интервалов.', ' Only a subset of intervals is retained.') : '');
      const plot = chartPanel(controls, graph, note, pointNavigation(index, items.length, tr));
      return shell('session', tr('Динамика сессии', 'Session dynamics'), tr('Нажмите на точку или полосу, чтобы посмотреть наблюдение.', 'Click a point or interval bar to inspect the observation.'),
        rowsFor.minutes.length || rowsFor.blocks.length
          ? `<div class="ab-split"><div>${plot}${selected ? detail(label(selected), fields) : ''}</div>${participantMap(tr, channel, trial ? null : selected, number)}</div>`
          : plot + (selected ? detail(label(selected), fields) : ''));
    }, { abMode: 'mode', abChannel: 'channel', abBlock: 'block', abPage: 'page', abPoint: 'point' });
  }

  function comparison(root, data, options) {
    const { tr, number } = helpers(options.en);
    const paired = data.design === 'paired';
    const items = paired ? list(data.pairs).filter(row => finite(row.reference) && finite(row.comparison))
      : ['reference', 'comparison'].flatMap((side, column) => list(data[side]?.values)
        .map((value, i) => ({ value, column, index: i + 1 })).filter(row => finite(row.value)));
    if (!items.length) return;
    const state = { page: '0', point: '0' };
    const unit = data.effectUnit === 'pct' ? tr('п.п.', 'pp') : data.effectUnit === 'bpm' ? tr('уд/мин', 'bpm')
      : data.effectUnit === 'breaths/min' ? tr('дых/мин', 'breaths/min') : tr('мс', 'ms');
    const rawUnit = data.effectUnit === 'pct' ? '%' : unit;
    const allY = scale(items.flatMap(row => paired ? [row.reference, row.comparison] : [row.value]), 182, 25);
    const label = row => paired ? options.labels?.participant?.(row.participantId)
      || `${tr('Участник', 'Participant')} ${row.participantId}` : `${row.column ? 'B' : 'A'} · ${tr('точка', 'point')} ${row.index}`;
    const ci = data.estimateCi95;
    const intervalFigure = [ci?.lower, ci?.upper, data.effect].every(finite) ? (() => {
      const x = scale([ci.lower, ci.upper, data.effect, 0], 70, 570).at;
      const caption = tr('Разность B − A и поисковый 95% ДИ', 'Difference B − A and exploratory 95% CI');
      return `<figure class="ab-card ab-effect"><figcaption>${caption}</figcaption>
        <svg viewBox="0 0 640 75" role="img" aria-label="${caption}">
          <path class="ab-axis" d="M70 47H570M${x(0)} 9V52"/>
          <line class="ab-segment" x1="${x(ci.lower)}" x2="${x(ci.upper)}" y1="28" y2="28"/>
          <circle class="ab-dot" cx="${x(data.effect)}" cy="28" r="6"/>
          <text x="${x(0)}" y="67" text-anchor="middle">0</text>
        </svg></figure>`;
    })() : '';
    browse(root, state, () => {
      const page = Number(state.page), index = Number(state.point);
      const visible = items.slice(page * PAGE, (page + 1) * PAGE);
      const active = visible[index];
      const y = allY.at;
      const caption = paired ? tr('Парные значения участников', 'Paired participant values') : tr('Значения независимых групп', 'Independent group values');
      const legend = options.sideNames ? `<div class="ab-series-key">${options.sideNames.map((name, i) =>
        `<span><b class="${i ? 'ab-key-b' : 'ab-key-a'}">${i ? 'B' : 'A'}</b> ${esc(name)}</span>`).join('')}</div>` : '';
      const graph = svg(caption, `<path class="ab-axis" d="M72 22V183H615"/><text x="192" y="209" text-anchor="middle">A</text><text x="490" y="209" text-anchor="middle">B</text>
        <text x="62" y="30" text-anchor="end">${esc(number(allY.max))}</text>${allY.min !== allY.max ? `<text x="62" y="183" text-anchor="end">${esc(number(allY.min))}</text>` : ''}
        ${visible.map((row, i) => paired ? `<g data-ab-point="${i}">
          <line class="ab-range-hit" x1="192" x2="490" y1="${y(row.reference)}" y2="${y(row.comparison)}"/>
          <line class="ab-pair${i === index ? ' is-active' : ''}" x1="192" x2="490" y1="${y(row.reference)}" y2="${y(row.comparison)}"/></g>` : '').join('')}
        ${visible.map((row, i) => paired
          ? marker(192, y(row.reference), i, i === index, label(row)) + marker(490, y(row.comparison), i, i === index, label(row), 'ab-second')
          : marker((row.column ? 490 : 192) + ((row.index * 37) % 79 - 39), y(row.value), i, i === index, label(row), row.column ? 'ab-second' : '')).join('')}`);
      const controls = (items.length > PAGE ? select('abPage', tr('Диапазон', 'Range'), pageOptions(items.length, tr), state.page) : '')
        + select('abPoint', tr('Наблюдение', 'Observation'), visible.map((row, i) => [String(i), label(row)]), state.point);
      const fields = paired ? [['A', `${number(active.reference)} ${rawUnit}`], ['B', `${number(active.comparison)} ${rawUnit}`], ['B − A', `${number(active.difference)} ${unit}`]]
        : [[tr('Значение', 'Value'), `${number(active.value)} ${rawUnit}`]];
      return shell('comparison', caption, options.metric,
        `${chartPanel(controls, legend + graph, paired ? tr('Одна линия — один участник. Нажмите на линию, чтобы увидеть разность.', 'One line per participant. Click the line to inspect the difference.')
          : tr('Одна точка — один участник. Горизонтальное смещение внутри группы только разделяет точки.', 'One point per participant. Within-group horizontal jitter only separates points.'), pointNavigation(index, visible.length, tr))}
        ${detail(label(active), fields)}${intervalFigure}`);
    }, { abPage: 'page', abPoint: 'point' });
  }

  function quality(root, data, options) {
    const { tr, number } = helpers(options.en);
    const rows = list(data.qcChannels);
    if (!rows.length) return;
    const state = { point: '0' };
    browse(root, state, () => {
      const row = rows[Number(state.point)];
      const name = options.channelLabel(row.channel);
      const share = finite(row.validFraction) && row.validFraction >= 0 && row.validFraction <= 1 ? row.validFraction * 100 : null;
      const note = tr('Доля валидных наблюдений, не доля времени. Выберите канал, чтобы узнать причины.',
        'Share of valid observations, not share of time. Channel quality does not establish measurement accuracy.');
      const tones = new Map([['valid','good'], ['borderline','warn'], ['invalid','bad']]);
      return shell('quality', tr('Качество по каналам', 'Quality by channel'), note,
        `<div class="ab-card ab-quality-list">${rows.map((channel, i) => {
          const label = options.channelLabel(channel.channel);
          const fraction = channel.validFraction;
          const percent = finite(fraction) && fraction >= 0 && fraction <= 1 ? fraction * 100 : null;
          return `<button class="ab-quality-row ab-tone-${tones.get(channel.status) || 'neutral'}" type="button" id="abQuality${i}" data-ab-point="${i}" aria-pressed="${Number(state.point) === i}">
            <span><strong>${esc(label)}</strong><small>${esc(options.statusLabel(channel.status))}</small></span>
            ${percent === null ? `<span class="ab-no-meter">${number(null)}</span>` : `<meter min="0" max="100" value="${percent}" aria-label="${esc(label)}">${percent}%</meter>`}
            <strong>${percent === null ? '—' : number(percent) + '%'}</strong></button>`;
        }).join('')}</div>
        ${detail(name, [[tr('Статус', 'Status'), options.statusLabel(row.status)],
          [tr('Валидность', 'Validity'), share === null ? number(null) : number(share) + '%'],
          [tr('Причины', 'Reasons'), list(row.reasons).map(options.reasonLabel).join('; ') || '—']])}
        <details class="ab-chart-method"><summary>${tr('Правила проверки', 'Quality rules')}</summary><p>${esc(row.ruleVersion || '—')}</p></details>`);
    }, { abPoint: 'point' });
  }

  global.EmocogBlockDashboard = { session, comparison, quality, group, rtDistribution, participantRelation };
})(window);
