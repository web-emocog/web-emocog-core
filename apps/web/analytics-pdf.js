(function (global) {
  'use strict';
  const scriptUrl = global.document.currentScript.src;
  let fontRequest;

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

  function svgSnapshot(node) {
    const copy = node.cloneNode(true);
    const targets = [copy, ...copy.querySelectorAll('*')];
    [node, ...node.querySelectorAll('*')].forEach((original, index) => {
      const style = global.getComputedStyle(original);
      for (const property of ['fill', 'stroke', 'color', 'font-size', 'font-family', 'font-weight']) targets[index].style.setProperty(property, style.getPropertyValue(property));
    });
    const rect = node.getBoundingClientRect();
    return { node: copy, width: rect.width, height: rect.height };
  }

  function selection(body) {
    return [...body.querySelectorAll('select, .analytics-layer-toggle')]
      .filter(node => !body.firstElementChild.contains(node) && node.getBoundingClientRect().width)
      .map(node => ({ control: node.id || node.dataset.layer, value: node.tagName === 'SELECT' ? node.selectedOptions[0]?.textContent : node.checked }));
  }

  function capture(body) {
    const clone = body.cloneNode(true);
    // Filters are represented by the immutable queryEcho, not live form values.
    clone.firstElementChild?.remove();
    clone.querySelectorAll('button, input, select, textarea, nav, svg, canvas, video, img, [role="status"]').forEach(node => node.remove());
    clone.querySelectorAll('table').forEach(table => {
      const text = global.document.createElement('div');
      text.textContent = [...table.rows].map(row => [...row.cells].map(cell => cell.textContent.trim()).join(' | ')).join('\n');
      text.style.whiteSpace = 'pre-wrap';
      table.replaceWith(text);
    });
    clone.removeAttribute('id');
    clone.inert = true;
    clone.style.cssText = `position:fixed;left:-100000px;top:0;width:${body.clientWidth}px;opacity:0;pointer-events:none;`;
    global.document.body.appendChild(clone);
    const text = clone.innerText;
    clone.remove();
    const stages = new Set([...body.querySelectorAll('.analytics-heatmap-canvas, .analytics-stimulus-media')].map(node => node.parentElement));
    const figures = [...stages].map(stage => {
      const rect = stage.getBoundingClientRect();
      const layers = [...stage.children].filter(node => node.getBoundingClientRect().width > 0).map(node => {
        const opacity = Number(global.getComputedStyle(node).opacity);
        if (node.tagName.toLowerCase() === 'svg') return { ...svgSnapshot(node), opacity };
        let png;
        if (node.tagName.toLowerCase() === 'canvas') png = node.toDataURL('image/png');
        else if (node.matches('img, video')) {
          if (node.matches('img') ? !node.complete || !node.naturalWidth : node.readyState < 2) throw new Error('Stimulus media is not ready; retry PDF export after loading');
          const canvas = canvasFor(stage), context = canvas.getContext('2d');
          const width = node.naturalWidth || node.videoWidth, height = node.naturalHeight || node.videoHeight;
          const scale = Math.min(rect.width / width, rect.height / height);
          context.drawImage(node, (rect.width - width * scale) / 2, (rect.height - height * scale) / 2, width * scale, height * scale);
          png = canvas.toDataURL('image/png');
        } else png = paintHtmlPlot(node);
        return { png, opacity };
      });
      return { width: rect.width, height: rect.height, layers,
        caption: stage.querySelector('img')?.alt || stage.previousElementSibling?.innerText || 'Heatmap / AOI' };
    });
    [...body.querySelectorAll('canvas, svg, div[role="img"]')].filter(node => {
      if ([...stages].some(stage => stage.contains(node))) return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= 100 && rect.height >= 50;
    }).map(node => {
      const type = node.tagName.toLowerCase();
      return { ...(type === 'svg' ? svgSnapshot(node) : {}),
        png: type === 'canvas' ? node.toDataURL('image/png') : type === 'div' ? paintHtmlPlot(node) : null,
        width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
        caption: node.closest('article')?.firstElementChild?.textContent || node.getAttribute('aria-label') || '' };
    }).forEach(figure => figures.push(figure));
    return { text, figures, controls: selection(body) };
  }

  async function svgPng(figure) {
    const svg = figure.node;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', figure.width);
    svg.setAttribute('height', figure.height);
    svg.querySelectorAll('script, foreignObject, image').forEach(node => node.remove());
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = global.document.createElement('canvas');
      canvas.width = Math.ceil(figure.width * 2);
      canvas.height = Math.ceil(figure.height * 2);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } finally { URL.revokeObjectURL(url); }
  }

  async function figurePng(figure) {
    if (!figure.layers) return figure.png || svgPng(figure);
    const canvas = global.document.createElement('canvas');
    canvas.width = Math.ceil(figure.width * 2); canvas.height = Math.ceil(figure.height * 2);
    const context = canvas.getContext('2d');
    context.fillStyle = '#eef2f7'; context.fillRect(0, 0, canvas.width, canvas.height);
    for (const layer of figure.layers) {
      const image = new Image(); image.src = layer.png || await svgPng(layer); await image.decode();
      context.globalAlpha = layer.opacity;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    return canvas.toDataURL('image/png');
  }

  async function create(report) {
    if (!global.jspdf?.jsPDF) throw new Error('PDF library unavailable');
    const pdf = new global.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.addFileToVFS('DejaVuSans.ttf', await fontData());
    pdf.addFont('DejaVuSans.ttf', 'Report', 'normal');
    pdf.setFont('Report');
    pdf.setProperties({ title: `wecog - ${report.title}`, subject: 'Current analytics report / analysis snapshot', creator: 'wecog' });
    let y = 26;
    function newPage() { pdf.addPage(); y = 20; }
    function paragraph(text, size = 10, color = [26, 45, 37]) {
      pdf.setFontSize(size);
      pdf.setTextColor(...color);
      const lines = pdf.splitTextToSize(String(text), 174);
      for (const line of lines) {
        if (y > 277) newPage();
        pdf.text(line, 18, y);
        y += size * 0.46;
      }
      y += 2;
    }
    pdf.setFillColor(17, 37, 28);
    pdf.rect(0, 0, 210, 14, 'F');
    pdf.setFontSize(11);
    pdf.setTextColor(208, 247, 59);
    pdf.text('wecog / Research report', 18, 9);
    paragraph(report.title, 19);
    paragraph(report.preview ? 'PREVIEW: fictional data / условные данные' : report.en ? 'API data. Current report and applied selection.' : 'Данные API. Текущий отчёт и применённая выборка.', 10);
    paragraph(`${report.en ? 'Generated' : 'Сформирован'}: ${report.generatedAt}`);
    paragraph(`Snapshot: ${report.snapshot.id}`, 8);
    paragraph(`Dataset: ${report.snapshot.datasetHash}`, 8);
    paragraph(`${report.en ? 'Participants / sessions' : 'Участников / сессий'}: ${report.counts.participants} / ${report.counts.sessions}`);
    paragraph(report.en ? 'Applied selection' : 'Применённая выборка', 14);
    const query = report.snapshot.queryEcho || {};
    const filters = query.filters || {};
    paragraph(`${report.en ? 'Project / protocol / version' : 'Проект / протокол / версия'}: ${query.projectId} / ${query.protocolId} / ${query.protocolVersion}`);
    paragraph(`QC: ${filters.qcMode} | ${report.en ? 'Channels' : 'Каналы'}: ${(filters.qcChannels || []).join(', ')}`);
    paragraph(`${report.en ? 'Incomplete sessions' : 'Незавершённые сессии'}: ${filters.includeIncompleteSessions ? (report.en ? 'included' : 'включены') : (report.en ? 'excluded' : 'исключены')}`);
    if (filters.dateFrom || filters.dateTo) paragraph(`${filters.dateFrom || '*'} - ${filters.dateTo || '*'}`);
    for (const key of ['sessionIds', 'participantIds', 'blockIds', 'conditionIds', 'stimulusIds', 'aoiIds']) {
      if (filters[key]?.length) paragraph(`${key}: ${filters[key].join(', ')}`, 9);
    }
    for (const control of report.capture.controls) paragraph(`${control.control}: ${control.value}`, 9);
    paragraph(report.en ? 'Report' : 'Отчёт', 14);
    for (const line of report.capture.text.split('\n').map(value => value.trim()).filter(Boolean)) paragraph(line);
    if (report.capture.figures.length) {
      if (y > 150) newPage();
      paragraph(report.en ? 'Figures' : 'Графики', 14);
    }
    for (const figure of report.capture.figures) {
      try {
        const png = await figurePng(figure);
        const height = Math.min(110, 174 * figure.height / figure.width);
        const width = height * figure.width / figure.height;
        pdf.setFontSize(11);
        const captionHeight = figure.caption ? pdf.splitTextToSize(figure.caption, 174).length * 5.1 + 2 : 0;
        if (y + height + captionHeight > 277) newPage();
        if (figure.caption) paragraph(figure.caption, 11);
        pdf.addImage(png, 'PNG', 18, y, width, height);
        y += height + 7;
      } catch (_) {
        paragraph(report.en ? 'Figure unavailable in PDF; no values substituted.' : 'График недоступен в PDF; значения не подставлялись.', 9);
      }
    }
    newPage();
    paragraph(report.en ? 'Selection provenance' : 'Параметры выборки', 14);
    paragraph(JSON.stringify(report.snapshot.queryEcho, null, 2), 8);
    if (report.snapshot.versions) paragraph(JSON.stringify(report.snapshot.versions, null, 2), 8);
    for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
      pdf.setPage(page);
      pdf.setFontSize(8);
      pdf.setTextColor(100, 110, 105);
      pdf.text(`${page} / ${pdf.getNumberOfPages()}`, 192, 290, { align: 'right' });
    }
    return pdf.output('blob');
  }
  global.EmocogAnalyticsPdf = { capture, create, selection };
})(window);
