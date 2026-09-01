// ========== DEV-ONLY SESSION CARD FIXTURE ==========
// Production analytics never reads this fixture. It is enabled explicitly with
// window.__EMOCOG_ANALYTICS_DEMO__ = true or ?analyticsDemo=1.
const ANALYTICS_DEMO_ENABLED = (typeof window !== 'undefined') && (
  window.__EMOCOG_ANALYTICS_DEMO__ === true
  || new URLSearchParams(window.location.search || '').get('analyticsDemo') === '1'
);
const SESSION_DATA = ANALYTICS_DEMO_ENABLED ? {
  session: {
    id: "S_2026_001_face_recognition",
    participant_id: "P_042",
    duration_sec: 187,
    device: "Desktop",
    browser: "Chrome 130",
    fps_mean: 59.8,
    light: "Хорошее",
    protocol: "v2.3.1"
  },
  qc: {
    score: 8.2,
    class: "VALID",
    badge: "good",
    reasons: [
      {label: "Взгляд валиден", value: "95%", severity: "ok"},
      {label: "Лицо детектировано", value: "98%", severity: "ok"},
      {label: "FPS стабилен", value: "59.8", severity: "ok"},
      {label: "Освещение", value: "хорошее", severity: "ok"}
    ]
  },
  segments: {
    full: {
      valence_mean: 5.8,
      arousal_mean: 4.2,
      emotion_joy: 0.65,
      emotion_sadness: 0.12,
      gaze_on_target: 87,
      pupil_size: 3.8,
      fixation_duration: 245,
      saccade_velocity: 182
    },
    baseline: {
      valence_mean: 5.1,
      arousal_mean: 3.8,
      emotion_joy: 0.45,
      emotion_sadness: 0.18,
      gaze_on_target: 82,
      pupil_size: 3.5,
      fixation_duration: 220,
      saccade_velocity: 165
    },
    task: {
      valence_mean: 6.2,
      arousal_mean: 4.8,
      emotion_joy: 0.78,
      emotion_sadness: 0.08,
      gaze_on_target: 91,
      pupil_size: 4.1,
      fixation_duration: 268,
      saccade_velocity: 195
    }
  },
  group: {
    full: {
      valence_mean: {mean: 5.5, sd: 0.8, p: 65},
      arousal_mean: {mean: 4.0, sd: 0.7, p: 58},
      emotion_joy: {mean: 0.60, sd: 0.15, p: 68},
      emotion_sadness: {mean: 0.15, sd: 0.08, p: 42},
      gaze_on_target: {mean: 85, sd: 8, p: 62},
      pupil_size: {mean: 3.6, sd: 0.4, p: 70},
      fixation_duration: {mean: 230, sd: 35, p: 67},
      saccade_velocity: {mean: 175, sd: 25, p: 64}
    },
    baseline: {
      valence_mean: {mean: 5.0, sd: 0.7, p: 56},
      arousal_mean: {mean: 3.5, sd: 0.6, p: 72},
      emotion_joy: {mean: 0.42, sd: 0.12, p: 60},
      emotion_sadness: {mean: 0.20, sd: 0.10, p: 45},
      gaze_on_target: {mean: 80, sd: 10, p: 58},
      pupil_size: {mean: 3.4, sd: 0.3, p: 68},
      fixation_duration: {mean: 210, sd: 30, p: 66},
      saccade_velocity: {mean: 160, sd: 20, p: 62}
    },
    task: {
      valence_mean: {mean: 5.8, sd: 0.9, p: 72},
      arousal_mean: {mean: 4.5, sd: 0.8, p: 68},
      emotion_joy: {mean: 0.72, sd: 0.18, p: 70},
      emotion_sadness: {mean: 0.10, sd: 0.06, p: 38},
      gaze_on_target: {mean: 88, sd: 9, p: 68},
      pupil_size: {mean: 3.9, sd: 0.5, p: 72},
      fixation_duration: {mean: 250, sd: 40, p: 70},
      saccade_velocity: {mean: 185, sd: 30, p: 68}
    }
  },
  blocks: [
    {name: "Block_1", duration_sec: 45, valid_pct: "97%", qc_score: 8.5, reasons: [{label:"FPS",value:"60",severity:"ok"}], tech:{fps_mean:60}, kpis:{gaze_on_target_pct:89}, validity_class:"VALID", segmentKey:"full"},
    {name: "Block_2", duration_sec: 52, valid_pct: "94%", qc_score: 8.1, reasons: [{label:"Взгляд",value:"94%",severity:"ok"}], tech:{fps_mean:59.5}, kpis:{gaze_on_target_pct:85}, validity_class:"VALID", segmentKey:"baseline"},
    {name: "Block_3", duration_sec: 48, valid_pct: "78%", qc_score: 6.8, reasons: [{label:"Лицо",value:"78%",severity:"warn"}], tech:{fps_mean:58}, kpis:{gaze_on_target_pct:78}, validity_class:"BORDERLINE", segmentKey:"task"}
  ]
} : null;
if (typeof window !== 'undefined' && ANALYTICS_DEMO_ENABLED) window.SESSION_DATA = SESSION_DATA;

const METRIC_GROUPS = [
  {key: "emotion", title: "Эмоции", sub: "Facial Expression Analysis"},
  {key: "gaze", title: "Взгляд", sub: "Eye Tracking Metrics"},
  {key: "pupil", title: "Зрачок", sub: "Pupillometry"}
];

const METRICS = [
  {key: "valence_mean", title: "valence_mean", ru: "Валентность", unit: "/10", group: "emotion", format: v=>v.toFixed(1), goodHint: "Среднее значение валентности (позитив/негатив). Выше = позитивнее."},
  {key: "arousal_mean", title: "arousal_mean", ru: "Возбуждение", unit: "/10", group: "emotion", format: v=>v.toFixed(1), goodHint: "Средний уровень эмоционального возбуждения. Выше = активнее."},
  {key: "emotion_joy", title: "emotion_joy", ru: "Радость", unit: "0–1", group: "emotion", format: v=>v.toFixed(2), goodHint: "Интенсивность выражения радости. 1 = максимум."},
  {key: "emotion_sadness", title: "emotion_sadness", ru: "Грусть", unit: "0–1", group: "emotion", format: v=>v.toFixed(2), goodHint: "Интенсивность выражения грусти. 0 = минимум."},
  {key: "gaze_on_target", title: "gaze_on_target", ru: "Взгляд на цель", unit: "%", group: "gaze", format: v=>Math.round(v), goodHint: "Процент времени с взглядом на целевой области. Выше = лучше."},
  {key: "pupil_size", title: "pupil_size", ru: "Размер зрачка", unit: "мм", group: "pupil", format: v=>v.toFixed(1), goodHint: "Средний диаметр зрачка. Связан с когнитивной нагрузкой."},
  {key: "fixation_duration", title: "fixation_duration", ru: "Длительность фиксаций", unit: "мс", group: "gaze", format: v=>Math.round(v), goodHint: "Среднее время фиксации взгляда. Дольше = глубже обработка."},
  {key: "saccade_velocity", title: "saccade_velocity", ru: "Скорость саккад", unit: "°/с", group: "gaze", format: v=>Math.round(v), goodHint: "Средняя скорость движения глаз между фиксациями."}
];

let SELECTED_METRIC = METRICS[0].key;

function computeZ(value, mean, sd){
  if(sd === 0) return 0;
  return (value - mean) / sd;
}

function safeNum(v, digits, fallback){
  if(v === null || v === undefined || !isFinite(Number(v))) return fallback || '—';
  return Number(v).toFixed(digits);
}
function safeStat(v){ return (v === null || v === undefined || !isFinite(Number(v))) ? '—' : v; }

function renderSessionCardHeader(){
  const data = SESSION_DATA;
  const qcEl = document.getElementById("qcMain");
  const qcScore = (data.qc.score !== null && data.qc.score !== undefined) ? data.qc.score : null;
  const qcClass = data.qc.class || null;
  const qcText = qcClass === "VALID"      ? t('qcOk')
    : qcClass === "BORDERLINE" ? t('qcWarn')
    : qcClass === "INVALID"    ? t('qcBad')
    : t('qcNone');

  qcEl.innerHTML = `
    <div class="qc-row">
      <span style="font-size:13px;color:var(--muted);font-weight:600;">QC Score</span>
      ${qcClass ? `<span class="badge ${data.qc.badge}">${qcClass}</span>` : `<span class="badge neutral">${t('qcNoData')}</span>`}
    </div>
    <div class="qc-score">${qcScore !== null ? qcScore : '<span style="color:var(--muted2);font-size:28px;">—</span>'}</div>
    <div class="qc-sub">${qcText}</div>
  `;
  
  const reasons = document.getElementById("reasonList");
  reasons.innerHTML = "";
  for(const r of data.qc.reasons){
    const chip = document.createElement("div");
    chip.className = "reason-chip";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = (r.severity === "ok") ? "var(--good)" : (r.severity === "warn") ? "var(--warn)" : "var(--bad)";
    chip.appendChild(dot);
    const txt = document.createElement("span");
    txt.innerHTML = `<b>${r.label}</b> ${r.value}`;
    chip.appendChild(txt);
    reasons.appendChild(chip);
  }
  if(!data.qc.reasons || data.qc.reasons.length === 0){
    reasons.innerHTML = `<div style="font-size:12px;color:var(--muted2);">${t('qcNoReasons')}</div>`;
  }

  const fps = data.session.fps_mean;
  const fpsOk = fps !== null && fps !== undefined && isFinite(fps);
  const meta = [
    [t('metaDur'),      data.session.duration_sec != null ? `${data.session.duration_sec} ${t('metaSec')}` : '—'],
    [t('metaDevice'),   data.session.device || '—'],
    [t('metaBrowser'),  data.session.browser || '—'],
    [t('metaFPS'),      fpsOk ? `${Number(fps).toFixed(1)}` : `<span style="color:var(--muted2);">${t('metaNoFPS')}</span>`],
    [t('metaLight'),    data.session.light || '—'],
    [t('metaProtocol'), data.session.protocol ? `<code>${data.session.protocol}</code>` : '—']
  ];
  const metaEl = document.getElementById("sessionMeta");
  metaEl.innerHTML = "";
  for(const [k,v] of meta){
    const kv = document.createElement("div");
    kv.className = "kv";
    kv.innerHTML = `<div class="k">${k}</div><div class="v">${v}</div>`;
    metaEl.appendChild(kv);
  }
}

function renderSessionMetrics(selectedKey){
  const seg = document.getElementById("segmentSelect").value;
  const grid = document.getElementById("metricsGrid");
  grid.innerHTML = "";
  
  const sectionEls = {};
  for(const g of METRIC_GROUPS){
    const gi = tG(g.key);
    const section = document.createElement("div");
    section.className = "section";
    section.innerHTML = `
      <div class="section-head">
        <div class="t">${gi.title}</div>
        <div class="s">${gi.sub}</div>
      </div>
      <div class="section-grid" data-group="${g.key}"></div>
    `;
    grid.appendChild(section);
    sectionEls[g.key] = section.querySelector(".section-grid");
  }
  
  METRICS.forEach(m => {
    const val = SESSION_DATA.segments[seg][m.key];
    const g = SESSION_DATA.group[seg][m.key];
    const z = computeZ(val, g.mean, g.sd);
    const p = g.p;
    const barWidth = Math.max(2, Math.min(98, p));
    
    const card = document.createElement("div");
    card.className = "dash-metric" + (m.key === selectedKey ? " active" : "");
    card.dataset.key = m.key;
    
    const mode = document.getElementById("modeSelect").value;
    const compareText = (mode === "zscore")
      ? `z = <b>${z.toFixed(2)}</b>`
      : `p = <b>${p}</b>`;
    
    const mi = tM(m.key);
    card.innerHTML = `
      <div class="name"><span class="mono">${m.title}</span> (${mi.ru || m.ru})</div>
      <div class="value">
        <div class="num">${m.format(val)}</div>
        <div class="unit">${m.unit}</div>
      </div>
      <div class="mini-row">
        <div class="mini">${t('compareLabel')} <span>${compareText}</span></div>
      </div>
      <div class="mini-row">
        <div class="bar" title="Percentile (0–100)">
          <span style="width:${barWidth}%;"></span>
        </div>
      </div>
    `;
    
    card.addEventListener("click", () => setSelectedSessionMetric(m.key));
    (sectionEls[m.group] || grid).appendChild(card);
  });
}

function drawDistribution(svgEl, percentile){
  const w = 380, h = 120;
  const pad = 16;
  const baseline = 96;
  
  const pX = pad + (w - 2*pad) * (percentile / 100);
  
  function y(x){
    const t = (x - w/2) / 90;
    const g = Math.exp(-0.5 * t * t);
    return baseline - g * 64;
  }
  
  let d = "";
  for(let x = pad; x <= w-pad; x += 2){
    const yy = y(x);
    d += (x === pad ? `M ${x} ${yy}` : ` L ${x} ${yy}`);
  }
  d += ` L ${w-pad} ${baseline} L ${pad} ${baseline} Z`;
  
  svgEl.innerHTML = `
    <defs>
      <linearGradient id="g" x1="0" x2="1">
        <stop offset="0%" stop-color="rgba(92,102,189,.25)"/>
        <stop offset="100%" stop-color="rgba(119,169,232,.35)"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${w}" height="${h}" rx="12" fill="rgba(255,255,255,.15)" stroke="rgba(92,102,189,.25)"/>
    <path d="${d}" fill="url(#g)" stroke="rgba(92,102,189,.65)" stroke-width="1.2"/>
    <line x1="${pX}" y1="${pad}" x2="${pX}" y2="${baseline}" stroke="var(--accent)" stroke-width="2.5"/>
    <circle cx="${pX}" cy="${y(pX)}" r="6" fill="var(--accent)"/>
    <text x="${pad}" y="${h-10}" fill="var(--muted)" font-size="12">0</text>
    <text x="${w-pad-16}" y="${h-10}" fill="var(--muted)" font-size="12">100</text>
    <text x="${pX+10}" y="${pad+14}" fill="var(--text)" font-size="13" font-weight="800">p${percentile}</text>
  `;
}

function setSelectedSessionMetric(key){
  SELECTED_METRIC = key;
  renderSessionMetrics(SELECTED_METRIC);
  renderSessionDetail();
}

function renderSessionDetail(){
  const seg = document.getElementById("segmentSelect").value;
  const mode = document.getElementById("modeSelect").value;
  const metric = METRICS.find(m => m.key === SELECTED_METRIC);
  
  const val = SESSION_DATA.segments[seg][metric.key];
  const g = SESSION_DATA.group[seg][metric.key];
  const z = computeZ(val, g.mean, g.sd);
  const p = g.p;
  
  const mi = tM(metric.key);
  document.getElementById("detailTitle").textContent = `${metric.title} (${mi.ru || metric.ru})`;
  document.getElementById("detailSub").textContent = mi.hint || metric.goodHint;
  document.getElementById("kpiValue").textContent = `${metric.format(val)} ${metric.unit}`;
  
  const compareLabel = document.getElementById("kpiCompareLabel");
  const compareVal = document.getElementById("kpiCompare");
  
  if(mode === "zscore"){
    compareLabel.textContent = t('kpiZscore');
    compareVal.textContent = z.toFixed(2);
  } else {
    compareLabel.textContent = t('kpiPercentile');
    compareVal.textContent = `p${p}`;
  }
  
  drawDistribution(document.getElementById("distSvg"), p);
  
  const note = document.getElementById("detailNote");
  const qcNoteText = (SESSION_DATA.qc.class === "VALID") ? t('noteQcOk')
    : (SESSION_DATA.qc.class === "BORDERLINE") ? t('noteQcWarn')
    : t('noteQcBad');
  note.innerHTML = `${t('notePrefix')} <b>${qcNoteText}</b>`;
}

function renderBlocks(){
  const tbody = document.getElementById("blocksTbody");
  if(!tbody) return;
  tbody.innerHTML = "";
  
  (SESSION_DATA.blocks || []).forEach(b => {
    const cls = (b.validity_class === "VALID") ? "v-ok" :
                (b.validity_class === "BORDERLINE") ? "v-warn" : "v-bad";
    
    const tr = document.createElement("tr");
    tr.className = "row-btn";
    tr.title = t('rowClickHint');
    tr.innerHTML = `
      <td><span class="mono">${b.name}</span></td>
      <td>${b.duration_sec}s</td>
      <td class="${cls}"><b>${b.valid_pct}</b></td>
      <td><b>${b.qc_score}</b></td>
      <td>
        <div class="mini-chips">
          ${(b.reasons || []).slice(0,3).map(r => {
            const dot = (r.severity === "ok") ? "var(--good)" :
                        (r.severity === "warn") ? "var(--warn)" : "var(--bad)";
            return `<span class="reason-chip" style="padding:5px 10px;"><span class="dot" style="background:${dot};"></span><span><b>${r.label}</b> ${r.value}</span></span>`;
          }).join("")}
        </div>
      </td>
      <td>${(b.tech?.fps_mean != null && isFinite(b.tech.fps_mean)) ? b.tech.fps_mean : '<span style="color:var(--muted2);">—</span>'}</td>
      <td>${(b.kpis?.gaze_on_target_pct != null && isFinite(b.kpis.gaze_on_target_pct)) ? b.kpis.gaze_on_target_pct + '%' : '<span style="color:var(--muted2);">—</span>'}</td>
    `;
    
    tr.addEventListener("click", () => {
      const sel = document.getElementById("segmentSelect");
      if(sel && b.segmentKey){
        sel.value = b.segmentKey;
        renderSessionMetrics(SELECTED_METRIC);
        renderSessionDetail();
      }
    });
    
    tbody.appendChild(tr);
  });
}

function wireSessionControls(){
  document.getElementById("segmentSelect").addEventListener("change", () => {
    renderSessionMetrics(SELECTED_METRIC);
    renderSessionDetail();
  });
  document.getElementById("modeSelect").addEventListener("change", () => {
    renderSessionMetrics(SELECTED_METRIC);
    renderSessionDetail();
  });
  
  document.getElementById("copyBtn").addEventListener("click", async () => {
    const payload = {
      session: SESSION_DATA.session,
      qc: SESSION_DATA.qc,
      segment: document.getElementById("segmentSelect").value,
      metrics: SESSION_DATA.segments[document.getElementById("segmentSelect").value],
      group: SESSION_DATA.group[document.getElementById("segmentSelect").value],
      blocks: SESSION_DATA.blocks
    };
    try{
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      const btn = document.getElementById("copyBtn");
      const old = btn.textContent;
      btn.textContent = t('copyDone');
      setTimeout(()=>btn.textContent = t('copyBtn'), 600);
    }catch(e){
      toast(t('copyFail'));
    }
  });
}

// function SessionsView(){
//   document.getElementById('pageTitle').textContent='Sessions';
//   setChips(['All','Recent']);
//   const root=document.createElement('div');
//   root.className='grid';
//   root.innerHTML=`
//     <div class="card" style="grid-column:span 12">
//       <h3>Sessions</h3>
//       <p>Session history and details — content placeholder.</p>
//     </div>
//     <div class="empty-state">Ready for session data</div>
//   `;
//   setInspector({type:'Session',title:'Sessions',subtitle:'История всех записанных сессий по текущему эксперименту.',status:'neutral',cta:{label:'Filter & Export…',action:"navigate('#/export')"}});
//   return root;
// }

