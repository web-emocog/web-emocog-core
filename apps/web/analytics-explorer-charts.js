(function (global) {
  'use strict';
  if (!global) return;

  const MAX_ROWS = 500, MAX_LEVELS = 32, WIDTH = 760;
  const INK = 'currentColor', GREEN = 'var(--ax-green,currentColor)';
  const PAPER = 'var(--ax-paper,var(--card-bg,Canvas))';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const key = value => typeof value === 'string' && value.length <= 120
    && !['__proto__', 'constructor', 'prototype'].includes(value) ? value : null;
  // Read only own data properties: inherited values and accessors are not report data.
  function own(object, name) {
    if (!object || typeof object !== 'object' || !key(name)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  }
  function scalar(value) {
    if (typeof value === 'string') return value.slice(0, 240).replace(/[\x00-\x1f\x7f]/g, ' ');
    if (finite(value) || typeof value === 'boolean') return String(value);
    return '';
  }
  const esc = value => scalar(value).replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const coord = value => String(Math.round(value * 1000) / 1000);
  const short = (value, length = 25) => scalar(value).length > length ? scalar(value).slice(0, length - 3) + '...' : scalar(value);
  function helpers(input) {
    const call = (name, args, fallback) => {
      const fn = own(input, name);
      if (typeof fn !== 'function') return fallback;
      try { return scalar(fn(...args)) || fallback; } catch (_) { return fallback; }
    };
    return {
      tr: (a, b) => call('tr', [a, b], b),
      num: value => call('num', [value], String(value)),
      field: value => call('field', [value], value),
      title: value => call('title', [value], value),
      unit: value => call('unit', [value], value),
      name: value => call('name', [value], value)
    };
  }
  const text = (x, y, label, anchor = 'start', extra = '') =>
    `<text x="${coord(x)}" y="${coord(y)}" text-anchor="${anchor}" style="fill:currentColor"${extra}>${esc(label)}</text>`;
  function rowsOf(module) {
    const rows = own(module, 'rows');
    if (!Array.isArray(rows)) return [];
    const result = [], length = Math.min(own(rows, 'length'), MAX_ROWS);
    for (let index = 0; index < length; index++) {
      const row = own(rows, String(index));
      if (row && typeof row === 'object' && !Array.isArray(row)) result.push({ row, index });
    }
    return result;
  }
  function mark(item, label, body, selected, extra = '') {
    return `<g class="ax-mark${selected === item.index ? ' is-selected' : ''}" data-point="${item.index}" role="button" tabindex="0" aria-pressed="${selected === item.index}" aria-label="${esc(label)}"${extra}>${body}<title>${esc(label)}</title></g>`;
  }
  function frame(context, kind, body, note, height = 360, printNote = true) {
    const { module, h } = context;
    if (own(own(module, 'rows'), 'length') > MAX_ROWS) note += '; ' + h.tr('Первые 500 строк', 'First 500 input rows only');
    return `<svg xmlns="http://www.w3.org/2000/svg" class="ab-chart ax-chart" data-chart="${kind}" viewBox="0 0 ${WIDTH} ${height}" role="group" aria-label="${esc(h.title(scalar(own(module, 'id'))))}"><title>${esc(h.title(scalar(own(module, 'id'))))}</title><desc>${esc(note)}</desc>${body}${printNote ? text(70, height - 12, short(note, 112), 'start', ' class="ax-chart-note"') : ''}</svg>`;
  }
  function scale(values, start, end, zero = false) {
    let lo = Math.min(...values), hi = Math.max(...values);
    if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    const magnitude = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    const low = lo / magnitude, high = hi / magnitude;
    // Normalize before subtraction so opposite-sign, near-MAX_VALUE inputs do not overflow.
    const fraction = value => high === low ? .5 : Math.max(0, Math.min(1, (value / magnitude - low) / (high - low)));
    return { lo, hi, fraction, at: value => start + fraction(value) * (end - start) };
  }
  const mix = (a, b, t) => a === b ? a : a * (1 - t) + b * t;
  function yAxis(s, h, label) {
    const ticks = s.lo === s.hi ? [s.lo] : Array.from({ length: 5 }, (_, i) => mix(s.lo, s.hi, i / 4));
    return text(70, 24, short(label, 85)) + ticks.map(value => {
      const y = s.at(value);
      return `<path d="M70 ${coord(y)} H720" style="fill:none;stroke:${INK};stroke-opacity:.16"/>${text(60, y + 4, h.num(value), 'end')}`;
    }).join('');
  }
  function unitOf(context, items) {
    const units = new Set(items.map(item => scalar(own(item.row, 'unit'))).filter(Boolean));
    const explicit = scalar(own(context.config, 'unit'));
    if (explicit) units.add(explicit);
    if (!units.size) {
      const metrics = own(context.module, 'metrics');
      if (Array.isArray(metrics)) for (let i = 0; i < Math.min(own(metrics, 'length'), 32); i++) {
        const unit = scalar(own(own(metrics, String(i)), 'unit'));
        if (unit) { units.add(unit); break; }
      }
    }
    return units.size > 1 ? null : context.h.unit([...units][0] || '');
  }
  function pairColumns(context) {
    const { config, rows } = context;
    const single = own(config, 'type') === 'box' && key(own(config, 'value'));
    if (single && rows.some(item => finite(own(item.row, single)))) return [single];
    const requested = [key(own(config, 'x')), key(own(config, 'y'))];
    if (requested.every(Boolean) && requested[0] !== requested[1]
      && requested.every(name => rows.some(item => finite(own(item.row, name))))) return requested;
    return rows.some(item => finite(own(item.row, 'referenceValue')) || finite(own(item.row, 'comparisonValue')))
      ? ['referenceValue', 'comparisonValue'] : ['reference', 'comparison'];
  }
  function pairLabels(context, columns) {
    return columns.map((column, i) => {
      const name = column.endsWith('Value') ? scalar(own(context.rows[0].row, i ? 'comparison' : 'reference')) : '';
      return name || context.h.field(column);
    });
  }
  function paired(context) {
    const { rows, h, selected } = context, columns = pairColumns(context);
    const items = rows.filter(item => columns.some(column => finite(own(item.row, column))));
    if (!items.length) return null;
    const unit = unitOf(context, items);
    if (unit === null) return null;
    const values = items.flatMap(item => columns.map(column => own(item.row, column)).filter(finite));
    const s = scale(values, 262, 52), labels = pairLabels(context, columns), xs = [210, 590];
    let body = yAxis(s, h, [h.tr('Значение', 'Value'), unit].filter(Boolean).join(' / '));
    body += items.map(item => {
      const values = columns.map(column => own(item.row, column));
      const label = [scalar(own(item.row, 'participant')) || scalar(own(item.row, 'participantId')) || h.tr('Строка', 'Row') + ' ' + (item.index + 1),
        ...values.map((value, i) => labels[i] + ': ' + (finite(value) ? h.num(value) + ' ' + unit : h.tr('Нет данных', 'Missing')))].join('; ');
      let shapes = values.every(finite) ? `<path class="ax-pair-line" d="M${xs[0]} ${coord(s.at(values[0]))} L${xs[1]} ${coord(s.at(values[1]))}" style="fill:none;stroke:${GREEN};stroke-width:${selected === item.index ? 3 : 1.5};stroke-opacity:${selected === item.index ? 1 : .45}"/>` : '';
      shapes += values.map((value, i) => finite(value) ? `<circle cx="${xs[i]}" cy="${coord(s.at(value))}" r="${selected === item.index ? 6 : 4}" data-series="${esc(columns[i])}" data-value="${value}" style="fill:${GREEN};stroke:${INK}"/>` : '').join('');
      return mark(item, label, shapes, selected);
    }).join('');
    body += labels.map((label, i) => text(xs[i], 289, short(label, 42), 'middle')).join('');
    return frame(context, 'paired', body, h.tr('Линии соединяют только записанные пары; пропуски не заменены нулём', 'Lines connect recorded pairs only; missing values are not zero'));
  }
  function quantile(sorted, p) {
    const at = (sorted.length - 1) * p, low = Math.floor(at);
    return mix(sorted[low], sorted[Math.ceil(at)], at - low);
  }
  function box(context) {
    const { rows, h, selected } = context, columns = pairColumns(context), labels = pairLabels(context, columns);
    const groups = columns.map(column => rows.filter(item => finite(own(item.row, column))));
    const values = groups.flatMap((items, i) => items.map(item => own(item.row, columns[i])));
    if (!values.length) return null;
    const unit = unitOf(context, rows);
    if (unit === null) return null;
    const s = scale(values, 258, 52);
    let body = yAxis(s, h, [h.tr('Значение', 'Value'), unit].filter(Boolean).join(' / '));
    groups.forEach((items, group) => {
      const x = groups.length === 1 ? 380 : group ? 560 : 250, column = columns[group];
      body += text(x, 286, short(labels[group], 39), 'middle') + text(x, 305, 'n = ' + items.length, 'middle');
      if (!items.length) return;
      const sorted = items.map(item => own(item.row, column)).sort((a, b) => a - b);
      const q1 = quantile(sorted, .25), median = quantile(sorted, .5), q3 = quantile(sorted, .75);
      const magnitude = Math.max(...sorted.map(Math.abs)) || 1;
      const iqr = q3 / magnitude - q1 / magnitude;
      const outlier = value => value / magnitude < q1 / magnitude - 1.5 * iqr || value / magnitude > q3 / magnitude + 1.5 * iqr;
      const inside = sorted.filter(value => !outlier(value)), lo = inside[0], hi = inside[inside.length - 1];
      const summary = `${labels[group]}; n = ${items.length}; Q1 = ${h.num(q1)}; median = ${h.num(median)}; Q3 = ${h.num(q3)}; whiskers = ${h.num(lo)}, ${h.num(hi)} ${unit}`;
      body += `<g class="ax-box-summary" data-series="${esc(column)}" data-q1="${q1}" data-median="${median}" data-q3="${q3}" data-low="${lo}" data-high="${hi}" style="stroke:${INK};fill:none"><title>${esc(summary)}</title><path d="M${x} ${coord(s.at(lo))} V${coord(s.at(hi))} M${x - 22} ${coord(s.at(lo))} H${x + 22} M${x - 22} ${coord(s.at(hi))} H${x + 22}"/><rect x="${x - 44}" y="${coord(s.at(q3))}" width="88" height="${coord(s.at(q1) - s.at(q3))}" style="fill:${GREEN};fill-opacity:.15"/><path d="M${x - 44} ${coord(s.at(median))} H${x + 44}" style="stroke-width:3"/></g>`;
      body += items.map(item => {
        const value = own(item.row, column), isOutlier = outlier(value);
        // Horizontal offsets separate recorded points, never change their measured ordinate.
        const px = x + ((item.index * 7) % 17 - 8) * 2.7;
        const label = `${labels[group]}; ${h.tr('Строка', 'Row')} ${item.index + 1}; ${h.num(value)} ${unit}${isOutlier ? '; ' + h.tr('Выброс Тьюки', 'Tukey outlier') : ''}`;
        return mark(item, label, `<circle cx="${coord(px)}" cy="${coord(s.at(value))}" r="${selected === item.index ? 6 : 3.5}" style="fill:${isOutlier ? PAPER : GREEN};stroke:${INK};stroke-width:${isOutlier ? 1.8 : 1}"/>`, selected,
          ` data-series="${esc(column)}" data-value="${value}" data-outlier="${isOutlier}"`);
      }).join('');
    });
    return frame(context, 'box', body, h.tr('Квантили type 7; усы до наблюдений в пределах 1.5 IQR; точки — реальные строки', 'Type-7 quantiles; whiskers reach observations within 1.5 IQR; points are recorded rows'));
  }
  const identity = value => (typeof value === 'string' && value.length > 0 && value.length <= 240) || finite(value)
    ? typeof value + ':' + String(value) : null;
  const scopeKey = row => JSON.stringify(['blockId', 'stimulusId'].map(name => identity(own(row, name))));
  function scopeLabel(row, h) {
    return ['blockId', 'stimulusId'].map(name => {
      const value = scalar(own(row, name));
      return value ? h.field(name) + ': ' + value : '';
    }).filter(Boolean).join('; ');
  }
  function chord(context) {
    const { rows, h, selected } = context;
    const valid = rows.filter(item => Number.isSafeInteger(own(item.row, 'count')) && own(item.row, 'count') > 0
      && identity(own(item.row, 'fromId') ?? own(item.row, 'from')) && identity(own(item.row, 'toId') ?? own(item.row, 'to')));
    if (!valid.length) return null;
    const scope = scopeKey(valid[0].row), nodes = new Map(), edges = [];
    let limited = false;
    for (const item of valid.filter(item => scopeKey(item.row) === scope)) {
      const ids = ['from', 'to'].map(name => identity(own(item.row, name + 'Id') ?? own(item.row, name)));
      if (nodes.size + new Set(ids.filter(id => !nodes.has(id))).size > MAX_LEVELS) { limited = true; continue; }
      ids.forEach((id, i) => {
        if (!nodes.has(id)) nodes.set(id, { label: scalar(own(item.row, i ? 'to' : 'from')) || scalar(own(item.row, i ? 'toId' : 'fromId')), weight: 0 });
        nodes.get(id).weight += own(item.row, 'count');
      });
      edges.push({ ...item, from: nodes.get(ids[0]), to: nodes.get(ids[1]), count: own(item.row, 'count') });
    }
    if (!edges.length) return null;
    const total = [...nodes.values()].reduce((sum, node) => sum + node.weight, 0);
    const gap = .035, span = Math.PI * 2 - gap * nodes.size;
    let angle = -Math.PI / 2;
    const point = (radius, a) => [380 + radius * Math.cos(a), 180 + radius * Math.sin(a)];
    const p = (radius, a) => point(radius, a).map(coord).join(' ');
    let body = '';
    for (const node of nodes.values()) {
      node.start = angle; node.end = angle + span * node.weight / total; node.cursor = angle;
      body += `<path d="M${p(144, node.start)} A144 144 0 ${node.end - node.start > Math.PI ? 1 : 0} 1 ${p(144, node.end)}" style="fill:none;stroke:${GREEN};stroke-width:10"><title>${esc(node.label)}</title></path>`;
      const mid = (node.start + node.end) / 2, xy = point(159, mid);
      body += `<g><title>${esc(node.label)}</title>${text(xy[0], xy[1] + 4, short(node.label, 21), Math.cos(mid) < -.1 ? 'end' : Math.cos(mid) > .1 ? 'start' : 'middle')}</g>`;
      angle = node.end + gap;
    }
    body += edges.map(edge => {
      const width = span * edge.count / total;
      const a = edge.from.cursor, b = a + width; edge.from.cursor = b;
      const c = edge.to.cursor, d = c + width; edge.to.cursor = d;
      const target = (c + d) / 2;
      const path = `M${p(137, (a + b) / 2)} Q380 180 ${p(137, target)}`;
      const label = `${edge.from.label} -> ${edge.to.label}; ${h.tr('Число переходов', 'Transition count')}: ${h.num(edge.count)}; ${h.tr('Строка', 'Row')} ${edge.index + 1}`;
      return mark(edge, label, `<path d="${path}" fill="none" stroke="transparent" stroke-width="16"/><path class="ax-chord-ribbon" d="${path}" style="fill:none;stroke:${GREEN};stroke-width:${coord(24 * edge.count / total)};stroke-opacity:${selected === edge.index ? 1 : .68}"/><path d="M${p(140, target)} L${p(124, target - .035)} L${p(124, target + .035)} Z" style="fill:${INK};stroke:none"/>`, selected, ` data-count="${edge.count}"`);
    }).join('');
    const note = [h.tr('Стрелка — следующая зона. Толщина — число переходов, без взвешивания по участникам.', 'Arrow: next area. Line width: transition count, not participant-balanced.'),
      limited ? h.tr('Не более 32 AOI', 'First 32 AOIs only') : ''].filter(Boolean).join('; ');
    return frame(context, 'chord', body, note, 370, false);
  }
  function heatmap(context) {
    const { rows, h, selected } = context;
    const valid = rows.filter(({ row }) => ['x', 'y'].every(name => Number.isSafeInteger(own(row, name)) && own(row, name) >= 0)
      && finite(own(row, 'value')) && own(row, 'value') >= 0 && own(row, 'value') <= 1);
    if (!valid.length) return null;
    const scope = scopeKey(valid[0].row), items = valid.filter(item => scopeKey(item.row) === scope);
    const occupied = new Set();
    for (const item of items) {
      const id = JSON.stringify([own(item.row, 'x'), own(item.row, 'y')]);
      if (occupied.has(id)) return null; // Conflicting grids cannot be identified or safely overlaid.
      occupied.add(id);
    }
    const xmax = Math.max(...items.map(item => own(item.row, 'x'))), ymax = Math.max(...items.map(item => own(item.row, 'y')));
    const cell = Math.min(560 / (xmax + 1), 224 / (ymax + 1));
    if (cell < .25) return null;
    const left = 100 + (560 - cell * (xmax + 1)) / 2, top = 48;
    const max = Math.max(...items.map(item => own(item.row, 'value')));
    let body = text(70, 22, h.tr('Плотность: доля вероятности в ячейке', 'Density: probability mass per grid cell'));
    body += items.map(item => {
      const x = own(item.row, 'x'), y = own(item.row, 'y'), value = own(item.row, 'value');
      const n = own(item.row, 'nParticipants');
      const label = `x: ${x}; y: ${y}; ${h.tr('Доля', 'Probability mass')}: ${h.num(value)}${Number.isSafeInteger(n) && n >= 0 ? '; n = ' + n : ''}`;
      return mark(item, label, `<rect x="${coord(left + x * cell)}" y="${coord(top + y * cell)}" width="${coord(cell)}" height="${coord(cell)}" style="fill:${GREEN};fill-opacity:${max ? .85 * value / max : 0};stroke:${INK};stroke-opacity:.3;stroke-width:.7"/>`, selected, ` data-value="${value}"`);
    }).join('');
    body += text(left, 291, '0') + text(left + xmax * cell, 291, String(xmax), 'end')
      + text(380, 311, h.tr('Столбец x; строка y сверху вниз', 'Grid column x; row y increases downward'), 'middle')
      + text(left - 10, top + 10, '0', 'end') + text(left - 10, top + (ymax + .5) * cell, String(ymax), 'end');
    body += text(70, 333, h.tr('Шкала долей', 'Probability scale') + ': 0 - ' + h.num(max));
    return frame(context, 'heatmap', body, [h.tr('Пусто = нет записи; без интерполяции; первая область block/stimulus', 'Blank = unrecorded; no interpolation; first block/stimulus context'), scopeLabel(valid[0].row, h)].filter(Boolean).join('; '), 385);
  }
  function flow(context) {
    const { rows, h, selected } = context, seen = new Set(), groups = [[], [], []];
    for (const item of rows) {
      const done = own(item.row, 'completed'), interrupted = own(item.row, 'interrupted');
      if (![0, 1].includes(done) || ![0, 1].includes(interrupted) || done + interrupted > 1) continue;
      const session = identity(own(item.row, 'sessionId'));
      if (session && seen.has(session)) return null;
      if (session) seen.add(session);
      groups[done ? 0 : interrupted ? 1 : 2].push(item);
    }
    const total = groups.reduce((sum, items) => sum + items.length, 0);
    if (!total) return null;
    const labels = [h.tr('Завершены', 'Completed'), h.tr('Прерваны', 'Interrupted'), h.tr('Не подтверждено', 'Unconfirmed')];
    let body = text(70, 25, h.tr('Исходы зарегистрированных сессий', 'Registered session outcomes'))
      + `<rect x="70" y="120" width="150" height="75" rx="8" style="fill:${GREEN};fill-opacity:.15;stroke:${INK}"/>`
      + text(145, 148, h.tr('Сессии', 'Sessions'), 'middle') + text(145, 177, h.num(total), 'middle');
    groups.forEach((items, group) => {
      const y = 65 + group * 86, w = 360 / total;
      body += `<path d="M220 157 H258 V${y + 20} H300" style="fill:none;stroke:${INK};stroke-opacity:.3"/>`
        + text(300, y - 10, labels[group] + ': ' + h.num(items.length));
      body += items.map((item, i) => {
        const recorded = own(item.row, 'recordedTrials'), accepted = own(item.row, 'acceptedTrials');
        const counts = Number.isSafeInteger(recorded) && recorded >= 0 && Number.isSafeInteger(accepted) && accepted >= 0 && accepted <= recorded
          ? '; ' + h.tr('Принято / записано проб', 'Accepted / recorded trials') + ': ' + accepted + ' / ' + recorded : '';
        const label = labels[group] + '; ' + h.field('sessionId') + ': ' + (scalar(own(item.row, 'sessionId')) || item.index + 1) + counts;
        return mark(item, label, `<rect x="${coord(300 + i * w)}" y="${y}" width="${coord(w)}" height="38" style="fill:${GREEN};fill-opacity:${group === 0 ? .8 : group === 1 ? .45 : .15};stroke:${INK};stroke-width:.7"/>`, selected);
      }).join('');
    });
    return frame(context, 'flow', body, h.tr('Количество сессий, не воронка приглашений; до регистрации потери неизвестны', 'Session counts, not an invitation funnel; losses before registration are unknown'));
  }
  function matrix(context) {
    const { rows, config, h, selected } = context;
    const xKey = key(own(config, 'x')), yKey = key(own(config, 'y'));
    if (!xKey || !yKey || xKey === yKey) return null;
    const cellValue = (row, name) => name === 'available' && typeof own(row, name) === 'boolean'
      ? (own(row, name) ? 1 : 0) : own(row, name);
    const valueKey = key(own(config, 'value')) || key(own(config, 'z'))
      || ['value', 'available', 'count'].find(name => rows.some(item => finite(cellValue(item.row, name))));
    if (!valueKey || valueKey === xKey || valueKey === yKey) return null;
    const xs = new Map(), ys = new Map(), cells = new Set(), items = [];
    let limited = false;
    for (const item of rows) {
      const x = identity(own(item.row, xKey)), y = identity(own(item.row, yKey)), value = cellValue(item.row, valueKey);
      if (!x || !y || !finite(value)) continue;
      if ((!xs.has(x) && xs.size >= MAX_LEVELS) || (!ys.has(y) && ys.size >= MAX_LEVELS)) { limited = true; continue; }
      const id = JSON.stringify([x, y]);
      if (cells.has(id)) return null;
      cells.add(id);
      if (!xs.has(x)) xs.set(x, { index: xs.size, label: h.name(scalar(own(item.row, xKey))) });
      if (!ys.has(y)) ys.set(y, { index: ys.size, label: h.name(scalar(own(item.row, yKey))) });
      items.push({ ...item, x: xs.get(x).index, y: ys.get(y).index, value });
    }
    if (!items.length) return null;
    const unit = unitOf(context, items);
    if (unit === null) return null;
    const width = 520 / xs.size, height = 215 / ys.size;
    const magnitude = Math.max(...items.map(item => Math.abs(item.value))) || 1;
    let body = text(70, 22, h.field(valueKey) + (unit ? ' / ' + unit : ''));
    body += items.map(item => {
      const x = 170 + item.x * width, y = 45 + item.y * height;
      const label = `${h.field(xKey)}: ${h.name(scalar(own(item.row, xKey)))}; ${h.field(yKey)}: ${h.name(scalar(own(item.row, yKey)))}; ${h.field(valueKey)}: ${h.num(item.value)} ${unit}`;
      const fill = item.value < 0 ? 'var(--ax-chart-negative,currentColor)' : GREEN;
      const shape = `<rect x="${coord(x)}" y="${coord(y)}" width="${coord(width)}" height="${coord(height)}" style="fill:${fill};fill-opacity:${Math.abs(item.value) / magnitude * .75};stroke:${INK};stroke-opacity:.4${item.value < 0 ? ';stroke-dasharray:3 2' : ''}"/>`
        + (width > 34 && height > 20 ? text(x + width / 2, y + height / 2 + 4, h.num(item.value), 'middle') : '');
      return mark(item, label, shape, selected, ` data-value="${item.value}"`);
    }).join('');
    for (const value of xs.values()) {
      const x = 170 + (value.index + .5) * width;
      body += `<g><title>${esc(value.label)}</title>${text(x, 278, short(value.label, xs.size > 12 ? 12 : 23), 'end', ` transform="rotate(-35 ${coord(x)} 278)"`)}</g>`;
    }
    for (const value of ys.values()) body += text(160, 49 + (value.index + .5) * height, short(value.label, 22), 'end');
    body += text(430, 335, h.field(xKey), 'middle') + text(70, 42, h.field(yKey));
    body += text(70, 356, h.tr('Шкала', 'Scale') + ': ' + h.num(Math.min(...items.map(item => item.value))) + ' - ' + h.num(Math.max(...items.map(item => item.value))));
    return frame(context, 'matrix', body, h.tr('Пусто = нет записи; 0 = записанный ноль; отрицательные ячейки пунктиром', 'Blank = unrecorded; 0 = recorded zero; dashed cells are negative') + (limited ? '; ' + h.tr('Первые 32 уровня осей', 'First 32 axis levels only') : ''), 400);
  }
  function histogram(context) {
    const { rows, config, h, selected } = context, isRT = own(context.module, 'id') === 'R2';
    let items = rows, valueKey = key(own(config, 'y')) || 'value', description = h.field(valueKey);
    let rtMetric = '';
    if (isRT) {
      const requested = scalar(own(config, 'metricId'));
      const metric = requested || (rows.some(item => own(item.row, 'metricId') === 'rt.median') ? 'rt.median'
        : scalar(own(rows.find(item => /^rt\.(?:q10|q25|q75|q90)$/.test(scalar(own(item.row, 'metricId'))))?.row, 'metricId')));
      if (!metric) return null;
      rtMetric = metric;
      valueKey = 'value';
      items = rows.filter(item => own(item.row, 'metricId') === metric && finite(own(item.row, 'value')) && own(item.row, 'value') >= 0);
      if (items.some(item => own(item.row, 'blockId') == null)) items = items.filter(item => own(item.row, 'blockId') == null);
      else if (items.length) {
        const block = identity(own(items[0].row, 'blockId'));
        items = items.filter(item => identity(own(item.row, 'blockId')) === block);
      }
      const seen = new Set();
      // Feature reports emit whole-session rows before condition rows; never count the same session twice.
      items = items.filter(item => {
        const session = identity(own(item.row, 'sessionId'));
        if (!session) return true;
        if (seen.has(session)) return false;
        seen.add(session); return true;
      });
      description = scalar(own(items[0]?.row, 'label')) || metric;
    }
    items = items.filter(item => finite(own(item.row, valueKey)) && (!isRT || own(item.row, valueKey) >= 0));
    if (!items.length) return null;
    const unit = unitOf(context, items);
    if (unit === null) return null;
    const values = items.map(item => own(item.row, valueKey)), s = scale(values, 90, 710);
    const nBins = s.lo === s.hi ? 1 : Math.min(16, Math.ceil(Math.log2(items.length)) + 1);
    const bins = Array.from({ length: nBins }, () => []);
    for (const item of items) bins[Math.min(nBins - 1, Math.floor(s.fraction(own(item.row, valueKey)) * nBins))].push(item);
    const max = Math.max(...bins.map(bin => bin.length));
    const ys = scale([0, max], 255, 55);
    const step = Math.max(1, Math.ceil(max / 4));
    const counts = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
    if (counts[counts.length - 1] !== max) counts.push(max);
    let body = text(70, 24, h.tr('Число записанных значений', 'Recorded value count')) + counts.map(value => {
      const y = ys.at(value);
      return `<path d="M70 ${coord(y)} H720" style="fill:none;stroke:${INK};stroke-opacity:.16"/>${text(60, y + 4, h.num(value), 'end')}`;
    }).join('');
    bins.forEach((bin, i) => {
      const low = mix(s.lo, s.hi, i / nBins), high = mix(s.lo, s.hi, (i + 1) / nBins);
      const caption = `${h.num(low)} - ${h.num(high)} ${unit}; n = ${bin.length}${i === nBins - 1 ? '; inclusive upper bound' : '; exclusive upper bound'}`;
      body += `<rect class="ax-histogram-bin" data-bin="${i}" data-count="${bin.length}" x="${coord(90 + i * 620 / nBins)}" y="${coord(ys.at(bin.length))}" width="${coord(620 / nBins)}" height="${coord(255 - ys.at(bin.length))}" style="fill:${GREEN};fill-opacity:.3;stroke:${INK};stroke-width:.8"><title>${esc(caption)}</title></rect>`;
    });
    body += '<g class="ax-histogram-observations">' + items.map(item => {
      const value = own(item.row, valueKey), label = `${description}; ${h.tr('Строка', 'Row')} ${item.index + 1}; ${h.num(value)} ${unit}`;
      return mark(item, label, `<circle cx="${coord(s.at(value))}" cy="${274 + item.index % 3 * 7}" r="${selected === item.index ? 6 : 3.5}" style="fill:${GREEN};stroke:${INK}"/>`, selected, ` data-value="${value}"`);
    }).join('') + '</g>';
    body += text(90, 310, h.num(s.lo)) + text(710, 310, h.num(s.hi), 'end') + text(400, 332, short(description + (unit ? ' / ' + unit : ''), 88), 'middle');
    const rtNote = rtMetric === 'rt.median'
      ? h.tr('Распределение записанных медиан RT сессий, не RT отдельных проб', 'Distribution of recorded session RT medians, NOT trial-level RT')
      : h.tr('Распределение записанных квантилей RT сессий, не RT отдельных проб', 'Distribution of recorded session RT quantiles, NOT trial-level RT');
    return frame(context, 'histogram', body, isRT
      ? rtNote + '; ' + h.tr('Первый итог на сессию в одной области', 'First summary per session in one scope')
      : h.tr('Равные интервалы по правилу Стерджеса (до 16); точки — исходные строки; максимум включён', 'Sturges equal-width bins (up to 16); points are original rows; maximum included'), 395);
  }
  function render(module, inputHelpers, selectedIndex) {
    try {
      const rows = rowsOf(module);
      if (!rows.length) return null;
      const config = own(module, 'chart'), h = helpers(inputHelpers);
      const context = { module, rows, config, h, selected: Number.isInteger(selectedIndex) ? selectedIndex : -1 };
      const id = own(module, 'id'), type = own(config, 'type');
      if (type === 'paired') return paired(context);
      if (type === 'box') return box(context);
      if (id === 'G3') return chord(context);
      if (id === 'G6') return heatmap(context);
      if (id === 'Q1') return flow(context);
      if (type === 'matrix') return matrix(context);
      if (id === 'R2' || type === 'histogram') return histogram(context);
      return null;
    } catch (_) { return null; }
  }

  global.WecogAnalyticsCharts = Object.freeze({ render });
})(typeof window === 'object' && window ? window : null);
