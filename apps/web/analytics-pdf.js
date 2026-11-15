(function (global) {
  'use strict';
  const scriptUrl = global.document.currentScript.src;
  let fontRequest;
  async function decodeImage(image) {
    let timer;
    try { await Promise.race([image.decode(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Image decoding timed out')), 5000);
    })]); } finally { clearTimeout(timer); }
  }

  function fontData() {
    if (!fontRequest) fontRequest = global.WecogHttp.request(new URL('assets/fonts/DejaVuSans.ttf', scriptUrl), {}, response => {
      if (!response.ok) throw new Error('PDF font unavailable'); return response.arrayBuffer();
    }, { scope: 'document' })
      .then(buffer => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        return global.btoa(binary);
      }).catch(error => { fontRequest = null; throw error; });
    return fontRequest;
  }

  function canvasFor(node) {
    const rect = node.getBoundingClientRect();
    const canvas = global.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(rect.width * 2));
    canvas.height = Math.max(1, Math.ceil(rect.height * 2));
    canvas.getContext('2d').scale(2, 2);
    return canvas;
  }

  function paintHtmlPlot(node) {
    const canvas = canvasFor(node);
    const context = canvas.getContext('2d');
    const base = node.getBoundingClientRect();
    for (const element of [node, ...node.querySelectorAll('*')]) {
      const rect = element.getBoundingClientRect();
      const style = global.getComputedStyle(element);
      if (!rect.width || !rect.height || style.visibility === 'hidden') continue;
      const x = rect.left - base.left, y = rect.top - base.top;
      context.beginPath();
      context.roundRect(x, y, rect.width, rect.height, Math.min(parseFloat(style.borderRadius) || 0, rect.width / 2, rect.height / 2));
      context.fillStyle = style.backgroundColor;
      context.fill();
      if (parseFloat(style.borderWidth)) { context.strokeStyle = style.borderColor; context.lineWidth = parseFloat(style.borderWidth); context.stroke(); }
      if (!element.children.length && element.textContent.trim()) {
        context.save(); context.beginPath(); context.rect(x, y, rect.width, rect.height); context.clip();
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.fillStyle = style.color; context.textBaseline = 'middle';
        context.fillText(element.textContent.trim(), x + (parseFloat(style.paddingLeft) || 0), y + rect.height / 2);
        context.restore();
      }
    }
    return canvas.toDataURL('image/png');
  }

  function svgSnapshot(node, print = false) {
    const copy = node.cloneNode(true);
    const targets = [copy, ...copy.querySelectorAll('*')];
    [node, ...node.querySelectorAll('*')].forEach((original, index) => {
      const style = global.getComputedStyle(original);
      for (const property of ['fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'color', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline']) {
        let value = style.getPropertyValue(property).replace(/url\(["']?[^)"']*#([^)"']+)["']?\)/g, 'url(#$1)');
        if (print && original.tagName.toLowerCase() === 'text' && (property === 'fill' || property === 'color')) value = '#32483f';
        targets[index].style.setProperty(property, value);
      }
    });
    const rect = node.getBoundingClientRect();
    const box = node.viewBox?.baseVal;
    // Display magnification must not increase report raster size or crop the plotted data.
    const width = box?.width > 0 && box.height > 0 ? Math.min(960, Math.max(640, box.width)) : rect.width;
    return { node: copy, width, height: box?.width > 0 && box.height > 0 ? width * box.height / box.width : rect.height };
  }

  function selection(body) {
    return [...body.querySelectorAll('select, #axPlanForm input, .analytics-layer-toggle, .ab-quality-row[aria-pressed="true"]')]
      .filter(node => !body.firstElementChild?.contains(node) && node.getBoundingClientRect().width)
      .map(node => ({
        control: node.id || node.name || node.dataset.layer,
        value: node.tagName === 'SELECT' ? node.selectedOptions[0]?.textContent : node.tagName === 'BUTTON' ? node.querySelector('strong')?.textContent : node.type === 'checkbox' ? node.checked : node.value,
        ...(node.tagName === 'SELECT' ? { key: node.value } : {}),
      }));
  }

  function capture(body) {
    if (body.querySelector('#analyticsExplorer')?.__analyticsPdfPending) throw new Error('Сначала рассчитайте изменённые настройки или отмените изменения. / Calculate or discard the changed settings first.');
    const source = body.querySelector('#analyticsExplorer')?.__analyticsPdfSource || body.__analyticsPdfSource;
    const en = source?.helpers?.en ?? global.document.documentElement.lang === 'en', tr = (ru, english) => en ? english : ru;
    const data = source?.extendedReport?.data;
    const figures = [], unavailable = [], metrics = [], statistics = [];
    const text = node => node?.textContent?.trim() || '';
    const scope = ['analyticsProjectFilter','analyticsProtocolFilter','analyticsVersionFilter'].map(id =>
      text(body.querySelector('#' + id)?.selectedOptions[0])).filter(Boolean);
    function addFigure(node, caption, note = '') {
      const rect = node.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      figures.push({ ...svgSnapshot(node, true), caption, note });
    }
    if (data && source.helpers) {
      const h = source.helpers;
      const module = id => data.modules.find(item => item.id === id);
      const chosen = source.tab === 'data-quality' ? ['Q1','Q2','Q3','Q4','Q5']
        : source.tab === 'connectedness' ? ['S5','S1','S3'] : ['R1','R5','F1','F5','F7'];
      for (const id of chosen) {
        const item = module(id);
        if (!item) continue;
        if (item.status !== 'computed') { unavailable.push(h.title(id)); continue; }
        for (const value of (item.metrics || []).filter(value => Number.isFinite(value.value)).slice(0, id === 'F1' ? 2 : 1)) {
          metrics.push({ label: h.metricLabel(value), value: h.metricNumber(value), unit: h.unit(value.unit) });
        }
      }
      if (['group-comparison', 'connectedness'].includes(source.tab)) {
        const ids = source.tab === 'connectedness' ? ['S5'] : ['S1','S2','S3','S4','S5','S6','S7'];
        for (const id of ids) {
          const item = module(id);
          if (!item || item.status !== 'computed') continue;
          const rows = (item.metrics || []).map(value => [h.metricLabel(value), h.metricNumber(value) + (value.unit ? ' ' + h.unit(value.unit) : '')]);
          if (id === 'S6') for (const row of (item.rows || []).slice(0, 20)) rows.push([
            h.metricLabel({ id: row.id, label: row.label }),
            'p: ' + h.metricNumber({ id: 'p', value: row.p }) + '; ' + tr('с поправкой: ', 'adjusted: ') + h.metricNumber({ id: 'pAdjusted', value: row.pAdjusted })
          ]);
          statistics.push({ title: h.title(id), method: item.method, rows });
        }
      }
      const stage = global.document.createElement('div');
      stage.className = 'ax-explorer'; stage.inert = true;
      stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;pointer-events:none;--ax-ink:#19372d;--ax-green:#27816d;--ax-paper:#ffffff;--ax-line:#dce5de;--muted:#52675d;color:#19372d;font-family:DejaVu Sans,sans-serif';
      global.document.body.appendChild(stage);
      try {
        const addModule = (id, caption, note, metricId) => {
          const original = module(id);
          if (original?.status !== 'computed') return;
          let item = original, html;
          if (metricId) {
            const seen = new Set();
            const rows = (original.rows || []).filter(row => {
              if (row.metricId !== metricId || !Number.isFinite(row.value)) return false;
              if (!row.sessionId) return true;
              if (seen.has(row.sessionId)) return false;
              seen.add(row.sessionId); return true;
            });
            if (!rows.length) return;
            item = { ...original, rows, chart: { type: 'histogram', value: 'value', metricId } };
            html = global.WecogAnalyticsCharts?.render(item, h, -1);
          } else html = source.chartHtml?.(item);
          if (!html) return;
          stage.innerHTML = html;
          const svg = stage.querySelector('svg.ax-chart');
          if (!svg) return;
          const series = stage.querySelector('[data-chart-series]')?.selectedOptions[0]?.textContent?.trim();
          if (series) note += ' ' + tr('Показано: ', 'Shown: ') + series + '.';
          if (/первые 32|first 32|первые 500|first 500/i.test(svg.querySelector('desc')?.textContent || '')) note += ' ' + tr('График показывает часть наблюдений; ограничение детализации указано в полном экспорте.', 'The chart shows a subset of observations; detail limits are recorded in the full export.');
          const box = svg.viewBox.baseVal;
          svg.style.cssText = 'width:760px;height:' + (box.height || 360) + 'px;max-height:none;min-height:0;min-width:0';
          svg.querySelectorAll('.ax-chart-note').forEach(node => node.remove());
          addFigure(svg, caption || h.title(id), note || '');
        };
        const perSession = tr('Столбец показывает число оценок в интервале. Точка — одна сессия. Повторные сессии одного участника не являются независимыми.', 'Each bar counts estimates in a bin. Each dot is one session. Repeat sessions from one participant are not independent.');
        if (source.tab === 'data-quality') {
          addModule('Q1', h.title('Q1'), tr('Только зарегистрированные в системе сессии.', 'Registered sessions only.'));
          addModule('Q5', h.title('Q5'), tr('Наличие данных не подтверждает точность измерений.', 'Availability does not establish measurement accuracy.'));
          addModule('Q2', h.title('Q2'));
        } else if (source.tab === 'connectedness') {
          addModule('S5', h.title('S5'), tr('Связь между участниками, не мгновенный физиологический ответ и не причинная связь.', 'Participant-level association, not an instantaneous physiological response or causation.'));
          body.querySelectorAll('#analyticsConnectedness svg.ab-chart').forEach(node => addFigure(node, node.getAttribute('aria-label') || tr('Связи показателей','Associations')));
        } else {
          const rawRT = body.querySelector('#analyticsRtDistribution svg.ab-chart');
          if (rawRT) addFigure(rawRT, tr('Распределение времени реакции отдельных проб', 'Trial response time distribution'), tr('Правильные ответы, прошедшие проверку качества; текущий выбранный диапазон.', 'Correct responses passing quality checks; the selected range.'));
          else addModule('R2', tr('Распределение медиан реакции сессий', 'Distribution of session response medians'), perSession, 'rt.median');
          if (source.tab === 'group-comparison') {
            addModule('S1', tr('Сравнение выбранных условий', 'Selected condition comparison'), tr('Линии соединяют наблюдения одного участника только при парном плане.', 'Lines join observations from the same participant only under a paired design.'));
            addModule('S2', tr('Разброс результатов в выбранных условиях', 'Variation within selected conditions'), tr('Полоса: средние 50% значений; линия: медиана; точки: сохранённые наблюдения.', 'Box: middle 50%; line: median; points: recorded observations.'));
            addModule('F1', tr('Распределение оценок пульса', 'Heart rate estimate distribution'), perSession, 'physiology.bpm');
            addModule('F1', tr('Распределение оценок дыхания', 'Respiration estimate distribution'), perSession, 'physiology.respiration');
            addModule('R5', h.title('R5'), tr('Точка соответствует сохранённой сессии.', 'Each point represents a retained session.'));
          } else addModule('F3', tr('Динамика выбранного канала', 'Selected channel trajectory'), tr('Один канал одной сессии. Разрывы не заполняются.', 'One channel from one session. Gaps are not filled.'));
          addModule('G1', h.title('G1'), tr('Выбранные блок и стимул. Для интерпретации важна точность калибровки.', 'Selected block and stimulus. Interpretation depends on calibration accuracy.'));
        }
      } finally { stage.remove(); }
    }
    for (const item of body.querySelectorAll('.ax-saved-chart')) {
      const svg = item.querySelector('svg');
      if (svg) addFigure(svg, item.dataset.vizCaption, text(item.querySelector('.ab-note')));
    }
    // Retain genuine spatial layers; navigation rings and silhouettes never enter a PDF.
    const stages = [...new Set([...body.querySelectorAll('.analytics-heatmap-canvas')].map(node => node.parentElement))];
    for (const stage of stages.slice(0, 4)) {
      const rect = stage.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;
      try {
        const layers = [...stage.children].filter(node => node.getBoundingClientRect().width > 0).map(node => {
          const opacity = Number(global.getComputedStyle(node).opacity);
          if (node.tagName.toLowerCase() === 'svg') return { ...svgSnapshot(node), opacity };
          let png;
          if (node.tagName.toLowerCase() === 'canvas') png = node.toDataURL('image/png');
          else if (node.matches('img, video')) {
            if (node.matches('img') ? !node.complete || !node.naturalWidth : node.readyState < 2) throw new Error('Media not ready');
            const canvas = canvasFor(stage), context = canvas.getContext('2d');
            const width = node.naturalWidth || node.videoWidth, height = node.naturalHeight || node.videoHeight;
            const scale = Math.min(rect.width / width, rect.height / height);
            context.drawImage(node, (rect.width - width * scale) / 2, (rect.height - height * scale) / 2, width * scale, height * scale);
            png = canvas.toDataURL('image/png');
          } else png = paintHtmlPlot(node);
          return { png, opacity };
        });
        const article = stage.closest('article, section');
        const stimulus = text(article?.querySelector('.ab-heatmap-heading h3')) || stage.querySelector('img')?.alt || '';
        const summary = [...(article?.querySelectorAll('.ab-heatmap-summary span') || [])].map(text).join(' · ');
        const context = [text(article?.querySelector('.ab-heatmap-heading p')), summary].filter(Boolean).join('. ');
        figures.push({ width: rect.width, height: rect.height, layers,
          caption: tr('Карта взгляда', 'Gaze map') + (stimulus ? ': ' + stimulus : ''),
          note: context + (context ? '. ' : '') + tr('Фон и слои в выбранном отображении. Пространственная точность зависит от калибровки.', 'Background and layers under the selected view. Spatial accuracy depends on calibration.') });
      } catch (_) { unavailable.push(tr('Карта взгляда: фон ещё не загружен', 'Gaze map: background not loaded')); }
    }
    if (!data) {
      for (const node of body.querySelectorAll('.ab-dashboard svg.ab-chart')) addFigure(node, node.getAttribute('aria-label') || tr('График текущего отчёта', 'Current report chart'));
    }
    const plan = data?.plan || source?.plan || {};
    const names = source?.helpers?.names;
    const name = id => names?.get(id) || tr('Не выбрано', 'Not selected');
    return { controls: selection(body), figures, metrics: metrics.slice(0, 8), statistics, scope, unavailable,
      sourceSnapshotId: source?.extendedReport?.snapshot?.id,
      sourceDatasetHash: source?.extendedReport?.snapshot?.datasetHash,
      analysisPlanKey: JSON.stringify(source?.plan || null),
      counts: data?.counts, truncated: !!data?.availability?.truncated,
      mapsLimited: stages.length > 4,
      analysisPlan: source ? [
        [tr('Показатель','Measure'), name(plan.metricId || 'rt.mean')],
        [tr('Сравнение','Design'), plan.design === 'independent' ? tr('Независимые группы','Independent groups') : tr('Те же участники','Same participants')],
        [tr('Условие A','Condition A'), name(plan.referenceId)], [tr('Условие B','Condition B'), name(plan.comparisonId)],
        [tr('Исходный блок','Baseline'), name(plan.baselineBlockId)]
      ] : [] };
  }

  async function svgPng(figure, title = '') {
    const svg = figure.node;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', figure.width);
    svg.setAttribute('height', figure.height);
    svg.querySelectorAll('script, foreignObject, image').forEach(node => node.remove());
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await decodeImage(image);
      const canvas = global.document.createElement('canvas');
      const header = title ? 76 : 0;
      canvas.width = Math.ceil(figure.width * 2);
      canvas.height = Math.ceil(figure.height * 2) + header;
      const context = canvas.getContext('2d');
      if (title) {
        context.fillStyle = figure.background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = figure.foreground;
        context.font = 'bold 26px sans-serif';
        context.fillText(title, 22, 47, canvas.width - 44);
      }
      context.drawImage(image, 0, header, canvas.width, canvas.height - header);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }

  async function chartImage(node, preview) {
    const figure = svgSnapshot(node);
    const style = global.getComputedStyle(node.closest('.ab-card, .ax-detail, .ax-explorer') || node);
    figure.background = style.backgroundColor;
    figure.foreground = style.color;
    const title = (preview ? 'PREVIEW / ' : '') + (node.getAttribute('aria-label') || 'wecog');
    const png = await svgPng(figure, title);
    return new Blob([Uint8Array.from(global.atob(png.split(',')[1]), c => c.charCodeAt(0))], { type: 'image/png' });
  }

  async function figurePng(figure) {
    if (!figure.layers) return figure.png || svgPng(figure);
    const canvas = global.document.createElement('canvas');
    canvas.width = Math.ceil(figure.width * 2); canvas.height = Math.ceil(figure.height * 2);
    const context = canvas.getContext('2d');
    context.fillStyle = '#eef2f7'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (const layer of figure.layers) {
      const image = new Image(); image.src = layer.png || await svgPng(layer); await decodeImage(image);
      context.globalAlpha = layer.opacity;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL('image/png');
  }

  async function create(report) {
    if (!global.jspdf?.jsPDF) throw new Error('PDF library unavailable');
    const capture = report.capture;
    if (capture.sourceSnapshotId && (capture.sourceSnapshotId !== report.snapshot.id || capture.sourceDatasetHash !== report.snapshot.datasetHash)) throw new Error('Selection changed; regenerate the report');
    const pdf = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.addFileToVFS('DejaVuSans.ttf', await fontData()); pdf.addFont('DejaVuSans.ttf', 'Report', 'normal'); pdf.setFont('Report');
    pdf.setProperties({ title: 'wecog - ' + report.title, subject: 'Research report / analysis snapshot', creator: 'wecog' });
    const tr = (ru, en) => report.en ? en : ru;
    const ink = [24, 55, 44], muted = [82, 103, 93], width = 174;
    let y = 30;
    const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').replace(/[\u2010-\u2015\u2212]/g, '-');
    function header() {
      pdf.setDrawColor(153, 180, 167); pdf.line(18, 16, 192, 16);
      pdf.setFontSize(10); pdf.setTextColor(...ink); pdf.text('wecog / ' + tr('Исследовательский отчёт','Research report'), 18, 11);
    }
    function newPage() {
      const size = pdf.getFontSize(), color = pdf.getTextColor();
      pdf.addPage(); header(); y = 29;
      pdf.setFontSize(size); pdf.setTextColor(color);
    }
    function room(height) { if (y + height > 276) newPage(); }
    function paragraph(text, size = 10, color = ink, gap = 3) {
      pdf.setFontSize(size); pdf.setTextColor(...color);
      const lines = pdf.splitTextToSize(clean(text), width);
      for (const line of lines) { room(size * .48); pdf.text(line, 18, y); y += size * .48; }
      y += gap;
    }
    function heading(text) { room(20); paragraph(text, 15, ink, 6); }
    function rows(items) {
      for (const [label, value] of items) {
        pdf.setFontSize(9); const values = pdf.splitTextToSize(clean(value), 112), labels = pdf.splitTextToSize(clean(label), 52);
        const height = Math.max(labels.length, values.length) * 4.5 + 5; room(height);
        pdf.setFillColor(244, 247, 241); pdf.roundedRect(18, y - 3.5, width, height, 2, 2, 'F');
        pdf.setTextColor(...muted); pdf.text(labels, 21, y + .5); pdf.setTextColor(...ink); pdf.text(values, 77, y + .5);
        y += height + 2;
      }
    }
    header(); paragraph(report.title, 23, ink, 5);
    const generated = new Date(report.generatedAt);
    paragraph(tr('Сформирован: ', 'Generated: ') + (Number.isFinite(generated.getTime()) ? generated.toLocaleString(report.en ? 'en-GB' : 'ru-RU') : ''), 9, muted, 5);
    if (report.preview || /синтетическ|synthetic/i.test(capture.scope.join(' '))) {
      pdf.setFillColor(238, 241, 228); pdf.roundedRect(18, y - 4, width, 12, 2, 2, 'F');
      paragraph(tr('СИНТЕТИЧЕСКИЕ ДАННЫЕ. Не научные результаты.', 'SYNTHETIC DATA. Not scientific results.'), 9, ink, 11);
    }
    const counts = capture.counts || report.counts || {};
    paragraph(tr('Участников: ', 'Participants: ') + (counts.participants ?? '—') + tr('    Сессий: ', '    Sessions: ') + (counts.sessions ?? '—'), 12, ink, 6);
    if (capture.scope.length) rows([[tr('Проект','Project'), capture.scope[0]], [tr('Протокол','Protocol'), capture.scope[1] || '—'], [tr('Версия','Version'), capture.scope[2] || '—']]);
    const metrics = capture.metrics;
    if (metrics.length) {
      y += 3; heading(tr('Ключевые результаты','Key results'));
      for (let i = 0; i < metrics.length; i += 2) {
        const pair = metrics.slice(i, i + 2); room(31);
        pair.forEach((item, index) => {
          const x = 18 + index * 89;
          pdf.setFillColor(...(i === 0 && index === 0 ? [226, 237, 232] : [244, 247, 245]));
          pdf.roundedRect(x, y - 3, 85, 29, 3, 3, 'F');
          pdf.setTextColor(...muted); pdf.setFontSize(8.5);
          const label = pdf.splitTextToSize(clean(item.label), 77).slice(0, 2); pdf.text(label, x + 4, y + 1);
          pdf.setTextColor(...ink); pdf.setFontSize(16);
          const value = clean(item.value + (item.unit ? ' ' + item.unit : ''));
          pdf.setFontSize(Math.min(16, 16 * 77 / Math.max(77, pdf.getTextWidth(value)))); pdf.text(value, x + 4, y + 19);
        }); y += 33;
      }
    }
    y += 2;
    paragraph(tr('Показатели исследовательские. Сохранённая запись не подтверждает точность измерений; пропуски не заменены нулями.', 'Research estimates. A stored recording does not establish measurement accuracy; missing values are not zero.'), 9, muted);
    for (const [index, figure] of capture.figures.entries()) {
      const caption = clean(figure.caption || tr('График','Chart'));
      pdf.setFontSize(13); const titleLines = pdf.splitTextToSize(caption, width);
      const height = Math.min(figure.layers ? 100 : 92, width * figure.height / figure.width);
      const noteLines = pdf.splitTextToSize(clean(figure.note), width);
      room(titleLines.length * 6 + height + noteLines.length * 4.2 + 13 + (index === 0 ? 18 : 0));
      if (index === 0) heading(tr('Графики','Charts'));
      paragraph(String(index + 1).padStart(2, '0') + ' / ' + caption, 13, ink, 4);
      try {
        const png = await figurePng(figure);
        const imageWidth = height * figure.width / figure.height;
        pdf.setFillColor(250, 252, 248); pdf.roundedRect(18, y - 1, width, height + 2, 2, 2, 'F');
        pdf.addImage(png, 'PNG', 18 + (width - imageWidth) / 2, y, imageWidth, height);
        y += height + 5;
        if (figure.note) paragraph(figure.note, 9, muted, 6);
      } catch (_) { paragraph(tr('График не удалось включить. Значения не подставлялись.', 'Figure could not be included. No values substituted.'), 9, muted); }
    }
    if (capture.statistics.length) {
      heading(tr('Статистические результаты','Statistical results'));
      const methods = { paired_t: tr('Парный t-критерий','Paired t test'), welch_t: tr('t-критерий Уэлча','Welch t test'),
        wilcoxon_signed_rank: tr('Критерий Уилкоксона','Wilcoxon signed-rank test'), mann_whitney_u: tr('Критерий Манна-Уитни','Mann-Whitney U test'),
        spearman: tr('Корреляция Спирмена','Spearman correlation'), pearson: tr('Корреляция Пирсона','Pearson correlation'),
        holm: tr('Поправка Холма','Holm correction'), bh: 'Benjamini-Hochberg', bonferroni: tr('Поправка Бонферрони','Bonferroni correction'),
        percentile_mean_difference_bootstrap: tr('Повторная выборка участников','Participant bootstrap'), icc_a1_anova: 'ICC(A,1)' };
      for (const section of capture.statistics) {
        pdf.setFontSize(9);
        const rowHeight = section.rows.reduce((sum, [label, value]) => sum
          + Math.max(pdf.splitTextToSize(clean(label), 52).length, pdf.splitTextToSize(clean(value), 112).length) * 4.5 + 7, 0);
        room(Math.min(240, rowHeight + 24)); paragraph(section.title, 12, ink, 3);
        paragraph(methods[section.method] || tr('Метод указан в полном экспорте','See full export for the method'), 8, muted, 4);
        rows(section.rows); y += 5;
      }
      paragraph(tr('Значение p само по себе не описывает величину эффекта. Интерпретируйте его вместе с разностью, доверительным интервалом и заранее выбранным планом.', 'A p value alone does not describe effect size. Interpret it with the difference, confidence interval and prespecified plan.'), 9, muted);
    }
    heading(tr('Выборка и условия расчёта','Selection and analysis settings'));
    const query = report.snapshot.queryEcho || {}, filters = query.filters || {};
    const channelNames = { task: tr('Задание','Task'), gaze: tr('Взгляд','Gaze'), physiology: tr('Пульс и дыхание','Physiology'), face: tr('Мимика','Facial activity'), audio: tr('Голос','Voice') };
    rows([
      [tr('Проверка качества','Quality filter'), filters.qcMode === 'valid_only' ? tr('Только прошедшие проверку','Passed only') : tr('По применённой выборке','As selected')],
      [tr('Каналы проверки','Quality channels'), (filters.qcChannels || []).map(id => channelNames[id] || id).join(', ') || '—'],
      [tr('Незавершённые сессии','Incomplete sessions'), filters.includeIncompleteSessions ? tr('Включены','Included') : tr('Исключены','Excluded')],
      ...capture.analysisPlan
    ]);
    if (filters.dateFrom || filters.dateTo) rows([[tr('Период','Period'), (filters.dateFrom || '—') + ' - ' + (filters.dateTo || '—')]]);
    if (capture.truncated) paragraph(tr('Достигнут лимит детализации. Часть наблюдений не включена; для подробностей уточните выборку.', 'Detail limits were reached. Some observations are omitted; narrow the selection for more detail.'), 9, muted);
    if (capture.mapsLimited) paragraph(tr('Включены первые четыре карты взгляда. Остальные доступны на сайте.', 'The first four gaze maps are included. Other maps remain available on the website.'), 9, muted);
    if (capture.unavailable.length) paragraph(tr('Нет подходящих данных или настроек: ', 'Missing suitable data or settings: ') + [...new Set(capture.unavailable)].join('; '), 9, muted);
    paragraph(tr('Сравнения учитывают участников, а не отдельные пробы. Полные данные, план и ограничения доступны в JSON. CSV содержит сводку по участникам.', 'Comparisons use participants, not individual trials. Full data, plan, and limitations are in JSON. CSV contains participant summaries.'), 9, muted);
    for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
      pdf.setPage(page); pdf.setDrawColor(220, 229, 222); pdf.line(18, 283, 192, 283);
      pdf.setFontSize(8); pdf.setTextColor(...muted); pdf.text('wecog', 18, 290);
      pdf.text(page + ' / ' + pdf.getNumberOfPages(), 192, 290, { align: 'right' });
    }
    return pdf.output('blob');
  }

  global.EmocogAnalyticsPdf = { capture, create, selection, chartImage };
})(window);