// Session Card content builder (used by AnalyticsView tabs)
function _buildSessionCard() {
  const root = document.createElement('div');
  root.className = 'dash-container';
  root.innerHTML = `
    <!-- Left column -->
    <div style="display:flex;flex-direction:column;gap:18px;">
      <!-- QC Card -->
      <div class="card" style="padding:0;">
        <div class="dash-card-header">
          <h2>${t('qualityControlQc')}</h2>
          <div class="hint">Сессия: ${SESSION_DATA.session.id}</div>
        </div>
        <div class="qc-grid">
          <div class="qc-main" id="qcMain">
            <!-- populated by renderSessionCardHeader -->
          </div>
          <div class="session-meta" id="sessionMeta">
            <!-- populated by renderSessionCardHeader -->
          </div>
        </div>
        <div style="padding:14px 20px 18px 20px;">
          <div class="section-title" style="margin-bottom:10px;">${t('qcDetailsLabel')}</div>
          <div class="reason-list" id="reasonList">
            <!-- populated by renderSessionCardHeader -->
          </div>
        </div>
      </div>

      <!-- Metrics Card -->
      <div class="card" style="padding:0;flex:1;min-height:0;display:flex;flex-direction:column;">
        <div class="dash-card-header">
          <h2>${t('metricsSectionHeader')}</h2>
        </div>
        <div class="control-row">
          <select id="segmentSelect">
            <option value="full">${t('segFull')}</option>
            <option value="baseline">${t('segBaseline')}</option>
            <option value="task">${t('segTask')}</option>
          </select>
          <select id="modeSelect">
            <option value="percentile">${t('modePerc')}</option>
            <option value="zscore">${t('modeZ')}</option>
          </select>
          <button id="copyBtn">${t('copyBtn')}</button>
        </div>
        <div class="metrics-grid" id="metricsGrid" style="overflow-y:auto;flex:1;min-height:0;">
          <!-- populated by renderSessionMetrics -->
        </div>
      </div>

      <!-- Blocks Table -->
      <div class="card" style="padding:0;">
        <div class="dash-card-header">
          <h2>${t('blocksHeader')}</h2>
          <div class="hint">${t('blocksHint')}</div>
        </div>
        <div class="blocks-table">
          <table>
            <thead>
              <tr>
                <th>${t('colBlock')}</th>
                <th>${t('colDur')}</th>
                <th>${t('colValidPct')}</th>
                <th>${t('colQC')}</th>
                <th>${t('colReasons')}</th>
                <th>${t('colFPS')}</th>
                <th>${t('colGaze')}</th>
              </tr>
            </thead>
            <tbody id="blocksTbody">
              <!-- populated by renderBlocks -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- Future metrics placeholder blocks -->
      <div class="card" style="padding:0;border:1.5px dashed rgba(92,102,189,.22);background:rgba(255,255,255,.18);">
        <div class="dash-card-header" style="background:rgba(92,102,189,.05);">
          <div>
            <h2 style="display:flex;align-items:center;gap:8px;">
              😊 Эмоциональные метрики
              <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(245,158,11,.10);color:var(--warn);border:1px solid rgba(245,158,11,.22);">${t('soon')}</span>
            </h2>
            <div class="hint">${t('emotionalMetricsSub')}</div>
          </div>
        </div>
        <div class="body" style="padding:14px 16px;">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            ${t('emotionalMetricsList').map(n=>`
              <div style="border:1px solid var(--stroke);border-radius:12px;padding:10px 12px;background:rgba(255,255,255,.28);">
                <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${n}</div>
                <div style="font-size:18px;font-weight:800;color:var(--muted2);">—</div>
                <div style="font-size:10px;color:var(--muted2);margin-top:4px;">${t('noDataLabel')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="card" style="padding:0;border:1.5px dashed rgba(92,102,189,.22);background:rgba(255,255,255,.18);">
        <div class="dash-card-header" style="background:rgba(92,102,189,.05);">
          <div>
            <h2 style="display:flex;align-items:center;gap:8px;">
              🧠 Когнитивные метрики
              <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(245,158,11,.10);color:var(--warn);border:1px solid rgba(245,158,11,.22);">${t('soon')}</span>
            </h2>
            <div class="hint">${t('cognitiveMetricsSub')}</div>
          </div>
        </div>
        <div class="body" style="padding:14px 16px;">
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">
            ${t('cognitiveMetricsList').map(n=>`
              <div style="border:1px solid var(--stroke);border-radius:12px;padding:10px 12px;background:rgba(255,255,255,.28);">
                  <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${n}</div>
                <div style="font-size:18px;font-weight:800;color:var(--muted2);">—</div>
                <div style="font-size:10px;color:var(--muted2);margin-top:4px;">${t('noDataLabel')}</div>
                </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="card" style="padding:0;border:1.5px dashed rgba(92,102,189,.22);background:rgba(255,255,255,.18);">
        <div class="dash-card-header" style="background:rgba(92,102,189,.05);">
          <div>
            <h2 style="display:flex;align-items:center;gap:8px;">
              🔗 Прокси-метрики (комбинированные)
              <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(245,158,11,.10);color:var(--warn);border:1px solid rgba(245,158,11,.22);">${t('soon')}</span>
            </h2>
            <div class="hint">${t('proxyMetricsSub')}</div>
          </div>
        </div>
        <div class="body" style="padding:14px 16px;">
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
            ${t('proxyMetricsList').map(n=>`
              <div style="border:1px solid var(--stroke);border-radius:12px;padding:12px;background:rgba(255,255,255,.28);">
                <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">${n}</div>
                <div style="font-size:18px;font-weight:800;color:var(--muted2);">—</div>
                <div style="font-size:10px;color:var(--muted2);margin-top:4px;">${t('noDataLabel')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- Right column - Detail panel -->
    <div class="sticky-side" style="display:flex;flex-direction:column;gap:14px;">
      <div class="card" style="padding:0;">
        <div class="dash-card-header">
          <h2>Participant vs Group</h2>
          <div class="hint">${t('sideHint')}</div>
        </div>
        <div class="detail-panel">
          <div class="detail-header">
            <h3 id="detailTitle">valence_mean (Валентность)</h3>
            <div class="sub" id="detailSub">Среднее значение валентности...</div>
          </div>

          <div class="kpi-row">
            <div class="kpi-label">${t('kpiParticipant')}</div>
            <div class="kpi-value" id="kpiValue">5.8 /10</div>
          </div>

          <div class="kpi-row">
            <div class="kpi-label" id="kpiCompareLabel">${t('kpiPercentile')}</div>
            <div class="kpi-value" id="kpiCompare">p65</div>
          </div>

          <div class="dist-box">
            <svg id="distSvg" viewBox="0 0 380 120"></svg>
          </div>

          <div class="note-box" id="detailNote">
            Подсказка: <b>QC высокий — можно интерпретировать уверенно.</b>
          </div>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    renderSessionCardHeader();
    wireSessionControls();
    renderSessionMetrics(SELECTED_METRIC);
    renderSessionDetail();
    renderBlocks();
  }, 0);

  return root;
}

// SessionCardView redirected to AnalyticsView (tabs)
// function SessionCardView is defined in AnalyticsView block above

// Analytics tab definitions
const ANALYTICS_TABS = [
  { key: 'session-card', labelKey: 'analyticsSessionCard', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>` },
  { key: 'group-comparison', labelKey: 'analyticsGroupComparison', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>` },
  { key: 'data-quality', labelKey: 'analyticsDataQuality', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>` },
  { key: 'connectedness', labelKey: 'analyticsConnectedness', icon: `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>` },
];

// Cache for dash content to avoid re-initializing on tab switch
const _dashCache = {};

function AnalyticsView(sub) {
  sub = sub || 'session-card';
  document.getElementById('pageTitle').textContent = t('analyticsToolsNav');
  setChips([]);

  const analyticsCfg = typeof getExperimentAnalyticsConfig === 'function'
    ? getExperimentAnalyticsConfig(localStorage.getItem('emocog_active_experiment_id') || 'draft')
    : { tabs: { 'session-card': true, 'group-comparison': true, 'data-quality': true, 'connectedness': true } };
  const visibleTabs = ANALYTICS_TABS.filter(tab => analyticsCfg.tabs[tab.key] !== false);
  if (!visibleTabs.some(tab => tab.key === sub)) {
    sub = visibleTabs[0]?.key || 'session-card';
  }

  // Build wrapper with tab bar + content area
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;min-height:100%;margin:-20px;'; // negate view padding

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'analytics-tabs';
  tabBar.innerHTML = visibleTabs.map(tab => `
    <div class="analytics-tab ${tab.key === sub ? 'active' : ''}" data-tab="${tab.key}">
      <span class="tab-icon">${tab.icon}</span>
      ${t(tab.labelKey)}
    </div>
  `).join('');
  wrapper.appendChild(tabBar);

  // Content body
  const body = document.createElement('div');
  body.className = 'analytics-view-body';
  body.id = 'analyticsViewBody';
  wrapper.appendChild(body);

  // Tab click handler
  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.analytics-tab');
    if (!tab) return;
    const key = tab.dataset.tab;
    if (key === sub) return;
    // Update URL
    navigate('#/analytics/' + key);
  });

  // Render content
  function renderDashContent(key) {
    body.innerHTML = '';
    if (key === 'session-card') {
      const node = _buildSessionCard();
      body.appendChild(node);
    } else {
      const initFn = key === 'group-comparison' ? initGroupDashboard
                   : key === 'data-quality' ? initQCDashboard
                   : key === 'connectedness' ? initConnectednessDashboard
                   : null;
      if (initFn) {
        const root = document.createElement('div');
        root.style.cssText = 'width:100%;';
        body.appendChild(root);
        setTimeout(() => {
          try { initFn(root); }
          catch(e) {
            console.error('Dashboard init error:', e);
            const card = document.createElement('div');
            card.className = 'card';
            card.style.padding = '20px';
            const message = document.createElement('p');
            message.style.color = 'var(--bad)';
            message.textContent = 'Ошибка: ' + (e && e.message ? e.message : String(e));
            card.appendChild(message);
            root.replaceChildren(card);
          }
        }, 0);
      }
    }
  }

  renderDashContent(sub);
  return wrapper;
}

// Patch SessionCardView to work inside tabs
function SessionCardView(){
  return AnalyticsView('session-card');
}

function initGroupDashboard(root) {
  root.innerHTML = `<div class="dash-wrap"><div class="topbar">
  <div class="brand">
    <h1>Dashboard 2 — Групповой по протоколу (demo)</h1>
    <div class="sub">
      Поиграйся фильтрами — графики и A/B таблица будут пересчитываться. Метрики подписаны: <i>метрика (что значит)</i>.
    </div>
  </div>
  <div class="filters">
    <select id="protocolSelect">
      <option value="emo-cog-taskA">Протокол: emo-cog / task A</option>
      <option value="emo-cog-taskB">Протокол: emo-cog / task B</option>
    </select>
    <select id="qcFilter">
      <option value="all">QC: все</option>
      <option value="valid">QC: только VALID</option>
      <option value="valid_borderline">QC: VALID + BORDERLINE</option>
    </select>
    <select id="groupSelect">
      <option value="all">Группа: все участники</option>
      <option value="groupA">Группа: A</option>
      <option value="groupB">Группа: B</option>
    </select>
    <button id="exportBtn" type="button">Экспорт JSON</button>
  </div>
</div>

<div class="container">
  <div>
    <div class="card">
      <div class="card-header">
        <div>
          <h2>1) Фильтры и сводка</h2>
          <div class="hint">N total / valid / borderline / invalid + avg qc_score (среднее качество).</div>
        </div>
        <div class="pill">Dataset: <strong id="datasetName">—</strong></div>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="k">N total (всего сессий)</div><div class="v" id="kpiTotal">—</div></div>
        <div class="kpi"><div class="k">N valid (валидные)</div><div class="v" id="kpiValid">—</div></div>
        <div class="kpi"><div class="k">N borderline (пограничные)</div><div class="v" id="kpiBorder">—</div></div>
        <div class="kpi"><div class="k">N invalid (невалидные)</div><div class="v" id="kpiInvalid">—</div></div>
        <div class="kpi"><div class="k">avg qc_score (ср. качество)</div><div class="v" id="kpiQc">— <small>/100</small></div></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <div>
          <h2>2) Метрики по блокам протокола</h2>
          <div class="hint">Bar chart. Для видео RT/omission_rate помечены как N/A.</div>
        </div>
        <div class="pill">Блоки: <strong id="blocksCount">—</strong></div>
      </div>
      <div class="body">
        <div class="grid-2">
          <div class="chart">
            <p class="t">attention <span>(gaze_on_target_pct — % времени взгляд на задаче)</span></p>
            <p class="sub">Ищем провалы внимания по блокам.</p>
            <svg id="barAttention" viewBox="0 0 520 180" width="100%" height="180"></svg>
          </div>
          <div class="chart">
            <p class="t">arousal <span>(arousal_mean — напряжённость/возбуждение)</span></p>
            <p class="sub">Рост — сигнал нагрузки. Сравниваем с RT и omission_rate.</p>
            <svg id="barArousal" viewBox="0 0 520 180" width="100%" height="180"></svg>
          </div>
          <div class="chart">
            <p class="t">valence <span>(valence_mean — позитив/негатив)</span></p>
            <p class="sub">Ниже 0 — возможная фрустрация.</p>
            <svg id="barValence" viewBox="0 0 520 180" width="100%" height="180"></svg>
          </div>
          <div class="chart">
            <p class="t">blinks <span>(blink_rate — моргания/мин)</span></p>
            <p class="sub">Интерпретируем вместе с attention и QC.</p>
            <svg id="barBlinks" viewBox="0 0 520 180" width="100%" height="180"></svg>
          </div>
          <div class="chart">
            <p class="t">reaction time <span>(rt_mean — среднее время реакции)</span></p>
            <p class="sub">Для видео — N/A.</p>
            <svg id="barRT" viewBox="0 0 520 180" width="100%" height="180"></svg>
          </div>
          <div class="chart">
            <p class="t">errors <span>(omission_rate — пропуски ответов)</span></p>
            <p class="sub">Рост часто связан с падением внимания/ростом сложности.</p>
            <svg id="barOmissions" viewBox="0 0 520 180" width="100%" height="180"></svg>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <div>
          <h2>4) Динамика (для видео)</h2>
          <div class="hint">attention + valence по времени.</div>
        </div>
        <div class="filters" style="gap:8px">
          <select id="stimulusSelect">
            <option value="videoA">Стимул: Video A</option>
            <option value="videoB">Стимул: Video B</option>
          </select>
        </div>
      </div>
      <div class="body">
        <div class="chart">
          <p class="t">Временные кривые <span>(attention + valence)</span></p>
          <p class="sub">Позже можно добавить доверительные интервалы.</p>
          <svg id="lineTimeSeries" viewBox="0 0 1060 260" width="100%" height="260"></svg>
          <div class="small" id="peaksNote">—</div>
        </div>
      </div>
    </div>
  </div>

  <div class="card side">
    <div class="card-header">
      <div>
        <h2>3) Сравнение условий / стимулов</h2>
        <div class="hint">A/B: mean±SD, N + эффект (Cohen’s d + Δ%).</div>
      </div>
      <div class="pill">Mode: <strong>A/B</strong></div>
    </div>
    <div class="body">
      <div class="filters" style="justify-content:flex-start">
        <select id="condA">
          <option value="baseline">Условие A: Baseline</option>
          <option value="videoA">Условие A: Video A</option>
        </select>
        <select id="condB">
          <option value="stressor">Условие B: Stressor</option>
          <option value="videoB">Условие B: Video B</option>
        </select>
        <button id="recalcBtn" type="button">Пересчитать</button>
      </div>

      <div style="margin-top:12px;">
        <table>
          <thead>
            <tr><th>Метрика</th><th>A (mean±SD, N)</th><th>B (mean±SD, N)</th><th>Эффект</th></tr>
          </thead>
          <tbody id="abTable"></tbody>
        </table>
      </div>

      <div class="section">
        <p class="t">QC-статус <span>(кратко)</span></p>
        <p class="p">Качество данных по выбранному протоколу и фильтрам.</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
          <span class="tag"><span class="dot" style="background:var(--ok)"></span> valid: <b id="tagValid">—</b></span>
          <span class="tag"><span class="dot" style="background:var(--warn)"></span> borderline: <b id="tagBorder">—</b></span>
          <span class="tag"><span class="dot" style="background:var(--bad)"></span> invalid: <b id="tagInvalid">—</b></span>
          <span class="tag"><span class="dot"></span> avg qc_score: <b id="tagQc">—</b></span>
        </div>
        <p class="p" style="margin-top:10px;">Детальные QC-графики (распределение, по устройствам, техметрики) → вкладка <b>Data Quality</b>.</p>
      </div>

      <div class="section">
        <p class="t">Демо-заметка</p></p>
        <p class="p">Фильтры изменяют агрегаты искусственно (для кликабельности). В проде будет API.</p>
      </div>
    </div>
  </div>
</div></div>`;

  (function() {
    const $ = (id) => root.querySelector('#' + id);

const DATASETS = {"emo-cog-taskA": {"meta": {"dataset": "demo", "protocol": "emo-cog-taskA"}, "summary": {"total": 50, "valid": 37, "borderline": 10, "invalid": 3, "avgQc": 79}, "blocks": [{"name": "Baseline", "attention": 88, "arousal": 0.487, "valence": 0.042, "blinks": 13, "rt": 694, "omissions": 2.36}, {"name": "Task 1", "attention": 82, "arousal": 0.539, "valence": -0.094, "blinks": 18, "rt": 747, "omissions": 2.24}, {"name": "Task 2", "attention": 82, "arousal": 0.602, "valence": -0.151, "blinks": 20, "rt": 814, "omissions": 3.19}, {"name": "Stressor", "attention": 76, "arousal": 0.724, "valence": -0.162, "blinks": 22, "rt": 790, "omissions": 4.55}, {"name": "Task 3", "attention": 81, "arousal": 0.585, "valence": -0.133, "blinks": 21, "rt": 879, "omissions": 3.34}, {"name": "Video A", "attention": 85, "arousal": 0.544, "valence": -0.026, "blinks": 17, "rt": null, "omissions": null}, {"name": "Video B", "attention": 82, "arousal": 0.698, "valence": -0.165, "blinks": 21, "rt": null, "omissions": null}], "conditions": {"baseline": {"N": 55, "attention": 88, "attention_sd": 6.28, "arousal": 0.487, "arousal_sd": 0.115, "valence": 0.042, "valence_sd": 0.193, "rt": 694, "rt_sd": 102.5, "omissions": 2.36, "omissions_sd": 1.14}, "stressor": {"N": 46, "attention": 76, "attention_sd": 5.99, "arousal": 0.724, "arousal_sd": 0.121, "valence": -0.162, "valence_sd": 0.207, "rt": 790, "rt_sd": 118.6, "omissions": 4.55, "omissions_sd": 1.65}, "videoA": {"N": 51, "attention": 85, "attention_sd": 5.6, "arousal": 0.544, "arousal_sd": 0.132, "valence": -0.026, "valence_sd": 0.202, "rt": null, "rt_sd": null, "omissions": null, "omissions_sd": null}, "videoB": {"N": 49, "attention": 82, "attention_sd": 5.16, "arousal": 0.698, "arousal_sd": 0.112, "valence": -0.165, "valence_sd": 0.19, "rt": null, "rt_sd": null, "omissions": null, "omissions_sd": null}}, "timeSeries": {"videoA": {"t": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100], "attention": [81.75, 81.82, 81.35, 80.85, 80.88, 80.39, 81.76, 81.46, 82.3, 82.38, 83.61, 84.28, 85.74, 87.41, 88.5, 88.85, 89.65, 90.47, 90.52, 90.82, 90.84, 90.28, 89.2, 88.96, 88.57, 86.35, 84.52, 84.05, 82.93, 80.73, 79.91, 78.51, 78.51, 77.53, 76.79, 77.38, 76.76, 76.69, 77.06, 78.46, 77.59, 78.14, 79.36, 79.94, 79.64, 80.54, 80.54, 79.66, 80.78, 79.31, 79.49, 78.46, 77.88, 77.94, 76.95, 76.59, 76.08, 76.27, 76.45, 75.67, 76.66, 77.61, 78.83, 79.17, 81.38, 82.29, 84.52, 85.11, 86.67, 88.22, 88.52, 88.92, 90.13, 90.48, 90.75, 91.04, 90.19, 88.73, 88.89, 88.27, 86.9, 86.42, 84.71, 83.25, 83.97, 82.75, 82.44, 82.11, 82.6, 82.07, 82.69, 81.89, 82.32, 82.78, 82.84, 83.85, 83.7, 84.48, 84.12, 83.59, 82.77], "valence": [0.029, 0.012, 0.007, 0.021, 0.019, 0.01, 0.021, 0.018, 0.04, 0.038, 0.069, 0.089, 0.104, 0.119, 0.147, 0.162, 0.165, 0.161, 0.175, 0.176, 0.149, 0.139, 0.125, 0.112, 0.089, 0.054, 0.029, 0.004, -0.012, -0.03, -0.032, -0.052, -0.037, -0.043, -0.037, -0.035, -0.033, -0.021, -0.018, -0.002, 0.01, 0.014, 0.027, 0.005, 0.009, 0.016, -0.005, -0.017, -0.03, -0.051, -0.048, -0.06, -0.079, -0.08, -0.066, -0.077, -0.073, -0.049, -0.035, -0.01, 0.016, 0.044, 0.054, 0.083, 0.099, 0.13, 0.146, 0.142, 0.151, 0.16, 0.162, 0.133, 0.127, 0.129, 0.09, 0.082, 0.079, 0.055, 0.039, 0.037, 0.024, 0.038, 0.04, 0.031, 0.035, 0.053, 0.066, 0.07, 0.069, 0.07, 0.088, 0.086, 0.085, 0.072, 0.042, 0.038, 0.012, -0.021, -0.022, -0.046, -0.065]}, "videoB": {"t": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100], "attention": [78.61, 77.04, 77.84, 77.16, 76.32, 77.13, 76.5, 77.72, 78.79, 78.5, 79.49, 81.28, 83.19, 83.49, 85.11, 85.64, 87.38, 87.16, 88.59, 88.81, 87.5, 87.38, 86.47, 85.64, 84.21, 83.56, 81.83, 79.63, 78.4, 76.31, 75.05, 73.95, 74.21, 72.56, 71.55, 71.72, 72.31, 72.24, 73.35, 73.8, 74.34, 74.0, 74.45, 75.98, 76.15, 75.96, 76.2, 75.78, 76.24, 75.94, 73.95, 73.66, 72.88, 72.01, 72.76, 72.1, 70.34, 71.62, 70.63, 72.05, 72.03, 72.76, 73.6, 76.07, 75.99, 79.1, 79.55, 81.81, 83.33, 85.07, 85.32, 86.13, 87.83, 87.01, 88.43, 86.67, 87.58, 85.56, 85.19, 85.12, 83.59, 81.68, 80.33, 79.89, 79.05, 79.29, 77.71, 77.29, 78.14, 78.43, 78.75, 78.73, 78.69, 78.76, 80.37, 80.71, 80.38, 80.54, 79.61, 78.93, 79.18], "valence": [-0.069, -0.067, -0.066, -0.071, -0.088, -0.088, -0.07, -0.068, -0.048, -0.052, -0.039, -0.025, -0.007, 0.031, 0.027, 0.046, 0.056, 0.061, 0.072, 0.068, 0.05, 0.037, 0.029, 0.0, -0.021, -0.022, -0.057, -0.081, -0.084, -0.096, -0.112, -0.119, -0.131, -0.132, -0.129, -0.122, -0.116, -0.109, -0.105, -0.094, -0.09, -0.065, -0.066, -0.064, -0.065, -0.081, -0.09, -0.106, -0.119, -0.129, -0.144, -0.14, -0.155, -0.165, -0.155, -0.146, -0.136, -0.118, -0.122, -0.093, -0.083, -0.05, -0.025, -0.023, 0.007, 0.023, 0.034, 0.048, 0.05, 0.061, 0.039, 0.031, 0.034, 0.028, 0.011, -0.008, -0.026, -0.032, -0.045, -0.05, -0.068, -0.063, -0.059, -0.04, -0.057, -0.046, -0.035, -0.029, -0.024, -0.025, -0.022, -0.019, -0.019, -0.02, -0.052, -0.052, -0.07, -0.095, -0.111, -0.125, -0.149]}}, "qc": {"histBins": [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], "histCounts": [0, 0, 1, 2, 3, 5, 6, 10, 12, 11], "byDevice": [{"name": "Mobile", "validPct": 62}, {"name": "Laptop", "validPct": 82}, {"name": "Desktop", "validPct": 83}], "fpsByDevice": [{"name":"Mobile","fps":22.8},{"name":"Laptop","fps":28.6},{"name":"Desktop","fps":29.4}], "lagP95ByDevice": [{"name":"Mobile","ms":88},{"name":"Laptop","ms":42},{"name":"Desktop","ms":35}]}}, "emo-cog-taskB": {"meta": {"dataset": "demo", "protocol": "emo-cog-taskB"}, "summary": {"total": 50, "valid": 35, "borderline": 9, "invalid": 6, "avgQc": 76}, "blocks": [{"name": "Baseline", "attention": 89, "arousal": 0.482, "valence": 0.079, "blinks": 16, "rt": 718, "omissions": 2.11}, {"name": "Task 1", "attention": 86, "arousal": 0.525, "valence": -0.02, "blinks": 17, "rt": 800, "omissions": 2.94}, {"name": "Task 2", "attention": 80, "arousal": 0.569, "valence": -0.144, "blinks": 16, "rt": 828, "omissions": 4.4}, {"name": "Stressor", "attention": 75, "arousal": 0.685, "valence": -0.195, "blinks": 21, "rt": 815, "omissions": 4.65}, {"name": "Task 3", "attention": 84, "arousal": 0.633, "valence": -0.153, "blinks": 18, "rt": 882, "omissions": 3.54}, {"name": "Video A", "attention": 79, "arousal": 0.608, "valence": -0.001, "blinks": 19, "rt": null, "omissions": null}, {"name": "Video B", "attention": 77, "arousal": 0.662, "valence": -0.1, "blinks": 20, "rt": null, "omissions": null}], "conditions": {"baseline": {"N": 46, "attention": 89, "attention_sd": 6.32, "arousal": 0.482, "arousal_sd": 0.118, "valence": 0.079, "valence_sd": 0.177, "rt": 718, "rt_sd": 139.9, "omissions": 2.11, "omissions_sd": 1.7}, "stressor": {"N": 44, "attention": 75, "attention_sd": 6.42, "arousal": 0.685, "arousal_sd": 0.113, "valence": -0.195, "valence_sd": 0.174, "rt": 815, "rt_sd": 111.6, "omissions": 4.65, "omissions_sd": 1.14}, "videoA": {"N": 58, "attention": 79, "attention_sd": 5.22, "arousal": 0.608, "arousal_sd": 0.104, "valence": -0.001, "valence_sd": 0.177, "rt": null, "rt_sd": null, "omissions": null, "omissions_sd": null}, "videoB": {"N": 47, "attention": 77, "attention_sd": 6.92, "arousal": 0.662, "arousal_sd": 0.134, "valence": -0.1, "valence_sd": 0.16, "rt": null, "rt_sd": null, "omissions": null, "omissions_sd": null}}, "timeSeries": {"videoA": {"t": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100], "attention": [81.54, 81.59, 81.16, 81.31, 80.64, 80.79, 81.71, 81.31, 81.6, 82.56, 83.89, 85.35, 86.28, 86.99, 87.79, 89.58, 90.5, 90.32, 91.09, 91.77, 90.46, 90.17, 89.09, 89.01, 87.95, 86.47, 85.17, 84.38, 81.85, 81.58, 79.36, 79.51, 78.65, 77.45, 76.22, 77.39, 76.99, 77.38, 76.89, 78.04, 77.78, 79.34, 78.95, 79.28, 79.74, 79.62, 80.17, 79.69, 80.64, 79.86, 79.23, 77.75, 78.51, 77.96, 76.86, 76.55, 76.66, 75.79, 76.44, 76.44, 77.32, 77.73, 79.01, 80.05, 81.01, 82.11, 83.91, 85.38, 87.11, 87.54, 88.89, 90.13, 90.58, 90.67, 90.14, 90.38, 90.63, 88.55, 88.83, 87.12, 86.94, 86.33, 85.04, 83.81, 83.85, 82.42, 81.9, 81.96, 82.46, 82.71, 81.68, 82.17, 82.76, 83.26, 84.14, 83.77, 83.22, 83.21, 83.85, 83.8, 82.16], "valence": [0.04, 0.034, 0.005, 0.017, -0.002, 0.02, 0.004, 0.012, 0.04, 0.049, 0.057, 0.074, 0.093, 0.114, 0.149, 0.147, 0.155, 0.177, 0.16, 0.159, 0.164, 0.139, 0.117, 0.101, 0.081, 0.072, 0.039, 0.008, 0.005, -0.027, -0.029, -0.051, -0.039, -0.051, -0.057, -0.045, -0.036, -0.018, -0.018, -0.011, 0.009, 0.016, 0.026, 0.004, 0.01, -0.003, -0.003, -0.02, -0.018, -0.037, -0.063, -0.076, -0.068, -0.088, -0.077, -0.076, -0.073, -0.043, -0.026, -0.004, 0.009, 0.046, 0.059, 0.094, 0.109, 0.127, 0.129, 0.161, 0.16, 0.161, 0.149, 0.133, 0.12, 0.117, 0.107, 0.089, 0.065, 0.053, 0.039, 0.048, 0.032, 0.028, 0.027, 0.046, 0.055, 0.056, 0.054, 0.079, 0.083, 0.076, 0.082, 0.073, 0.076, 0.058, 0.06, 0.021, 0.02, -0.005, -0.037, -0.065, -0.074]}, "videoB": {"t": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100], "attention": [77.24, 77.18, 76.52, 76.9, 77.13, 77.68, 76.72, 77.16, 78.3, 78.69, 79.98, 81.39, 82.97, 84.24, 84.28, 86.35, 86.81, 88.22, 88.1, 88.6, 87.91, 87.04, 87.28, 86.11, 85.17, 83.88, 82.06, 80.68, 78.21, 76.86, 76.02, 73.64, 72.72, 72.16, 72.66, 71.41, 72.34, 72.51, 72.6, 72.47, 73.78, 74.73, 74.99, 75.57, 75.68, 76.75, 76.74, 76.1, 75.28, 75.31, 73.97, 74.07, 73.8, 72.6, 71.27, 71.3, 71.75, 70.88, 70.9, 72.0, 71.68, 73.04, 73.37, 74.52, 76.32, 78.05, 80.15, 81.93, 83.09, 83.97, 85.52, 86.42, 86.68, 87.8, 87.71, 87.63, 86.55, 86.77, 85.09, 85.04, 84.08, 81.59, 81.49, 79.52, 79.21, 78.08, 78.52, 77.48, 78.54, 77.38, 78.65, 78.89, 78.32, 78.69, 79.83, 79.52, 79.75, 80.98, 79.31, 80.23, 79.26], "valence": [-0.052, -0.075, -0.07, -0.074, -0.072, -0.074, -0.075, -0.079, -0.052, -0.05, -0.025, -0.011, 0.001, 0.029, 0.044, 0.037, 0.058, 0.058, 0.071, 0.07, 0.055, 0.045, 0.028, 0.0, -0.001, -0.032, -0.058, -0.064, -0.1, -0.104, -0.117, -0.117, -0.121, -0.133, -0.135, -0.12, -0.105, -0.094, -0.085, -0.094, -0.085, -0.072, -0.064, -0.077, -0.068, -0.089, -0.079, -0.099, -0.111, -0.121, -0.122, -0.145, -0.148, -0.149, -0.152, -0.138, -0.147, -0.138, -0.106, -0.096, -0.083, -0.044, -0.026, -0.019, 0.011, 0.019, 0.026, 0.035, 0.043, 0.05, 0.043, 0.039, 0.021, 0.02, 0.011, -0.002, -0.018, -0.026, -0.05, -0.059, -0.047, -0.064, -0.062, -0.044, -0.039, -0.041, -0.043, -0.02, -0.007, -0.015, -0.014, -0.024, -0.031, -0.03, -0.042, -0.067, -0.068, -0.085, -0.125, -0.134, -0.154]}}, "qc": {"histBins": [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], "histCounts": [0, 0, 1, 2, 3, 5, 6, 10, 12, 11], "byDevice": [{"name": "Mobile", "validPct": 63}, {"name": "Laptop", "validPct": 80}, {"name": "Desktop", "validPct": 89}], "fpsByDevice": [{"name":"Mobile","fps":23.2},{"name":"Laptop","fps":27.9},{"name":"Desktop","fps":29.6}], "lagP95ByDevice": [{"name":"Mobile","ms":92},{"name":"Laptop","ms":45},{"name":"Desktop","ms":33}]}}};
// $ scoped
function escTip(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function deepCopy(x){ return JSON.parse(JSON.stringify(x)); }

// --- UI state (demo) ---
let __selValidDevice = null;
const __selBars = {}; // key: svgId -> label

function renderSegButtons(containerId, labels, selected, onSelect){
  const el = $(containerId);
  if(!el) return;
  el.innerHTML = labels.map(lbl => {
    const isActive = (lbl === selected);
    return `<button type="button" class="seg-btn ${isActive?'active':''}" data-val="${lbl}">${lbl}</button>`;
  }).join('');
  el.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => onSelect(btn.dataset.val));
  });
}

function applyFilters(base, qcFilter, groupKey){
  const d = deepCopy(base);

  if(groupKey === "groupA") {
    d.blocks.forEach(b => {
      b.attention += 2;
      b.valence = (typeof b.valence === "number") ? b.valence + 0.03 : b.valence;
      b.omissions = (typeof b.omissions === "number") ? Math.max(0, b.omissions - 0.3) : b.omissions;
    });
    d.summary.avgQc = Math.min(95, d.summary.avgQc + 1);
  } else if(groupKey === "groupB") {
    d.blocks.forEach(b => {
      b.arousal = (typeof b.arousal === "number") ? b.arousal + 0.03 : b.arousal;
      b.attention -= 1;
      b.valence = (typeof b.valence === "number") ? b.valence - 0.03 : b.valence;
    });
    d.summary.avgQc = Math.max(55, d.summary.avgQc - 1);
  }

  if(qcFilter === "valid") {
    d.summary.total = d.summary.valid;
    d.summary.borderline = 0;
    d.summary.invalid = 0;
    d.summary.avgQc = Math.min(95, d.summary.avgQc + 6);
    d.blocks.forEach(b => { b.attention += 1; b.arousal = (typeof b.arousal==="number") ? b.arousal - 0.01 : b.arousal; });
  } else if(qcFilter === "valid_borderline") {
    d.summary.total = d.summary.valid + d.summary.borderline;
    d.summary.invalid = 0;
    d.summary.avgQc = Math.min(95, d.summary.avgQc + 3);
  }
  return d;
}

function meanStdCell(mean, sd, n, unit=""){
  if(mean === null || mean === undefined) return "—";
  const m = (typeof mean === "number") ? (unit==="%" ? mean.toFixed(0) : mean.toFixed(2)) : mean;
  const s = (sd === null || sd === undefined) ? "—" : ((typeof sd === "number") ? (unit==="%" ? sd.toFixed(0) : sd.toFixed(2)) : sd);
  return `${m}${unit} ± ${s}${unit}, N=${n}`;
}

function cohensD(m1, s1, n1, m2, s2, n2){
  if([m1,s1,n1,m2,s2,n2].some(v => v===undefined || v===null)) return null;
  const sp = Math.sqrt((((n1-1)*s1*s1)+((n2-1)*s2*s2))/Math.max(1,(n1+n2-2)));
  if(!isFinite(sp) || sp===0) return 0;
  return (m2 - m1)/sp;
}

function pctDiff(a,b){ if(a === null || b === null || a === 0) return null; return ((b-a)/Math.abs(a))*100; }

function drawBarChart(svgId, labels, values, opts={}){
  const svg = $(svgId);

  // Allow per-chart sizing via viewBox (useful when a chart needs more vertical room).
  const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
  const W = (opts.width !== undefined) ? opts.width : (vb && vb.width ? vb.width : 520);
  const H = (opts.height !== undefined) ? opts.height : (vb && vb.height ? vb.height : 180);

  const big = !!opts.big;
  const showValues = !!opts.showValues;

  const padL = (opts.padL !== undefined) ? opts.padL : (big ? 46 : 42);
  const padR = (opts.padR !== undefined) ? opts.padR : (big ? 14 : 12);
  const padT = (opts.padT !== undefined) ? opts.padT : (big ? 20 : 16);
  const padB = (opts.padB !== undefined) ? opts.padB : (big ? 44 : 30);

  const fsAxis = big ? 11 : 10;
  const fsX = big ? 12 : 10;
  const fsVal = 12;

  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const clean = values.map(v => (typeof v === "number" ? v : null));
  const vMin = (opts.min!==undefined) ? opts.min : (clean.some(v=>v!==null) ? Math.min(...clean.filter(v=>v!==null)) : 0);
  const vMax = (opts.max!==undefined) ? opts.max : (clean.some(v=>v!==null) ? Math.max(...clean.filter(v=>v!==null)) : 1);
  const min=vMin, max=(vMax===vMin)?(vMin+1):vMax;

  const n=labels.length, gap=10;
  const bw=(innerW - gap*(n-1))/n;
  function x(i){return padL + i*(bw+gap);}
  function y(v){const t=(v-min)/(max-min); return padT + (1-t)*innerH;}

  let bars="";
  for(let i=0;i<n;i++) {
    const v=clean[i];
    const xx=x(i);
    if(v===null) {
      bars += `<rect x="${xx}" y="${padT+innerH-2}" width="${bw}" height="2" rx="4" fill="rgba(156,163,175,.35)"></rect>`;
      bars += `<text x="${xx + bw/2}" y="${padT+innerH-6}" text-anchor="middle" fill="rgba(100,116,139,.80)" font-size="${fsAxis}">N/A</text>`;
    } else {
      const yy=y(v), hh=(padT+innerH)-yy;
      bars += `<rect x="${xx}" y="${yy}" width="${bw}" height="${hh}" rx="10" fill="rgba(92,102,189,.72)" stroke="rgba(119,169,232,.90)" stroke-width="1"></rect>`;

      if(showValues) {
        const vLbl = (opts.valueFmt) ? opts.valueFmt(v) : (Math.round(v*10)/10);
        const vY = Math.max(padT + 14, yy - 8);
        bars += `<text x="${xx + bw/2}" y="${vY}" text-anchor="middle" fill="rgba(15,23,42,.88)" font-size="${fsVal}" font-weight="800">${vLbl}</text>`;
      }
    }
    const lab=labels[i];
    bars += `<text x="${xx + bw/2}" y="${H-10}" text-anchor="middle" fill="rgba(100,116,139,.90)" font-size="${fsX}" ${big ? 'font-weight="700"' : ''}>${lab}</text>`;
  }

  let grid="";
  for(let t=0;t<=4;t++) {
    const vv=min + (max-min)*(t/4);
    const yy=y(vv);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="rgba(92,102,189,.20)" />`;
    const lbl = (opts.tickFmt) ? opts.tickFmt(vv) : (Math.round(vv*100)/100);
    grid += `<text x="${padL-8}" y="${yy+4}" text-anchor="end" fill="rgba(100,116,139,.80)" font-size="${fsAxis}" ${big ? 'font-weight="600"' : ''}>${lbl}</text>`;
  }

  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
    ${grid}
    ${bars}
  `;
}

function drawHistogram(svgId, counts){
  const svg = $(svgId);
  const W=520,H=170,pad=14;
  const innerW=W-2*pad, innerH=H-2*pad;
  const maxC=Math.max(...counts,1);
  const n=counts.length, gap=6;
  const bw=(innerW - gap*(n-1))/n;
  let bars="";
  for(let i=0;i<n;i++) {
    const c=counts[i];
    const h=innerH*(c/maxC);
    const x=pad + i*(bw+gap);
    const y=pad + (innerH-h);
    bars += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="8" fill="rgba(92,102,189,.62)" stroke="rgba(119,169,232,.80)" />`;
  }
  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
    ${bars}
    <text x="${pad}" y="${H-10}" fill="rgba(100,116,139,.85)" font-size="10">0</text>
    <text x="${W-pad}" y="${H-10}" text-anchor="end" fill="rgba(100,116,139,.85)" font-size="10">100</text>
  `;
}


function quantileFromHist(bins, counts, q){
  // bins: edges (len = counts+1), counts: frequencies per bin
  const total = counts.reduce((a,b)=>a+(b||0),0);
  if(total<=0) return null;
  const target = q*total;
  let cum=0;
  for(let i=0;i<counts.length;i++){
    const c = counts[i]||0;
    const prev=cum;
    cum += c;
    if(target<=cum && c>0){
      const frac = (target-prev)/c; // 0..1 inside bin
      const lo = bins[i], hi = bins[i+1];
      return lo + frac*(hi-lo);
    }
  }
  // fallback
  return bins[bins.length-1];
}

function extentFromHist(bins, counts){
  let minV=null, maxV=null;
  for(let i=0;i<counts.length;i++){
    if((counts[i]||0)>0){
      minV = bins[i];
      break;
    }
  }
  for(let i=counts.length-1;i>=0;i--){
    if((counts[i]||0)>0){
      maxV = bins[i+1];
      break;
    }
  }
  if(minV===null) minV=bins[0];
  if(maxV===null) maxV=bins[bins.length-1];
  return {minV,maxV};
}

function drawBoxPlotFromHist(svgId, bins, counts, opts={}){
  const svg = $(svgId);
  const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
  const W = (opts.width !== undefined) ? opts.width : (vb && vb.width ? vb.width : 520);
  const H = (opts.height !== undefined) ? opts.height : (vb && vb.height ? vb.height : 170);

  const padL = 34, padR = 18, padT = 20, padB = 28;
  const innerW = W - padL - padR;
  const axisY = Math.round(padT + (H-padT-padB)/2);

  const q1 = quantileFromHist(bins, counts, 0.25);
  const med = quantileFromHist(bins, counts, 0.50);
  const q3 = quantileFromHist(bins, counts, 0.75);
  const {minV, maxV} = extentFromHist(bins, counts);

  function x(v){
    const t = (v-0)/100; // qc_score 0..100
    return padL + t*innerW;
  }

  // grid/ticks
  let grid='';
  [0,25,50,75,100].forEach((tv)=>{
    const xx=x(tv);
    grid += `<line x1="${xx}" y1="${padT}" x2="${xx}" y2="${H-padB}" stroke="rgba(92,102,189,.18)" />`;
    grid += `<text x="${xx}" y="${H-10}" text-anchor="middle" fill="rgba(100,116,139,.85)" font-size="10">${tv}</text>`;
  });

  const xMin=x(minV), xMax=x(maxV), xQ1=x(q1), xMed=x(med), xQ3=x(q3);

  const boxH=26;
  const boxY=axisY - boxH/2;

  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
    ${grid}
    <line x1="${xMin}" y1="${axisY}" x2="${xMax}" y2="${axisY}" stroke="rgba(100,116,139,.65)" stroke-width="2" />
    <line x1="${xMin}" y1="${axisY-10}" x2="${xMin}" y2="${axisY+10}" stroke="rgba(100,116,139,.65)" stroke-width="2" />
    <line x1="${xMax}" y1="${axisY-10}" x2="${xMax}" y2="${axisY+10}" stroke="rgba(100,116,139,.65)" stroke-width="2" />
    <rect x="${xQ1}" y="${boxY}" width="${Math.max(2, xQ3-xQ1)}" height="${boxH}" rx="10" fill="rgba(92,102,189,.18)" stroke="rgba(119,169,232,.90)" stroke-width="1" />
    <line x1="${xMed}" y1="${boxY}" x2="${xMed}" y2="${boxY+boxH}" stroke="rgba(119,169,232,.95)" stroke-width="2.2" />
    <text x="${padL}" y="${padT-4}" fill="rgba(100,116,139,.92)" font-size="11" font-weight="800">median ${med.toFixed(0)} (IQR ${q1.toFixed(0)}–${q3.toFixed(0)})</text>
  `;
}

