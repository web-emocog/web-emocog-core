const elements = {
    fileInput: document.getElementById('fileInput'),
    status: document.getElementById('status'),
    summary: document.getElementById('summary'),
    heatmapStimulus: document.getElementById('heatmapStimulus'),
    heatmapBlock: document.getElementById('heatmapBlock'),
    perclosChart: document.getElementById('perclosChart'),
    globalMetricsChart: document.getElementById('globalMetricsChart'),
    attentionText: document.getElementById('attentionText'),
    timeline: document.getElementById('timeline')
};

function n(value, digits = 1) {
    if (!Number.isFinite(value)) return 'n/a';
    return Number(value).toFixed(digits);
}

function formatReasonStats(reasonMap, topN = 3) {
    if (!reasonMap || typeof reasonMap !== 'object') return 'n/a';
    const items = Object.entries(reasonMap)
        .filter(([, count]) => Number.isFinite(count) && count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
    if (items.length === 0) return 'none';
    return items.map(([reason, count]) => `${reason}:${count}`).join(', ');
}

function clearNode(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
}

function appendSummaryItem(node, label, value) {
    const item = document.createElement('div');
    item.className = 'summary-item';
    item.innerHTML = `<div class="muted">${label}</div><div><strong>${value}</strong></div>`;
    node.appendChild(item);
}

function heatColor(ratio) {
    const t = Math.max(0, Math.min(1, ratio));
    if (t < 0.5) {
        const k = t / 0.5;
        const r = Math.round(240 + (255 - 240) * k);
        const g = Math.round(245 + (173 - 245) * k);
        const b = Math.round(255 + (76 - 255) * k);
        return `rgb(${r},${g},${b})`;
    }
    const k = (t - 0.5) / 0.5;
    const r = 255;
    const g = Math.round(173 + (48 - 173) * k);
    const b = Math.round(76 + (32 - 76) * k);
    return `rgb(${r},${g},${b})`;
}

function drawHeatmap(canvas, bins) {
    if (!canvas || !Array.isArray(bins) || bins.length === 0 || !Array.isArray(bins[0])) return;

    const height = bins.length;
    const width = bins[0].length;
    const scale = 4;

    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let maxValue = 0;
    for (const row of bins) {
        for (const value of row) {
            if (value > maxValue) maxValue = value;
        }
    }

    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const value = bins[y][x] || 0;
            const ratio = maxValue > 0 ? value / maxValue : 0;
            ctx.fillStyle = heatColor(ratio);
            ctx.fillRect(x * scale, y * scale, scale, scale);
        }
    }
}

function createHeatmapCard(entry, title) {
    const card = document.createElement('div');
    card.className = 'heatmap-card';

    const meta = document.createElement('div');
    meta.innerHTML = `
        <div><strong>${title}</strong></div>
        <div class="muted">samples: ${entry.sampleCount || 0}, onScreen: ${n(entry.onScreenPct, 1)}%</div>
        <div class="muted">range: ${entry.timeRangeMs?.durationMs || 0} ms</div>
    `;

    const canvas = document.createElement('canvas');
    canvas.className = 'heatmap';
    drawHeatmap(canvas, entry.bins);

    card.appendChild(meta);
    card.appendChild(canvas);
    return card;
}

function renderHeatmaps(heatmaps) {
    clearNode(elements.heatmapStimulus);
    clearNode(elements.heatmapBlock);

    if (!heatmaps || !Array.isArray(heatmaps.perStimulus) || !Array.isArray(heatmaps.perBlock)) {
        elements.heatmapStimulus.innerHTML = '<div class="muted">Heatmaps отсутствуют в сессии</div>';
        elements.heatmapBlock.innerHTML = '';
        return;
    }

    for (const entry of heatmaps.perStimulus) {
        const title = `block=${entry.blockId ?? 'n/a'} | stimulus=${entry.stimulusId ?? 'n/a'}`;
        elements.heatmapStimulus.appendChild(createHeatmapCard(entry, title));
    }

    for (const entry of heatmaps.perBlock) {
        const title = `block=${entry.blockId ?? 'n/a'}`;
        elements.heatmapBlock.appendChild(createHeatmapCard(entry, title));
    }
}

function drawLineChart(canvas, series, maxY = 100) {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 28;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding + ((height - 2 * padding) * i) / 5;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }

    const maxLen = Math.max(...series.map(s => s.values.length), 1);

    for (const s of series) {
        if (!Array.isArray(s.values) || s.values.length === 0) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (let i = 0; i < s.values.length; i++) {
            const v = Number.isFinite(s.values[i]) ? s.values[i] : 0;
            const x = padding + ((width - 2 * padding) * i) / Math.max(1, maxLen - 1);
            const y = height - padding - (Math.max(0, Math.min(maxY, v)) / maxY) * (height - 2 * padding);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }

        ctx.stroke();
    }

    ctx.fillStyle = '#111827';
    ctx.font = '12px sans-serif';
    ctx.fillText('0%', 4, height - padding + 4);
    ctx.fillText(`${maxY}%`, 4, padding + 4);

    let legendX = padding;
    for (const s of series) {
        ctx.fillStyle = s.color;
        ctx.fillRect(legendX, 6, 10, 10);
        ctx.fillStyle = '#111827';
        ctx.fillText(s.name, legendX + 14, 15);
        legendX += 90;
    }
}

