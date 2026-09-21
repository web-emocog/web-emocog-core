/**
 * Researcher UI ↔ platform API adapter (PR25 layer).
 * Does not modify participant flow, ingest schema, or metric naming on the server.
 * Never falls back to demo/mock analytics in the production route.
 */
(function (global) {
  'use strict';

  const PROJECT_ID_KEY = 'emocog_selected_project_id';
  const PROTOCOL_ID_KEY = 'emocog_selected_protocol_id';
  const SESSION_DB_ID_KEY = 'emocog_selected_session_db_id';

  function hasLiveApi() {
    try {
      return typeof global.apiGet === 'function' && (
        typeof global.hasResearcherApiToken === 'function'
          ? global.hasResearcherApiToken()
          : localStorage.getItem('emocog_developer_auth') === '1'
      );
    } catch (_) {
      return false;
    }
  }

  function toFinite(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function validityToClass(v) {
    const s = String(v || '').toLowerCase();
    if (s === 'valid') return 'VALID';
    if (s === 'borderline') return 'BORDERLINE';
    if (s === 'invalid') return 'INVALID';
    return s ? s.toUpperCase() : 'UNKNOWN';
  }

  function severityFromCheck(ok) {
    if (ok === true) return 'ok';
    if (ok === false) return 'warn';
    return 'neutral';
  }

  function buildQcReasons(row, features) {
    const reasons = [];
    const fail = Array.isArray(row.qc_fail_reasons)
      ? row.qc_fail_reasons
      : (Array.isArray(row.fail_reasons) ? row.fail_reasons : []);
    fail.forEach((code) => {
      reasons.push({ label: String(code), value: '—', severity: 'warn' });
    });
    const qcPayload = row.qc_payload || row.qc_summary_payload || {};
    const checks = qcPayload.checks && typeof qcPayload.checks === 'object' ? qcPayload.checks : {};
    const checksFeatures = features && features.qcSummary && features.qcSummary.checks
      ? features.qcSummary.checks
      : {};
    const merged = Object.assign({}, checksFeatures, checks);
    Object.keys(merged).forEach((k) => {
      const val = merged[k];
      if (val == null) return;
      reasons.push({
        label: k.replace(/_/g, ' '),
        value: typeof val === 'boolean' ? (val ? 'ok' : 'fail') : String(val),
        severity: typeof val === 'boolean' ? severityFromCheck(val) : 'ok',
      });
    });
    if (!reasons.length && row.qc_score != null) {
      reasons.push({ label: 'qc_score', value: String(row.qc_score), severity: 'ok' });
    }
    return reasons;
  }

  function pickMetric(features, proxy, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = toFinite(features && features[keys[i]]);
      if (v != null) return v;
    }
    for (let j = 0; j < keys.length; j++) {
      const v2 = toFinite(proxy && proxy[keys[j]]);
      if (v2 != null) return v2;
    }
    return null;
  }

  function mapBlocks(features, proxy) {
    const blocks = Array.isArray(features && features.blocks) ? features.blocks : [];
    if (blocks.length) {
      return blocks.map((b, idx) => ({
        name: b.name || `Block_${idx + 1}`,
        duration_sec: toFinite(b.duration_sec),
        valid_pct: b.valid_pct != null ? String(b.valid_pct) : '—',
        qc_score: toFinite(b.qc_score) ?? toFinite(proxy && proxy.payload && proxy.payload.qc_score),
        reasons: Array.isArray(b.reasons) ? b.reasons : [],
        tech: b.tech || {},
        kpis: {
          gaze_on_target_pct: toFinite(b.attention) ?? toFinite(b.gaze_on_target_pct),
        },
        validity_class: validityToClass(b.validity_class || b.validity),
        segmentKey: b.segmentKey || 'full',
      }));
    }
    return [];
  }

  function segmentMetrics(features, proxy) {
    const gaze = pickMetric(features, proxy, [
      'gaze_on_target_pct', 'gaze_on_target', 'attention_score',
    ]) ?? toFinite(proxy && proxy.attention_score);
    const valence = pickMetric(features, proxy, [
      'valence_mean', 'emotion_valence_mean',
    ]) ?? toFinite(proxy && proxy.emotion_valence_mean);
    const arousal = pickMetric(features, proxy, [
      'arousal_mean', 'emotion_arousal_mean',
    ]) ?? toFinite(proxy && proxy.emotion_arousal_mean);
    const rt = pickMetric(features, proxy, [
      'rt_mean', 'mean_rt_ms', 'rt_median',
    ]) ?? toFinite(proxy && proxy.mean_rt_ms);
    const omissions = pickMetric(features, proxy, [
      'omission_rate', 'omissions_pct',
    ]) ?? toFinite(proxy && proxy.omissions_pct);
    const blinks = pickMetric(features, proxy, [
      'blink_rate', 'blink_count',
    ]) ?? toFinite(proxy && proxy.blink_count);
    const bpm = pickMetric(features, proxy, ['bpm_mean']) ?? toFinite(proxy && proxy.bpm_mean);

    return {
      gaze_on_target: gaze,
      valence_mean: valence,
      arousal_mean: arousal,
      rt_mean: rt,
      omission_rate: omissions,
      blink_rate: blinks,
      bpm_mean: bpm,
      emotion_joy: null,
      emotion_sadness: null,
      pupil_size: null,
      fixation_duration: null,
      saccade_velocity: null,
    };
  }

  function mapSessionRowToSessionData(row) {
    const features = row.features && typeof row.features === 'object' ? row.features : {};
    const proxy = row.proxy_metrics && typeof row.proxy_metrics === 'object'
      ? row.proxy_metrics
      : (row.proxy_source_data || {});
    const seg = segmentMetrics(features, row);
    const started = row.started_at ? new Date(row.started_at) : null;
    const stopped = row.stopped_at ? new Date(row.stopped_at) : null;
    const durationSec = started && stopped
      ? Math.max(0, Math.round((stopped - started) / 1000))
      : null;

    return {
      session: {
        id: row.session_id || String(row.id || '—'),
        participant_id: row.participant_id || '—',
        duration_sec: durationSec,
        device: features.device || features.meta?.device || '—',
        browser: features.browser || features.meta?.browser || '—',
        fps_mean: pickMetric(features, proxy, ['fps_mean']),
        light: features.light || '—',
        protocol: row.protocol_id != null ? `protocol #${row.protocol_id}` : '—',
        db_id: row.id,
      },
      qc: {
        score: toFinite(row.qc_score) ?? toFinite(proxy.payload && proxy.payload.qc_score),
        class: validityToClass(row.qc_validity),
        badge: validityToClass(row.qc_validity) === 'VALID' ? 'good' : 'warn',
        reasons: buildQcReasons(row, features),
      },
      segments: {
        full: Object.assign({}, seg),
        baseline: Object.assign({}, seg),
        task: Object.assign({}, seg),
      },
      group: {
        full: Object.assign({}, seg),
        baseline: Object.assign({}, seg),
        task: Object.assign({}, seg),
      },
      blocks: mapBlocks(features, proxy),
    };
  }

  function applySessionData(target, data) {
    if (!target || !data) return;
    Object.keys(data).forEach((k) => {
      if (data[k] && typeof data[k] === 'object' && !Array.isArray(data[k])) {
        target[k] = target[k] || {};
        applySessionData(target[k], data[k]);
      } else {
        target[k] = data[k];
      }
    });
  }

  async function fetchSessions(query) {
    const q = query || {};
    const params = new URLSearchParams();
    if (q.project_id) params.set('project_id', String(q.project_id));
    if (q.protocol_id) params.set('protocol_id', String(q.protocol_id));
    if (q.qc_validity) params.set('qc_validity', String(q.qc_validity));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return global.apiGet('/sessions' + suffix);
  }

  async function fetchSessionDetail(dbId) {
    return global.apiGet('/sessions/' + encodeURIComponent(String(dbId)));
  }

  async function fetchProxyMetrics(sessionRef) {
    return global.apiGet('/sessions/' + encodeURIComponent(String(sessionRef)) + '/proxy-metrics');
  }

  function mergeProxyV1IntoSessionData(target, proxyV1) {
    if (!target || !proxyV1 || !proxyV1.metrics) return;
    const m = proxyV1.metrics;
    const val = (k) => (m[k] && m[k].value != null && isFinite(Number(m[k].value)) ? Number(m[k].value) : null);
    const seg = target.segments && target.segments.full ? target.segments.full : null;
    if (!seg) return;
    if (val('gaze_on_target_pct') != null) seg.gaze_on_target = val('gaze_on_target_pct');
    if (val('valence_mean') != null) seg.valence_mean = val('valence_mean');
    if (val('arousal_mean') != null) seg.arousal_mean = val('arousal_mean');
    if (val('rt_mean') != null) seg.rt_mean = val('rt_mean');
    if (val('omission_rate') != null) seg.omission_rate = val('omission_rate');
    if (val('blink_rate') != null) seg.blink_rate = val('blink_rate');
    if (val('bpm_mean') != null) seg.bpm_mean = val('bpm_mean');
    if (val('qc_score') != null && target.qc) target.qc.score = val('qc_score');
    target._proxy_metrics = proxyV1;
  }

  function renderProxyMetricsBanner(proxyV1, host) {
    if (!host) return;
    let el = document.getElementById('researcherProxyMetricsBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'researcherProxyMetricsBanner';
      el.style.cssText = 'font-size:12px;padding:8px 12px;border-radius:10px;border:1px solid var(--stroke);margin-bottom:10px;background:rgba(92,102,189,.06);';
      host.insertBefore(el, host.firstChild ? host.firstChild.nextSibling : null);
    }
    const status = (proxyV1 && proxyV1.status) || 'not_computed';
    const count = proxyV1 && proxyV1.metrics ? Object.keys(proxyV1.metrics).length : 0;
    const labels = {
      not_computed: 'Proxy metrics: not computed',
      partial: 'Proxy metrics: partial (ingest scalars)',
      computed: 'Proxy metrics: computed',
      failed: 'Proxy metrics: failed',
    };
    el.textContent = labels[status] || ('Proxy metrics: ' + status);
    el.title = count ? (count + ' metric entries in contract') : 'No proxy metric values yet';
  }

  async function fetchProjects() {
    return global.apiGet('/projects');
  }

  async function fetchProtocols(projectId) {
    const suffix = projectId ? `?project_id=${encodeURIComponent(String(projectId))}` : '';
    return global.apiGet('/protocols' + suffix);
  }

  function getSelectedProjectId() {
    try {
      const v = localStorage.getItem(PROJECT_ID_KEY);
      return v ? parseInt(v, 10) : null;
    } catch (_) {
      return null;
    }
  }

  function setSelectedProjectId(id, name) {
    const previous = getSelectedProjectId();
    try {
      if (id != null) localStorage.setItem(PROJECT_ID_KEY, String(id));
      if (name && global.state) global.state.project = name;
    } catch (_) {}
    if (id != null && String(previous || '') !== String(id)) {
      global.dispatchEvent(new CustomEvent('wecog:projectchange', {
        detail: { projectId: String(id), projectName: name || '' }
      }));
    }
  }

  function populateProjectSelect(projects) {
    const sel = document.getElementById('projectSelect');
    if (!sel || !Array.isArray(projects)) return;
    const current = getSelectedProjectId();
    sel.innerHTML = '<option value="">—</option>';
    projects.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name || `Project ${p.id}`;
      if (current && p.id === current) opt.selected = true;
      sel.appendChild(opt);
    });
    if (!sel.dataset.apiBridgeBound) {
      sel.dataset.apiBridgeBound = '1';
      sel.addEventListener('change', function () {
        const opt = sel.options[sel.selectedIndex];
        const pid = sel.value ? parseInt(sel.value, 10) : null;
        setSelectedProjectId(pid, opt ? opt.textContent : '');
        if (global.state && opt) global.state.project = opt.textContent;
      }, true);
    }
  }

  async function syncProjectsFromApi() {
    if (!hasLiveApi()) return false;
    try {
      const projects = await fetchProjects();
      if (projects.length && !getSelectedProjectId()) {
        setSelectedProjectId(projects[0].id, projects[0].name);
      }
      populateProjectSelect(projects);
      if (typeof global.syncProjectStimuliFromApi === 'function') {
        await global.syncProjectStimuliFromApi();
      }
      if (typeof global.syncWelcomeProjects === 'function') {
        global.syncWelcomeProjects(projects);
      }
      if (global.state && projects[0]) {
        const cur = projects.find((p) => p.id === getSelectedProjectId()) || projects[0];
        global.state.project = cur.name;
        if (cur.organization_name) global.state.org = cur.organization_name;
      }
      return true;
    } catch (e) {
      console.warn('[researcher-api-bridge] projects sync failed', e);
      if (hasLiveApi() && typeof global.toast === 'function') {
        global.toast('Не удалось загрузить библиотеку с сервера. Проверьте соединение и обновите страницу.', 'error');
      }
      return false;
    }
  }

  function injectSessionPicker(root) {
    if (!hasLiveApi() || !root) return;
    const bar = document.createElement('div');
    bar.className = 'card';
    bar.style.cssText = 'padding:12px 16px;margin-bottom:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;';
    bar.innerHTML = `
      <label style="font-size:12px;font-weight:700;color:var(--muted);">Live session</label>
      <select id="researcherSessionPicker" style="min-width:220px;padding:8px 10px;border-radius:10px;border:1px solid var(--stroke);"></select>
      <select id="researcherQcFilter" style="padding:8px 10px;border-radius:10px;border:1px solid var(--stroke);">
        <option value="">QC: all</option>
        <option value="valid">valid</option>
        <option value="borderline">borderline</option>
        <option value="invalid">invalid</option>
      </select>
      <span id="researcherSessionPickerHint" style="font-size:11px;color:var(--muted2);"></span>
    `;
    root.insertBefore(bar, root.firstChild);

    const picker = bar.querySelector('#researcherSessionPicker');
    const qcSel = bar.querySelector('#researcherQcFilter');
    const hint = bar.querySelector('#researcherSessionPickerHint');

    async function reloadList() {
      picker.disabled = true;
      hint.textContent = 'Loading…';
      try {
        const rows = await fetchSessions({
          project_id: getSelectedProjectId(),
          qc_validity: qcSel.value || undefined,
        });
        picker.innerHTML = '';
        if (!rows.length) {
          picker.innerHTML = '<option value="">No sessions</option>';
          hint.textContent = 'API: 0 sessions';
          return;
        }
        rows.forEach((r) => {
          const opt = document.createElement('option');
          opt.value = String(r.id);
          const qc = r.qc_validity ? ` · ${r.qc_validity}` : '';
          opt.textContent = `${r.session_id || r.id} · ${r.participant_id || '—'}${qc}`;
          picker.appendChild(opt);
        });
        const saved = localStorage.getItem(SESSION_DB_ID_KEY);
        if (saved) picker.value = saved;
        hint.textContent = `API: ${rows.length} session(s)`;
        if (picker.value) await loadAndApply(picker.value);
      } catch (e) {
        hint.textContent = 'API error — no data shown';
        console.warn('[researcher-api-bridge] sessions list', e);
      } finally {
        picker.disabled = false;
      }
    }

    async function loadAndApply(dbId) {
      if (!dbId || !global.SESSION_DATA) return;
      try {
        const row = await fetchSessionDetail(dbId);
        const mapped = mapSessionRowToSessionData(row);
        applySessionData(global.SESSION_DATA, mapped);
        try {
          const proxyV1 = await fetchProxyMetrics(dbId);
          mergeProxyV1IntoSessionData(global.SESSION_DATA, proxyV1);
          renderProxyMetricsBanner(proxyV1, bar);
        } catch (proxyErr) {
          console.warn('[researcher-api-bridge] proxy-metrics', proxyErr);
          renderProxyMetricsBanner({ status: 'not_computed', metrics: {} }, bar);
        }
        localStorage.setItem(SESSION_DB_ID_KEY, String(dbId));
        if (typeof global.renderSessionCardHeader === 'function') global.renderSessionCardHeader();
        if (typeof global.renderSessionMetrics === 'function') {
          const seg = document.getElementById('segmentSelect');
          global.renderSessionMetrics(seg ? seg.value : 'full');
        }
        if (typeof global.renderSessionDetail === 'function') global.renderSessionDetail();
        if (typeof global.renderBlocks === 'function') global.renderBlocks();
      } catch (e) {
        console.warn('[researcher-api-bridge] session detail', e);
        if (typeof global.toast === 'function') global.toast('Session load failed');
      }
    }

    picker.addEventListener('change', () => loadAndApply(picker.value));
    qcSel.addEventListener('change', reloadList);
    reloadList();
  }

  function buildExportViewLive() {
    const root = document.createElement('div');
    root.className = 'grid';
    root.innerHTML = `
      <div class="card" style="grid-column:span 12;">
        <h3>Экспорт данных (API)</h3>
        <p style="margin-top:8px;">Выгрузка сессий текущего проекта через <code>GET /export</code>. Формат CSV или JSON.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
          <select id="exportFormat" style="padding:8px 12px;border-radius:10px;border:1px solid var(--stroke);">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <select id="exportQc" style="padding:8px 12px;border-radius:10px;border:1px solid var(--stroke);">
            <option value="">QC: all</option>
            <option value="valid">valid</option>
            <option value="borderline">borderline</option>
            <option value="invalid">invalid</option>
          </select>
          <button type="button" id="exportDownloadBtn" style="padding:10px 18px;border-radius:12px;border:1px solid rgba(92,102,189,.35);background:rgba(92,102,189,.12);color:var(--accent);font-weight:700;cursor:pointer;">Скачать</button>
        </div>
        <p id="exportStatus" style="font-size:12px;color:var(--muted);margin-top:10px;"></p>
      </div>
    `;
    const btn = root.querySelector('#exportDownloadBtn');
    const status = root.querySelector('#exportStatus');
    btn.addEventListener('click', async () => {
      const fmt = root.querySelector('#exportFormat').value || 'csv';
      const qc = root.querySelector('#exportQc').value;
      const params = new URLSearchParams({ format: fmt });
      const pid = getSelectedProjectId();
      if (pid) params.set('project_id', String(pid));
      if (qc) params.set('qc_validity', qc);
      status.textContent = 'Запрос…';
      try {
        const base = (global.API_BASE || '').replace(/\/$/, '');
        const url = `${base}/export?${params.toString()}`;
        const r = await fetch(url, {
          headers: global.apiHeaders ? global.apiHeaders() : {},
          credentials: 'include'
        });
        if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `emocog-export.${fmt === 'json' ? 'json' : 'csv'}`;
        a.click();
        URL.revokeObjectURL(a.href);
        status.textContent = 'Готово';
      } catch (e) {
        status.textContent = 'Ошибка: ' + e.message;
      }
    });
    if (typeof global.setInspector === 'function') {
      global.setInspector({
        type: 'Export',
        title: 'Export',
        subtitle: 'Live export via API for the selected project.',
        status: 'good',
      });
    }
    return root;
  }

  function SessionsViewLive() {
    if (typeof global.document !== 'undefined') {
      const pageTitle = global.document.getElementById('pageTitle');
      if (pageTitle) pageTitle.textContent = 'Sessions';
    }
    if (typeof global.setChips === 'function') global.setChips(['API', 'QC']);
    const root = document.createElement('div');
    root.className = 'grid';
    root.innerHTML = `
      <div class="card" style="grid-column:span 12;">
        <h3>Sessions</h3>
        <p id="sessionsListHint" style="margin-top:8px;color:var(--muted);">Loading…</p>
        <div id="sessionsList" style="margin-top:12px;display:flex;flex-direction:column;gap:8px;"></div>
      </div>
    `;
    const listEl = root.querySelector('#sessionsList');
    const hint = root.querySelector('#sessionsListHint');

    if (!hasLiveApi()) {
      hint.textContent = 'API unavailable — sign in as researcher.';
      return root;
    }

    fetchSessions({ project_id: getSelectedProjectId() })
      .then((rows) => {
        if (!rows.length) {
          hint.textContent = 'No sessions for this project.';
          return;
        }
        hint.textContent = `${rows.length} session(s)`;
        listEl.innerHTML = rows.map((r) => {
          const qc = r.qc_validity || '—';
          const score = r.qc_score != null ? r.qc_score : '—';
          return `<button type="button" class="quick-btn" data-sid="${escapeUiHtml(r.id)}" style="justify-content:space-between;">
            <span>${escapeUiHtml(r.session_id || r.id)}</span>
            <span style="font-size:11px;color:var(--muted);">QC ${escapeUiHtml(qc)} · ${escapeUiHtml(score)}</span>
          </button>`;
        }).join('');
        listEl.querySelectorAll('[data-sid]').forEach((btn) => {
          btn.addEventListener('click', () => {
            localStorage.setItem(SESSION_DB_ID_KEY, btn.getAttribute('data-sid'));
            if (typeof global.navigate === 'function') global.navigate('#/analytics/session-card');
          });
        });
      })
      .catch((e) => {
        hint.textContent = 'Failed to load sessions: ' + e.message;
      });

    if (typeof global.setInspector === 'function') {
      global.setInspector({
        type: 'Session',
        title: 'Sessions',
        subtitle: 'Live session list from GET /sessions.',
        status: 'neutral',
        cta: { label: 'Open Session Card', action: "navigate('#/analytics/session-card')" },
      });
    }
    return root;
  }

  function patchRender() {
    if (typeof global.render !== 'function' || global.render.__bridgePatched) return;
    const orig = global.render;
    global.render = function (hashOverride) {
      orig(hashOverride);
      const route = (hashOverride || global.location.hash || '#/overview').replace(/^#\/?/, '').split('/')[0];
      if (route === 'analytics') {
        const view = global.document.getElementById('view');
        if (view && view.firstChild) injectSessionPicker(view.firstChild);
      }
    };
    global.render.__bridgePatched = true;
  }

  function patchExportView() {
    if (typeof global.ExportView !== 'function' || global.ExportView.__bridgePatched) return;
    global.ExportView = function () {
      if (global.EmocogAnalyticsProduction && typeof global.EmocogAnalyticsProduction.exportView === 'function') {
        return global.EmocogAnalyticsProduction.exportView();
      }
      if (hasLiveApi()) {
        if (typeof global.document !== 'undefined') {
          const pageTitle = global.document.getElementById('pageTitle');
          if (pageTitle) pageTitle.textContent = 'Export';
        }
        if (typeof global.setChips === 'function') global.setChips(['Export', 'API']);
        return buildExportViewLive();
      }
      const root = document.createElement('div');
      root.className = 'grid';
      root.innerHTML = '<div class="card" style="grid-column:span 12;padding:24px;"><h3>Authorization required</h3><p style="margin-top:8px;color:var(--muted);">Sign in as a researcher to export API data. No demo export is generated.</p></div>';
      return root;
    };
    global.ExportView.__bridgePatched = true;
  }

  function installSessionsView() {
    global.SessionsView = function () {
      if (hasLiveApi()) return SessionsViewLive();
      const root = document.createElement('div');
      root.className = 'grid';
      root.innerHTML = `
        <div class="card" style="grid-column:span 12">
          <h3>Sessions</h3>
          <p>Sign in to load sessions from API. No demo session data is shown.</p>
        </div>
      `;
      return root;
    };
  }

  function init() {
    installSessionsView();
    patchExportView();
    // The production analytics route owns its API/store/view lifecycle explicitly.
    // Keep the legacy injection only for pages that do not load that module.
    if (!global.EmocogAnalyticsProduction) patchRender();
    syncProjectsFromApi();
    global.addEventListener('wecog:researcherauthenticated', () => {
      syncProjectsFromApi();
    });
    global.addEventListener('wecog:projectchange', () => {
      if (typeof global.syncProjectStimuliFromApi === 'function') {
        global.syncProjectStimuliFromApi().catch(error => console.warn('[researcher-api-bridge] stimuli sync failed', error));
      }
    });
    if (hasLiveApi() && typeof global.toast === 'function') {
      global.toast('Researcher API connected');
    }
  }

  global.EmocogResearcherBridge = {
    hasLiveApi,
    syncProjectsFromApi,
    fetchSessions,
    fetchSessionDetail,
    mapSessionRowToSessionData,
    applySessionData,
    getSelectedProjectId,
  };

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