function drawDonutList(svgId, labels, pcts, opts={}){
  const svg = $(svgId);
  const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
  const W = (opts.width !== undefined) ? opts.width : (vb && vb.width ? vb.width : 520);
  const H = (opts.height !== undefined) ? opts.height : (vb && vb.height ? vb.height : 170);

  const n = labels.length;
  const r = 28;
  const stroke = 10;
  const cy = 78;
  const sectionW = W / n;

  function colorFor(p){
    if(p >= 80) return 'var(--ok)';
    if(p >= 60) return 'var(--warn)';
    return 'var(--bad)';
  }

  let out = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
  `;

  for(let i=0;i<n;i++){
    const cx = sectionW*(i+0.5);
    const p = Math.max(0, Math.min(100, pcts[i]||0));
    const C = 2*Math.PI*r;
    const dash = (p/100)*C;
    const col = colorFor(p);

    out += `
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(92,102,189,.22)" stroke-width="${stroke}" />
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round"
              stroke-dasharray="${dash} ${C}" transform="rotate(-90 ${cx} ${cy})" />
      <text x="${cx}" y="${cy+5}" text-anchor="middle" fill="rgba(15,23,42,.95)" font-size="16" font-weight="950">${Math.round(p)}%</text>
      <text x="${cx}" y="${cy+42}" text-anchor="middle" fill="rgba(100,116,139,.92)" font-size="11" font-weight="800">${labels[i]}</text>
    `;
  }

  svg.innerHTML = out;
}

// --- QC distribution (line/area) from histogram ---
function drawQcDistribution(svgId, bins, counts, opts={}){
  const svg = $(svgId);
  if(!svg) return;
  const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
  const W = (opts.width !== undefined) ? opts.width : (vb && vb.width ? vb.width : 520);
  const H = (opts.height !== undefined) ? opts.height : (vb && vb.height ? vb.height : 210);

  const padL=34, padR=18, padT=20, padB=34;
  const innerW=W-padL-padR, innerH=H-padT-padB;

  // bin centers
  const xs=[], ys=[];
  for(let i=0;i<counts.length;i++){
    xs.push((bins[i]+bins[i+1])/2);
    ys.push(counts[i]||0);
  }
  const maxY = Math.max(1, ...ys);

  const x = (v)=> padL + (v/100)*innerW;
  const y = (c)=> padT + (1-(c/maxY))*innerH;

  // smooth path via simple Catmull-Rom to Bezier
  function catmullRom2bezier(points){
    let d = '';
    for(let i=0;i<points.length;i++){
      const p0 = points[i-1] || points[i];
      const p1 = points[i];
      const p2 = points[i+1] || points[i];
      const p3 = points[i+2] || p2;
      if(i===0){ d += `M ${p1[0]} ${p1[1]}`; continue; }
      const c1x = p1[0] + (p2[0]-p0[0]) / 6;
      const c1y = p1[1] + (p2[1]-p0[1]) / 6;
      const c2x = p2[0] - (p3[0]-p1[0]) / 6;
      const c2y = p2[1] - (p3[1]-p1[1]) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  const pts = xs.map((v,i)=>[x(v), y(ys[i])]);
  const lineD = catmullRom2bezier(pts);
  const areaD = `${lineD} L ${x(xs[xs.length-1])} ${padT+innerH} L ${x(xs[0])} ${padT+innerH} Z`;

  // median marker for orientation
  const med = quantileFromHist(bins, counts, 0.5);
  const medX = (med===null) ? null : x(med);

  let grid='';
  [0,25,50,75,100].forEach(tv=>{
    const xx=x(tv);
    grid += `<line x1="${xx}" y1="${padT}" x2="${xx}" y2="${padT+innerH}" stroke="rgba(92,102,189,.18)" />`;
    grid += `<text x="${xx}" y="${H-12}" text-anchor="middle" fill="rgba(100,116,139,.85)" font-size="10">${tv}</text>`;
  });
  for(let k=0;k<=2;k++){
    const yy = padT + innerH*(k/2);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="rgba(92,102,189,.10)" />`;
  }

  const gradId = `qcFill_${svgId}`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(119,169,232,.30)" />
        <stop offset="100%" stop-color="rgba(96,165,250,0)" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
    ${grid}
    <path d="${areaD}" fill="url(#${gradId})" />
    <path d="${lineD}" fill="none" stroke="rgba(119,169,232,.95)" stroke-width="2.6" />
    ${medX===null ? '' : `<line x1="${medX}" y1="${padT}" x2="${medX}" y2="${padT+innerH}" stroke="rgba(251,191,36,.75)" stroke-dasharray="4 4" />`}
    ${medX===null ? '' : `<text x="${medX}" y="${padT-6}" text-anchor="middle" fill="rgba(251,191,36,.92)" font-size="11" font-weight="900">median ${Math.round(med)}</text>`}
    <text x="${padL}" y="${padT-6}" text-anchor="start" fill="rgba(100,116,139,.86)" font-size="10">частота</text>
  `;
}

function donutColor(p){
  if(p >= 80) return 'var(--ok)';
  if(p >= 60) return 'var(--warn)';
  return 'var(--bad)';
}

function drawSingleDonut(svgId, label, pct, opts={}){
  const svg = $(svgId);
  if(!svg) return;
  const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
  const W = (opts.width !== undefined) ? opts.width : (vb && vb.width ? vb.width : 240);
  const H = (opts.height !== undefined) ? opts.height : (vb && vb.height ? vb.height : 240);

  const size = Math.min(W, H);
  const cx = W/2;
  // чуть ниже центра, чтобы было место под верхнюю подпись
  const cy = H*0.56;

  const r = size*0.24;
  const stroke = Math.max(10, size*0.07);

  const p = Math.max(0, Math.min(100, pct||0));
  const C = 2*Math.PI*r;
  const dash = (p/100)*C;
  const col = donutColor(p);

  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(92,102,189,.22)" stroke-width="${stroke}" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round"
            stroke-dasharray="${dash} ${C}" transform="rotate(-90 ${cx} ${cy})" />
    <text x="${cx}" y="${cy+6}" text-anchor="middle" fill="rgba(15,23,42,.95)" font-size="22" font-weight="950">${Math.round(p)}%</text>
    <text x="${cx}" y="${cy + r + 26}" text-anchor="middle" fill="rgba(100,116,139,.92)" font-size="12" font-weight="900">${label}</text>
    <text x="${cx}" y="26" text-anchor="middle" fill="rgba(100,116,139,.85)" font-size="10">valid sessions</text>
  `;
}

function renderValidDeviceDonut(byDevice){
  const labels = byDevice.map(x=>x.name);
  if(!__selValidDevice || !labels.includes(__selValidDevice)) __selValidDevice = labels[0];
  const onPickValidDevice = (val)=>{
    __selValidDevice = val;
    // re-render buttons so active state updates
    renderSegButtons('validDeviceBtns', labels, __selValidDevice, onPickValidDevice);
    const row = byDevice.find(x=>x.name===__selValidDevice);
    drawSingleDonut('qcDeviceDonut', __selValidDevice, row ? row.validPct : 0);
  };
  renderSegButtons('validDeviceBtns', labels, __selValidDevice, onPickValidDevice);
  const row = byDevice.find(x=>x.name===__selValidDevice);
  drawSingleDonut('qcDeviceDonut', __selValidDevice, row ? row.validPct : 0);
}

// --- Small bars with focus by device (selected highlighted, others scaled down) ---
function drawFocusBars(svgId, labels, values, selectedLabel, opts={}){
  const svg = $(svgId);
  if(!svg) return;
  const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
  const W = (opts.width !== undefined) ? opts.width : (vb && vb.width ? vb.width : 520);
  const H = (opts.height !== undefined) ? opts.height : (vb && vb.height ? vb.height : 190);
  const min = (opts.min!==undefined) ? opts.min : 0;
  const max = (opts.max!==undefined) ? opts.max : Math.max(...values);
  const unit = opts.unit || '';
  const decimals = (opts.decimals!==undefined) ? opts.decimals : 0;

  const padL=22,padR=22,padT=18,padB=34;
  const innerW=W-padL-padR, innerH=H-padT-padB;
  const n=labels.length;
  const gap=12;
  const bw=Math.min(96, (innerW - gap*(n-1))/n);
  const totalW = bw*n + gap*(n-1);
  const startX = padL + (innerW-totalW)/2;
  const baseY = padT + innerH;

  const y = (v)=>{
    const t = (v-min)/(max-min || 1);
    return baseY - Math.max(0, Math.min(1,t))*innerH;
  }

  let grid='';
  [min, (min+max)/2, max].forEach(tv=>{
    const yy=y(tv);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="rgba(92,102,189,.10)" />`;
  });

  // draw non-selected first, selected last (front)
  const order = labels.filter(l=>l!==selectedLabel).concat([selectedLabel]);
  let bars='';
  for(const lbl of order){
    const i = labels.indexOf(lbl);
    const v = values[i];
    const isSel = (lbl===selectedLabel);
    const xx = startX + i*(bw+gap);
    const topY = y(v);
    const h = baseY - topY;

    const sx = isSel ? 1.00 : 0.92;
    const sy = isSel ? 1.00 : 0.78;
    const op = isSel ? 1.00 : 0.45;

    const cx = xx + bw/2;
    const tf = `translate(${cx} ${baseY}) scale(${sx} ${sy}) translate(${-cx} ${-baseY})`;
    const fill = isSel ? 'rgba(92,102,189,.78)' : 'rgba(92,102,189,.40)';
    const stroke = isSel ? 'rgba(119,169,232,.92)' : 'rgba(119,169,232,.48)';

    const valTxt = (typeof v === 'number') ? v.toFixed(decimals) : '—';
    bars += `
      <g transform="${tf}" opacity="${op}">
        <rect x="${xx}" y="${topY}" width="${bw}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" />
        <text x="${cx}" y="${topY-6}" text-anchor="middle" fill="rgba(15,23,42,.95)" font-size="${isSel?14:11}" font-weight="950">${valTxt}${unit?` ${unit}`:''}</text>
      </g>
      <text x="${cx}" y="${H-12}" text-anchor="middle" fill="rgba(100,116,139,.88)" font-size="10" font-weight="900">${lbl}</text>
    `;
  }

  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
    ${grid}
    <line x1="${padL}" y1="${baseY}" x2="${W-padR}" y2="${baseY}" stroke="rgba(92,102,189,.20)" />
    ${bars}
  `;
}

function renderSelectableBars(svgId, buttonsId, labels, values, opts={}){
  if(!__selBars[svgId] || !labels.includes(__selBars[svgId])) __selBars[svgId] = labels[0];
  const onPickBar = (val)=>{
    __selBars[svgId] = val;
    // re-render buttons so active state updates
    renderSegButtons(buttonsId, labels, __selBars[svgId], onPickBar);
    drawFocusBars(svgId, labels, values, __selBars[svgId], opts);
  };
  renderSegButtons(buttonsId, labels, __selBars[svgId], onPickBar);
  drawFocusBars(svgId, labels, values, __selBars[svgId], opts);
}

function drawDotScale(svgId, labels, values, opts={}){
  const svg = $(svgId);
  const vb = (svg.viewBox && svg.viewBox.baseVal) ? svg.viewBox.baseVal : null;
  const W = (opts.width !== undefined) ? opts.width : (vb && vb.width ? vb.width : 520);
  const H = (opts.height !== undefined) ? opts.height : (vb && vb.height ? vb.height : 240);

  const min = (opts.min!==undefined) ? opts.min : 0;
  const max = (opts.max!==undefined) ? opts.max : 1;
  const unit = opts.unit || "";
  const decimals = (opts.decimals!==undefined) ? opts.decimals : 0;
  const higherIsBetter = (opts.higherIsBetter!==undefined) ? opts.higherIsBetter : true;
  const good = (opts.good!==undefined) ? opts.good : null;
  const warn = (opts.warn!==undefined) ? opts.warn : null;

  const padL = 96, padR = 20, padT = 22, padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const n = labels.length;
  const rowGap = (n>1) ? innerH/(n-1) : 0;

  function x(v){
    const t = (v-min)/(max-min || 1);
    return padL + Math.max(0, Math.min(1, t))*innerW;
  }

  function statusColor(v){
    if(good===null || warn===null) return 'rgba(119,169,232,.95)';
    if(higherIsBetter){
      if(v >= good) return 'var(--ok)';
      if(v >= warn) return 'var(--warn)';
      return 'var(--bad)';
    } else {
      if(v <= good) return 'var(--ok)';
      if(v <= warn) return 'var(--warn)';
      return 'var(--bad)';
    }
  }

  let out = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
  `;

  // vertical grid ticks
  const ticks = (opts.ticks) ? opts.ticks : [min, (min+max)/2, max];
  ticks.forEach(tv=>{
    const xx=x(tv);
    out += `<line x1="${xx}" y1="${padT-2}" x2="${xx}" y2="${H-padB+2}" stroke="rgba(92,102,189,.18)" />`;
    const lbl = (opts.tickFmt) ? opts.tickFmt(tv) : (Math.round(tv));
    out += `<text x="${xx}" y="${padT-6}" text-anchor="middle" fill="rgba(100,116,139,.82)" font-size="10">${lbl}</text>`;
  });

  for(let i=0;i<n;i++){
    const v = values[i];
    const yy = padT + i*rowGap;
    // row separator
    if(i>0){
      out += `<line x1="${padL}" y1="${yy-rowGap/2}" x2="${W-padR}" y2="${yy-rowGap/2}" stroke="rgba(92,102,189,.10)" />`;
    }

    // label
    out += `<text x="${padL-10}" y="${yy+4}" text-anchor="end" fill="rgba(100,116,139,.92)" font-size="12" font-weight="800">${labels[i]}</text>`;

    // track
    const x0 = padL;
    const x1 = W - padR;
    out += `<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="rgba(92,102,189,.22)" stroke-width="8" stroke-linecap="round" />`;

    if(typeof v === 'number'){
      const xx = x(v);
      const col = statusColor(v);
      out += `<circle cx="${xx}" cy="${yy}" r="8" fill="${col}" stroke="rgba(15,23,42,.75)" stroke-width="2" />`;
      const txt = v.toFixed(decimals) + (unit ? ` ${unit}` : '');
      // value at the end (right aligned) to avoid overlaps
      out += `<text x="${W-padR}" y="${yy+4}" text-anchor="end" fill="rgba(15,23,42,.93)" font-size="12" font-weight="950">${txt}</text>`;
    } else {
      out += `<text x="${W-padR}" y="${yy+4}" text-anchor="end" fill="rgba(100,116,139,.82)" font-size="12" font-weight="800">—</text>`;
    }
  }

  // small legend
  if(good!==null && warn!==null){
    const legend = higherIsBetter ? `OK ≥ ${good}${unit} · WARN ≥ ${warn}${unit}` : `OK ≤ ${good}${unit} · WARN ≤ ${warn}${unit}`;
    out += `<text x="${padL}" y="${H-8}" text-anchor="start" fill="rgba(100,116,139,.78)" font-size="10">${legend}</text>`;
  }

  svg.innerHTML = out;
}

function drawBarSmall(svgId, labels, values){ drawBarChart(svgId, labels, values, {min:0,max:100,tickFmt:(v)=>Math.round(v)}); }

function drawLineChart(svgId, ts){
  const svg = $(svgId);
  const W=1060,H=260,padL=44,padR=14,padT=18,padB=32;
  const innerW=W-padL-padR, innerH=H-padT-padB;
  const t=ts.t, att=ts.attention, val=ts.valence;
  const attMin=Math.min(...att), attMax=Math.max(...att);
  const valMin=Math.min(...val), valMax=Math.max(...val);
  function x(i){ return padL + (t[i]/t[t.length-1])*innerW; }
  function yAtt(v){ const tt=(v-attMin)/(attMax-attMin||1); return padT + (1-tt)*innerH; }
  function yVal(v){ const tt=(v-valMin)/(valMax-valMin||1); return padT + (1-tt)*innerH; }
  let d1="", d2="";
  for(let i=0;i<t.length;i++) {
    d1 += (i===0?`M ${x(i)} ${yAtt(att[i])}`:` L ${x(i)} ${yAtt(att[i])}`);
    d2 += (i===0?`M ${x(i)} ${yVal(val[i])}`:` L ${x(i)} ${yVal(val[i])}`);
  }
  let grid="";
  for(let k=0;k<=4;k++) {
    const yy=padT + innerH*(k/4);
    grid += `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="rgba(92,102,189,.20)"/>`;
  }
  svg.innerHTML = `
    <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="rgba(255,255,255,.35)" stroke="rgba(92,102,189,.18)"></rect>
    ${grid}
    <path d="${d1}" fill="none" stroke="rgba(119,169,232,.95)" stroke-width="2.2"/>
    <path d="${d2}" fill="none" stroke="rgba(251,191,36,.95)" stroke-width="2.2"/>
    <text x="${padL}" y="${H-10}" fill="rgba(100,116,139,.85)" font-size="10">время (норм.)</text>
    <text x="${padL}" y="${padT-6}" fill="rgba(119,169,232,.95)" font-size="11" font-weight="800">attention (gaze_on_target_pct)</text>
    <text x="${padL+270}" y="${padT-6}" fill="rgba(251,191,36,.95)" font-size="11" font-weight="800">valence (valence_mean)</text>
  `;
}

function findPeakDrop(att){
  let maxI=0, minI=0;
  for(let i=1;i<att.length;i++){ if(att[i]>att[maxI]) maxI=i; if(att[i]<att[minI]) minI=i; }
  return {maxI,minI,maxV:att[maxI],minV:att[minI]};
}

function getCurrentData(){
  const protocol = $("protocolSelect").value;
  const qcFilter = $("qcFilter").value;
  const groupKey = $("groupSelect").value;
  return applyFilters(DATASETS[protocol], qcFilter, groupKey);
}

function renderAB(d){
  const aKey = $("condA").value, bKey = $("condB").value;
  const A = d.conditions[aKey], B = d.conditions[bKey];

  const rows = [
    { key:"attention", label:"attention (gaze_on_target_pct — % времени взгляд на задаче)", tip:"Доля времени, когда взгляд на целевой области (AOI). Чувствительно к отвлечениям и к качеству трекинга.", unit:"%", sdKey:"attention_sd" },
    { key:"arousal", label:"arousal (arousal_mean — напряжённость)", tip:"Средняя интенсивность/возбуждение. Интерпретируется в контексте стимулов; при низком QC — осторожно.", unit:"", sdKey:"arousal_sd" },
    { key:"valence", label:"valence (valence_mean — позитив/негатив)", tip:"Средняя валентность (позитив/негатив). Стабильность зависит от освещения/позы/частоты кадров.", unit:"", sdKey:"valence_sd" },
    { key:"rt", label:"rt (rt_mean — среднее время реакции)", tip:"Время реакции на стимул/задачу. Связано с нагрузкой и вниманием; проверяем вместе с пропусками/ошибками.", unit:"мс", sdKey:"rt_sd" },
    { key:"omissions", label:"omission_rate (пропуски ответов)", tip:"Доля пропусков/неответов. Рост может быть признаком отвлечения, непонимания инструкции или технических проблем.", unit:"%", sdKey:"omissions_sd" },
  ];

  const tbody = $("abTable");
  tbody.innerHTML = "";
  rows.forEach(r => {
    const a=A[r.key], b=B[r.key];
    const asd=A[r.sdKey], bsd=B[r.sdKey];
    const unit = (r.unit === "%") ? "%" : "";
    const cellA = meanStdCell(a, asd, A.N, unit);
    const cellB = meanStdCell(b, bsd, B.N, unit);

    let eff="—";
    if(a !== null && b !== null && asd !== null && bsd !== null) {
      const dEff = cohensD(a, asd, A.N, b, bsd, B.N);
      const pd = pctDiff(a, b);
      eff = `d=${(dEff>=0?"+":"")}${dEff.toFixed(2)}`;
      if(pd !== null) eff += `, Δ%=${(pd>=0?"+":"")}${pd.toFixed(1)}%`;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.label}</td><td>${cellA}</td><td>${cellB}</td><td><b>${eff}</b></td>`;
    tbody.appendChild(tr);
  });
}