function drawBarChart(canvas, bars) {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 30;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const maxV = Math.max(1, ...bars.map(b => Number.isFinite(b.value) ? b.value : 0));
    const barWidth = Math.max(20, (width - padding * 2) / Math.max(1, bars.length) - 10);

    for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const value = Number.isFinite(b.value) ? b.value : 0;
        const x = padding + i * (barWidth + 10);
        const barH = (value / maxV) * (height - padding * 2);
        const y = height - padding - barH;

        ctx.fillStyle = '#0f766e';
        ctx.fillRect(x, y, barWidth, barH);

        ctx.fillStyle = '#111827';
        ctx.font = '12px sans-serif';
        ctx.fillText(n(value, 2), x, y - 4);

        ctx.save();
        ctx.translate(x + barWidth / 2, height - 6);
        ctx.rotate(-0.25);
        ctx.textAlign = 'center';
        ctx.fillText(b.label, 0, 0);
        ctx.restore();
    }
}

function renderAttention(metrics) {
    clearNode(elements.attentionText);

    if (!metrics || !metrics.global) {
        elements.attentionText.innerHTML = '<div class="muted">attentionMetrics отсутствуют в сессии</div>';
        return;
    }

    const global = metrics.global;
    const focusCognitive = metrics?.focus?.cognitiveStimulus || null;
    const perclos = global?.perclos || {};
    const perclosCriteria = perclos.criteria || {};
    const focusPerclos = focusCognitive?.perclos || {};
    const p30 = global?.perclos?.windows?.['30s']?.values || [];
    const p60 = global?.perclos?.windows?.['60s']?.values || [];

    drawLineChart(elements.perclosChart, [
        { name: 'PERCLOS 30s', color: '#0284c7', values: p30.map(v => v.perclosPct) },
        { name: 'PERCLOS 60s', color: '#f97316', values: p60.map(v => v.perclosPct) }
    ], 100);

    const bars = [
        { label: 'Blink/min', value: global?.blinkDynamics?.blinkRatePerMin || 0 },
        { label: 'Sacc/min', value: global?.saccadesAndFixations?.saccadeRatePerMin || 0 },
        { label: 'Hippus std', value: global?.hippusProxy?.hippusStd || 0 },
        { label: 'PERCLOS60 max%', value: global?.perclos?.windows?.['60s']?.maxPct || 0 }
    ];
    drawBarChart(elements.globalMetricsChart, bars);

    appendSummaryItem(elements.attentionText, 'Blink count', global?.blinkDynamics?.blinkCount ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'Blink detection', global?.blinkDynamics?.blinkDetection?.mode ?? 'n/a');
    appendSummaryItem(
        elements.attentionText,
        'Blink thresholds',
        JSON.stringify({
            close: global?.blinkDynamics?.blinkDetection?.closeThresholdRel,
            open: global?.blinkDynamics?.blinkDetection?.openThresholdRel,
            confirm: global?.blinkDynamics?.blinkDetection?.minConfirmFrames
        })
    );
    appendSummaryItem(elements.attentionText, 'PERCLOS episodes', global?.perclos?.episodes?.count ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'PERCLOS episodes (/min)', n(global?.perclos?.episodes?.ratePerMin, 2));
    appendSummaryItem(elements.attentionText, 'PERCLOS criteria', JSON.stringify(perclosCriteria));
    appendSummaryItem(elements.attentionText, 'PERCLOS min deep dwell (ms)', perclosCriteria?.minDeepDwellMs ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'PERCLOS max rebounds', perclosCriteria?.maxRebounds ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'PERCLOS candidates', perclos?.candidateCount ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'PERCLOS rejected', perclos?.rejectedCount ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'PERCLOS reject reasons (top)', formatReasonStats(perclos?.rejectReasons));
    appendSummaryItem(elements.attentionText, 'Blink mean duration (ms)', n(global?.blinkDynamics?.durationMs?.mean, 1));
    appendSummaryItem(elements.attentionText, 'Fixation count', global?.saccadesAndFixations?.fixationCount ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'Fixation mean duration (ms)', n(global?.saccadesAndFixations?.fixationMeanDurationMs, 1));
    appendSummaryItem(elements.attentionText, 'Micro-shift rate (/min)', n(global?.microShiftProxy?.microShiftRatePerMin, 2));
    appendSummaryItem(elements.attentionText, 'Hippus dominant freq (Hz)', n(global?.hippusProxy?.hippusDominantFreq, 3));
    appendSummaryItem(elements.attentionText, 'Hippus quality reason', global?.hippusProxy?.qualityReason ?? 'ok');
    appendSummaryItem(elements.attentionText, 'Scope start phase', global?.meta?.scopeStartPhase ?? metrics?.scopeStartPhase ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'Scope start ms', global?.meta?.scopeStartMs ?? metrics?.scopeStartMs ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'Scope filter applied', (global?.meta?.scopeFilterApplied ?? metrics?.scopeFilterApplied) === true ? 'true' : 'false');

    appendSummaryItem(elements.attentionText, 'Focus cognitive blink count', focusCognitive?.blinkDynamics?.blinkCount ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'Focus cognitive PERCLOS episodes', focusCognitive?.perclos?.episodes?.count ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'Focus cognitive PERCLOS60 max%', n(focusCognitive?.perclos?.windows?.['60s']?.maxPct, 2));
    appendSummaryItem(elements.attentionText, 'Focus cognitive PERCLOS candidates', focusPerclos?.candidateCount ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'Focus cognitive PERCLOS rejected', focusPerclos?.rejectedCount ?? 'n/a');
    appendSummaryItem(elements.attentionText, 'Focus cognitive reject reasons', formatReasonStats(focusPerclos?.rejectReasons));
    appendSummaryItem(elements.attentionText, 'Focus cognitive hippus quality', focusCognitive?.hippusProxy?.qualityReason ?? (focusCognitive ? 'ok' : 'n/a'));
}

