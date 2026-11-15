(function (global) {
  'use strict';
  const LIMIT = 12;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const finite = Number.isFinite;

  function view(source, kind, requested, options = {}) {
    const points = source.points.filter(p => finite(p.x)).slice(0, 1000);
    const data = points.filter(p => finite(p.y));
    if (!data.length || (kind === 'curve' && (!source.ordered || data.length < 2))) return null;
    const k = Math.max(kind === 'curve' ? 1 : 2, Math.min(kind === 'histogram' ? 20 : 9, Math.round(Number(requested)) || 3));
    const tr = (ru, en) => source.en ? en : ru;
    const num = new Intl.NumberFormat(source.en ? 'en' : 'ru', { maximumFractionDigits: 2 });
    const n = v => num.format(v);
    const lo = Math.min(...data.map(p => p.y)), hi = Math.max(...data.map(p => p.y));
    const unit = source.unit || '';
    const ratio = (value, min, max) => {
      const magnitude = Math.max(Math.abs(min), Math.abs(max)) || 1;
      const low = min / magnitude, high = max / magnitude;
      return low === high ? .5 : (value / magnitude - low) / (high - low);
    };
    const scale = (value, min, max, from, to) => from + ratio(value, min, max) * (to - from);
    const left = 92, right = 696, top = 28, bottom = 182;
    const line = (x1,y1,x2,y2,style) => `<path d="M${x1} ${y1}L${x2} ${y2}" style="fill:none;stroke:currentColor;${style}"/>`;
    const labels = (a, b) => `<text x="${left}" y="208">${esc(a)}</text><text x="${right}" y="208" text-anchor="end">${esc(b)}</text>`;
    const dots = (ps, x, y, tone) => ps.map(p => `<circle cx="${x(p)}" cy="${y(p)}" r="3" style="fill:${tone};fill-opacity:.76"><title>${esc(n(p.y) + ' ' + unit)}</title></circle>`).join('');
    const showDensity = options.density && ['clusters','histogram'].includes(kind) && hi > lo;
    const bandwidth = Math.max(2, Math.min(30, Math.round(Number(options.bandwidth)) || 12));
    function densityLine(from, to) {
      // The vertical scale is relative density, separate from counts and cluster numbers.
      const samples = Array.from({ length: 65 }, (_, i) => data.reduce((sum, p) => {
        const distance = (i / 64 - ratio(p.y, lo, hi)) / (bandwidth / 100);
        return sum + Math.exp(-.5 * distance ** 2);
      }, 0));
      const peak = Math.max(...samples);
      return `<path class="ax-relative-density" d="${samples.map((v, i) =>
        `${i ? 'L' : 'M'}${left + (right - left) * i / 64} ${to - v / peak * (to - from)}`).join(' ')}" style="fill:none;stroke:#2a8e78;stroke-width:2.5"/>`;
    }
    const tickLabels = () => lo === hi ? `<text x="394" y="208" text-anchor="middle">${esc(n(lo))}</text>` :
      Array.from({ length: 5 }, (_, i) => {
        const x = left + (right-left) * i / 4;
        return line(x,bottom,x,bottom+5,'opacity:.24') + `<text x="${x}" y="208" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${esc(n(lo*(1-i/4) + hi*i/4))}</text>`;
      }).join('');
    let graphic, note, title, count = k;
    if (kind === 'curve') {
      const sorted = points.slice().sort((a,b) => a.x - b.x);
      const xmin = sorted[0].x, xmax = sorted.at(-1).x;
      const x = p => scale(p.x, xmin, xmax, left, right), y = p => scale(p.y, lo, hi, bottom - 5, top + 7);
      const segments = [[]];
      sorted.forEach(p => { if (finite(p.y)) segments.at(-1).push(p); else if (segments.at(-1).length) segments.push([]); });
      const radius = Math.floor((k - 1) / 2);
      count = 2 * radius + 1;
      if (!segments.some(segment => segment.length > 1)) return null;
      const paths = segments.filter(s => s.length > 1).map(segment => {
        const smooth = segment.map((p,i) => {
          const neighbors = segment.slice(Math.max(0,i-radius), i+radius+1);
          return { x:p.x, y:neighbors.reduce((sum,q) => sum+q.y/neighbors.length,0) };
        });
        const path = smooth.map((p,i) => `${i ? 'L' : 'M'}${x(p)} ${y(p)}`).join(' ');
        return `<path d="${path}" style="fill:none;stroke:#2a8e78;stroke-width:3;stroke-linejoin:round"/>`;
      }).join('');
      graphic = paths + dots(data, x, y, '#5b7cb0')
        + labels(source.xLabel ? source.xLabel(xmin) : n(xmin), source.xLabel ? source.xLabel(xmax) : n(xmax))
        + `<text x="80" y="39" text-anchor="end">${esc(n(hi))}</text><text x="80" y="177" text-anchor="end">${esc(n(lo))}</text>`;
      title = tr('Линия изменений','Trend line');
      note = tr('Скользящее среднее (до ' + count + ' точек). Точки — измерения. Разрывы не заполнены.',
        'Moving average (up to ' + count + ' points). Dots are observations. No gap filling.');
    } else if (kind === 'histogram') {
      const bins = new Array(lo === hi ? 1 : k).fill(0);
      data.forEach(p => bins[Math.max(0, Math.min(bins.length - 1, Math.floor(ratio(p.y,lo,hi) * bins.length)))]++);
      const plotTop = showDensity ? 84 : top;
      const step = (right-left) / bins.length, maximum = Math.max(...bins);
      graphic = bins.map((total,i) => {
        const height = total/maximum * (bottom-plotTop);
        return `<rect x="${left+i*step+2}" y="${bottom-height}" width="${step-4}" height="${height}" rx="2" style="fill:#398976;fill-opacity:.67"><title>${total}</title></rect>`;
      }).join('') + tickLabels() + `<text x="80" y="${plotTop+4}" text-anchor="end">${maximum}</text><text x="80" y="${bottom+4}" text-anchor="end">0</text>`;
      title = tr('Распределение','Distribution');
      count = bins.length;
      note = tr(count + ' интервалов · наблюдений: ' + data.length, count + ' bins · observations: ' + data.length);
    } else if (kind === 'clusters') {
      const sorted = [...data].sort((a,b) => a.y - b.y);
      const unique = [...new Set(sorted.map(p => p.y))];
      count = Math.min(k, unique.length);
      if (count < 2) return null;
      let centers = Array.from({ length: count }, (_,i) => ratio(unique[Math.round(i*(unique.length-1)/(count-1))],lo,hi));
      let groups;
      const assign = () => {
        const next = centers.map(() => []);
        for (const p of sorted) {
          const value = ratio(p.y,lo,hi);
          const index = centers.reduce((best,c,i) => Math.abs(value-c) < Math.abs(value-centers[best]) ? i : best, 0);
          next[index].push(p);
        }
        return next;
      };
      for (let iteration = 0; iteration < 30; iteration++) {
        groups = assign();
        const next = centers.map((c,i) => groups[i].length ? groups[i].reduce((sum,p) => sum+ratio(p.y,lo,hi),0)/groups[i].length : c);
        if (next.every((c,i) => c === centers[i])) break;
        centers = next;
      }
      groups = assign().filter(group => group.length);
      count = groups.length;
      const colors = ['#317d6a','#597aa8','#a26341','#8c772c','#466d7a','#885c6a','#6b7f43','#755f4f','#5d6782'];
      const plotTop = showDensity ? 84 : top;
      const rowSize = (bottom-plotTop)/groups.length;
      graphic = groups.map((ps,i) => {
        const y = plotTop + (i + .5) * rowSize;
        const before = groups[i-1], after = groups[i+1];
        const start = before ? before.at(-1).y/2 + ps[0].y/2 : lo;
        const end = after ? ps.at(-1).y/2 + after[0].y/2 : hi;
        const startX = scale(start,lo,hi,left,right), endX = scale(end,lo,hi,left,right);
        return `<text x="80" y="${y+4}" text-anchor="end">${i+1} · ${ps.length}</text>`
          + `<rect class="ax-cluster-zone" x="${startX}" y="${y-rowSize*.38}" width="${endX-startX}" height="${rowSize*.76}" rx="4" style="fill:${colors[i]};fill-opacity:.19;stroke:${colors[i]};stroke-opacity:.62"/>`
          + dots(ps.map((p,j) => ({ ...p, j })), p => scale(p.y,lo,hi,left,right), p => y + (p.j%5-2)*1.8, colors[i]);
      }).join('') + tickLabels();
      title = tr('Кластеры по значению','Value clusters');
      note = tr(count + ' групп наблюдений по одному показателю. Это исследовательская группировка, не вывод о типах участников.',
        count + ' groups of observations on one measure. Exploratory grouping, not evidence of participant types.');
      note += ' ' + tr('Цветная полоса показывает диапазон группы, а не погрешность оценки.', 'The colored band shows the group range, not uncertainty.');
    } else return null;
    if (showDensity) {
      graphic += `<text x="${left}" y="18" style="font-size:11px">${tr('Относительная плотность','Relative density')}</text>` + densityLine(top, 68);
      note += ' ' + tr('Кривая сверху показывает форму распределения, не изменение во времени.', 'The curve above shows the shape of the distribution, not a time trend.');
    }
    if (source.points.length > 1000) note += ' ' + tr('График ограничен первыми 1 000 точками.', 'The chart is limited to the first 1,000 points.');
    const caption = source.title + ' · ' + title;
    const svg = `<svg class="ab-chart ax-saved-svg" role="img" aria-label="${esc(caption)}" viewBox="0 0 760 238">${line(left,top,left,bottom,'opacity:.22')}${line(left,bottom,right,bottom,'opacity:.35')}${graphic}<text x="696" y="229" text-anchor="end">${esc(kind === 'curve' ? tr('Время записи','Recording time') + (unit ? ' · '+unit : '') : unit)}</text></svg>`;
    return { svg, caption, note, count, bandwidth: showDensity ? bandwidth : null };
  }

  const plotKey = svg => [svg.closest('[data-chart-module]')?.dataset.chartModule, svg.getAttribute('aria-label'), svg.dataset.chart].join('|');
  function zoomState(root) {
    const saved = new Map();
    root.querySelectorAll('.ax-plot-viewport').forEach(viewport => {
      const svg = viewport.firstElementChild;
      if (!svg) return;
      const key = plotKey(svg), matches = saved.get(key) || [];
      matches.push([Number(viewport.dataset.zoom) || 100, viewport.scrollLeft, viewport.scrollTop]);
      saved.set(key, matches);
    });
    return saved;
  }
  function zoomWithin(root, tr, saved) {
    if (!root) return;
    root.querySelectorAll('svg.ax-chart,svg.ab-chart,svg.ax-viz-preview-svg,.conn-chart svg').forEach(svg => {
      if (svg.parentElement.classList.contains('ax-plot-viewport')) return;
      const viewport = document.createElement('div');
      viewport.className = 'ax-plot-viewport';
      const controls = document.createElement('div');
      controls.className = 'ax-plot-zoom-controls';
      const status = document.createElement('output');
      const button = (name, label, action) => {
        const el = document.createElement('button');
        el.type = 'button'; el.textContent = name; el.setAttribute('aria-label', label); el.onclick = action;
        return el;
      };
      let scale = 100;
      const minus = button('−', tr('Уменьшить график','Zoom out'), () => update(-25));
      const plus = button('+', tr('Увеличить график','Zoom in'), () => update(25));
      const reset = button(tr('Сбросить','Reset'), tr('Сбросить масштаб графика','Reset chart zoom'), () => update(100 - scale));
      function update(delta) {
        scale = Math.max(100, Math.min(250, scale + delta));
        viewport.style.setProperty('--ax-zoom', scale + '%');
        viewport.dataset.zoom = scale;
        viewport.classList.toggle('is-zoomed', scale > 100);
        viewport.tabIndex = scale > 100 ? 0 : -1;
        status.textContent = scale + '%';
        minus.disabled = reset.disabled = scale === 100; plus.disabled = scale === 250;
      }
      controls.append(minus, status, plus, reset);
      svg.before(controls, viewport);
      viewport.append(svg);
      const [initial, left, top] = saved?.get(plotKey(svg))?.shift() || [100, 0, 0];
      update(initial - 100);
      viewport.scrollLeft = left; viewport.scrollTop = top;
    });
  }

  function editor(source, tr, table) {
    if (!source || !source.points.some(p => finite(p.y))) return '';
    return `<details class="ax-viz-editor${table ? ' ax-table-chart' : ''}"><summary>${table ? tr('Построить по таблице','Chart this table') : tr('Добавить свой график','Create a custom chart')}</summary>
      <div class="ax-viz-controls">
        ${table ? `<label>${tr('Показатель','Measure')} <select data-viz-column>${table.map((column,i) => `<option value="${i}">${esc(column.label)}</option>`).join('')}</select></label>` : ''}
        <label>${tr('Вид','View')} <select data-viz-kind>${source.ordered ? `<option value="curve">${tr('Линия изменений','Trend line')}</option>` : ''}
          <option value="histogram">${tr('Распределение','Distribution')}</option><option value="clusters">${tr('Кластеры по значению','Value clusters')}</option></select></label>
        <label><span data-viz-param></span> <input data-viz-size type="number" min="2" max="20" step="1" required value="${source.ordered ? 3 : 8}"></label>
        <button class="quick-btn" type="button" data-viz-add>${tr('Добавить к отчёту','Add to report')}</button>
        <label data-viz-density-option><input type="checkbox" data-viz-density checked> ${tr('Кривая распределения','Density curve')}</label>
        <label data-viz-band-option>${tr('Сглаживание кривой','Curve smoothing')} <input data-viz-band type="range" min="2" max="30" value="12"></label>
      </div><div data-viz-preview></div><p data-viz-feedback role="status"></p></details>`;
  }

  function workspace(tr) {
    let items = [], nextId = 1, scope, gallery;
    function reset(key) {
      if (key !== scope) { scope = key; items = []; nextId = 1; paint(); }
    }
    function paint() {
      if (!gallery?.isConnected) return;
      gallery.hidden = !items.length;
      gallery.innerHTML = items.length ? `<header><h3>${tr('Мои графики','My charts')}</h3><p>${tr('Эти графики войдут в PDF текущего отчёта. При смене выборки список очищается.','These charts are included in the current PDF. Changing the selection clears the list.')}</p></header>
        <div class="ax-viz-gallery">${items.map(item => `<article class="ab-card ax-saved-chart" data-viz-id="${item.id}" data-viz-caption="${esc(item.caption)}"><h4>${esc(item.caption)}</h4>${item.svg}<p class="ab-note">${esc(item.note)}</p>
          <div class="ax-viz-actions"><button class="ab-chart-download" type="button" data-ab-save-chart>${tr('Скачать PNG','Download PNG')}</button>
          <button class="ab-chart-download" type="button" data-viz-delete="${item.id}">${tr('Убрать','Remove')}</button><span class="ab-chart-status" role="status"></span></div></article>`).join('')}</div>` : '';
      zoomWithin(gallery, tr);
    }
    function mount(node) {
      if (gallery !== node) {
        gallery = node;
        if (gallery) gallery.onclick = event => {
          const button = event.target.closest('[data-viz-delete]');
          if (!button) return;
          items = items.filter(item => item.id !== Number(button.dataset.vizDelete));
          paint();
        };
        paint();
      }
    }
    function attach(node, source, columns, table) {
      if (!node) return;
      node.innerHTML = editor(source, tr, columns);
      const kind = node.querySelector('[data-viz-kind]'), size = node.querySelector('[data-viz-size]');
      if (!kind || !size) return;
      const preview = node.querySelector('[data-viz-preview]'), feedback = node.querySelector('[data-viz-feedback]');
      const add = node.querySelector('[data-viz-add]');
      const density = node.querySelector('[data-viz-density]');
      const band = node.querySelector('[data-viz-band]');
      const column = node.querySelector('[data-viz-column]');
      const getSource = () => column ? columnSource(table, columns[Number(column.value)]) : source;
      if (source.ordered && !view(source, 'curve', 3)) kind.querySelector('[value=curve]').remove();
      const setting = () => ({ curve: [tr('Сглаживание, точек','Smoothing points'), 1, 9, 2, 3],
        histogram: [tr('Интервалов','Bins'), 2, 20, 1, 8],
        clusters: [tr('Групп','Groups'), 2, 9, 1, 3] })[kind.value];
      function update() {
        node.querySelector('[data-viz-density-option]').hidden = kind.value === 'curve';
        node.querySelector('[data-viz-band-option]').hidden = kind.value === 'curve' || !density.checked;
        const result = size.validity.valid ? view(getSource(), kind.value, size.value, { density: density.checked, bandwidth: band.value }) : null;
        preview.innerHTML = result ? result.svg.replace('class="ab-chart ax-saved-svg"', 'class="ax-viz-preview-svg"')
          + '<p>' + esc(result.note) + '</p>' : '';
        feedback.textContent = result ? '' : tr('Не хватает разных значений или указан неверный диапазон настройки.', 'More distinct values or a valid setting is required.');
        add.disabled = !result;
        zoomWithin(preview, tr);
        return result;
      }
      function selectView() {
        const [label,min,max,step,value] = setting();
        node.querySelector('[data-viz-param]').textContent = label;
        size.min = min; size.max = max; size.step = step; size.value = value;
        update();
      }
      kind.addEventListener('change', selectView);
      size.addEventListener('input', update);
      band.addEventListener('input', update);
      density.addEventListener('change', update);
      column?.addEventListener('change', update);
      add.addEventListener('click', () => {
        if (items.length >= LIMIT) {
          feedback.textContent = tr('В отчёте уже 12 графиков. Уберите один, чтобы добавить новый.', 'The report already contains 12 charts. Remove one to add another.');
          return;
        }
        const result = update();
        if (!result) return;
        const selectedSource = getSource();
        items = [...items, { ...result, id: nextId++, source: selectedSource.title, kind: kind.value,
          setting: Number(size.value), unit: selectedSource.unit || null }];
        paint();
        feedback.textContent = tr('График добавлен в «Мои графики».', 'Chart added to My charts.');
      });
      selectView();
    }
    function columnSource(table, column) {
      return { title: table.title + ' · ' + column.label, en: table.en, unit: column.unit, ordered: false,
        points: column.values.map((y, x) => ({ x, y })) };
    }
    function attachTable(node, table) {
      if (!node) return;
      const columns = table.columns.filter(column => column.values.some(finite)).slice(0, 150);
      if (columns.length) attach(node, columnSource(table, columns[0]), columns, table);
    }
    function manifest() { return items.map(({ id, source, kind, setting, count, unit, caption, note, bandwidth }) =>
      ({ id, source, kind, setting, count, unit, caption, note, bandwidth })); }
    return { reset, mount, attach, attachTable, manifest };
  }

  global.WecogAnalyticsVisualizations = { view, workspace, zoomWithin, zoomState };
})(typeof globalThis === 'object' ? globalThis : this);