function renderAll(){
  const d = getCurrentData();
  $("datasetName").textContent = d.meta.dataset;
  $("kpiTotal").textContent = d.summary.total;
  $("kpiValid").textContent = d.summary.valid;
  $("kpiBorder").textContent = d.summary.borderline;
  $("kpiInvalid").textContent = d.summary.invalid;
  $("kpiQc").innerHTML = `${d.summary.avgQc} <small>/100</small>`;

  $("tagValid").textContent = d.summary.valid;
  $("tagBorder").textContent = d.summary.borderline;
  $("tagInvalid").textContent = d.summary.invalid;
  $("tagQc").textContent = d.summary.avgQc;

  $("blocksCount").textContent = d.blocks.length;
  const labels = d.blocks.map(b => b.name.replace(" "," "));
  drawBarChart("barAttention", labels, d.blocks.map(b=>b.attention), {min:60,max:95,tickFmt:(v)=>Math.round(v)});
  drawBarChart("barArousal", labels, d.blocks.map(b=>b.arousal), {min:0.35,max:0.82,tickFmt:(v)=>v.toFixed(2)});
  drawBarChart("barValence", labels, d.blocks.map(b=>b.valence), {min:-0.4,max:0.2,tickFmt:(v)=>v.toFixed(2)});
  drawBarChart("barBlinks", labels, d.blocks.map(b=>b.blinks), {min:8,max:26,tickFmt:(v)=>Math.round(v)});
  drawBarChart("barRT", labels, d.blocks.map(b=>b.rt), {min:650,max:980,tickFmt:(v)=>Math.round(v)});
  drawBarChart("barOmissions", labels, d.blocks.map(b=>b.omissions), {min:0,max:7,tickFmt:(v)=>v.toFixed(1)});

  const stim = $("stimulusSelect").value;
  const ts = d.timeSeries[stim];
  drawLineChart("lineTimeSeries", ts);
  const peak = findPeakDrop(ts.attention);
  $("peaksNote").textContent = `Подсказка: максимум внимания на t≈${peak.maxI} (≈${peak.maxV.toFixed(1)}), минимум на t≈${peak.minI} (≈${peak.minV.toFixed(1)}).`;

  // QC distribution details → Data Quality tab

  renderAB(d);
}

["protocolSelect","qcFilter","groupSelect","stimulusSelect"].forEach(id => $(id).addEventListener("change", renderAll));
$("recalcBtn").addEventListener("click", renderAll);

$("exportBtn").addEventListener("click", () => {
  const payload = { filters: {
    protocol: $("protocolSelect").value, qc: $("qcFilter").value, group: $("groupSelect").value
  }, data: getCurrentData() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "group_dashboard_export.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

  renderAll();

  })();
}



// ─── Stable demo-data caches (generated once, reused on re-renders/lang switch) ─
let _QC_DATASETS_CACHE = null;
let _CONN_DATASETS_CACHE = null;