function renderTimeline(events) {
    clearNode(elements.timeline);

    if (!Array.isArray(events) || events.length === 0) {
        elements.timeline.innerHTML = '<div class="muted">События не найдены</div>';
        return;
    }

    const sorted = [...events].sort((a, b) => (a.tRelMs || 0) - (b.tRelMs || 0));

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    thead.innerHTML = `
        <tr>
            <th>tRel (s)</th>
            <th>type</th>
            <th>phase</th>
            <th>block/trial/stimulus</th>
            <th>details</th>
        </tr>
    `;

    for (const ev of sorted) {
        const row = document.createElement('tr');
        const details = { ...ev };
        delete details.type;
        delete details.phase;
        delete details.blockId;
        delete details.trialId;
        delete details.stimulusId;
        delete details.timestamp;
        delete details.tRelMs;

        row.innerHTML = `
            <td>${n((ev.tRelMs || 0) / 1000, 3)}</td>
            <td><span class="badge">${ev.type || 'event'}</span></td>
            <td>${ev.phase || 'n/a'}</td>
            <td>${ev.blockId || '-'} / ${ev.trialId || '-'} / ${ev.stimulusId || '-'}</td>
            <td>${JSON.stringify(details)}</td>
        `;
        tbody.appendChild(row);
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    elements.timeline.appendChild(table);
}

function renderSummary(session) {
    clearNode(elements.summary);

    appendSummaryItem(elements.summary, 'Session ID', session?.ids?.session || 'n/a');
    appendSummaryItem(elements.summary, 'Participant ID', session?.ids?.participant || 'n/a');
    appendSummaryItem(elements.summary, 'Gaze samples', session?.eyeTracking?.length || 0);
    appendSummaryItem(elements.summary, 'Eye signal samples', session?.eyeSignals?.length || 0);
    appendSummaryItem(elements.summary, 'Tracking samples', session?.trackingTest?.length || 0);
    appendSummaryItem(elements.summary, 'Cognitive results', session?.cognitiveResults?.length || 0);
    appendSummaryItem(elements.summary, 'QC overall pass', session?.qcSummary?.overallPass === true ? 'true' : 'false');
    appendSummaryItem(elements.summary, 'QC gazeValidPct', n(session?.qcSummary?.gazeValidPct, 1));
    appendSummaryItem(elements.summary, 'QC gazeOnScreenPct', n(session?.qcSummary?.gazeOnScreenPct, 1));
    appendSummaryItem(elements.summary, 'Events', session?.events?.length || 0);
}

function renderSession(session) {
    renderSummary(session);
    renderHeatmaps(session?.heatmaps);
    renderAttention(session?.attentionMetrics);
    renderTimeline(session?.events || []);
}

async function onFileSelected(file) {
    if (!file) return;

    elements.status.textContent = `Чтение ${file.name}...`;

    try {
        const text = await file.text();
        const session = JSON.parse(text);
        renderSession(session);
        elements.status.textContent = `Загружено: ${file.name}`;
    } catch (e) {
        console.error('[session-report] parse error:', e);
        elements.status.textContent = `Ошибка чтения файла: ${String(e?.message || e)}`;
    }
}

if (elements.fileInput) {
    elements.fileInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0] || null;
        onFileSelected(file);
    });
}