function initQCDashboard(root) {
  root.innerHTML = `<div class="dash-wrap"><div class="topbar">
  <div class="brand">
    <h1>Dashboard — Качество данных (QC)</h1>
    <div class="sub">
      QC — это «фильтр достоверности»: сначала качество сигнала/поведения, затем любые выводы по эмоциям/взгляду.
      На этом экране — только качество данных и тех.метрики.
    </div>
  </div>

  <div class="filters">
    <select id="orgSelect"></select>
    <select id="projectSelect"></select>
    <select id="protocolSelect"></select>
    <select id="deviceSelect"></select>
    <select id="browserSelect"></select>
    <select id="timeSelect"></select>
    <input id="dateFrom" type="date" />
    <input id="dateTo" type="date" />
    <button id="exportBtn" type="button">Экспорт JSON</button>
  </div>
</div>

<div class="container">
  <div>
    <div class="card">
      <div class="card-header">
        <div>
          <h2>1) Сводка по качеству</h2>
          <div class="hint">N total / valid / borderline / invalid + avg qc_score — с учётом фильтров.</div>
        </div>
        <div class="pill">Dataset: <strong id="datasetName">—</strong></div>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="k">N total</div><div class="v" id="kpiTotal">—</div></div>
        <div class="kpi"><div class="k">N valid</div><div class="v" id="kpiValid">—</div></div>
        <div class="kpi"><div class="k">N borderline</div><div class="v" id="kpiBorder">—</div></div>
        <div class="kpi"><div class="k">N invalid</div><div class="v" id="kpiInvalid">—</div></div>
        <div class="kpi"><div class="k">avg qc_score</div><div class="v" id="kpiQc">— <small>/100</small></div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>2) Распределение qc_score</h2>
          <div class="hint">Гистограмма + распределения по протоколам.
Как читать: каждая строка — мини‑гистограмма qc_score по протоколу (скролл вниз). Правее = лучше качество; более узко = стабильнее.</div>
        </div>
        <div class="pill">Порог (demo): <strong>valid ≥ 80</strong></div>
      </div>
      <div class="body">
        <div class="grid-2">
          <div class="chart h280">
            <p class="t">qc_score <span>(histogram)</span></p>
            <p class="sub">Смотрим «сдвиг вправо» после улучшения инструкции/сигнала.</p>
            <div class="viz noscroll-x">
            <svg id="qcHist" viewBox="0 0 520 240"></svg>
          </div>
            <div class="small" id="qcHistNote">—</div>
          </div>
          <div class="chart h280">
            <p class="t">qc_score <span>(by protocol)</span></p>
            <p class="sub">Сравнение распределений по протоколам.</p>
            <div class="viz scroll scroll-y">
            <svg id="qcByProtocol" viewBox="0 0 520 240"></svg>
          </div>
            <div class="small" id="qcProtoNote">—</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>3) Доли валидности</h2>
          <div class="hint">valid / borderline / invalid по разрезам: устройство, браузер, время суток.
Как читать: каждая строка — сегмент; цвета — доли классов; подпись справа — % valid.</div>
        </div>
        <div class="pill">Mode: <strong>stacked</strong></div>
      </div>

      <div class="body">

        <div class="seg" id="validMode">
          <button type="button" class="active" data-mode="device">by device</button>
          <button type="button" data-mode="browser">by browser</button>
          <button type="button" data-mode="time">by time-of-day</button>
        </div>

        <div class="chart h240">
          <p class="t" id="validSliceTitle">validity share <span>(by device)</span></p>
          <p class="sub" id="validSliceSub">Фокус на доле valid; тонкая полоса снизу показывает borderline/invalid.</p>
          <div class="viz noscroll-x">
            <svg id="validSlice" viewBox="0 0 520 240"></svg>
          </div>
          <div class="small" id="validSliceNote">—</div>
        </div>

        <div class="legend" aria-label="legend-validity">
          <span class="item"><span class="sw" style="background:rgba(16,185,129,.75)"></span> valid</span>
          <span class="item"><span class="sw" style="background:rgba(251,191,36,.75)"></span> borderline</span>
          <span class="item"><span class="sw" style="background:rgba(248,113,113,.75)"></span> invalid</span>
        </div>

        <div class="section">
          <p class="t">QC-разрез (кратко)</p>
          <p class="p">QC — только про качество данных: никаких «состояний как диагнозов», только нейтральные статусы.</p>
          <div class="tagrow">
            <span class="tag"><span class="dot" style="background:var(--ok)"></span> valid: <b id="tagValid">—</b></span>
            <span class="tag"><span class="dot" style="background:var(--warn)"></span> borderline: <b id="tagBorder">—</b></span>
            <span class="tag"><span class="dot" style="background:var(--bad)"></span> invalid: <b id="tagInvalid">—</b></span>
            <span class="tag"><span class="dot"></span> avg qc_score: <b id="tagQc">—</b></span>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>4) Причины брака</h2>
          <div class="hint">Топ-причины отказа/плохого QC.
Как читать: по оси Y — сегменты; внутри строки — вклад причин (доля сессий с причиной).</div>
        </div>
        <div class="pill">Top N: <strong>6</strong></div>
      </div>

      <div class="body">
        <div class="seg" id="reasonsMode">
          <button type="button" class="active" data-mode="device">by device</button>
          <button type="button" data-mode="protocol">by protocol</button>
          <button type="button" data-mode="browser">by browser</button>
        </div>

        <div class="chart h280">
          <p class="t">rejection reasons <span>(stacked)</span></p>
          <p class="sub">Сфокусируйтесь на первых 3–5 причинах — они чаще всего дают основную долю брака.</p>
          <div class="viz scroll">
          <svg id="reasonsStack" viewBox="0 0 520 260"></svg>
        </div>
          <div class="legend" aria-label="legend-reasons">
            <span class="item"><span class="sw" style="background:rgba(251,191,36,.75)"></span> плохой свет</span>
            <span class="item"><span class="sw" style="background:rgba(248,113,113,.70)"></span> потеря лица</span>
            <span class="item"><span class="sw" style="background:rgba(59,130,246,.70)"></span> поза/угол</span>
            <span class="item"><span class="sw" style="background:rgba(96,165,250,.65)"></span> низкий FPS</span>
            <span class="item"><span class="sw" style="background:rgba(167,243,208,.55)"></span> event loop lag</span>
            <span class="item"><span class="sw" style="background:rgba(156,163,175,.55)"></span> omissions</span>
            <span class="item"><span class="sw" style="background:rgba(244,114,182,.55)"></span> frame drops</span>
          </div>
          <div class="small" id="reasonsNote">—</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>5) Техническое качество веб-сигнала</h2>
          <div class="hint">Ключевые тех-факторы надёжности: effective FPS и event loop lag p95.
Как читать: сравниваем средние по устройствам; низкий FPS/высокий lag → выше риск брака.</div>
        </div>
        <div class="pill">Scope: <strong>web runtime</strong></div>
      </div>

      <div class="body">
        <div class="seg" id="techMode">
          <button type="button" class="active" data-mode="fps">effective FPS</button>
          <button type="button" data-mode="lag">event loop lag p95</button>
          <button type="button" data-mode="drops">frame drops</button>
        </div>

        <div class="chart h280">
          <p class="t" id="techTitle">effective FPS <span>(by device)</span></p>
          <p class="sub" id="techSub">Ниже 24–25 FPS часто растёт «дрожь» и выпадение лица/взгляда.</p>
          <div class="viz noscroll-x">
            <svg id="techByDevice" viewBox="0 0 520 260"></svg>
          </div>
          <div class="small" id="techNote">—</div>
        </div>

        <div class="section" style="margin-top:12px;">
          <p class="t">Комментарий</p>
          <div class="grid-2">
            <div class="callout" style="margin:0;">
              <b>Важно:</b> это не про «эмоции», а про <b>достоверность</b>.
              Если FPS/лаги плохие — QC и любые downstream‑метрики трактуем осторожно.
              Быстрые фиксы: подсказки при просадке FPS, предупредить про свет/позицию, ограничить «ночные» сессии.
            </div>
            <div class="section" style="margin:0; background:rgba(255,255,255,.25);">
              <p class="t">Как читать</p>
              <p class="p">Каждая строка — устройство. Точка показывает среднее значение метрики; цвет — условная зона риска (зелёный/жёлтый/красный).
              Пунктир — ориентир порога (например, 24.5 FPS или 85 ms lag).</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>

  <div class="card side">
    <div class="card-header">
      <div>
        <h2>Сайдбар: «где болит»</h2>
        <div class="hint">Автосписок худших сегментов по качеству + короткие рекомендации.</div>
      </div>
      <div class="pill">Action list</div>
    </div>

    <div class="body">
      <div class="section">
        <p class="t">Рекомендации (шаблон)</p>
        <p class="p" id="adviceText">—</p>
      </div>

      <div class="section">
        <p class="t">Worst slices</p>
        <p class="p">Топ-5 сегментов, где больше всего borderline/invalid.</p>
        <div style="margin-top:10px;max-height:220px;overflow-y:auto;overflow-x:auto;border-radius:10px;">
          <table>
            <thead><tr><th>Срез</th><th>valid</th><th>borderline</th><th>invalid</th><th>avg qc</th></tr></thead>
            <tbody id="worstTable"></tbody>
          </table>
        </div>
        <div class="small" style="margin-top:10px;">
          Идея: клик по строке → drill-down до примеров сессий (session_id + причины), чтобы можно было быстро дебажить.
        </div>
      </div>

      <div class="section">
        <p class="t">Примечание</p>
        <p class="p">Это демо: расчёты на клиенте для UX. В проде — API, события и персистентные QC-правила.</p>
      </div>
    </div>
  </div>
</div></div>`;

  (function() {
    const $ = (id) => root.querySelector('#' + id);

/* ------------------------- DEMO DATA ------------------------- */
if (!_QC_DATASETS_CACHE) {
  _QC_DATASETS_CACHE = {
    "HSE / Pilot 01": {
      meta: { dataset:"demo", org:"HSE", project:"Pilot 01" },
      sessions: [
        ...genSessions("emo-cog / task A", 140, {Laptop:0.55, Desktop:0.25, Mobile:0.20}, {Chrome:0.64, Safari:0.20, Edge:0.10, Firefox:0.06}),
        ...genSessions("emo-cog / task B", 110, {Laptop:0.45, Desktop:0.35, Mobile:0.20}, {Chrome:0.58, Safari:0.22, Edge:0.12, Firefox:0.08}),
        ...genSessions("video / ad A",      90, {Laptop:0.35, Desktop:0.25, Mobile:0.40}, {Chrome:0.52, Safari:0.34, Edge:0.08, Firefox:0.06})
      ]
    }
  };
}
const DATASETS = _QC_DATASETS_CACHE;

/* ------------------------- HELPERS ------------------------- */
// $ scoped
function clamp(x,a,b){return Math.max(a, Math.min(b,x));}
function fmt(n){return (Math.round(n*10)/10).toString();}
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}


function initVizContainers(){
  document.querySelectorAll('.viz').forEach(v=>{
    const svg = v.querySelector('svg');
    if(!svg) return;
    if(!svg.dataset.vb) svg.dataset.vb = svg.getAttribute('viewBox') || '';
    const minw = v.getAttribute('data-minw');
    if(minw){ svg.style.minWidth = `${parseInt(minw,10)}px`; }
  });
}

function resetViewBox(svg){
  if(!svg.dataset.vb) svg.dataset.vb = svg.getAttribute('viewBox') || '';
  if(svg.dataset.vb) svg.setAttribute('viewBox', svg.dataset.vb);
  svg.style.height = '';
}

function setViewBoxHeight(svg, newH){
  if(!svg.dataset.vb) svg.dataset.vb = svg.getAttribute('viewBox') || '';
  const parts = (svg.dataset.vb || '').trim().split(/\s+/).map(Number);
  if(parts.length !== 4 || !isFinite(parts[2])) return;
  const W = parts[2];
  svg.setAttribute('viewBox', `0 0 ${W} ${newH}`);
  svg.style.height = `${newH}px`;
}

function pickWeighted(weights){
  const entries = Object.entries(weights);
  const sum = entries.reduce((a,[,w])=>a+w,0);
  let r = Math.random()*sum;
  for(const [k,w] of entries){ r -= w; if(r<=0) return k; }
  return entries[entries.length-1][0];
}
function randomDateISO(){
  const now = new Date();
  const d = new Date(now.getTime() - Math.floor(Math.random()*60)*24*3600*1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
function genSessions(protocol, n, deviceW, browserW){
  const out = [];
  for(let i=0;i<n;i++){
    const device = pickWeighted(deviceW);
    const browser = pickWeighted(browserW);
    const hour = Math.floor(Math.random()*24);
    const date = randomDateISO();

    let fpsBase = device==="Desktop" ? 29.5 : device==="Laptop" ? 27.8 : 23.8;
    let lagBase = device==="Desktop" ? 35 : device==="Laptop" ? 48 : 95;
    let dropsBase = device==="Desktop" ? 2.2 : device==="Laptop" ? 3.6 : 6.8;

    if(browser==="Safari"){ fpsBase -= 0.8; lagBase += 10; }
    if(browser==="Firefox"){ fpsBase -= 1.1; lagBase += 6; }
    if(browser==="Edge"){ lagBase += 4; }

    const fps = clamp(fpsBase + (Math.random()*3-1.5), 14, 31);
    const lag = clamp(lagBase + (Math.random()*30-15), 12, 180);
    const drops = clamp(dropsBase + (Math.random()*3-1.5), 0.2, 14);

    const night = (hour>=20 || hour<=6);
    const risk = (device==="Mobile" ? 0.22 : device==="Laptop" ? 0.12 : 0.08) + (night ? 0.10 : 0);

    let qc = 92;
    qc -= (30 - fps) * 1.9;
    qc -= (lag/10) * 1.1;
    qc -= drops * 1.3;
    qc -= risk * 35;
    qc += (Math.random()*10-5);
    qc = clamp(qc, 5, 99);

    const qcClass = (qc >= 80) ? "VALID" : (qc >= 60) ? "BORDERLINE" : "INVALID";
    const reasons = buildReasons({device, night, fps, lag, drops, qcClass});

    out.push({
      protocol, device, browser, hour, date,
      qc_score: Math.round(qc),
      qc_class: qcClass,
      reasons,
      fps_eff: fps,
      lag_p95: Math.round(lag),
      frame_drops_pct: drops
    });
  }
  return out;
}
function buildReasons(ctx){
  const list = [];
  const add = (key,label,weight)=>list.push({key,label,weight});
  const night = ctx.night;
  const mobile = ctx.device==="Mobile";
  const lowFps = ctx.fps < 24.5;
  const highLag = ctx.lag > 85;
  const highDrops = ctx.drops > 7;

  if(night) add("low_light_time","Плохой свет", 0.9);
  if(mobile) add("pose_ok_low","Поза/угол", 0.7);
  if(lowFps) add("low_fps","Низкий FPS", 0.8);
  if(highLag) add("event_loop_lag","Большой lag", 0.7);
  if(highDrops) add("frame_drops","Frame drops", 0.6);

  if(ctx.qcClass !== "VALID"){
    add("face_lost","Потеря лица", 0.65);
    add("too_many_omissions","Omissions", 0.55);
  }
  if(list.length===0) add("none","Нет явных причин", 0.3);

  const picks = [];
  const k = (ctx.qcClass==="INVALID") ? 3 : (ctx.qcClass==="BORDERLINE") ? 2 : 1;
  for(let i=0;i<k;i++){
    const total = list.reduce((a,x)=>a+x.weight,0);
    let r = Math.random()*total;
    let chosen = list[0];
    for(const item of list){ r -= item.weight; if(r<=0){ chosen=item; break; } }
    if(!picks.find(p=>p.key===chosen.key)) picks.push(chosen);
  }
  return picks.map(p=>({key:p.key,label:p.label}));
}
function applyFilters(base, f){
  return base.filter(s=>{
    if(f.protocol!=="all" && s.protocol!==f.protocol) return false;
    if(f.device!=="all" && s.device!==f.device) return false;
    if(f.browser!=="all" && s.browser!==f.browser) return false;
    if(f.time!=="all"){
      const h = s.hour;
      if(f.time==="morning" && !(h>=6 && h<12)) return false;
      if(f.time==="day" && !(h>=12 && h<18)) return false;
      if(f.time==="evening" && !(h>=18 && h<22)) return false;
      if(f.time==="night" && !(h>=22 || h<6)) return false;
    }
    if(f.dateFrom && s.date < f.dateFrom) return false;
    if(f.dateTo && s.date > f.dateTo) return false;
    return true;
  });
}

/* ------------------------- AGGREGATIONS ------------------------- */
function summarize(sessions){
  const total = sessions.length;
  const valid = sessions.filter(s=>s.qc_class==="VALID").length;
  const border = sessions.filter(s=>s.qc_class==="BORDERLINE").length;
  const invalid = sessions.filter(s=>s.qc_class==="INVALID").length;
  const avgQc = avg(sessions,'qc_score');
  return {total, valid, border, invalid, avgQc};
}
function groupBy(arr, keyFn){
  const m = new Map();
  for(const x of arr){
    const k = keyFn(x);
    if(!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
function validityShares(arr){
  const t = arr.length || 1;
  const v = arr.filter(s=>s.qc_class==="VALID").length/t;
  const b = arr.filter(s=>s.qc_class==="BORDERLINE").length/t;
  const i = arr.filter(s=>s.qc_class==="INVALID").length/t;
  return {v,b,i};
}
function avg(arr, key){
  if(!arr.length) return null;
  const valid = arr.map(x=>x[key]).filter(v=>v !== null && v !== undefined && isFinite(Number(v)));
  if(!valid.length) return null;
  return valid.reduce((a,v)=>a+Number(v),0)/valid.length;
}
function histogram(values, bins){
  const counts = new Array(bins.length-1).fill(0);
  for(const v of values){
    for(let i=0;i<bins.length-1;i++){
      if(v>=bins[i] && v<bins[i+1]){ counts[i]++; break; }
      if(v===bins[bins.length-1]) counts[counts.length-1]++;
    }
  }
  return counts;
}

/* ------------------------- SVG DRAW ------------------------- */
function clearSvg(svg){ while(svg.firstChild) svg.removeChild(svg.firstChild); }
function axisX(svg, x0, y0, w, labels){
  const g = document.createElementNS("http://www.w3.org/2000/svg","g");
  labels.forEach((t,idx)=>{
    const x = x0 + (w/(labels.length-1))*idx;
    const tx = document.createElementNS("http://www.w3.org/2000/svg","text");
    tx.setAttribute("x", x);
    tx.setAttribute("y", y0);
    tx.setAttribute("text-anchor","middle");
    tx.setAttribute("fill","rgba(100,116,139,.90)");
    tx.setAttribute("font-size","11");
    tx.textContent = t;
    g.appendChild(tx);
  });
  svg.appendChild(g);
}
function drawHistogram(svgId, bins, counts, thresholds){
  const svg = $(svgId);
  clearSvg(svg);
  const W = svg.viewBox.baseVal.width || 520;
  const H = svg.viewBox.baseVal.height || 260;
  const pad = {l:36,r:12,t:10,b:22};
  const w = W-pad.l-pad.r;
  const h = H-pad.t-pad.b;
  const maxC = Math.max(1, ...counts);

  for(let j=0;j<=3;j++){
    const y = pad.t + h*(j/3);
    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", pad.l);
    line.setAttribute("x2", pad.l+w);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("stroke","rgba(92,102,189,.18)");
    svg.appendChild(line);
  }

  const barW = w / counts.length;
  counts.forEach((c,i)=>{
    const bh = (c/maxC)*h;
    const x = pad.l + i*barW + 2;
    const y = pad.t + (h-bh);
    const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", Math.max(1, barW-4));
    rect.setAttribute("height", bh);
    rect.setAttribute("rx", 6);
    rect.setAttribute("fill","rgba(92,102,189,.62)");
    rect.setAttribute("stroke","rgba(119,169,232,.60)");
    svg.appendChild(rect);
  });

  thresholds.forEach(t=>{
    const x = pad.l + ( (t.value - bins[0])/(bins[bins.length-1]-bins[0]) )*w;
    const ln = document.createElementNS("http://www.w3.org/2000/svg","line");
    ln.setAttribute("x1", x); ln.setAttribute("x2", x);
    ln.setAttribute("y1", pad.t); ln.setAttribute("y2", pad.t+h);
    ln.setAttribute("stroke", t.color);
    ln.setAttribute("stroke-width","2");
    ln.setAttribute("stroke-dasharray","5 5");
    svg.appendChild(ln);

    const tx = document.createElementNS("http://www.w3.org/2000/svg","text");
    tx.setAttribute("x", Math.min(x+6, W-72));
    tx.setAttribute("y", pad.t+14);
    tx.setAttribute("fill", t.color);
    tx.setAttribute("font-size","11");
    tx.setAttribute("font-weight","900");
    tx.textContent = t.label;
    svg.appendChild(tx);
  });

  axisX(svg, pad.l, H-7, w, [String(bins[0]), "50", String(bins[bins.length-1])]);
}
function drawBarWithMean(svgId, items, getVal, unit){
  const svg = $(svgId);
  clearSvg(svg);
  resetViewBox(svg);

  const vb = (svg.getAttribute('viewBox')||'0 0 520 240').trim().split(/\s+/).map(Number);
  const W = vb[2] || 520;
  const baseH = vb[3] || 240;

  const pad = {l:130,r:84,t:10,b:14};
  const rows = Math.max(1, items.length);

  // Keep rows readable; if too many, expand SVG and rely on inner scroll container.
  const minRowPx = 26;
  const neededH = pad.t + pad.b + rows*minRowPx + 16;
  const H = Math.max(baseH, Math.round(neededH));
  if(H !== baseH){ setViewBoxHeight(svg, H); }

  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;

  const raw = items.map(getVal);
  const clean = raw.filter(v=>typeof v === 'number' && isFinite(v));
  const maxV = clean.length ? Math.max(...clean) : 1;
  const minV = clean.length ? Math.min(...clean) : 0;
  const span = Math.max(1e-6, maxV - minV);

  items.forEach((it, idx)=>{
    const y = pad.t + (h/rows)*idx + 8;

    const name = document.createElementNS('http://www.w3.org/2000/svg','text');
    name.setAttribute('x', pad.l-10);
    name.setAttribute('y', y+12);
    name.setAttribute('text-anchor','end');
    name.setAttribute('fill','rgba(100,116,139,.92)');
    name.setAttribute('font-size','12');
    name.textContent = it.name;
    svg.appendChild(name);

    const v = getVal(it);
    const norm = (v - minV)/span;
    const bw = clamp(norm, 0, 1) * w;

    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', pad.l);
    rect.setAttribute('y', y);
    rect.setAttribute('width', bw);
    rect.setAttribute('height', 16);
    rect.setAttribute('rx', 8);
    rect.setAttribute('fill','rgba(92,102,189,.62)');
    rect.setAttribute('stroke','rgba(119,169,232,.60)');
    svg.appendChild(rect);

    const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
    const txX = Math.min(pad.l + bw + 6, W - 8);
    tx.setAttribute('x', txX);
    tx.setAttribute('y', y+12);
    if(txX >= W - 14) tx.setAttribute('text-anchor','end');
    tx.setAttribute('fill','rgba(15,23,42,.93)');
    tx.setAttribute('font-size','12');
    tx.setAttribute('font-weight','900');
    tx.textContent = unit ? `${fmt(v)} ${unit}` : fmt(v);
    svg.appendChild(tx);
  });
}
function drawStackedValidity(svgId, items){
  const svg = $(svgId);
  clearSvg(svg);
  resetViewBox(svg);

  const vb = (svg.getAttribute('viewBox')||'0 0 420 240').trim().split(/\s+/).map(Number);
  const W = vb[2] || 420;
  const baseH = vb[3] || 240;

  const pad = {l:96,r:76,t:10,b:14};
  const rows = Math.max(1, items.length);

  const minRowPx = 26;
  const neededH = pad.t + pad.b + rows*minRowPx + 22;
  const H = Math.max(baseH, Math.round(neededH));
  if(H !== baseH){ setViewBoxHeight(svg, H); }

  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const rowH = h/rows;

  const colors = {v:'rgba(16,185,129,.75)', b:'rgba(251,191,36,.75)', i:'rgba(248,113,113,.75)'};

  items.forEach((it, idx)=>{
    const y = pad.t + rowH*idx + (rowH>26?6:4);

    const name = document.createElementNS('http://www.w3.org/2000/svg','text');
    name.setAttribute('x', pad.l-10);
    name.setAttribute('y', y+12);
    name.setAttribute('text-anchor','end');
    name.setAttribute('fill','rgba(100,116,139,.92)');
    name.setAttribute('font-size','12');
    name.textContent = it.name;
    svg.appendChild(name);

    let x = pad.l;
    [['v',it.v],['b',it.b],['i',it.i]].forEach(([k,val])=>{
      const segW = w*val;
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', segW);
      rect.setAttribute('height', 16);
      rect.setAttribute('rx', 8);
      rect.setAttribute('fill', colors[k]);
      rect.setAttribute('stroke','rgba(15,23,42,.08)');
      svg.appendChild(rect);
      x += segW;
    });

    const pct = document.createElementNS('http://www.w3.org/2000/svg','text');
    const pctX = Math.min(pad.l + w + 6, W - 8);
    pct.setAttribute('x', pctX);
    pct.setAttribute('y', y+12);
    if(pctX >= W - 14) pct.setAttribute('text-anchor','end');
    pct.setAttribute('fill','rgba(15,23,42,.93)');
    pct.setAttribute('font-size','12');
    pct.setAttribute('font-weight','900');
    pct.textContent = `${Math.round(it.v*100)}%`;
    svg.appendChild(pct);
  });
}


function drawValidityBullet(svgId, items, opts={}){
  const svg = $(svgId);
  if(!svg) return;
  clearSvg(svg);
  resetViewBox(svg);

  const vb = (svg.getAttribute('viewBox')||'0 0 520 240').trim().split(/\s+/).map(Number);
  const W = vb[2] || 520;
  const baseH = vb[3] || 240;

  const pad = {l:160, r:84, t:18, b:18};
  const rows = Math.max(1, items.length);

  // enough height so each stacked bar is thick and readable
  const minRowPx = 38;
  const neededH = pad.t + pad.b + rows*minRowPx + 10;
  const H = Math.max(baseH, Math.round(neededH));
  if(H !== baseH){ setViewBoxHeight(svg, H); }

  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const rowH = h/rows;

  // soft vertical grid (0/25/50/75/100)
  const ticks = [0,25,50,75,100];
  ticks.forEach((t,i)=>{
    const x = pad.l + w*(t/100);
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', pad.t-6);
    line.setAttribute('x2', x);
    line.setAttribute('y2', H-pad.b+6);
    line.setAttribute('stroke', i===0||i===ticks.length-1 ? 'rgba(92,102,189,.18)' : 'rgba(92,102,189,.08)');
    svg.appendChild(line);

    if(i===0 || i===2 || i===4){
      const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
      tx.setAttribute('x', x);
      tx.setAttribute('y', H-6);
      tx.setAttribute('text-anchor','middle');
      tx.setAttribute('fill','rgba(100,116,139,.85)');
      tx.setAttribute('font-size','10');
      tx.textContent = String(t);
      svg.appendChild(tx);
    }
  });

  // thresholds (e.g. 60/80) — keep, but softer
  const thr = (opts.thresholds||[]).filter(x=>isFinite(x));
  thr.forEach(v=>{
    const x = pad.l + w*(v/100);
    const l = document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('x1', x);
    l.setAttribute('y1', pad.t-6);
    l.setAttribute('x2', x);
    l.setAttribute('y2', H-pad.b+6);
    l.setAttribute('stroke','rgba(251,191,36,.32)');
    l.setAttribute('stroke-width','1.25');
    l.setAttribute('stroke-dasharray','3 6');
    svg.appendChild(l);
  });

  const col = {v:'rgba(16,185,129,.80)', b:'rgba(251,191,36,.76)', i:'rgba(248,113,113,.72)'};

  items.forEach((it, idx)=>{
    const y0 = pad.t + rowH*idx;
    const cy = y0 + rowH/2;

    // one thicker stacked bar (no duplicate "valid" overlay)
    const barH = 18;
    const barY = cy - barH/2;

    // left label, vertically centered to the bar
    const name = document.createElementNS('http://www.w3.org/2000/svg','text');
    name.setAttribute('x', 14);
    name.setAttribute('y', cy + 4);
    name.setAttribute('text-anchor','start');
    name.setAttribute('fill','rgba(100,116,139,.92)');
    name.setAttribute('font-size','12');
    name.setAttribute('font-weight','800');
    name.textContent = it.name;
    svg.appendChild(name);

    const meta = document.createElementNS('http://www.w3.org/2000/svg','text');
    meta.setAttribute('x', 14);
    meta.setAttribute('y', cy + 18);
    meta.setAttribute('text-anchor','start');
    meta.setAttribute('fill','rgba(156,163,175,.72)');
    meta.setAttribute('font-size','10');
    meta.textContent = `n=${it.n}`;
    svg.appendChild(meta);

    // background / frame
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x', pad.l);
    bg.setAttribute('y', barY);
    bg.setAttribute('width', w);
    bg.setAttribute('height', barH);
    bg.setAttribute('rx', 10);
    bg.setAttribute('fill','rgba(255,255,255,.35)');
    bg.setAttribute('stroke','rgba(92,102,189,.14)');
    svg.appendChild(bg);

    // clip so stacked segments inherit rounded corners
    const clipId = `clip_valid_${idx}`;
    const defs = svg.querySelector('defs') || (()=>{
      const d = document.createElementNS('http://www.w3.org/2000/svg','defs');
      svg.insertBefore(d, svg.firstChild);
      return d;
    })();

    // remove any stale clipPath with same id (re-render safety)
    const old = defs.querySelector(`#${clipId}`);
    if(old) old.remove();

    const cp = document.createElementNS('http://www.w3.org/2000/svg','clipPath');
    cp.setAttribute('id', clipId);
    const cpr = document.createElementNS('http://www.w3.org/2000/svg','rect');
    cpr.setAttribute('x', pad.l);
    cpr.setAttribute('y', barY);
    cpr.setAttribute('width', w);
    cpr.setAttribute('height', barH);
    cpr.setAttribute('rx', 10);
    cp.appendChild(cpr);
    defs.appendChild(cp);

    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('clip-path', `url(#${clipId})`);

    let x = pad.l;
    const parts = [['v',it.v||0],['b',it.b||0],['i',it.i||0]];
    parts.forEach(([k,val])=>{
      const segW = w*val;
      if(segW<=0.2) { x += segW; return; }
      const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
      r.setAttribute('x', x);
      r.setAttribute('y', barY);
      r.setAttribute('width', Math.max(0, segW));
      r.setAttribute('height', barH);
      r.setAttribute('fill', col[k]);
      g.appendChild(r);
      x += segW;
    });
    svg.appendChild(g);

    // right label: % valid
    const pct = document.createElementNS('http://www.w3.org/2000/svg','text');
    pct.setAttribute('x', W - 12);
    pct.setAttribute('y', cy + 4);
    pct.setAttribute('text-anchor','end');
    pct.setAttribute('fill','rgba(15,23,42,.93)');
    pct.setAttribute('font-size','12');
    pct.setAttribute('font-weight','950');
    pct.textContent = `${Math.round((it.v||0)*100)}% valid`;
    svg.appendChild(pct);
  });

  // small axis caption
  const lab = document.createElementNS('http://www.w3.org/2000/svg','text');
  lab.setAttribute('x', pad.l);
  lab.setAttribute('y', 12);
  lab.setAttribute('text-anchor','start');
  lab.setAttribute('fill','rgba(100,116,139,.82)');
  lab.setAttribute('font-size','10');
  lab.textContent = 'share, %';
  svg.appendChild(lab);
}
function drawRangeBars(svgId, items){
  const svg = $(svgId);
  clearSvg(svg);
  resetViewBox(svg);

  const vb = (svg.getAttribute('viewBox')||'0 0 520 240').trim().split(/\s+/).map(Number);
  const W = vb[2] || 520;
  const baseH = vb[3] || 240;

  const pad = {l:170,r:92,t:12,b:16};
  const visible = items.slice(0,6);
  const rows = Math.max(1, visible.length);

  const minRowPx = 26;
  const neededH = pad.t + pad.b + rows*minRowPx + 22;
  const H = Math.max(baseH, Math.round(neededH));
  if(H !== baseH){ setViewBoxHeight(svg, H); }

  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const rowH = h/rows;
  const scale = (x)=> pad.l + (x/100)*w;

  visible.forEach((it, idx)=>{
    const y = pad.t + rowH*idx + 8;

    const name = document.createElementNS('http://www.w3.org/2000/svg','text');
    name.setAttribute('x', pad.l-10);
    name.setAttribute('y', y+10);
    name.setAttribute('text-anchor','end');
    name.setAttribute('fill','rgba(100,116,139,.92)');
    name.setAttribute('font-size','12');
    name.textContent = it.name;
    svg.appendChild(name);

    const x1 = scale(it.min), x2 = scale(it.max), xm = scale(it.mean);

    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', x1); line.setAttribute('x2', x2);
    line.setAttribute('y1', y+7); line.setAttribute('y2', y+7);
    line.setAttribute('stroke','rgba(119,169,232,.68)');
    line.setAttribute('stroke-width','6');
    line.setAttribute('stroke-linecap','round');
    svg.appendChild(line);

    const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx', xm); dot.setAttribute('cy', y+7);
    dot.setAttribute('r', 6);
    dot.setAttribute('fill','rgba(16,185,129,.9)');
    dot.setAttribute('stroke','rgba(17,24,39,.55)');
    svg.appendChild(dot);

    const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
    const txX = Math.min(x2+8, W-8);
    tx.setAttribute('x', txX);
    tx.setAttribute('y', y+11);
    if(txX >= W-14) tx.setAttribute('text-anchor','end');
    tx.setAttribute('fill','rgba(15,23,42,.93)');
    tx.setAttribute('font-size','12');
    tx.setAttribute('font-weight','900');
    tx.textContent = `${fmt(it.mean)} (n=${it.n})`;
    svg.appendChild(tx);
  });

  axisX(svg, pad.l, H-7, w, ['0', '50', '100']);
}

function drawProtocolDistributions(svgId, items, bins, thresholds){
  const svg = $(svgId);
  clearSvg(svg);
  resetViewBox(svg);

  const vb = (svg.getAttribute('viewBox')||'0 0 520 240').trim().split(/\s+/).map(Number);
  const W = vb[2] || 520;
  const baseH = vb[3] || 240;

  // Layout: left label + compact distribution (no horizontal scroll), scroll only down.
  const pad = {l:14, r:14, t:10, b:10};
  const labelW = 160;
  const rowH = 94;

  const chartX = pad.l + labelW;
  const chartW = Math.max(1, W - chartX - pad.r);

  if(!items || !items.length){
    const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
    tx.setAttribute('x', 16);
    tx.setAttribute('y', 28);
    tx.setAttribute('fill','rgba(100,116,139,.90)');
    tx.setAttribute('font-size','12');
    tx.textContent = 'Нет данных по выбранным фильтрам.';
    svg.appendChild(tx);
    return;
  }

  // Ensure a single gradient definition (used by all mini-distributions).
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  defs.innerHTML = `
    <linearGradient id="qcFillMini" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(119,169,232,.30)"></stop>
      <stop offset="100%" stop-color="rgba(96,165,250,0)"></stop>
    </linearGradient>
  `;
  svg.appendChild(defs);

  const trunc = (s, n=22)=>{
    s = String(s||'');
    return s.length>n ? (s.slice(0, n-1)+'…') : s;
  };

  // Build per-protocol densities (normalize by n to compare shapes) + median.
  const per = items.map(it => {
    const scores = (it.scores || []).filter(v => typeof v === 'number' && isFinite(v));
    const counts = histogram(scores, bins);
    const sum = Math.max(1, counts.reduce((a,b)=>a+b,0));
    const dens = counts.map(c=>c/sum);
    return {
      name: it.name,
      n: scores.length,
      mean: it.mean,
      median: scores.length ? median(scores) : null,
      dens
    };
  });
  const globalMax = Math.max(1e-6, ...per.flatMap(p => p.dens));

  const neededH = pad.t + pad.b + per.length * rowH;
  const H = Math.max(baseH, Math.round(neededH));
  if(H !== baseH){ setViewBoxHeight(svg, H); }

  const domainMin = bins[0];
  const domainMax = bins[bins.length-1];

  // Helpers for a smooth line (catmull-rom -> bezier)
  function smoothPath(pts){
    if(pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for(let i=0;i<pts.length-1;i++){
      const p0 = pts[i-1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i+1];
      const p3 = pts[i+2] || p2;
      const c1x = p1.x + (p2.x - p0.x)/6;
      const c1y = p1.y + (p2.y - p0.y)/6;
      const c2x = p2.x - (p3.x - p1.x)/6;
      const c2y = p2.y - (p3.y - p1.y)/6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }

  per.forEach((p, idx) => {
    const y0 = pad.t + idx * rowH;

    // Row background
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x', 10);
    bg.setAttribute('y', y0 + 6);
    bg.setAttribute('width', W - 20);
    bg.setAttribute('height', rowH - 12);
    bg.setAttribute('rx', 12);
    bg.setAttribute('fill','rgba(255,255,255,.28)');
    bg.setAttribute('stroke','rgba(92,102,189,.18)');
    svg.appendChild(bg);

    // Protocol label (left-aligned, vertically centered)
    const centerY = y0 + rowH/2;
    const name = document.createElementNS('http://www.w3.org/2000/svg','text');
    name.setAttribute('x', pad.l);
    name.setAttribute('y', centerY - 6);
    name.setAttribute('text-anchor','start');
    name.setAttribute('fill','rgba(15,23,42,.90)');
    name.setAttribute('font-size','12');
    name.setAttribute('font-weight','950');
    name.textContent = trunc(p.name);
    svg.appendChild(name);

    const meta = document.createElementNS('http://www.w3.org/2000/svg','text');
    meta.setAttribute('x', pad.l);
    meta.setAttribute('y', centerY + 12);
    meta.setAttribute('text-anchor','start');
    meta.setAttribute('fill','rgba(100,116,139,.90)');
    meta.setAttribute('font-size','10.5');
    meta.textContent = `n=${p.n}${(typeof p.mean==='number' && isFinite(p.mean)) ? ` · avg ${fmt(p.mean)}` : ''}`;
    svg.appendChild(meta);

    // Mini distribution chart frame
    const cx = chartX;
    const cy = y0 + 18;
    const ch = rowH - 36;

    const frame = document.createElementNS('http://www.w3.org/2000/svg','rect');
    frame.setAttribute('x', cx);
    frame.setAttribute('y', cy);
    frame.setAttribute('width', chartW);
    frame.setAttribute('height', ch);
    frame.setAttribute('rx', 12);
    frame.setAttribute('fill','rgba(255,255,255,.35)');
    frame.setAttribute('stroke','rgba(92,102,189,.18)');
    svg.appendChild(frame);

    // Grid (vertical @ 0/25/50/75/100 + horizontal mid)
    const ticks = [0,25,50,75,100];
    ticks.forEach(t=>{
      const xx = cx + (t/100)*chartW;
      const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
      ln.setAttribute('x1', xx);
      ln.setAttribute('x2', xx);
      ln.setAttribute('y1', cy);
      ln.setAttribute('y2', cy + ch);
      ln.setAttribute('stroke','rgba(92,102,189,.18)');
      svg.appendChild(ln);
    });
    const mid = document.createElementNS('http://www.w3.org/2000/svg','line');
    mid.setAttribute('x1', cx);
    mid.setAttribute('x2', cx + chartW);
    mid.setAttribute('y1', cy + ch/2);
    mid.setAttribute('y2', cy + ch/2);
    mid.setAttribute('stroke','rgba(92,102,189,.10)');
    svg.appendChild(mid);

    // Thresholds (optional)
    (thresholds||[]).forEach(t=>{
      const xx = cx + ((t.value - domainMin) / (domainMax - domainMin || 1)) * chartW;
      const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
      ln.setAttribute('x1', xx);
      ln.setAttribute('x2', xx);
      ln.setAttribute('y1', cy);
      ln.setAttribute('y2', cy + ch);
      ln.setAttribute('stroke', t.color);
      ln.setAttribute('stroke-width','1.6');
      ln.setAttribute('stroke-dasharray','4 4');
      ln.setAttribute('opacity','0.9');
      svg.appendChild(ln);
    });

    // Build points (bin centers) for the curve
    const nBins = p.dens.length;
    const pts = [];
    for(let i=0;i<nBins;i++){
      const center = (bins[i] + bins[i+1]) / 2;
      const xx = cx + ((center - domainMin)/(domainMax - domainMin || 1)) * chartW;
      const yy = cy + ch * (1 - (p.dens[i]/globalMax));
      pts.push({x:xx, y:yy});
    }

    const lineD = smoothPath(pts);
    if(lineD){
      const baseY = cy + ch;
      const areaD = lineD.replace(/^M\s*[^\s]+\s*[^\s]+/, `M ${pts[0].x} ${baseY} L ${pts[0].x} ${pts[0].y}`) + ` L ${pts[pts.length-1].x} ${baseY} Z`;

      const area = document.createElementNS('http://www.w3.org/2000/svg','path');
      area.setAttribute('d', areaD);
      area.setAttribute('fill','url(#qcFillMini)');
      svg.appendChild(area);

      const line = document.createElementNS('http://www.w3.org/2000/svg','path');
      line.setAttribute('d', lineD);
      line.setAttribute('fill','none');
      line.setAttribute('stroke','rgba(119,169,232,.95)');
      line.setAttribute('stroke-width','2.4');
      svg.appendChild(line);
    }

    // Median marker
    if(typeof p.median === 'number' && isFinite(p.median)){
      const m = clamp(p.median, domainMin, domainMax);
      const mx = cx + ((m - domainMin)/(domainMax - domainMin || 1)) * chartW;
      const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
      ln.setAttribute('x1', mx);
      ln.setAttribute('x2', mx);
      ln.setAttribute('y1', cy);
      ln.setAttribute('y2', cy + ch);
      ln.setAttribute('stroke','rgba(251,191,36,.75)');
      ln.setAttribute('stroke-dasharray','4 4');
      svg.appendChild(ln);

      const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
      tx.setAttribute('x', mx);
      tx.setAttribute('y', cy - 4);
      tx.setAttribute('text-anchor','middle');
      tx.setAttribute('fill','rgba(251,191,36,.92)');
      tx.setAttribute('font-size','10.5');
      tx.setAttribute('font-weight','900');
      tx.textContent = `med ${Math.round(m)}`;
      svg.appendChild(tx);
    }
  });
}


function drawReasonStack(svgId, grouped){
  const svg = $(svgId);
  if(!svg) return;
  clearSvg(svg);
  resetViewBox(svg);

  const vb = (svg.getAttribute('viewBox')||'0 0 520 260').trim().split(/\s+/).map(Number);
  const W = vb[2] || 520;
  const baseH = vb[3] || 260;

  // Align visual scale with validity share card
  const pad = {l:160, r:84, t:18, b:18};
  const rows = Math.max(1, grouped.length);

  const minRowPx = 38;
  const neededH = pad.t + pad.b + rows*minRowPx + 10;
  const H = Math.max(baseH, Math.round(neededH));
  if(H !== baseH){ setViewBoxHeight(svg, H); }

  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const rowH = h/rows;

  // Soft vertical grid (0/25/50/75/100)
  const ticks = [0,25,50,75,100];
  ticks.forEach((t,i)=>{
    const x = pad.l + w*(t/100);
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', pad.t-6);
    line.setAttribute('x2', x);
    line.setAttribute('y2', H-pad.b+6);
    line.setAttribute('stroke', i===0||i===ticks.length-1 ? 'rgba(92,102,189,.18)' : 'rgba(92,102,189,.08)');
    svg.appendChild(line);

    if(i===0 || i===2 || i===4){
      const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
      tx.setAttribute('x', x);
      tx.setAttribute('y', H-6);
      tx.setAttribute('text-anchor','middle');
      tx.setAttribute('fill','rgba(100,116,139,.85)');
      tx.setAttribute('font-size','10');
      tx.textContent = String(t);
      svg.appendChild(tx);
    }
  });

  const palette = [
    ['low_light_time','rgba(251,191,36,.75)'],
    ['face_lost','rgba(248,113,113,.70)'],
    ['pose_ok_low','rgba(92,102,189,.72)'],
    ['low_fps','rgba(119,169,232,.68)'],
    ['event_loop_lag','rgba(167,243,208,.55)'],
    ['too_many_omissions','rgba(100,116,139,.55)'],
    ['frame_drops','rgba(244,114,182,.55)']
  ];

  // defs holder for clip paths
  const defs = svg.querySelector('defs') || (()=>{
    const d = document.createElementNS('http://www.w3.org/2000/svg','defs');
    svg.insertBefore(d, svg.firstChild);
    return d;
  })();

  grouped.forEach((it, idx)=>{
    const y0 = pad.t + rowH*idx;
    const cy = y0 + rowH/2;

    const barH = 18;
    const barY = cy - barH/2;

    // left label (aligned like validity card)
    const name = document.createElementNS('http://www.w3.org/2000/svg','text');
    name.setAttribute('x', 14);
    name.setAttribute('y', cy + 4);
    name.setAttribute('text-anchor','start');
    name.setAttribute('fill','rgba(100,116,139,.92)');
    name.setAttribute('font-size','12');
    name.setAttribute('font-weight','800');
    name.textContent = it.name;
    svg.appendChild(name);

    const meta = document.createElementNS('http://www.w3.org/2000/svg','text');
    meta.setAttribute('x', 14);
    meta.setAttribute('y', cy + 18);
    meta.setAttribute('text-anchor','start');
    meta.setAttribute('fill','rgba(156,163,175,.72)');
    meta.setAttribute('font-size','10');
    meta.textContent = `n=${it.n||0}`;
    svg.appendChild(meta);

    // background/frame
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x', pad.l);
    bg.setAttribute('y', barY);
    bg.setAttribute('width', w);
    bg.setAttribute('height', barH);
    bg.setAttribute('rx', 10);
    bg.setAttribute('fill','rgba(255,255,255,.35)');
    bg.setAttribute('stroke','rgba(92,102,189,.14)');
    svg.appendChild(bg);

    // clip for rounded corners
    const clipId = `clip_reason_${idx}`;
    const old = defs.querySelector(`#${clipId}`);
    if(old) old.remove();

    const cp = document.createElementNS('http://www.w3.org/2000/svg','clipPath');
    cp.setAttribute('id', clipId);
    const cpr = document.createElementNS('http://www.w3.org/2000/svg','rect');
    cpr.setAttribute('x', pad.l);
    cpr.setAttribute('y', barY);
    cpr.setAttribute('width', w);
    cpr.setAttribute('height', barH);
    cpr.setAttribute('rx', 10);
    cp.appendChild(cpr);
    defs.appendChild(cp);

    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('clip-path', `url(#${clipId})`);

    // stacked segments, capped at 100% width (no horizontal overflow)
    let x = pad.l;
    const xMax = pad.l + w;
    let sum = 0;
    for(const [k, col] of palette){
      const val = (it.reasons && it.reasons[k]) ? it.reasons[k] : 0;
      if(val <= 0) continue;
      sum += val;
      let segW = w * val;
      if(x + segW > xMax) segW = xMax - x;
      if(segW <= 0.2) break;
      const r = document.createElementNS('http://www.w3.org/2000/svg','rect');
      r.setAttribute('x', x);
      r.setAttribute('y', barY);
      r.setAttribute('width', Math.max(0, segW));
      r.setAttribute('height', barH);
      r.setAttribute('fill', col);
      g.appendChild(r);
      x += segW;
      if(x >= xMax-0.2) break;
    }
    svg.appendChild(g);

    // right label: bad share (borderline+invalid)
    const pct = document.createElementNS('http://www.w3.org/2000/svg','text');
    pct.setAttribute('x', W - 12);
    pct.setAttribute('y', cy + 4);
    pct.setAttribute('text-anchor','end');
    pct.setAttribute('fill','rgba(15,23,42,.93)');
    pct.setAttribute('font-size','12');
    pct.setAttribute('font-weight','950');
    pct.textContent = `${Math.round((it.total||0)*100)}% bad`;
    svg.appendChild(pct);

    // overflow marker if summed shares exceed 100%
    if(sum > 1.02){
      const ov = document.createElementNS('http://www.w3.org/2000/svg','text');
      ov.setAttribute('x', pad.l + w - 6);
      ov.setAttribute('y', barY + 13);
      ov.setAttribute('text-anchor','end');
      ov.setAttribute('fill','rgba(249,250,251,.65)');
      ov.setAttribute('font-size','10');
      ov.setAttribute('font-weight','800');
      ov.textContent = '100%+';
      svg.appendChild(ov);
    }
  });

  const lab = document.createElementNS('http://www.w3.org/2000/svg','text');
  lab.setAttribute('x', pad.l);
  lab.setAttribute('y', 12);
  lab.setAttribute('text-anchor','start');
  lab.setAttribute('fill','rgba(100,116,139,.82)');
  lab.setAttribute('font-size','10');
  lab.textContent = 'share, % (capped at 100)';
  svg.appendChild(lab);
}




function drawTechMetric(svgId, items, mode){
  const svg = $(svgId);
  if(!svg) return;
  clearSvg(svg);
  resetViewBox(svg);

  const vb = (svg.getAttribute('viewBox')||'0 0 520 260').trim().split(/\s+/).map(Number);
  const W = vb[2] || 520;
  const baseH = vb[3] || 260;

  const pad = {l:160, r:84, t:18, b:18};
  const rows = Math.max(1, items.length);

  // comfortable row height (similar to validity/reasons)
  const minRowPx = 44;
  const neededH = pad.t + pad.b + rows*minRowPx + 10;
  const H = Math.max(baseH, Math.round(neededH));
  if(H !== baseH){ setViewBoxHeight(svg, H); }

  const w = W - pad.l - pad.r;
  const h = H - pad.t - pad.b;
  const rowH = h/rows;

  const cfgs = {
    fps:   {key:'fps',   unit:'fps', min:0,   max:32,  ticks:[0,15,30],   thr:24.5, thrText:'24.5'},
    lag:   {key:'lag',   unit:'ms',  min:0,   max:200, ticks:[0,100,200], thr:85,   thrText:'85'},
    drops: {key:'drops', unit:'%',   min:0,   max:15,  ticks:[0,5,10,15], thr:7,    thrText:'7'}
  };
  const cfg = cfgs[mode] || cfgs.fps;
  const span = Math.max(1e-6, cfg.max - cfg.min);

  const ok = 'rgba(16,185,129,.85)';
  const warn = 'rgba(251,191,36,.85)';
  const bad = 'rgba(248,113,113,.82)';
  function riskColor(v){
    if(mode==='fps')   return (v>=25) ? ok : (v>=24) ? warn : bad;
    if(mode==='lag')   return (v<=60) ? ok : (v<=85) ? warn : bad;
    if(mode==='drops') return (v<=4)  ? ok : (v<=7)  ? warn : bad;
    return 'rgba(96,165,250,.90)';
  }

  // soft grid + tick labels
  (cfg.ticks||[]).forEach((t,i)=>{
    const x = pad.l + w*((t-cfg.min)/span);
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', x);
    line.setAttribute('y1', pad.t-6);
    line.setAttribute('x2', x);
    line.setAttribute('y2', H-pad.b+6);
    line.setAttribute('stroke', (i===0 || i===(cfg.ticks.length-1)) ? 'rgba(92,102,189,.18)' : 'rgba(92,102,189,.08)');
    svg.appendChild(line);

    const show = (i===0 || i===Math.floor((cfg.ticks.length-1)/2) || i===(cfg.ticks.length-1));
    if(show){
      const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
      tx.setAttribute('x', x);
      tx.setAttribute('y', H-6);
      tx.setAttribute('text-anchor','middle');
      tx.setAttribute('fill','rgba(100,116,139,.85)');
      tx.setAttribute('font-size','10');
      tx.textContent = String(t);
      svg.appendChild(tx);
    }
  });

  // threshold line
  if(isFinite(cfg.thr)){
    const x = pad.l + w*((cfg.thr-cfg.min)/span);
    const l = document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('x1', x);
    l.setAttribute('y1', pad.t-6);
    l.setAttribute('x2', x);
    l.setAttribute('y2', H-pad.b+6);
    l.setAttribute('stroke','rgba(251,191,36,.28)');
    l.setAttribute('stroke-width','1.2');
    l.setAttribute('stroke-dasharray','3 6');
    svg.appendChild(l);

    const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
    tx.setAttribute('x', x);
    tx.setAttribute('y', 12);
    tx.setAttribute('text-anchor','middle');
    tx.setAttribute('fill','rgba(251,191,36,.70)');
    tx.setAttribute('font-size','10');
    tx.setAttribute('font-weight','900');
    tx.textContent = cfg.thrText;
    svg.appendChild(tx);
  }

  items.forEach((it, idx)=>{
    const y0 = pad.t + rowH*idx;
    const cy = y0 + rowH/2;

    const barH = 18;
    const barY = cy - barH/2;

    // track
    const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
    bg.setAttribute('x', pad.l);
    bg.setAttribute('y', barY);
    bg.setAttribute('width', w);
    bg.setAttribute('height', barH);
    bg.setAttribute('rx', 10);
    bg.setAttribute('fill','rgba(255,255,255,.35)');
    bg.setAttribute('stroke','rgba(92,102,189,.14)');
    svg.appendChild(bg);

    // left labels (aligned like validity)
    const name = document.createElementNS('http://www.w3.org/2000/svg','text');
    name.setAttribute('x', 14);
    name.setAttribute('y', cy + 4);
    name.setAttribute('text-anchor','start');
    name.setAttribute('fill','rgba(100,116,139,.92)');
    name.setAttribute('font-size','12');
    name.setAttribute('font-weight','800');
    name.textContent = it.name;
    svg.appendChild(name);

    const meta = document.createElementNS('http://www.w3.org/2000/svg','text');
    meta.setAttribute('x', 14);
    meta.setAttribute('y', cy + 18);
    meta.setAttribute('text-anchor','start');
    meta.setAttribute('fill','rgba(156,163,175,.72)');
    meta.setAttribute('font-size','10');
    meta.textContent = `n=${it.n}`;
    svg.appendChild(meta);

    const raw = it[cfg.key];
    const has = raw !== null && raw !== undefined && isFinite(Number(raw));
    const v = has ? Number(raw) : null;

    // If there is no data, show N/A and avoid painting a misleading green OK marker.
    if(!has){
      const naX = pad.l; // keep alignment, but don't imply a measured value
      const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
      dot.setAttribute('cx', naX);
      dot.setAttribute('cy', cy);
      dot.setAttribute('r', 5.5);
      dot.setAttribute('fill', 'rgba(148,163,184,.65)');
      dot.setAttribute('stroke', 'rgba(17,24,39,.25)');
      dot.setAttribute('stroke-width', '1.6');
      svg.appendChild(dot);

      const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
      tx.setAttribute('x', W - 12);
      tx.setAttribute('y', cy + 4);
      tx.setAttribute('text-anchor','end');
      tx.setAttribute('fill','rgba(148,163,184,.92)');
      tx.setAttribute('font-size','12');
      tx.setAttribute('font-weight','900');
      tx.textContent = '— / N/A';
      svg.appendChild(tx);
      return;
    }

    const t = clamp((v - cfg.min)/span, 0, 1);
    const x = pad.l + w*t;
    const c = riskColor(v);

    // marker
    const mk = document.createElementNS('http://www.w3.org/2000/svg','line');
    mk.setAttribute('x1', x);
    mk.setAttribute('x2', x);
    mk.setAttribute('y1', barY+2);
    mk.setAttribute('y2', barY+barH-2);
    mk.setAttribute('stroke', c);
    mk.setAttribute('stroke-width','2.2');
    mk.setAttribute('stroke-linecap','round');
    svg.appendChild(mk);

    const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', 6);
    dot.setAttribute('fill', c);
    dot.setAttribute('stroke', 'rgba(17,24,39,.55)');
    dot.setAttribute('stroke-width', '2');
    svg.appendChild(dot);

    const tx = document.createElementNS('http://www.w3.org/2000/svg','text');
    tx.setAttribute('x', W - 12);
    tx.setAttribute('y', cy + 4);
    tx.setAttribute('text-anchor','end');
    tx.setAttribute('fill','rgba(15,23,42,.93)');
    tx.setAttribute('font-size','12');
    tx.setAttribute('font-weight','950');
    tx.textContent = cfg.unit ? `${fmt(v)} ${cfg.unit}` : fmt(v);
    svg.appendChild(tx);
  });

  const lab = document.createElementNS('http://www.w3.org/2000/svg','text');
  lab.setAttribute('x', pad.l);
  lab.setAttribute('y', 12);
  lab.setAttribute('text-anchor','start');
  lab.setAttribute('fill','rgba(100,116,139,.82)');
  lab.setAttribute('font-size','10');
  lab.textContent = 'mean value (marker)';
  svg.appendChild(lab);
}
/* ------------------------- UI + RENDER ------------------------- *//* ------------------------- UI + RENDER ------------------------- */
let __datasetKey = Object.keys(DATASETS)[0];
let __reasonMode = "device";
let __validMode = "device";
let __techMode = "fps";

function fillSelect(el, options, selected){
  el.innerHTML = options.map(o => `<option value="${esc(o.value)}" ${o.value===selected?'selected':''}>${esc(o.label)}</option>`).join("");
}
function getFilters(){
  return {
    dataset: __datasetKey,
    protocol: $("protocolSelect").value,
    device: $("deviceSelect").value,
    browser: $("browserSelect").value,
    time: $("timeSelect").value,
    dateFrom: $("dateFrom").value || null,
    dateTo: $("dateTo").value || null
  };
}
function initUI(){
  initVizContainers();
  fillSelect($("orgSelect"), [
    {value:"HSE", label:"Орг: HSE"},
    {value:"all", label:"Орг: все"}
  ], "HSE");
  fillSelect($("projectSelect"), [
    {value:"Pilot 01", label:"Проект: Pilot 01"},
    {value:"all", label:"Проект: все"}
  ], "Pilot 01");

  const allProtocols = new Set();
  const allDevices = new Set(["Laptop","Desktop","Mobile"]);
  const allBrowsers = new Set(["Chrome","Safari","Edge","Firefox"]);
  DATASETS[__datasetKey].sessions.forEach(s=>allProtocols.add(s.protocol));

  fillSelect($("protocolSelect"), [{value:"all",label:"Протокол: все"}, ...Array.from(allProtocols).map(p=>({value:p,label:`Протокол: ${p}`}))], "all");
  fillSelect($("deviceSelect"), [{value:"all",label:"Устройство: все"}, ...Array.from(allDevices).map(d=>({value:d,label:`Устройство: ${d}`}))], "all");
  fillSelect($("browserSelect"), [{value:"all",label:"Браузер: все"}, ...Array.from(allBrowsers).map(b=>({value:b,label:`Браузер: ${b}`}))], "all");
  fillSelect($("timeSelect"), [
    {value:"all",label:"Время: все"},
    {value:"morning",label:"Время: утро (6–12)"},
    {value:"day",label:"Время: день (12–18)"},
    {value:"evening",label:"Время: вечер (18–22)"},
    {value:"night",label:"Время: ночь (22–6)"},
  ], "all");

  ["protocolSelect","deviceSelect","browserSelect","timeSelect","dateFrom","dateTo"].forEach(id=>{
    $(id).addEventListener("change", renderAll);
  });

  $("exportBtn").addEventListener("click", ()=>{
    const f = getFilters();
    const sessions = applyFilters(DATASETS[__datasetKey].sessions, f);
    const payload = {filters:f, summary:summarize(sessions), sessions_sample:sessions.slice(0,20)};
    navigator.clipboard?.writeText(JSON.stringify(payload,null,2));
    $("exportBtn").textContent = "JSON скопирован ✓";
    setTimeout(()=>$("exportBtn").textContent="Экспорт JSON", 1100);
  });

  $("reasonsMode").querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      __reasonMode = btn.dataset.mode;
      $("reasonsMode").querySelectorAll("button").forEach(b=>b.classList.toggle("active", b===btn));
      renderAll();
    });
  });


  $("validMode").querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      __validMode = btn.dataset.mode;
      $("validMode").querySelectorAll("button").forEach(b=>b.classList.toggle("active", b===btn));
      renderAll();
    });
  });

  $("techMode").querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      __techMode = btn.dataset.mode;
      $("techMode").querySelectorAll("button").forEach(b=>b.classList.toggle("active", b===btn));
      renderAll();
    });
  });

  const now = new Date();
  const d1 = new Date(now.getTime() - 30*24*3600*1000);
  $("dateFrom").value = `${d1.getFullYear()}-${String(d1.getMonth()+1).padStart(2,"0")}-${String(d1.getDate()).padStart(2,"0")}`;
  $("dateTo").value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}
function timeBucket(h){
  if(h>=6 && h<12) return "утро";
  if(h>=12 && h<18) return "день";
  if(h>=18 && h<22) return "вечер";
  return "ночь";
}
function median(vals){
  if(!vals.length) return 0;
  const a = [...vals].sort((x,y)=>x-y);
  const m = Math.floor(a.length/2);
  return (a.length%2)?a[m]:(a[m-1]+a[m])/2;
}
function minBy(arr, fn){
  let best = arr[0];
  for(const x of arr){ if(fn(x) < fn(best)) best = x; }
  return best;
}
function maxBy(arr, fn){
  let best = arr[0];
  for(const x of arr){ if(fn(x) > fn(best)) best = x; }
  return best;
}

function buildReasonGrouped(sessions, mode){
  const keyFn = mode==="protocol" ? (s)=>s.protocol : mode==="browser" ? (s)=>s.browser : (s)=>s.device;
  const groups = groupBy(sessions, keyFn);

  const items = Array.from(groups.entries()).map(([name, arr])=>{
    const reasonToCount = {};
    for(const s of arr){
      const uniq = new Set((s.reasons||[]).map(r=>r.key));
      for(const k of uniq){
        reasonToCount[k] = (reasonToCount[k] || 0) + 1;
      }
    }
    const total = arr.length || 1;
    const reasons = {};
    Object.entries(reasonToCount).forEach(([k,c])=>{
      reasons[k] = c/total;
    });
    const badShare = arr.filter(x=>x.qc_class!=="VALID").length/total;
    return {name, reasons, total:badShare, n:arr.length};
  });

  items.sort((a,b)=>b.total-a.total);

  const worst = items[0] ? `${items[0].name} (${Math.round(items[0].total*100)}% borderline+invalid)` : "—";
  const note = items.length ? `Самый «проблемный» срез сейчас: ${worst}.` : "Нет данных.";
  return {items: items.slice(0,6), note};
}

function renderWorstSlices(sessions){
  const combos = groupBy(sessions, s=>`${s.device} × ${s.browser}`);
  const rows = Array.from(combos.entries()).map(([name, arr])=>{
    const sh = validityShares(arr);
    const avgQc = avg(arr,"qc_score");
    const score = (1-sh.v) + (sh.i*0.6) + (70-avgQc)/200;
    return {name, v:sh.v, b:sh.b, i:sh.i, avgQc, n:arr.length, score};
  }).filter(r=>r.n>=10).sort((a,b)=>b.score-a.score).slice(0,5);

  const tb = $("worstTable");
  tb.innerHTML = rows.map(r=>`
    <tr>
      <td><b>${esc(r.name)}</b><div class="small">n=${r.n}</div></td>
      <td>${Math.round(r.v*100)}%</td>
      <td>${Math.round(r.b*100)}%</td>
      <td>${Math.round(r.i*100)}%</td>
      <td><b>${fmt(r.avgQc)}</b></td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="small">Недостаточно данных по фильтрам (или слишком мало сессий в срезах).</td></tr>`;
}

function buildAdvice(sessions){
  if(!sessions.length) return "Нет данных по выбранным фильтрам — расширьте диапазон дат/снимите ограничения.";
  const s = summarize(sessions);
  const validPct = s.total ? (s.valid/s.total) : 0;
  const byReason = new Map();
  sessions.forEach(x=>{
    (x.reasons||[]).forEach(r=>{
      byReason.set(r.key, (byReason.get(r.key)||0)+1);
    });
  });
  const top = Array.from(byReason.entries()).sort((a,b)=>b[1]-a[1]).slice(0,3);

  const tips = [];
  tips.push(`Доля valid: ${Math.round(validPct*100)}% (цель — двигать вверх).`);
  if(top.length){
    const labels = {
      low_light_time:"плохой свет",
      face_lost:"потеря лица",
      pose_ok_low:"поза/угол",
      low_fps:"низкий FPS",
      event_loop_lag:"event loop lag",
      too_many_omissions:"omissions",
      frame_drops:"frame drops"
    };
    tips.push(`Топ-причины: ${top.map(([k,c])=>`${labels[k]||k} (${c})`).join(", ")}.`);
  }
  const byDev = groupBy(sessions, x=>x.device);
  const devItems = Array.from(byDev.entries()).map(([name,arr])=>({name, v:validityShares(arr).v, n:arr.length}))
    .sort((a,b)=>a.v-b.v);
  if(devItems.length){
    tips.push(`Проверьте устройство с наименьшей valid-долей: ${devItems[0].name} (${Math.round(devItems[0].v*100)}% valid).`);
  }
  tips.push("Рекомендация: усилить pre-check (свет/лицо/поза), подсказки при просадке FPS и аккуратнее с ночными сессиями.");
  return tips.join(" ");
}

function renderAll(){
  const f = getFilters();
  const base = DATASETS[__datasetKey];
  const sessions = applyFilters(base.sessions, f);

  $("datasetName").textContent = base.meta.dataset;

  const s = summarize(sessions);
  $("kpiTotal").textContent = s.total || '—';
  $("kpiValid").textContent = s.total ? s.valid : '—';
  $("kpiBorder").textContent = s.total ? s.border : '—';
  $("kpiInvalid").textContent = s.total ? s.invalid : '—';
  $("kpiQc").innerHTML = s.avgQc !== null ? `${fmt(s.avgQc)} <small>/100</small>` : `<span style="color:var(--muted2);">— / нет данных</span>`;

  $("tagValid").textContent = s.total ? s.valid : '—';
  $("tagBorder").textContent = s.total ? s.border : '—';
  $("tagInvalid").textContent = s.total ? s.invalid : '—';
  $("tagQc").textContent = s.avgQc !== null ? fmt(s.avgQc) : '—';

  const bins = [0,10,20,30,40,50,60,70,80,90,100];
  const vals = sessions.map(x=>x.qc_score);
  const counts = histogram(vals, bins);
  drawHistogram("qcHist", bins, counts, [
    {value:60, label:"borderline", color:"rgba(251,191,36,.95)"},
    {value:80, label:"valid", color:"rgba(16,185,129,.95)"},
  ]);
  $("qcHistNote").textContent = s.total
    ? `Медиана ~ ${median(vals)}. Доля valid: ${Math.round((s.valid/Math.max(1,s.total))*100)}%.`
    : "Нет данных по фильтрам.";

  const byP = groupBy(sessions, x=>x.protocol);
  const protoItems = Array.from(byP.entries()).map(([name,arr])=>{
    const scores = arr.map(a=>a.qc_score);
    return {name, scores, mean:avg(arr,"qc_score"), n:arr.length};
  }).sort((a,b)=>b.mean-a.mean);
  drawProtocolDistributions("qcByProtocol", protoItems, bins, [
    {value:60, label:"borderline", color:"rgba(251,191,36,.95)"},
    {value:80, label:"valid", color:"rgba(16,185,129,.95)"},
  ]);
  $("qcProtoNote").textContent = protoItems.length
    ? `Лучше всего сейчас: ${protoItems[0].name} (avg ${fmt(protoItems[0].mean)}).`
    : "—";

  const mkStack = (keyFn, order=null)=>{
    const g = groupBy(sessions, keyFn);
    const items = Array.from(g.entries()).map(([name,arr])=>{
      const sh = validityShares(arr);
      return {name, ...sh, n:arr.length};
    });
    if(order){
      items.sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name));
    } else {
      items.sort((a,b)=>b.n-a.n);
    }
    return items.slice(0,6);
  };

  // Validity shares (single view with toggle)
  let validItems = [];
  let modeLabel = "by device";
  let modeSub = "Где провалы качества по устройствам.";
  if(__validMode === "browser"){
    validItems = mkStack(x=>x.browser, ["Chrome","Safari","Edge","Firefox"]);
    modeLabel = "by browser";
    modeSub = "«Кривые» браузеры/версии.";
  } else if(__validMode === "time"){
    validItems = mkStack(x=>timeBucket(x.hour), ["утро","день","вечер","ночь"]);
    modeLabel = "by time-of-day";
    modeSub = "Часто ночью больше проблем со светом.";
  } else {
    validItems = mkStack(x=>x.device, ["Mobile","Laptop","Desktop"]);
  }

  $("validSliceTitle").innerHTML = `validity share <span>(${modeLabel})</span>`;
  $("validSliceSub").textContent = modeSub + " Сортировка: хуже (ниже valid%) выше.";
  validItems = [...validItems].sort((a,b)=>a.v-b.v);
  drawValidityBullet("validSlice", validItems, {thresholds:[60,80]});

  if(validItems.length){
    const worst = validItems[0];
    const best = validItems[validItems.length-1];
    $("validSliceNote").textContent = `Хуже всего: ${worst.name} (${Math.round(worst.v*100)}% valid, n=${worst.n}). Лучше всего: ${best.name} (${Math.round(best.v*100)}% valid, n=${best.n}).`;
  } else {
    $("validSliceNote").textContent = "—";
  }

  const reasonGrouped = buildReasonGrouped(sessions, __reasonMode);
  drawReasonStack("reasonsStack", reasonGrouped.items);
  $("reasonsNote").textContent = reasonGrouped.note;

  const byDev = groupBy(sessions, x=>x.device);
  const devItems = ["Mobile","Laptop","Desktop"].map(name=>{
    const arr = byDev.get(name) || [];
    const fps = avg(arr,"fps_eff");
    const lag = avg(arr,"lag_p95");
    const drops = avg(arr,"frame_drops_pct");
    return {name, fps, lag, drops, n:arr.length};
  }).filter(x=>x.n>0);

  let techLabel = 'effective FPS';
  let techSub = 'Ниже 24–25 FPS часто растёт «дрожь» и выпадение лица/взгляда.';
  if(__techMode === 'lag'){
    techLabel = 'event loop lag p95';
    techSub = 'Высокий лаг = перегруз браузера → пропуски кадров / задержки событий.';
  } else if(__techMode === 'drops'){
    techLabel = 'frame drops';
    techSub = '% выпадений кадров (чем выше, тем больше риск брака).';
  }
  $("techTitle").innerHTML = `${techLabel} <span>(by device)</span>`;
  $("techSub").textContent = techSub;
  drawTechMetric('techByDevice', devItems, __techMode);

  if(devItems.length){
    const fmtN = (v, unit) => (v !== null && isFinite(v)) ? `${fmt(v)} ${unit}` : `— / нет данных`;
    if(__techMode === 'fps'){
      const hasData = devItems.filter(x=>x.fps!==null && isFinite(x.fps));
      if(!hasData.length){ $("techNote").textContent = 'Нет данных FPS по выбранным фильтрам.'; }
      else {
        const worst = minBy(hasData, x=>x.fps);
        const best = maxBy(hasData, x=>x.fps);
        $("techNote").textContent = `Хуже всего: ${worst.name} (${fmtN(worst.fps,'fps')}). Лучше всего: ${best.name} (${fmtN(best.fps,'fps')}).`;
      }
    } else if(__techMode === 'lag'){
      const hasData = devItems.filter(x=>x.lag!==null && isFinite(x.lag));
      if(!hasData.length){ $("techNote").textContent = 'Нет данных lag по выбранным фильтрам.'; }
      else {
        const worst = maxBy(hasData, x=>x.lag);
        const best = minBy(hasData, x=>x.lag);
        $("techNote").textContent = `Хуже всего: ${worst.name} (${fmtN(worst.lag,'ms')}). Лучше всего: ${best.name} (${fmtN(best.lag,'ms')}).`;
      }
    } else {
      const hasData = devItems.filter(x=>x.drops!==null && isFinite(x.drops));
      if(!hasData.length){ $("techNote").textContent = 'Нет данных drops по выбранным фильтрам.'; }
      else {
        const worst = maxBy(hasData, x=>x.drops);
        const best = minBy(hasData, x=>x.drops);
        $("techNote").textContent = `Хуже всего: ${worst.name} (${fmtN(worst.drops,'%')}). Лучше всего: ${best.name} (${fmtN(best.drops,'%')}).`;
      }
    }
  } else {
    $("techNote").textContent = '— / нет данных по выбранным фильтрам';
  }

  renderWorstSlices(sessions);
  $("adviceText").textContent = buildAdvice(sessions);
}

initUI();
renderAll();

  })();
}



function initConnectednessDashboard(root) {
  root.innerHTML = `<div class="dash-wrap"><div class="topbar">
  <div class="brand">
    <h1>Dashboard — Связанность показателей (корреляции/сеть)</h1>
    <div class="sub">
      Смотрим, как <b>gaze</b>, <b>blinks</b>, <b>эмоции</b>, <b>поведение</b> и <b>QC</b> связаны между собой на уровне SessionFeatures.
      В MVP: матрица корреляций + drill-down по паре (scatter, r, p, N) и простая сеть по порогу |r|.
    </div>
  </div>

  <div class="filters">
    <select id="orgSelect" title="Организация (демо)."></select>
    <select id="projectSelect" title="Проект (демо)."></select>
    <select id="protocolSelect" title="Протокол/задача. Фильтрует список сессий для расчёта корреляций."></select>
    <select id="blockSelect" title="Блок внутри протокола (например часть 1/2/3)."></select>
    <select id="groupSelect" title="Экспериментальное условие/группа (A/B)."></select>
    <select id="methodSelect" title="Метод корреляции: Pearson (линейная) или Spearman (по рангу, устойчивее к нелинейности/выбросам).">
      <option value="pearson">Pearson (линейная)</option>
      <option value="spearman">Spearman (по рангу)</option>
    </select>
    <select id="qcSelect" title="Фильтр по качеству: показываем только сессии с QC не ниже выбранного порога."></select>
    <div class="checkbox" title="Исключаем грубые выбросы по z-score (|z|>3) для выбранной пары. Влияет на scatter и на r/p/N в блоке Drill‑down.">
      <input id="outlierToggle" type="checkbox" />
      <label for="outlierToggle">Исключать выбросы</label>
    </div>
    <button id="exportBtn" type="button">Экспорт JSON</button>
  </div>
</div>

<div class="container">
  <div>
    <div class="card">
      <div class="card-header">
        <div>
          <h2>1) Сводка</h2>
          <div class="hint">N сессий, метод связи, число сильных рёбер по порогу. Всё — с учётом фильтров.</div>
        </div>
        <div class="pill">Dataset: <strong id="datasetName">—</strong></div>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="k">Сессии (N)</div><div class="v" id="kpiN">—</div></div>
        <div class="kpi"><div class="k">Метод</div><div class="v" id="kpiMethod">—</div></div>
        <div class="kpi"><div class="k">Порог |r|</div><div class="v" id="kpiThr">—</div></div>
        <div class="kpi"><div class="k">Рёбра (|r|≥порог)</div><div class="v" id="kpiEdges">—</div></div>
        <div class="kpi"><div class="k">Выбранная пара</div><div class="v" id="kpiPair">—</div></div>
      </div>
      <div class="body">
        <div class="section" style="margin-top:0;">
          <p class="t">Как читать</p>
          <p class="p">
            Нажмите на ячейку в матрице: откроется scatter и базовые статистики.
            В сети: узлы — метрики, рёбра — |r| выше порога; толщина ~ |r|. Это UX‑прототип: в проде — расчёты на сервере и стабильная статистика.
          </p>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>2) Матрица корреляций</h2>
          <div class="hint">Теплокарта r по выбранному методу. Клик по ячейке → drill-down. Диагональ = 1.</div>
        </div>
        <div class="pill">Order: <strong>by channel</strong></div>
      </div>

      <div class="body">
        <div class="seg" id="viewMode">
          <button type="button" class="active" data-mode="matrix">matrix</button>
          <button type="button" data-mode="network">network</button>
        </div>

        <div class="sliderRow" style="margin-bottom:10px;">
          <span class="lbl" title="Порог для отображения рёбер в сети: показываем только связи, где модуль корреляции |r| не меньше порога.">Порог ребра |r|:</span>
          <input id="thrRange" type="range" min="0" max="0.8" step="0.05" value="0.30" />
          <span class="badge" id="thrVal">0.30</span>
          <span class="lbl" title="Минимальное число сессий (N) для расчёта/показа корреляции. Если N меньше — ставим “·” и не рисуем ребро.">Минимум N:</span>
          <input id="minN" type="number" min="10" max="1000" step="1" value="25" style="width:92px;" />
          <span class="small">Если точек меньше min N — в матрице ставим “·”.</span>
        </div>

        <div class="chart" style="--svg-h:520px;">
          <p class="t" id="matrixTitle">correlation matrix <span>(click cell → scatter)</span></p>
          <p class="sub" id="matrixSub">Цвет и насыщенность показывают знак и силу связи. Наведите на ячейку для подсказки.</p>

          <div class="viz scroll-x" id="matrixWrap" data-minw="900">
            <svg id="corrMatrix" viewBox="0 0 900 420"></svg>
          </div>

          <div class="viz noscroll" id="networkWrap" style="display:none; --svg-h:640px;">
            <svg id="netSvg" viewBox="0 0 900 420"></svg>
          </div>

          <div class="small" id="netNote" style="display:none; margin-top:6px;">Толщина ребра ~ |r|. Цвет: blue=+, red=−. Клик по ребру открывает scatter.</div>

          <div class="small" id="matrixNote">—</div>

          <div class="legend" aria-label="legend-corr">
            <span class="item"><span class="sw" style="background:rgba(248,113,113,.75)"></span> r &lt; 0</span>
            <span class="item"><span class="sw" style="background:rgba(59,130,246,.70)"></span> r &gt; 0</span>
            <span class="item"><span class="sw" style="background:rgba(156,163,175,.55)"></span> насыщенность = |r|</span>
          </div>

        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h2>3) Drill‑down: пара метрик</h2>
          <div class="hint">Scatter + линейная регрессия (для UX) + r, p, N. Выбирается кликом по матрице/сети.</div>
        </div>
        <div class="pill">Pair: <strong id="pairLabel">—</strong></div>
      </div>
      <div class="body">
        <div class="grid-2">
          <div class="chart" style="--svg-h:320px;">
            <p class="t">scatter <span>(session points)</span></p>
            <p class="sub" id="scatterSub">Клик по точке в будущем может вести в карточку сессии (session_id).</p>
            <div class="viz noscroll">
              <svg id="scatterSvg" viewBox="0 0 520 320"></svg>
            </div>
            <div class="small" id="scatterNote">—</div>
          </div>
          <div class="chart" style="--svg-h:320px;">
            <p class="t">stats <span>(r, p, N)</span></p>
            <p class="sub">В MVP p — приближение t‑тестом (двусторонний), без поправок множественных сравнений.</p>
            <div class="section" style="margin-top:0;">
              <p class="t">Результат по паре</p>
              <div class="tagrow">
                <span class="tag"><span class="dot" id="statRdot"></span> r: <b id="statR">—</b></span>
                <span class="tag"><span class="dot"></span> p: <b id="statP">—</b></span>
                <span class="tag"><span class="dot"></span> N: <b id="statN">—</b></span>
                <span class="tag"><span class="dot"></span> method: <b id="statM">—</b></span>
              </div>
              <div class="small" id="pairHint" style="margin-top:10px;">—</div>
            </div>

            <div class="section">
              <p class="t">Идеи использования (шаблон)</p>
              <p class="p">
                1) QC‑фильтр меняет ли знак/силу? 2) Разные протоколы/блоки дают разные структуры? 3) В сети смотрим “хабы” — какие метрики тянут на себя много связей.
              </p>
            </div>
          </div>
        </div>

        <div class="section">
          <p class="t">Топ‑корреляции (текущие фильтры)</p>
          <p class="p">Показываем первые 8 связей по |r| (без диагонали). Для устойчивости сравнивайте Pearson vs Spearman.</p>
          <div style="margin-top:10px;">
            <table>
              <thead><tr><th>Пара</th><th>r</th><th>p</th><th>N</th><th>заметка</th></tr></thead>
              <tbody id="topCorrTable"></tbody>
            </table>
          </div>
        </div>

      </div>
    </div>

  </div>

  <div class="card side">
    <div class="card-header">
      <div>
        <h2>Сайдбар: инсайты и контроль</h2>
        <div class="hint">Быстрые подсказки по связям + “сетка” задач на проверку.</div>
      </div>
      <div class="pill">Action list</div>
    </div>

    <div class="body">
      <div class="section">
        <p class="t">Что искать (MVP)</p>
        <p class="p" id="sidebarAdvice">
          —
        </p>
        <div class="tagrow">
          <span class="tag"><span class="dot pos"></span> positive link</span>
          <span class="tag"><span class="dot neg"></span> negative link</span>
          <span class="tag"><span class="dot"></span> check QC filter</span>
        </div>
      </div>
      </div>

      <div class="section">
        <p class="t">Примечание</p>
        <p class="p">
          Это демо‑данные и клиентские расчёты — чтобы проверить UX и поток анализа.
          В проде: API, версионирование SessionFeatures, и (при необходимости) FDR‑коррекция/bootstrapped CI для устойчивости.
        </p>
      </div>

    </div>
  </div>

</div>

<div class="tooltip" id="tip"></div>
<div class="dash-tooltip" id="tip"></div></div>`;

  (function() {
    const $ = (id) => root.querySelector('#' + id);

/* ------------------------- DEMO DATA (UX) ------------------------- */
if (!_CONN_DATASETS_CACHE) {
  _CONN_DATASETS_CACHE = {
    "HSE / Pilot 01": {
      meta: { dataset:"demo", org:"HSE", project:"Pilot 01" },
      sessions: [
        ...genSessions("emo-cog / task A", 240),
        ...genSessions("emo-cog / task B", 210),
        ...genSessions("video / ad A", 180),
      ]
    }
  };
}
const DATASETS = _CONN_DATASETS_CACHE;
const METRICS = [
  // order by channel (как в плане)
  {key:"gaze_on_target_pct", label:"gaze_on_target_pct", channel:"Gaze"},
  {key:"gaze_off_count", label:"gaze_off_count", channel:"Gaze"},
  {key:"gaze_return_latency_mean", label:"gaze_return_latency_mean", channel:"Gaze"},
  {key:"blink_rate", label:"blink_rate", channel:"Blinks"},
  {key:"blink_long_frac", label:"blink_long_frac", channel:"Blinks"},
  {key:"valence_mean", label:"valence_mean", channel:"Emotion"},
  {key:"arousal_mean", label:"arousal_mean", channel:"Emotion"},
  {key:"omission_rate", label:"omission_rate", channel:"Behavior"},
  {key:"commission_rate", label:"commission_rate", channel:"Behavior"},
  {key:"speed_accuracy_index", label:"speed_accuracy_index", channel:"Behavior"},
  {key:"qc_score", label:"qc_score", channel:"QC"},
];

// $ scoped
function clamp(x,a,b){return Math.max(a, Math.min(b,x));}
function fmt(n, d=2){
  if(n===null || n===undefined || !isFinite(n)) return "—";
  const p = Math.pow(10,d);
  return (Math.round(n*p)/p).toString();
}
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function randn(){ // Box-Muller
  let u=0,v=0; while(u===0) u=Math.random(); while(v===0) v=Math.random();
  return Math.sqrt(-2.0*Math.log(u))*Math.cos(2.0*Math.PI*v);
}
function pickWeighted(weights){
  const entries = Object.entries(weights);
  const sum = entries.reduce((a,[,w])=>a+w,0);
  let r = Math.random()*sum;
  for(const [k,w] of entries){ r -= w; if(r<=0) return k; }
  return entries[entries.length-1][0];
}
function randomDateISO(days=60){
  const now = new Date();
  const d = new Date(now.getTime() - Math.floor(Math.random()*days)*24*3600*1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

// Generate sessions with a built-in correlated structure (latent factors) to make the UX believable.
function genSessions(protocol, n){
  const out = [];
  const deviceW = {Laptop:0.52, Desktop:0.26, Mobile:0.22};
  const browserW = {Chrome:0.62, Safari:0.20, Edge:0.10, Firefox:0.08};
  const groupW = {A:0.50, B:0.50};

  for(let i=0;i<n;i++){
    const device = pickWeighted(deviceW);
    const browser = pickWeighted(browserW);
    const group = pickWeighted(groupW);
    const block = 1 + Math.floor(Math.random()*3);
    const date = randomDateISO();

    // Latents
    // attention: higher -> more on target, fewer off events, faster return
    // arousal: higher -> higher arousal_mean, slightly worse accuracy and more variability
    // fatigue: higher -> blink_rate up, qc down
    let attention = randn()*0.9 + (group==="A"? 0.25 : -0.10) + (block===3? -0.20 : 0.0);
    let arousal = randn()*0.8 + (group==="B"? 0.22 : -0.05) + (block===2? 0.15 : 0.0);
    let fatigue  = randn()*0.7 + (device==="Mobile"? 0.30 : device==="Laptop"? 0.10 : -0.05) + (block===3? 0.20 : 0);

    // QC driver (tech risk + fatigue)
    let techRisk = (device==="Mobile"? 0.28 : device==="Laptop"? 0.13 : 0.08) + (browser==="Safari"?0.06:0) + (browser==="Firefox"?0.05:0);
    let qc = 86 + (attention*2.6) - (fatigue*4.2) - (techRisk*28) + randn()*4.5;
    qc = clamp(qc, 20, 99);

    // Metrics
    const gaze_on = clamp(62 + attention*12 - fatigue*2.5 + randn()*4.0, 10, 98);
    const gaze_off = clamp(18 - attention*4.2 + fatigue*1.2 + randn()*2.8, 0, 60);
    const gaze_ret = clamp(420 - attention*55 + fatigue*18 + randn()*22, 120, 900);

    const blink_rate = clamp(14 + fatigue*5.2 - attention*1.2 + randn()*2.2, 2, 38);
    const blink_long = clamp(0.10 + fatigue*0.06 + randn()*0.03, 0.01, 0.55);

    const arousal_mean = clamp(0.42 + arousal*0.14 + randn()*0.05, 0.05, 0.98);
    const valence_mean = clamp(0.02 + (group==="A"? 0.05:-0.03) - arousal*0.03 + randn()*0.07, -0.75, 0.75);

    // Errors: better attention -> fewer omissions, but high arousal -> more commissions (tradeoff)
    const omission_rate = clamp(0.08 - attention*0.025 + fatigue*0.015 + randn()*0.02, 0.0, 0.35);
    const commission_rate = clamp(0.06 + arousal*0.020 - attention*0.008 + randn()*0.018, 0.0, 0.30);

    // Speed-accuracy composite: attention helps, errors hurt, qc helps
    const speed_accuracy_index = clamp(
      0.55 + attention*0.09 - omission_rate*0.9 - commission_rate*0.7 + (qc-80)/200 + randn()*0.05,
      0.05, 0.95
    );

    out.push({
      session_id: `${protocol.replace(/\W+/g,'_')}_${i+1}`,
      org: "HSE",
      project: "Pilot 01",
      protocol,
      block,
      group,
      device,
      browser,
      date,
      qc_score: Math.round(qc),
      gaze_on_target_pct: gaze_on,
      gaze_off_count: gaze_off,
      gaze_return_latency_mean: gaze_ret,
      blink_rate,
      blink_long_frac: blink_long,
      valence_mean,
      arousal_mean,
      omission_rate,
      commission_rate,
      speed_accuracy_index
    });
  }
  return out;
}

/* ------------------------- FILTERS ------------------------- */
function initSelect(selectId, values, addAll=true, allText="Все"){
  const sel = $(selectId);
  sel.innerHTML = "";
  if(addAll){
    const opt = document.createElement("option");
    opt.value = "all"; opt.textContent = allText;
    sel.appendChild(opt);
  }
  values.forEach(v=>{
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    sel.appendChild(opt);
  });
}
function getDatasetKey(){
  // single dataset for demo
  return Object.keys(DATASETS)[0];
}
function getAllSessions(){
  const key = getDatasetKey();
  return DATASETS[key].sessions;
}
function applyFilters(base){
  const protocol = $("protocolSelect").value;
  const block = $("blockSelect").value;
  const group = $("groupSelect").value;
  const qc = $("qcSelect").value;
  const qcThr = qc==="all" ? null : parseInt(qc,10);

  return base.filter(s=>{
    if(protocol!=="all" && s.protocol!==protocol) return false;
    if(block!=="all" && String(s.block)!==block) return false;
    if(group!=="all" && s.group!==group) return false;
    if(qcThr!==null && s.qc_score < qcThr) return false;
    return true;
  });
}

/* ------------------------- STATS ------------------------- */
function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : NaN; }
function variance(arr){
  if(arr.length<2) return NaN;
  const m = mean(arr);
  let s = 0;
  for(const x of arr){ s += (x-m)*(x-m); }
  return s/(arr.length-1);
}
function std(arr){ const v = variance(arr); return isFinite(v)? Math.sqrt(v):NaN; }

function pearson(x, y){
  const n = Math.min(x.length, y.length);
  if(n<3) return {r:NaN, n};
  const mx = mean(x), my = mean(y);
  let sxx=0, syy=0, sxy=0;
  for(let i=0;i<n;i++){
    const dx = x[i]-mx, dy = y[i]-my;
    sxx += dx*dx; syy += dy*dy; sxy += dx*dy;
  }
  const r = (sxx>0 && syy>0) ? (sxy/Math.sqrt(sxx*syy)) : NaN;
  return {r, n};
}
function rankData(a){
  // average ranks for ties
  const n = a.length;
  const idx = Array.from({length:n}, (_,i)=>i);
  idx.sort((i,j)=>a[i]-a[j]);
  const ranks = new Array(n);
  let i=0;
  while(i<n){
    let j=i;
    while(j+1<n && a[idx[j+1]]===a[idx[i]]) j++;
    const avgRank = (i + j)/2 + 1; // 1-based
    for(let k=i;k<=j;k++) ranks[idx[k]] = avgRank;
    i = j+1;
  }
  return ranks;
}
function spearman(x,y){
  const rx = rankData(x);
  const ry = rankData(y);
  return pearson(rx, ry);
}
function approxPValue(r, n){
  if(!isFinite(r) || n<3) return NaN;
  const df = n-2;
  const t = Math.abs(r) * Math.sqrt(df / Math.max(1e-12, (1-r*r)));
  // Approximate 2-sided p with normal tail for moderate/large df (UX level)
  // Using erfc approximation
  const p = 2 * (1 - normalCdf(t)); // treat t as z-ish; good enough for demo
  return clamp(p, 0, 1);
}
function normalCdf(z){
  // Abramowitz-Stegun approximation
  const sign = z<0 ? -1 : 1;
  z = Math.abs(z)/Math.sqrt(2);
  const t = 1/(1+0.3275911*z);
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429;
  const erf = 1 - (((((a5*t + a4)*t) + a3)*t + a2)*t + a1)*t*Math.exp(-z*z);
  return 0.5*(1 + sign*erf);
}
function zScores(arr){
  const m = mean(arr), s = std(arr);
  if(!isFinite(m) || !isFinite(s) || s===0) return arr.map(()=>0);
  return arr.map(x => (x-m)/s);
}
function filterPairPoints(points, outlierOn){
  // points: [{x,y,meta}]
  if(!outlierOn || points.length<10) return points;
  const xs = points.map(p=>p.x), ys = points.map(p=>p.y);
  const zx = zScores(xs), zy = zScores(ys);
  const out = [];
  for(let i=0;i<points.length;i++){
    if(Math.abs(zx[i])>3 || Math.abs(zy[i])>3) continue;
    out.push(points[i]);
  }
  return out;
}

/* ------------------------- VIS: CORR MATRIX ------------------------- */
function clearSvg(svg){ while(svg.firstChild) svg.removeChild(svg.firstChild); }
function drawMatrix(svgId, metrics, corr, opts){
  const svg = $(svgId);
  clearSvg(svg);

  // --- Dynamic paddings so the matrix fits nicely inside the card ---
  // We approximate label width by character count (works well for monospace-ish dashboard fonts).
  const maxLen = Math.max(...metrics.map(m => (m.label||"?").length));
  const estLabelW = maxLen * 6.2; // px-ish

  const pad = {
    l: clamp(70 + estLabelW, 140, 220),
    r: clamp(20 + maxLen * 2.6, 46, 120),
    // rotated x-labels need real headroom, otherwise they get clipped
    t: clamp(80 + maxLen * 3.2, 110, 190),
    b: 18
  };

  const n = metrics.length;
  const cell = 34; // fixed for readability
  const gridW = n*cell;
  const gridH = n*cell;

  // Make viewBox match the actual content bounds.
  const vbH = pad.t + gridH + pad.b;
  const vbW = pad.l + gridW + pad.r;
  svg.setAttribute("viewBox", `0 0 ${vbW} ${vbH}`);

  // Ensure the SVG expands to the available width (no wasted left space)
  // while still allowing horizontal scroll if the card gets narrow.
  svg.style.minWidth = "100%";

  // helper to avoid text stealing clicks
  const noPointer = (el)=>{ el.style.pointerEvents = "none"; };

  // Title small axis text
  const title = document.createElementNS("http://www.w3.org/2000/svg","text");
  title.setAttribute("x", pad.l);
  title.setAttribute("y", 18);
  title.setAttribute("fill", "rgba(100,116,139,.85)");
  title.setAttribute("font-size", "11");
  title.setAttribute("font-weight", "800");
  title.textContent = "r (click cell)";
  noPointer(title);
  svg.appendChild(title);

  // labels (y)
  metrics.forEach((m, i)=>{
    const y = pad.t + i*cell + cell*0.70;
    const tx = document.createElementNS("http://www.w3.org/2000/svg","text");
    tx.setAttribute("x", pad.l-10);
    tx.setAttribute("y", y);
    tx.setAttribute("text-anchor","end");
    tx.setAttribute("fill","rgba(100,116,139,.92)");
    tx.setAttribute("font-size","12");
    tx.setAttribute("font-weight","800");
    tx.textContent = m.label;
    noPointer(tx);
    svg.appendChild(tx);
  });

  // labels (x) rotated
  metrics.forEach((m, j)=>{
    const x = pad.l + j*cell + cell*0.50;
    const y = pad.t - 12;
    const tx = document.createElementNS("http://www.w3.org/2000/svg","text");
    tx.setAttribute("x", x);
    tx.setAttribute("y", y);
    tx.setAttribute("text-anchor","start");
    tx.setAttribute("fill","rgba(100,116,139,.92)");
    tx.setAttribute("font-size","12");
    tx.setAttribute("font-weight","800");
    tx.setAttribute("transform", `rotate(-60 ${x} ${y})`);
    tx.textContent = m.label;
    noPointer(tx);
    svg.appendChild(tx);
  });

  // grid background
  const bg = document.createElementNS("http://www.w3.org/2000/svg","rect");
  bg.setAttribute("x", pad.l);
  bg.setAttribute("y", pad.t);
  bg.setAttribute("width", gridW);
  bg.setAttribute("height", gridH);
  bg.setAttribute("rx", 12);
  bg.setAttribute("fill","rgba(255,255,255,.20)");
  bg.setAttribute("stroke","rgba(92,102,189,.14)");
  bg.style.pointerEvents = "none";
  svg.appendChild(bg);

  // cells
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++){
      const info = corr[i][j];
      const x = pad.l + j*cell;
      const y = pad.t + i*cell;

      // Group cell so hit-area always matches the visible square
      const g = document.createElementNS("http://www.w3.org/2000/svg","g");

      const rect = document.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x", x+1);
      rect.setAttribute("y", y+1);
      rect.setAttribute("width", cell-2);
      rect.setAttribute("height", cell-2);
      rect.setAttribute("rx", 8);

      let fill = "rgba(92,102,189,.08)";
      let txt = "·";
      let isBelowThr = false;

      if(i===j){
        fill = "rgba(92,102,189,.08)";
        txt = "1.00";
      } else if(info && info.n>=opts.minN && isFinite(info.r)){
        const r = info.r;
        const a = clamp(Math.abs(r), 0, 1);

        // Base (full) alpha encodes strength
        let alpha = (r>=0 ? (0.12 + 0.62*a) : (0.10 + 0.62*a));

        // If threshold is set: visually dim cells that don't pass |r| ≥ thr
        const thr = (opts && isFinite(opts.thr)) ? opts.thr : 0;
        isBelowThr = (thr>0 && Math.abs(r) < thr);

        // Dim but keep the value visible (still clickable)
        if(isBelowThr) alpha *= 0.18;

        fill = r>=0 ? `rgba(59,130,246,${alpha})` : `rgba(248,113,113,${alpha})`;
        txt = (Math.round(r*100)/100).toFixed(2);

        // store flag on group via dataset later (optional)
      }

      rect.setAttribute("fill", fill);
      rect.setAttribute("stroke","rgba(15,23,42,.08)");
      rect.style.cursor = (i===j) ? "default" : "pointer";

      if(i!==j){
        // attach listeners to the group so clicking ANYWHERE inside the square works
        g.addEventListener("mousemove", (ev)=>{
          const info2 = corr[i][j];
          showTip(ev.clientX, ev.clientY, tipHTML(metrics[i], metrics[j], info2, opts));
        });
        g.addEventListener("mouseleave", hideTip);
        g.addEventListener("click", ()=>{ selectPair(metrics[i].key, metrics[j].key); });
      }

      g.appendChild(rect);

      const t = document.createElementNS("http://www.w3.org/2000/svg","text");
      t.setAttribute("x", x + cell/2);
      t.setAttribute("y", y + cell/2 + 4);
      t.setAttribute("text-anchor","middle");
      t.setAttribute("fill","rgba(17,24,39,.94)");
      t.setAttribute("font-size","11");
      t.setAttribute("font-weight","950");
      t.textContent = txt;
      if(txt==="·") { t.setAttribute("fill","rgba(100,116,139,.75)"); t.setAttribute("font-weight","800"); }
      if(i===j) { t.setAttribute("fill","rgba(15,23,42,.90)"); }
      if(isBelowThr && txt!=="·") { t.setAttribute("fill","rgba(100,116,139,.75)"); t.setAttribute("font-weight","900"); }
      noPointer(t); // IMPORTANT: text must not steal clicks/hover
      g.appendChild(t);

      svg.appendChild(g);
    }
  }
}

function tipHTML(mi, mj, info, opts){
  if(!info || !isFinite(info.r)) return `<div><b>${esc(mi.label)} × ${esc(mj.label)}</b><div class="muted">нет данных</div></div>`;
  const ok = info.n >= opts.minN;
  return `<div><b>${esc(mi.label)} × ${esc(mj.label)}</b></div>
  <div class="muted">r=${fmt(info.r,2)} · p≈${fmt(info.p,3)} · N=${info.n}${ok?'':' (too small)'}</div>
  <div class="muted">click → scatter</div>`;
}

/* ------------------------- VIS: NETWORK ------------------------- */
function drawNetwork(svgId, metrics, edges, opts){
  const svg = $(svgId);
  clearSvg(svg);

  // Keep a stable coordinate system; the <g> with graph content is scaled-to-fit.
  const W = 900, H = 620;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  // Layout params
  const nodeR = 18;
  const bounds = {l: 40, r: W-40, t: 56, b: H-56};

  // Nodes initial positions on a larger circle (so it can expand into the card)
  const cx=W/2, cy=H/2 + 6, R=Math.min(W,H)*0.36;
  const nodes = metrics.map((m, i)=>({
    key:m.key, label:m.label,
    x: cx + R*Math.cos((2*Math.PI*i)/metrics.length),
    y: cy + R*Math.sin((2*Math.PI*i)/metrics.length),
    vx:0, vy:0
  }));
  const nodeByKey = new Map(nodes.map(n=>[n.key,n]));

  // Simple force-directed relax (deterministic, lightweight)
  const K = 92;          // repulsion scale
  const steps = 260;
  for(let s=0;s<steps;s++){
    // repulsion
    for(let i=0;i<nodes.length;i++){
      for(let j=i+1;j<nodes.length;j++){
        const a=nodes[i], b=nodes[j];
        let dx=a.x-b.x, dy=a.y-b.y;
        let d2 = dx*dx+dy*dy + 0.01;
        const f = (K*K)/d2;
        const invD = 1/Math.sqrt(d2);
        a.vx += dx*invD*f*0.020;
        a.vy += dy*invD*f*0.020;
        b.vx -= dx*invD*f*0.020;
        b.vy -= dy*invD*f*0.020;
      }
    }
    // springs along edges
    for(const e of edges){
      const a = nodeByKey.get(e.a);
      const b = nodeByKey.get(e.b);
      if(!a||!b) continue;
      const dx=b.x-a.x, dy=b.y-a.y;
      const dist = Math.sqrt(dx*dx+dy*dy)+1e-6;
      const target = 190 - 90*Math.abs(e.r); // stronger corr -> shorter
      const f = (dist - target)*0.015;
      a.vx += (dx/dist)*f;
      a.vy += (dy/dist)*f;
      b.vx -= (dx/dist)*f;
      b.vy -= (dy/dist)*f;
    }
    // integrate + damping + bounds
    for(const n of nodes){
      n.vx *= 0.84; n.vy *= 0.84;
      n.x += n.vx; n.y += n.vy;
      n.x = clamp(n.x, bounds.l, bounds.r);
      n.y = clamp(n.y, bounds.t, bounds.b);
    }
  }

  // Title (not scaled)
  const title = document.createElementNS("http://www.w3.org/2000/svg","text");
  title.setAttribute("x", 18);
  title.setAttribute("y", 18);
  title.setAttribute("fill", "rgba(100,116,139,.85)");
  title.setAttribute("font-size", "12");
  title.setAttribute("font-weight", "900");
  title.textContent = `Network view (|r| ≥ ${fmt(opts.thr,2)})`;
  svg.appendChild(title);

  // Group with content, then scale-to-fit so it occupies more of the block.
  const g = document.createElementNS("http://www.w3.org/2000/svg","g");
  svg.appendChild(g);

  // Compute scale-to-fit (so the network uses the available space)
  const labelExtra = 34; // bottom label
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for(const n of nodes){
    minX = Math.min(minX, n.x-nodeR);
    maxX = Math.max(maxX, n.x+nodeR);
    minY = Math.min(minY, n.y-nodeR);
    maxY = Math.max(maxY, n.y+nodeR+labelExtra);
  }
  const contentW = Math.max(1, maxX-minX);
  const contentH = Math.max(1, maxY-minY);
  const padFit = 26;

  // allow upscaling: if the graph is small, make it bigger
  const scale = Math.min((W-2*padFit)/contentW, (H-2*padFit)/contentH, 2.2);
  const centerX = (minX+maxX)/2;
  const centerY = (minY+maxY)/2;
  const tx = W/2 - scale*centerX;
  const ty = H/2 - scale*centerY;
  g.setAttribute("transform", `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(3)})`);

  // Edges (in group so they are scaled)
  edges.forEach(e=>{
    const a = nodeByKey.get(e.a);
    const b = nodeByKey.get(e.b);
    if(!a||!b) return;

    const line = document.createElementNS("http://www.w3.org/2000/svg","line");
    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
    const w = 1.6 + 6.0*Math.abs(e.r);
    line.setAttribute("stroke-width", w.toFixed(2));
    line.setAttribute("stroke", e.r>=0 ? `rgba(59,130,246,${0.22+0.60*Math.abs(e.r)})` : `rgba(248,113,113,${0.20+0.60*Math.abs(e.r)})`);
    line.setAttribute("stroke-linecap","round");
    line.style.cursor = "pointer";

    line.addEventListener("mousemove", (ev)=>{
      showTip(ev.clientX, ev.clientY, `<div><b>${esc(e.aLabel)} × ${esc(e.bLabel)}</b></div>
      <div class="muted">r=${fmt(e.r,2)} · p≈${fmt(e.p,3)} · N=${e.n}</div>
      <div class="muted">click → scatter</div>`);
    });
    line.addEventListener("mouseleave", hideTip);
    line.addEventListener("click", ()=> selectPair(e.a, e.b));

    g.appendChild(line);
  });

  // Nodes (in group so they are scaled)
  nodes.forEach(n=>{
    const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx", n.x); c.setAttribute("cy", n.y);
    c.setAttribute("r", nodeR);
    c.setAttribute("fill","rgba(31,41,55,.95)");
    c.setAttribute("stroke","rgba(96,165,250,.40)");
    g.appendChild(c);

    const t = document.createElementNS("http://www.w3.org/2000/svg","text");
    t.setAttribute("x", n.x);
    t.setAttribute("y", n.y + 5);
    t.setAttribute("text-anchor","middle");
    t.setAttribute("fill","rgba(15,23,42,.93)");
    t.setAttribute("font-size","11");
    t.setAttribute("font-weight","950");
    t.textContent = shortLabel(n.label);
    t.style.pointerEvents = "none";
    g.appendChild(t);

    const tl = document.createElementNS("http://www.w3.org/2000/svg","text");
    tl.setAttribute("x", n.x);
    tl.setAttribute("y", n.y + 32);
    tl.setAttribute("text-anchor","middle");
    tl.setAttribute("fill","rgba(156,163,175,.88)");
    tl.setAttribute("font-size","10.5");
    tl.setAttribute("font-weight","800");
    tl.textContent = n.label;
    tl.style.pointerEvents = "none";
    g.appendChild(tl);
  });
}
function shortLabel(s){
  // compact node label
  const parts = String(s).split("_");
  if(parts.length===1) return parts[0].slice(0,6);
  const last = parts[parts.length-1];
  return (parts[0][0]+parts[1][0]+(last?last[0]:"")).toUpperCase();
}

/* ------------------------- VIS: SCATTER ------------------------- */
function drawScatter(svgId, pts, xLabel, yLabel, stats){
  const svg = $(svgId);
  clearSvg(svg);

  const W = svg.viewBox.baseVal.width || 520;
  const H = svg.viewBox.baseVal.height || 320;
  const pad = {l:54,r:14,t:16,b:42};
  const w = W-pad.l-pad.r;
  const h = H-pad.t-pad.b;

  if(!pts.length){
    const tx = document.createElementNS("http://www.w3.org/2000/svg","text");
    tx.setAttribute("x", 16); tx.setAttribute("y", 28);
    tx.setAttribute("fill", "rgba(100,116,139,.90)");
    tx.setAttribute("font-size","12");
    tx.textContent = "Нет данных по текущим фильтрам.";
    svg.appendChild(tx);
    return;
  }

  const xs = pts.map(p=>p.x);
  const ys = pts.map(p=>p.y);
  const xmin = Math.min(...xs), xmax=Math.max(...xs);
  const ymin = Math.min(...ys), ymax=Math.max(...ys);
  const xpad = (xmax-xmin)*0.06 || 1;
  const ypad = (ymax-ymin)*0.06 || 1;

  const x0 = xmin-xpad, x1=xmax+xpad;
  const y0 = ymin-ypad, y1=ymax+ypad;

  const X = (x)=> pad.l + ( (x-x0)/(x1-x0) )*w;
  const Y = (y)=> pad.t + (1 - ( (y-y0)/(y1-y0) ))*h;

  // grid
  for(let i=0;i<=4;i++){
    const xx = pad.l + w*(i/4);
    const v = document.createElementNS("http://www.w3.org/2000/svg","line");
    v.setAttribute("x1", xx); v.setAttribute("x2", xx);
    v.setAttribute("y1", pad.t); v.setAttribute("y2", pad.t+h);
    v.setAttribute("stroke","rgba(92,102,189,.08)");
    svg.appendChild(v);
  }
  for(let j=0;j<=4;j++){
    const yy = pad.t + h*(j/4);
    const v = document.createElementNS("http://www.w3.org/2000/svg","line");
    v.setAttribute("x1", pad.l); v.setAttribute("x2", pad.l+w);
    v.setAttribute("y1", yy); v.setAttribute("y2", yy);
    v.setAttribute("stroke","rgba(92,102,189,.08)");
    svg.appendChild(v);
  }

  // regression line (UX): y = a + b x
  if(stats && isFinite(stats.b) && isFinite(stats.a)){
    const xA = x0, xB = x1;
    const yA = stats.a + stats.b*xA;
    const yB = stats.a + stats.b*xB;

    const ln = document.createElementNS("http://www.w3.org/2000/svg","line");
    ln.setAttribute("x1", X(xA)); ln.setAttribute("y1", Y(yA));
    ln.setAttribute("x2", X(xB)); ln.setAttribute("y2", Y(yB));
    ln.setAttribute("stroke","rgba(119,169,232,.80)");
    ln.setAttribute("stroke-width","2.5");
    ln.setAttribute("stroke-dasharray","4 4");
    svg.appendChild(ln);
  }

  // points
  pts.forEach(p=>{
    const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
    c.setAttribute("cx", X(p.x));
    c.setAttribute("cy", Y(p.y));
    c.setAttribute("r", 4.2);
    c.setAttribute("fill","rgba(92,102,189,.62)");
    c.setAttribute("stroke","rgba(119,169,232,.60)");
    c.addEventListener("mousemove", (ev)=>{
      showTip(ev.clientX, ev.clientY, `<div><b>${esc(p.meta.session_id)}</b></div>
      <div class="muted">protocol=${esc(p.meta.protocol)} · block=${p.meta.block} · group=${p.meta.group}</div>
      <div class="muted">${esc(xLabel)}=${fmt(p.x,2)} · ${esc(yLabel)}=${fmt(p.y,2)} · qc=${p.meta.qc_score}</div>`);
    });
    c.addEventListener("mouseleave", hideTip);
    svg.appendChild(c);
  });

  // axes labels
  const xT = document.createElementNS("http://www.w3.org/2000/svg","text");
  xT.setAttribute("x", pad.l + w/2);
  xT.setAttribute("y", H-14);
  xT.setAttribute("text-anchor","middle");
  xT.setAttribute("fill","rgba(100,116,139,.92)");
  xT.setAttribute("font-size","11");
  xT.textContent = xLabel;
  svg.appendChild(xT);

  const yT = document.createElementNS("http://www.w3.org/2000/svg","text");
  yT.setAttribute("x", 14);
  yT.setAttribute("y", pad.t + h/2);
  yT.setAttribute("text-anchor","middle");
  yT.setAttribute("fill","rgba(100,116,139,.92)");
  yT.setAttribute("font-size","11");
  yT.setAttribute("transform", `rotate(-90 14 ${pad.t + h/2})`);
  yT.textContent = yLabel;
  svg.appendChild(yT);
}
function linreg(x,y){
  const n = Math.min(x.length,y.length);
  if(n<2) return {a:NaN,b:NaN};
  const mx=mean(x), my=mean(y);
  let sxx=0, sxy=0;
  for(let i=0;i<n;i++){
    const dx = x[i]-mx;
    sxx += dx*dx;
    sxy += dx*(y[i]-my);
  }
  const b = sxx>0 ? sxy/sxx : NaN;
  const a = my - b*mx;
  return {a,b};
}

/* ------------------------- TOOLTIP ------------------------- */
const TIP = $("tip");
function showTip(x,y,html){
  TIP.innerHTML = html;
  const pad = 14;
  let left = x + pad;
  let top = y + pad;
  const bw = 340;
  const bh = 120;
  if(left + bw > window.innerWidth) left = x - bw - pad;
  if(top + bh > window.innerHeight) top = y - bh - pad;
  TIP.style.left = left + "px";
  TIP.style.top = top + "px";
  TIP.style.opacity = "1";
  TIP.style.transform = "translateY(0)";
}
function hideTip(){
  TIP.style.opacity = "0";
  TIP.style.transform = "translateY(6px)";
}

/* ------------------------- CORE PIPELINE ------------------------- */
let SELECTED = {x: METRICS[0].key, y: METRICS[7].key}; // default pair

function computeCorrMatrix(sessions, metrics, method, minN){
  const n = metrics.length;
  const mat = Array.from({length:n}, ()=>Array.from({length:n}, ()=>({r:NaN,p:NaN,n:0})));
  for(let i=0;i<n;i++){
    for(let j=0;j<n;j++){
      const ki = metrics[i].key, kj = metrics[j].key;
      const xs=[], ys=[];
      for(const s of sessions){
        const a = s[ki], b = s[kj];
        if(typeof a==="number" && isFinite(a) && typeof b==="number" && isFinite(b)){
          xs.push(a); ys.push(b);
        }
      }
      const res = (method==="spearman") ? spearman(xs,ys) : pearson(xs,ys);
      const p = approxPValue(res.r, res.n);
      mat[i][j] = {r:res.r, p, n:res.n};
    }
  }
  return mat;
}

function buildEdges(metrics, mat, thr, minN){
  const edges = [];
  const n = metrics.length;
  for(let i=0;i<n;i++){
    for(let j=i+1;j<n;j++){
      const info = mat[i][j];
      if(!info || info.n<minN || !isFinite(info.r)) continue;
      if(Math.abs(info.r) < thr) continue;
      edges.push({
        a: metrics[i].key, b: metrics[j].key,
        aLabel: metrics[i].label, bLabel: metrics[j].label,
        r: info.r, p: info.p, n: info.n
      });
    }
  }
  edges.sort((e1,e2)=>Math.abs(e2.r)-Math.abs(e1.r));
  return edges;
}

function selectPair(xKey, yKey){
  if(xKey===yKey) return;
  SELECTED = {x:xKey, y:yKey};
  renderAll();
}

function pairHintText(xKey,yKey){
  // lightweight heuristics (for UX)
  const pair = `${xKey}__${yKey}`;
  const has = (a,b)=> (pair.includes(a) && pair.includes(b));
  if(has("gaze_on_target_pct","omission_rate")) return "Ожидаемо: больше времени “на цели” → меньше omissions.";
  if(has("blink_rate","speed_accuracy_index")) return "Гипотеза: рост blink_rate при усталости может идти с падением performance.";
  if(has("arousal_mean","commission_rate")) return "Trade‑off: выше arousal иногда связан с ростом impulsive errors (commissions).";
  if(has("qc_score","gaze_on_target_pct")) return "QC может выступать конфаундом: плохой сигнал занижает gaze_on_target.";
  return "Проверьте устойчивость: сравните Pearson vs Spearman и измените QC‑порог.";
}

function renderTables(edges){
  // Sidebar edges (removed in minimal UI)
  const tb = $("edgeTable");
  if(tb){
    tb.innerHTML = "";
    const top = edges.slice(0, 10);
    for(const e of top){
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(e.aLabel)} × ${esc(e.bLabel)}</td>
      <td>${fmt(e.r,2)}</td>
      <td>${e.n}</td>`;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", ()=> selectPair(e.a, e.b));
    tb.appendChild(tr);
    }
  }

  // Top correlations table (main)
  const tb2 = $("topCorrTable");
  tb2.innerHTML = "";
  const top8 = edges.slice(0, 8);
  for(const e of top8){
    const note = pairHintText(e.a, e.b);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${esc(e.aLabel)} × ${esc(e.bLabel)}</td>
      <td>${fmt(e.r,2)}</td>
      <td>${fmt(e.p,3)}</td>
      <td>${e.n}</td>
      <td>${esc(note)}</td>`;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", ()=> selectPair(e.a, e.b));
    tb2.appendChild(tr);
  }

  // Sidebar advice
  const example = edges[0];
  $("sidebarAdvice").textContent = example
    ? `Начните с самых сильных связей (|r|≥${fmt($("thrRange").value,2)}). Например: ${example.aLabel} × ${example.bLabel} (r=${fmt(example.r,2)}). Затем проверьте, сохраняется ли структура при изменении QC‑порога и метода (Pearson/Spearman).`
    : `Поднимите/опустите QC‑порог или уменьшите threshold, чтобы увидеть рёбра и структуру сети.`;
}

function renderPair(sessions, xKey, yKey, method){
  const xMeta = METRICS.find(m=>m.key===xKey);
  const yMeta = METRICS.find(m=>m.key===yKey);
  const pts = [];
  for(const s of sessions){
    const x = s[xKey], y = s[yKey];
    if(typeof x==="number" && isFinite(x) && typeof y==="number" && isFinite(y)){
      pts.push({x, y, meta:s});
    }
  }
  const filteredPts = filterPairPoints(pts, $("outlierToggle").checked);
  const xs = filteredPts.map(p=>p.x);
  const ys = filteredPts.map(p=>p.y);
  const cr = (method==="spearman") ? spearman(xs,ys) : pearson(xs,ys);
  const p = approxPValue(cr.r, cr.n);

  const lr = linreg(xs, ys);
  drawScatter("scatterSvg", filteredPts, xMeta.label, yMeta.label, lr);

  $("pairLabel").textContent = `${xMeta.label} × ${yMeta.label}`;
  $("kpiPair").textContent = `${xMeta.label} × ${yMeta.label}`;
  $("statR").textContent = fmt(cr.r, 3);
  const rdot = $("statRdot"); if(rdot){ rdot.className = "dot " + (cr.r>=0 ? "pos" : "neg"); }
  $("statP").textContent = fmt(p, 4);
  $("statN").textContent = cr.n;
  $("statM").textContent = method;
  $("pairHint").textContent = pairHintText(xKey, yKey);

  const outNote = $("outlierToggle").checked ? `outliers removed: ${pts.length - filteredPts.length}` : `outliers filter off`;
  $("scatterNote").textContent = `${outNote}. Range X: ${fmt(Math.min(...xs),2)}…${fmt(Math.max(...xs),2)}, Y: ${fmt(Math.min(...ys),2)}…${fmt(Math.max(...ys),2)}.`;
  $("scatterSub").textContent = $("outlierToggle").checked
    ? "Включён фильтр выбросов (|z|>3) для выбранной пары."
    : "Показываем все точки (без выброс‑фильтра).";
}

function renderAll(){
  const all = getAllSessions();
  const sessions = applyFilters(all);

  const method = $("methodSelect").value;
  const thr = parseFloat($("thrRange").value);
  const minN = parseInt($("minN").value,10) || 25;

  $("thrVal").textContent = fmt(thr,2);
  $("kpiThr").textContent = fmt(thr,2);
  $("kpiMethod").textContent = method;
  $("kpiN").textContent = sessions.length;

  const key = getDatasetKey();
  $("datasetName").textContent = key;

  const mat = computeCorrMatrix(sessions, METRICS, method, minN);
  drawMatrix("corrMatrix", METRICS, mat, {minN, thr});

  const edges = buildEdges(METRICS, mat, thr, minN);
  $("kpiEdges").textContent = edges.length;

  // Switch view
  const mode = document.querySelector("#viewMode button.active").dataset.mode;
  if(mode==="matrix"){
    $("matrixWrap").style.display = "";
    $("networkWrap").style.display = "none";
    $("matrixTitle").textContent = "correlation matrix";
    $("matrixSub").textContent = "Цвет и насыщенность показывают знак и силу связи. Наведите на ячейку для подсказки.";
    $("netNote").style.display = "none";
  } else {
    $("matrixWrap").style.display = "none";
    $("networkWrap").style.display = "";
    $("matrixTitle").textContent = "network view";
    $("matrixSub").textContent = "Узлы — метрики. Рёбра рисуются только для |r| ≥ threshold. Клик по ребру → scatter.";
    $("netNote").style.display = "";
    drawNetwork("netSvg", METRICS, edges, {thr});
  }

  // Pair drilldown
  renderPair(sessions, SELECTED.x, SELECTED.y, method);

  // Notes + tables
  const tooSmall = edges.filter(e=>e.n<minN).length;
  $("matrixNote").textContent = `Всего пар (без диагонали): ${METRICS.length*(METRICS.length-1)/2}. Рёбра по порогу: ${edges.length}. min N=${minN}.`;
  renderTables(edges);
}

function initUI(){
  const key = getDatasetKey();
  const d = DATASETS[key];

  initSelect("orgSelect", [d.meta.org], false);
  initSelect("projectSelect", [d.meta.project], false);

  const protocols = Array.from(new Set(d.sessions.map(s=>s.protocol))).sort();
  initSelect("protocolSelect", protocols, true, "Все протоколы");

  initSelect("blockSelect", ["1","2","3"], true, "Все блоки");
  initSelect("groupSelect", ["A","B"], true, "Все условия");

  // QC thresholds, aligned with "qc_score ≥ 0.8" idea but in 0..100 scale
  initSelect("qcSelect", ["60","70","80","85","90"], true, "Любой QC");
  $("qcSelect").value = "80";

  // Human-friendly option labels
  // block: 1/2/3 -> "Блок 1/2/3"
  Array.from($("blockSelect").options).forEach(o=>{
    if(o.value!=="all") o.textContent = `Блок ${o.value}`;
  });
  // group: A/B -> "Условие A/B"
  Array.from($("groupSelect").options).forEach(o=>{
    if(o.value!=="all") o.textContent = `Условие ${o.value}`;
  });
  // qc: 60/70/80... -> "QC ≥ 60/70/..."
  Array.from($("qcSelect").options).forEach(o=>{
    if(o.value!=="all") o.textContent = `QC ≥ ${o.value}`;
  });
  // org/project: show as labeled pills inside selects
  if($("orgSelect").options[0]) $("orgSelect").options[0].textContent = `Орг: ${d.meta.org}`;
  if($("projectSelect").options[0]) $("projectSelect").options[0].textContent = `Проект: ${d.meta.project}`;


  // Event listeners
  ["protocolSelect","blockSelect","groupSelect","methodSelect","qcSelect"].forEach(id=>{
    $(id).addEventListener("change", renderAll);
  });
  $("outlierToggle").addEventListener("change", renderAll);
  $("thrRange").addEventListener("input", ()=>{ $("thrVal").textContent = fmt(parseFloat($("thrRange").value),2); });
  $("thrRange").addEventListener("change", renderAll);
  $("minN").addEventListener("change", renderAll);

  document.querySelectorAll("#viewMode button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll("#viewMode button").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      renderAll();
    });
  });

  $("exportBtn").addEventListener("click", ()=>{
    const payload = {
      filters: {
        protocol: $("protocolSelect").value,
        block: $("blockSelect").value,
        group: $("groupSelect").value,
        method: $("methodSelect").value,
        qc_min: $("qcSelect").value,
        edge_threshold: $("thrRange").value,
        minN: $("minN").value,
        exclude_outliers_for_pair: $("outlierToggle").checked
      },
      selection: { x: SELECTED.x, y: SELECTED.y },
      metrics: METRICS.map(m=>({key:m.key,label:m.label,channel:m.channel})),
      // For UX demo export: keep it compact
      n_sessions: applyFilters(getAllSessions()).length,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "connectedness_dashboard_export.json";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  });

  // Set default pair
  SELECTED = {x:"gaze_on_target_pct", y:"omission_rate"};
  $("kpiPair").textContent = "gaze_on_target_pct × omission_rate";
}

initUI();
renderAll();

  })();
}

//(Аня)
