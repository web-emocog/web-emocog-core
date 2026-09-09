(function (global) {
  'use strict';

  const legacyAnalyticsView = global.AnalyticsView;
  const PROJECT_KEY = 'emocog_selected_project_id';
  const PROTOCOL_KEY = 'emocog_selected_protocol_id';
  const SESSION_KEY = 'emocog_selected_session_db_id';
  const QUERY_KEY = 'emocog_analytics_query_draft_v1';
  const RESULT_IMPORT_MAX_BYTES = 128 * 1024 * 1024;
  const INGEST_PAYLOAD_MAX_BYTES = 1750 * 1024;

  const TABS = [
    { id: 'session-card', ru: 'Сессия', en: 'Session' },
    { id: 'group-comparison', ru: 'Группа', en: 'Group' },
    { id: 'data-quality', ru: 'Качество данных', en: 'Data quality' },
    { id: 'connectedness', ru: 'Связанность', en: 'Connectedness' }
  ];

  function isEnglish() {
    return typeof CURRENT_LANG !== 'undefined' && CURRENT_LANG === 'en';
  }

  function tr(ru, en) {
    return isEnglish() ? en : ru;
  }

  function parseApiError(response, fallback) {
    return response.json().catch(() => null).then(body => {
      const message = body && (body.message || body.error);
      const error = new Error(`${response.status}${message ? ` — ${message}` : ` — ${fallback}`}`);
      error.status = response.status;
      error.code = body && body.code || null;
      return error;
    });
  }

  function importApiUrl(path) {
    const base = String(global.API_BASE || '').replace(/\/$/, '');
    return base ? `${base}${path}` : path;
  }

  function resultImportHeaders(idempotencyKey) {
    const headers = typeof global.apiRequestHeaders === 'function'
      ? global.apiRequestHeaders(true)
      : { 'Content-Type': 'application/json' };
    headers['Idempotency-Key'] = idempotencyKey;
    return headers;
  }

  function resultImportId(payload) {
    const existing = payload?.lifecycle?.finishAttemptId;
    if (existing) return String(existing);
    const random = global.crypto?.randomUUID
      ? global.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `result-import-${random}`;
  }

  async function buildResultImportPayload(source) {
    if (source?.schemaVersion === 'session_feature.v1') return source;
    const moduleUrl = new URL(
      '../participant-web/js/unified-aggregates-new.js?v=20260828-2',
      global.location.href
    );
    const aggregates = await import(moduleUrl.href);
    const payload = aggregates.buildAggregatesPayload(source, { forIngest: true });
    if (!payload) throw new Error(tr('Файл не похож на результат сессии','The file is not a session result'));
    return payload;
  }

  async function importResultJson(file, state) {
    if (!file || !file.name?.toLowerCase().endsWith('.json')) {
      throw new Error(tr('Выберите файл JSON','Select a JSON file'));
    }
    if (file.size > RESULT_IMPORT_MAX_BYTES) {
      throw new Error(tr('Файл превышает допустимый размер 128 МБ','The file exceeds the 128 MB limit'));
    }
    const projectId = Number(state.query.projectId);
    const protocolId = Number(state.query.protocolId);
    if (!Number.isInteger(projectId) || !Number.isInteger(protocolId)) {
      throw new Error(tr('Сначала выберите проект и протокол','Select a project and protocol first'));
    }

    let source;
    try {
      source = JSON.parse(await file.text());
    } catch (_) {
      throw new Error(tr('JSON повреждён или имеет неверный формат','The JSON is damaged or malformed'));
    }
    const payload = await buildResultImportPayload(source);
    payload.ids = payload.ids && typeof payload.ids === 'object' ? { ...payload.ids } : {};
    delete payload.ids.invitationCode;

    const sessionId = String(payload.ids.session || '').trim();
    if (!sessionId || sessionId.length > 64) {
      throw new Error(tr('В файле отсутствует корректный ID сессии','The file has no valid session ID'));
    }
    const participantId = payload.ids.participant == null
      ? null
      : String(payload.ids.participant).slice(0, 64);
    const idempotencyKey = resultImportId(payload);
    const completedAt = payload?.lifecycle?.completedAt || new Date().toISOString();
    payload.lifecycle = {
      ...(payload.lifecycle || {}),
      schemaVersion: 'session_lifecycle.v1',
      state: 'completed',
      status: 'completed',
      completedAt,
      finishAttemptId: idempotencyKey,
    };

    const encoded = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(encoded).byteLength;
    if (payloadBytes > INGEST_PAYLOAD_MAX_BYTES) {
      throw new Error(tr(
        'После безопасного сокращения результат всё ещё слишком велик для API',
        'The safely compacted result is still too large for the API'
      ));
    }

    await global.apiPost('/sessions/start', {
      session_id: sessionId,
      participant_id: participantId,
      project_id: projectId,
      protocol_id: protocolId,
    });
    const response = await global.fetch(importApiUrl('/ingest'), {
      method: 'POST',
      headers: resultImportHeaders(idempotencyKey),
      credentials: 'include',
      body: encoded,
    });
    if (!response.ok) throw await parseApiError(response, tr('Импорт отклонён','Import rejected'));
    const result = await response.json();
    return { sessionId, payloadBytes, result };
  }

  function localizedName(value, fallback) {
    if (!value || typeof value !== 'object') return fallback || '';
    return value[isEnglish() ? 'name_en' : 'name_ru']
      || value.name
      || value[isEnglish() ? 'name_ru' : 'name_en']
      || fallback
      || '';
  }

  function statusLabel(value) {
    const code = String(value || 'unknown').trim().toLowerCase().replace(/\s+/g, '_');
    const labels = {
      valid: ['Валидно', 'Valid'],
      borderline: ['Пограничное', 'Borderline'],
      invalid: ['Невалидно', 'Invalid'],
      completed: ['Завершена', 'Completed'],
      complete: ['Завершена', 'Completed'],
      in_progress: ['Выполняется', 'In progress'],
      running: ['Выполняется', 'In progress'],
      pending: ['Ожидает', 'Pending'],
      incomplete: ['Не завершена', 'Incomplete'],
      aborted: ['Прервана', 'Aborted'],
      failed: ['Ошибка', 'Failed'],
      error: ['Ошибка', 'Error'],
      computed: ['Рассчитано', 'Computed'],
      not_computed: ['Не рассчитано', 'Not computed'],
      no_data: ['Нет данных', 'No data'],
      no_event: ['Событие не наступило', 'No event'],
      insufficient_quality: ['Недостаточное качество', 'Insufficient quality'],
      not_configured: ['Не настроено', 'Not configured'],
      not_applicable: ['Неприменимо', 'Not applicable'],
      available: ['Доступно', 'Available'],
      insufficient_data: ['Недостаточно данных', 'Insufficient data'],
      confounded: ['Факторы смешаны', 'Confounded'],
      pass: ['Пройдено', 'Passed'],
      warning: ['Предупреждение', 'Warning'],
      blocked: ['Заблокировано', 'Blocked'],
      unknown: ['Не определено', 'Unknown']
    };
    const pair = labels[code];
    return pair
      ? pair[isEnglish() ? 1 : 0]
      : `${tr('Неизвестный статус','Unknown status')}: ${String(value)}`;
  }

  function channelLabel(value) {
    const code = String(value || 'unknown').trim().toLowerCase();
    const labels = {
      task: ['Задача', 'Task'],
      gaze: ['Взгляд / AOI', 'Gaze / AOI'],
      blink: ['Моргания', 'Blinks'],
      face: ['Мимика', 'Facial expression'],
      head_hands: ['Голова и руки', 'Head and hands'],
      rppg: ['Пульс (rPPG)', 'Heart rate (rPPG)'],
      respiration: ['Дыхание', 'Respiration'],
      emotion: ['Эмоции', 'Emotion'],
      bpm: ['Пульс', 'Heart rate'],
      unknown: ['Канал не указан', 'Channel unknown']
    };
    const pair = labels[code];
    return pair
      ? pair[isEnglish() ? 1 : 0]
      : `${tr('Неизвестный канал','Unknown channel')}: ${String(value)}`;
  }

  function deviceClassLabel(value) {
    const code = String(value || '').trim().toLowerCase();
    const labels = {
      computer_webcam: ['Компьютер с веб-камерой', 'Computer with webcam'],
      desktop_browser: ['Компьютер, браузерная сессия', 'Computer, browser session'],
      desktop_webcam: ['Настольный компьютер с веб-камерой', 'Desktop with webcam'],
      laptop_webcam: ['Ноутбук со встроенной камерой', 'Laptop with built-in camera'],
      mobile_browser: ['Мобильное устройство', 'Mobile device'],
      unknown: ['Тип устройства не определён', 'Device type not detected']
    };
    const pair = labels[code] || labels.unknown;
    return pair[isEnglish() ? 1 : 0];
  }

  function reasonLabel(value) {
    const code = String(value || '').trim().toLowerCase();
    const labels = {
      low_valid_gaze_fraction: ['Недостаточная доля валидного взгляда', 'Low valid-gaze fraction'],
      low_signal_confidence: ['Низкая надёжность сигнала', 'Low signal confidence'],
      response_before_rt_min: ['Ответ раньше минимально допустимого RT', 'Response before minimum RT'],
      target_not_reached_before_presentation_end: ['AOI не достигнута до конца показа', 'AOI was not reached before presentation end'],
      off_screen: ['Взгляд вне экрана', 'Gaze off screen'],
      outside_stimulus: ['Взгляд вне стимула', 'Gaze outside stimulus'],
      missing_samples: ['Нет необходимых сэмплов', 'Required samples are missing'],
      gaze_qc_invalid: ['Сессия исключена по gaze QC', 'Session excluded by gaze QC'],
      group_is_confounded_with_camera_model: ['Группа полностью совпадает с моделью камеры', 'Group is fully confounded with camera model'],
      camera_model_segregated_by_group: ['Модели камер распределены по группам неравномерно', 'Camera models are segregated by group'],
      borderline_gaze_sessions_included: ['Включены сессии с пограничным качеством взгляда', 'Borderline gaze-quality sessions are included'],
      insufficient_participants: ['Недостаточно участников для выбранного сравнения', 'Insufficient participants for the selected comparison'],
      face_occluded: ['Лицо было частично закрыто или не полностью видно', 'The face was partly covered or not fully visible'],
      head_pose: ['Положение головы вышло за допустимый диапазон', 'Head position moved outside the allowed range'],
      quality_invalid: ['Проба не прошла контроль качества записи', 'The trial did not pass recording quality checks'],
      low_pose_ok_pct: ['Положение головы было стабильным недостаточную часть сессии', 'Head position was stable for too little of the session'],
      low_fps_time: ['Частота обработки кадров временно снижалась', 'Frame processing rate temporarily dropped'],
      consecutive_low_fps: ['Зафиксирован непрерывный эпизод низкой частоты кадров', 'A continuous low-frame-rate episode was detected'],
      high_omission_rate: ['В задании пропущено много требуемых ответов', 'Too many required responses were missed'],
      high_rt_outlier_frac: ['Слишком много ответов имеют нетипичное время реакции', 'Too many responses have atypical reaction times']
    };
    const pair = labels[code];
    return pair ? pair[isEnglish() ? 1 : 0] : String(value || tr('Причина не указана','Reason unavailable')).replace(/_/g, ' ');
  }

  function qualityCheckLabel(value) {
    const labels = {
      duration: ['Длительность записи', 'Recording duration'],
      faceVisible: ['Лицо обнаружено', 'Face detected'],
      faceOk: ['Лицо полностью видно', 'Face fully visible'],
      poseOk: ['Положение головы', 'Head position'],
      illuminationOk: ['Освещение', 'Lighting'],
      eyesOpen: ['Глаза доступны для анализа', 'Eyes available for analysis'],
      occlusion: ['Нет перекрытия лица', 'Face is not occluded'],
      gazeValid: ['Валидность взгляда', 'Gaze validity'],
      gazeOnScreen: ['Взгляд в области экрана', 'Gaze within screen area'],
      lowFps: ['Стабильность FPS', 'FPS stability'],
      consecutiveLowFps: ['Нет длительного падения FPS', 'No prolonged FPS drop'],
      gazeAccuracy: ['Точность калибровки взгляда', 'Gaze calibration accuracy'],
      gazePrecision: ['Стабильность точки взгляда', 'Gaze-point stability']
    };
    const pair = labels[value];
    return pair ? pair[isEnglish() ? 1 : 0] : String(value || '').replace(/_/g, ' ');
  }

  function qcModeLabel(value) {
    if (value === 'valid_only') return tr('Только валидные','Valid only');
    if (value === 'all') return tr('Все, включая невалидные','All, including invalid');
    return tr('Валидные + пограничные','Valid + borderline');
  }

  function formatDateTime(value) {
    if (!value) return tr('Нет данных','No data');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(isEnglish() ? 'en-US' : 'ru-RU', {
      dateStyle: 'medium', timeStyle: 'short'
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function listFromResponse(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const candidate = payload.items || payload.results || payload.data || payload.sessions || payload.protocols || payload.projects;
    return Array.isArray(candidate) ? candidate : [];
  }

  function selectedStored(key) {
    try { return global.localStorage.getItem(key) || ''; } catch (_) { return ''; }
  }

  function storeSelected(key, value) {
    try {
      if (value == null || value === '') global.localStorage.removeItem(key);
      else global.localStorage.setItem(key, String(value));
    } catch (_) {}
  }

  function storedJson(key, fallback) {
    try {
      const value = JSON.parse(global.localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch (_) { return fallback; }
  }

  function coerceId(value) {
    const text = String(value == null ? '' : value);
    return /^\d+$/.test(text) ? Number(text) : text;
  }

  function normalizeOptions(payload) {
    const value = payload && payload.data && !Array.isArray(payload.data) ? payload.data : payload;
    return {
      blocks: Array.isArray(value && value.blocks) ? value.blocks : [],
      stimuli: Array.isArray(value && value.stimuli) ? value.stimuli : [],
      aois: Array.isArray(value && value.aois) ? value.aois : [],
      groups: Array.isArray(value && value.groups) ? value.groups : [],
      conditions: Array.isArray(value && value.conditions) ? value.conditions : [],
      comparisons: Array.isArray(value && value.comparisons) ? value.comparisons : [],
      qcChannels: Array.isArray(value && value.qcChannels) ? value.qcChannels : ['task', 'gaze'],
      dateMin: value && value.dateMin || '',
      dateMax: value && value.dateMax || ''
    };
  }

  function hasAuth() {
    return !!global.EmocogAnalyticsPreviewFixture
      || (typeof global.hasResearcherApiToken === 'function' && global.hasResearcherApiToken())
      || selectedStored('emocog_developer_auth') === '1';
  }

  function errorStatus(error) {
    const match = String(error && error.message || error || '').match(/^\s*(\d{3})\b/);
    return match ? Number(match[1]) : null;
  }

  function validateAnalyticsResponse(payload, kind, snapshotId) {
    const value = payload && payload.data && payload.kind == null && payload.data.kind ? payload.data : payload;
    if (!value || value.kind !== kind || !value.data || !value.snapshot) {
      throw new Error(`502 — invalid ${kind} analytics response`);
    }
    if (snapshotId && String(value.snapshot.id) !== String(snapshotId)) {
      throw new Error('409 — analytics response belongs to another snapshot');
    }
    return value;
  }

  function previewSessionSummary(sessionId, snapshot) {
    const fixture = global.EmocogAnalyticsPreviewFixture;
    const row = fixture.sessions.find(item => String(item.id) === String(sessionId)) || fixture.sessions[0];
    const summary = row.analytics_summary || {};
    const channels = (summary.qcChannels || []).map(channel => Object.assign({
      signalConfidence: null,
      ruleVersion: `${channel.channel || 'unknown'}-qc-1.0.0`
    }, channel));
    const channelById = Object.fromEntries(channels.map(channel => [channel.channel, channel]));
    const metrics = (summary.metrics || []).map(metric => {
      const channelId = String(metric.metricId || '').startsWith('qc.') || String(metric.metricId || '').startsWith('aoi.') ? 'gaze' : 'task';
      const qc = metric.qc && metric.qc.channel ? metric.qc : channelById[channelId] || null;
      return Object.assign({
        reason: null,
        numerator: null,
        denominator: null,
        observationDurationMs: 72000,
        nParticipants: 1,
        nObservations: 0,
        signalConfidence: null,
        distribution: null
      }, metric, {
        scope: Object.assign({ sessionId: row.id, blockId: 'main-block', trialId: null, presentationId: null, stimulusId: null, aoiId: null }, metric.scope || {}),
        qc: qc ? Object.assign({ channel: channelId, validFraction: null, signalConfidence: null, reasons: [], ruleVersion: `${channelId}-qc-1.0.0` }, qc) : null,
        algorithm: Object.assign({ id: channelId === 'task' ? 'task-performance' : 'gaze-validity', version: '1.0.0', parametersHash: null }, metric.algorithm || {})
      });
    });
    return {
      contractVersion: '1.0',
      kind: 'session_summary',
      generatedAt: new Date().toISOString(),
      snapshot,
      data: {
        session: {
          sessionId: row.id,
          participantAlias: row.participant_alias || row.participant_id || '—',
          startedAt: row.started_at,
          completedAt: row.stopped_at || null,
          completionStatus: row.status === 'completed' ? 'completed' : (row.status || 'in_progress'),
          protocolId: coerceId(snapshot.queryEcho.protocolId),
          protocolVersion: row.protocol_version || snapshot.queryEcho.protocolVersion,
          deviceClass: row.device_class || null,
          resolution: row.resolution || null,
          actualFps: row.actual_fps == null ? null : row.actual_fps
        },
        qcChannels: channels,
        metrics,
        exclusions: Array.isArray(summary.exclusions) ? summary.exclusions : []
      }
    };
  }

  function previewStimulus() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eef2ff"/><stop offset="1" stop-color="#dbeafe"/></linearGradient></defs><rect width="1200" height="675" fill="url(#bg)"/><circle cx="260" cy="330" r="105" fill="#93c5fd"/><rect x="475" y="220" width="250" height="235" rx="24" fill="#5c66bd"/><path d="M900 190 1040 455 765 455Z" fill="#f59e0b"/><text x="600" y="615" text-anchor="middle" font-family="Arial" font-size="28" fill="#64748b">Preview stimulus · normalized AOI space</text></svg>`;
    return { id: 'stimulus-42', version: '1', name: 'Target image', type: 'image', contentUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), intrinsicWidth: 1200, intrinsicHeight: 675 };
  }

  function previewAoiMetric(metricId, value, unit, status, aoiId, options) {
    const extra = options || {};
    return {
      metricId, value: status === 'computed' ? value : null, unit, status, reason: extra.reason || null,
      numerator: extra.numerator == null ? null : extra.numerator,
      denominator: extra.denominator == null ? null : extra.denominator,
      observationDurationMs: 2240, nParticipants: 1,
      nObservations: extra.nObservations == null ? 1 : extra.nObservations,
      signalConfidence: 0.78, distribution: extra.distribution || null,
      scope: { sessionId: 105, blockId: 'main-block', trialId: 'trial-7', presentationId: 'presentation-7', stimulusId: 'stimulus-42', aoiId },
      qc: { channel: 'gaze', status: 'borderline', validFraction: 0.747, signalConfidence: 0.78, reasons: ['low_valid_gaze_fraction'], ruleVersion: 'gaze-qc-1.0.0' },
      algorithm: { id: 'gaze-aoi', version: '1.0.0', parametersHash: 'sha256:gaze-aoi-default-v1' }
    };
  }

  function previewSessionAoi(snapshot) {
    const rows = [
      {
        aoi: { id: 'aoi-target', name: isEnglish() ? 'Target AOI' : 'Целевая область', shape: 'rectangle', points: [{ x: 0.40, y: 0.31 }, { x: 0.61, y: 0.68 }], order: 1, isTarget: true, validityInterval: { startMs: 0, endMs: 3000 } },
        metrics: [
          previewAoiMetric('aoi.target_reached', true, 'boolean', 'computed', 'aoi-target', { numerator: 1, denominator: 1 }),
          previewAoiMetric('aoi.dwell_time_ms', 1320, 'ms', 'computed', 'aoi-target', { denominator: 2240, nObservations: 6 }),
          previewAoiMetric('aoi.dwell_time_pct', 58.9, 'pct', 'computed', 'aoi-target', { numerator: 1320, denominator: 2240, nObservations: 6 }),
          previewAoiMetric('aoi.fixation_count', 6, 'count', 'computed', 'aoi-target', { nObservations: 6 }),
          previewAoiMetric('aoi.fixation_rate_per_min', 160.7, 'count_per_min', 'computed', 'aoi-target', { nObservations: 6 }),
          previewAoiMetric('aoi.fixation_duration_median_ms', 218, 'ms', 'computed', 'aoi-target', { nObservations: 6, distribution: { n: 6, mean: 220, sd: 38, median: 218, q1: 190, q3: 246, min: 172, max: 281 } }),
          previewAoiMetric('aoi.ttff_ms', 410, 'ms', 'computed', 'aoi-target', { denominator: 1, distribution: { n: 1, mean: 410, sd: 0, median: 410, q1: 410, q3: 410, min: 410, max: 410 } }),
          previewAoiMetric('aoi.visit_count', 3, 'count', 'computed', 'aoi-target', { nObservations: 3 }),
          previewAoiMetric('aoi.revisit_count', 2, 'count', 'computed', 'aoi-target', { nObservations: 2 })
        ]
      },
      {
        aoi: { id: 'aoi-distractor', name: isEnglish() ? 'Distractor' : 'Дистрактор', shape: 'polygon', points: [{ x: 0.63, y: 0.27 }, { x: 0.88, y: 0.27 }, { x: 0.75, y: 0.70 }], order: 2, isTarget: false, validityInterval: { startMs: 0, endMs: 3000 } },
        metrics: [
          previewAoiMetric('aoi.target_reached', false, 'boolean', 'computed', 'aoi-distractor', { numerator: 0, denominator: 1 }),
          previewAoiMetric('aoi.dwell_time_ms', 0, 'ms', 'computed', 'aoi-distractor', { numerator: 0, denominator: 2240, nObservations: 0 }),
          previewAoiMetric('aoi.dwell_time_pct', 0, 'pct', 'computed', 'aoi-distractor', { numerator: 0, denominator: 2240, nObservations: 0 }),
          previewAoiMetric('aoi.fixation_count', 0, 'count', 'computed', 'aoi-distractor', { nObservations: 0 }),
          previewAoiMetric('aoi.fixation_rate_per_min', 0, 'count_per_min', 'computed', 'aoi-distractor', { nObservations: 0 }),
          previewAoiMetric('aoi.fixation_duration_median_ms', null, 'ms', 'no_event', 'aoi-distractor', { reason: 'target_not_reached_before_presentation_end', nObservations: 0 }),
          previewAoiMetric('aoi.ttff_ms', null, 'ms', 'no_event', 'aoi-distractor', { reason: 'target_not_reached_before_presentation_end', denominator: 1, nObservations: 1 }),
          previewAoiMetric('aoi.visit_count', 0, 'count', 'computed', 'aoi-distractor', { nObservations: 0 }),
          previewAoiMetric('aoi.revisit_count', 0, 'count', 'computed', 'aoi-distractor', { nObservations: 0 })
        ]
      }
    ];
    const selectedAois = snapshot.queryEcho.filters.aoiIds || [];
    return { contractVersion: '1.0', kind: 'session_aoi', generatedAt: new Date().toISOString(), snapshot, data: { sessionId: 105, blockId: 'main-block', presentationId: 'presentation-7', stimulus: previewStimulus(), coordinateSpace: 'stimulus_normalized_0_1', aoiRows: selectedAois.length ? rows.filter(row => selectedAois.includes(row.aoi.id)) : rows } };
  }

  function previewSessionHeatmap(snapshot) {
    const width = 12, height = 7;
    const values = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const target = Math.exp(-((x - 5.5) ** 2 + (y - 3.2) ** 2) / 3.2);
      const secondary = 0.45 * Math.exp(-((x - 2.4) ** 2 + (y - 3.3) ** 2) / 2.2);
      values.push(Number(Math.min(1, target + secondary).toFixed(4)));
    }
    return { contractVersion: '1.0', kind: 'heatmap', generatedAt: new Date().toISOString(), snapshot, data: { aggregationLevel: 'session', stimulus: previewStimulus(), coordinateSpace: 'stimulus_normalized_0_1', normalizationMode: 'fixation_duration_weighted', smoothing: { method: 'gaussian', bandwidthNorm: 0.04 }, equalParticipantWeight: false, grid: { width, height, values, maxValue: 1 }, fixationPoints: [{ x: 0.23, y: 0.49, durationMs: 185, signalConfidence: 0.82 }, { x: 0.45, y: 0.42, durationMs: 240, signalConfidence: 0.80 }, { x: 0.52, y: 0.51, durationMs: 310, signalConfidence: 0.79 }, { x: 0.56, y: 0.59, durationMs: 205, signalConfidence: 0.76 }], nParticipants: 1, nSessions: 1, nFixations: 10, validObservationDurationMs: 2240, algorithm: { id: 'fixation-heatmap', version: '1.0.0', parametersHash: 'sha256:heatmap-default-v1' } } };
  }

  function previewGroupMetric(metricId, unit, values, summary) {
    return {
      metricId, unit, status: 'computed', reason: null,
      nParticipants: values.length,
      nObservations: summary.nObservations,
      numerator: summary.numerator == null ? null : summary.numerator,
      denominator: summary.denominator == null ? null : summary.denominator,
      observationDurationMs: summary.observationDurationMs || null,
      median: summary.median, q1: summary.q1, q3: summary.q3,
      mean: summary.mean, sd: summary.sd, min: Math.min(...values), max: Math.max(...values),
      estimateCi95: { value: summary.mean, lower: summary.ciLow, upper: summary.ciHigh, confidenceLevel: 0.95, method: 'participant_cluster_bootstrap' },
      participantValues: values.map((value, index) => ({ participantId: `P-${String(index + 1).padStart(3, '0')}`, value, nObservations: summary.perParticipantObservations || 24 })),
      scope: { sessionId: null, blockId: 'main-block', trialId: null, presentationId: null, stimulusId: String(metricId).startsWith('aoi.') ? 'stimulus-42' : null, aoiId: String(metricId).startsWith('aoi.') ? 'aoi-target' : null },
      algorithm: { id: String(metricId).startsWith('task.') ? 'task-performance' : 'gaze-aoi', version: '1.0.0', parametersHash: null }
    };
  }

  function previewGroupSummary(snapshot) {
    const accuracy = [71, 75, 77, 79, 81, 82, 84, 85, 87, 89, 91, 94];
    const dwell = [540, 590, 610, 650, 690, 720, 760, 790, 820, 870, 910, 980];
    const reached = [67, 71, 75, 79, 83, 83, 87, 88, 92, 92, 96, 100];
    return {
      contractVersion: '1.0', kind: 'group_summary', generatedAt: new Date().toISOString(), snapshot,
      data: {
        nParticipants: 12, nSessions: 12, nObservations: 288,
        qcCounts: { valid: 8, borderline: 4, invalid: 2, notComputed: 0 },
        qcByChannel: [{ channel: 'task', valid: 11, borderline: 1, invalid: 0, notComputed: 0 }, { channel: 'gaze', valid: 8, borderline: 4, invalid: 2, notComputed: 0 }],
        deviceCounts: [{ deviceClass: 'desktop_webcam', participantCount: 12, sessionCount: 12 }],
        missingness: [{ reasonCode: 'gaze_qc_invalid', count: 2 }, { reasonCode: 'target_not_reached_before_presentation_end', count: 26 }, { reasonCode: 'low_signal_confidence', count: 17 }],
        metrics: [
          previewGroupMetric('task.accuracy_pct', 'pct', accuracy, { nObservations: 288, numerator: 242, denominator: 288, median: 83, q1: 78.5, q3: 88, mean: 82.9, sd: 7.1, ciLow: 78.8, ciHigh: 87.1 }),
          previewGroupMetric('aoi.dwell_time_ms', 'ms', dwell, { nObservations: 254, denominator: 254, observationDurationMs: 645120, median: 740, q1: 640, q3: 832.5, mean: 744.2, sd: 137.6, ciLow: 663, ciHigh: 827, perParticipantObservations: 21 }),
          previewGroupMetric('aoi.target_reached_pct', 'pct', reached, { nObservations: 288, numerator: 262, denominator: 288, observationDurationMs: 645120, median: 85, q1: 78, q3: 92, mean: 84.4, sd: 9.8, ciLow: 78.7, ciHigh: 90.1 })
        ]
      }
    };
  }

  function previewGroupHeatmap(snapshot) {
    const response = previewSessionHeatmap(snapshot);
    response.data.aggregationLevel = 'group';
    response.data.equalParticipantWeight = true;
    response.data.fixationPoints = [];
    response.data.nParticipants = 12;
    response.data.nSessions = 12;
    response.data.nFixations = 680;
    response.data.validObservationDurationMs = 645120;
    return response;
  }

  function previewModelResult(snapshot, comparisonId) {
    const options = global.EmocogAnalyticsPreviewFixture && global.EmocogAnalyticsPreviewFixture.filterOptions;
    const comparison = options && Array.isArray(options.comparisons)
      ? options.comparisons.find(item => String(item.id) === String(comparisonId))
      : null;
    const confounded = comparison && comparison.previewResult === 'confounded';
    const common = {
      metricId: comparison && comparison.metricId || 'aoi.dwell_time_ms',
      modelId: 'linear-mixed-model',
      modelVersion: '1.0.0',
      effectUnit: 'ms',
      effectLabel: 'clinical_minus_control',
      referenceLevel: 'control',
      comparisonLevel: 'clinical',
      nParticipants: 12,
      nObservations: 254,
      adjustmentMethod: 'holm'
    };
    const data = confounded ? Object.assign(common, {
      readiness: 'confounded',
      reason: 'group_is_confounded_with_camera_model',
      formula: 'dwell_time_ms ~ group + camera_model + (1 | participant) + (1 | stimulus)',
      effect: null,
      estimateCi95: { value: null, lower: null, upper: null, confidenceLevel: 0.95, method: 'not_computed' },
      pValueAdjusted: null,
      warnings: ['camera_model_segregated_by_group'],
      readinessChecks: [
        { id: 'sample_size', status: 'pass', reason: null },
        { id: 'repeated_measures', status: 'pass', reason: null },
        { id: 'channel_compatibility', status: 'pass', reason: null },
        { id: 'version_compatibility', status: 'pass', reason: null },
        { id: 'technical_confounding', status: 'blocked', reason: 'group_is_confounded_with_camera_model' }
      ]
    }) : Object.assign(common, {
      readiness: 'available',
      reason: null,
      formula: 'dwell_time_ms ~ group + (1 | participant) + (1 | stimulus)',
      effect: 118,
      estimateCi95: { value: 118, lower: 42, upper: 194, confidenceLevel: 0.95, method: 'participant_cluster_bootstrap' },
      pValueAdjusted: 0.018,
      warnings: ['borderline_gaze_sessions_included'],
      readinessChecks: [
        { id: 'sample_size', status: 'pass', reason: null },
        { id: 'repeated_measures', status: 'pass', reason: null },
        { id: 'channel_compatibility', status: 'warning', reason: 'borderline_gaze_sessions_included' },
        { id: 'version_compatibility', status: 'pass', reason: null },
        { id: 'technical_confounding', status: 'pass', reason: null }
      ]
    });
    return { contractVersion: '1.0', kind: 'model_result', generatedAt: new Date().toISOString(), snapshot, data };
  }

  function exportMetricRows(state) {
    const rows = [];
    const append = (metric, context) => {
      if (!metric || !metric.metricId) return;
      const hasDirectValue = metric.value !== null && metric.value !== undefined;
      const hasMedian = metric.median !== null && metric.median !== undefined;
      rows.push(Object.assign({
        metricId: metric.metricId,
        value: hasDirectValue ? metric.value : (hasMedian ? metric.median : null),
        statistic: hasDirectValue ? 'value' : (hasMedian ? 'median' : null),
        unit: metric.unit || null,
        status: metric.status || 'computed',
        reason: metric.reason || null,
        numerator: metric.numerator == null ? null : metric.numerator,
        denominator: metric.denominator == null ? null : metric.denominator,
        nParticipants: metric.nParticipants == null ? null : metric.nParticipants,
        nObservations: metric.nObservations == null ? null : metric.nObservations,
        observationDurationMs: metric.observationDurationMs == null ? null : metric.observationDurationMs,
        scope: metric.scope || null,
        algorithm: metric.algorithm || null
      }, context || {}));
    };
    const sessionData = state.summaryResponse && state.summaryResponse.data;
    (sessionData && sessionData.metrics || []).forEach(metric => append(metric, { sourceKind: 'session_summary' }));
    const groupData = state.groupResponse && state.groupResponse.data;
    (groupData && groupData.metrics || []).forEach(metric => append(metric, { sourceKind: 'group_summary' }));
    const aoiData = state.aoiResponse && state.aoiResponse.data;
    (aoiData && aoiData.aoiRows || []).forEach(row => (row.metrics || []).forEach(metric => append(metric, {
      sourceKind: 'session_aoi',
      aoiId: row.aoi && row.aoi.id || null,
      aoiName: row.aoi && row.aoi.name || null,
      aoiOrder: row.aoi && row.aoi.order == null ? null : row.aoi.order
    })));
    const modelData = state.comparisonResponse && state.comparisonResponse.data;
    if (modelData && modelData.metricId) append({
      metricId: modelData.metricId,
      value: modelData.effect,
      unit: modelData.effectUnit,
      status: modelData.readiness === 'available' ? 'computed' : modelData.readiness,
      reason: modelData.reason,
      nParticipants: modelData.nParticipants,
      nObservations: modelData.nObservations,
      algorithm: { id: modelData.modelId, version: modelData.modelVersion }
    }, { sourceKind: 'model_result' });
    return rows;
  }

  function buildExportBundle(state, content) {
    const snapshot = state.snapshot;
    if (!snapshot || state.dirty) throw new Error(tr('Сначала примените фильтры и зафиксируйте выборку','Apply filters and fix the selection first'));
    const metricDefinitions = global.EmocogAnalyticsPlan && global.EmocogAnalyticsPlan.metrics || [];
    const selectedIds = snapshot.queryEcho && snapshot.queryEcho.metricIds || [];
    const dictionary = selectedIds.map(id => {
      const definition = metricDefinitions.find(item => item.id === id) || {};
      return { metricId: id, label: definition.label || null, unit: definition.unit || null, description: definition.description || null };
    });
    const group = state.groupResponse && state.groupResponse.data;
    const session = state.summaryResponse && state.summaryResponse.data;
    const rows = exportMetricRows(state);
    const sessionMetrics = session && Array.isArray(session.metrics) ? session.metrics : [];
    const validTrials = sessionMetrics.find(metric => metric.metricId === 'task.trial_count_valid');
    const excludedTrials = sessionMetrics.find(metric => metric.metricId === 'task.trial_count_excluded');
    const sessionObservations = validTrials && validTrials.denominator != null
      ? Number(validTrials.denominator)
      : Number(validTrials && validTrials.value || 0) + Number(excludedTrials && excludedTrials.value || 0);
    return {
      contractVersion: '1.0',
      kind: 'analytics_export',
      generatedAt: new Date().toISOString(),
      content,
      snapshot: {
        id: snapshot.id,
        datasetHash: snapshot.datasetHash,
        createdAt: snapshot.createdAt,
        queryEcho: snapshot.queryEcho,
        versions: snapshot.versions,
        includedParticipantIds: snapshot.includedParticipantIds || [],
        includedSessionIds: snapshot.includedSessionIds || [],
        excludedSessions: snapshot.excludedSessions || []
      },
      counts: {
        participants: group && group.nParticipants != null ? group.nParticipants : (snapshot.includedParticipantIds || []).length,
        sessions: group && group.nSessions != null ? group.nSessions : (snapshot.includedSessionIds || []).length,
        observations: group && group.nObservations != null ? group.nObservations : sessionObservations
      },
      summary: content === 'long' ? null : {
        session: session || null,
        group: group || null,
        modelResult: state.comparisonResponse && state.comparisonResponse.data || null
      },
      longData: content === 'summary' ? null : rows,
      dataDictionary: dictionary,
      provenance: { frontend: 'researcher-web', exportContract: '1.0', source: 'analysis_snapshot' }
    };
  }

  function exportFilename(state, format) {
    const protocol = selectedProtocol(state);
    const name = localizedName(protocol, protocol && protocol.id || 'protocol').replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'protocol';
    const version = String(state.snapshot && state.snapshot.queryEcho && state.snapshot.queryEcho.protocolVersion || 'version').replace(/[^a-zA-Z0-9_.-]/g, '-');
    const snapshotId = String(state.snapshot && state.snapshot.id || 'snapshot').replace(/[^a-zA-Z0-9_.-]/g, '-');
    return `emocog-${name}-v${version}-${snapshotId}.${format}`;
  }

  function csvCell(value) {
    if (value == null) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportBundleCsv(bundle) {
    const headers = ['rowType','snapshotId','datasetHash','metricId','value','unit','status','reason','numerator','denominator','nParticipants','nSessions','nObservations','label','details'];
    const base = [bundle.snapshot.id, bundle.snapshot.datasetHash];
    const rows = [
      ['counts', ...base, '', '', '', 'computed', '', '', '', bundle.counts.participants, bundle.counts.sessions, bundle.counts.observations, '', JSON.stringify({ versions: bundle.snapshot.versions, queryEcho: bundle.snapshot.queryEcho, provenance: bundle.provenance })]
    ];
    (bundle.dataDictionary || []).forEach(item => rows.push(['dictionary', ...base, item.metricId, '', item.unit, 'not_applicable', '', '', '', '', '', '', JSON.stringify(item.label), JSON.stringify(item.description)]));
    (bundle.longData || []).forEach(item => rows.push(['metric', ...base, item.metricId, item.value, item.unit, item.status, item.reason, item.numerator, item.denominator, item.nParticipants, '', item.nObservations, item.aoiName || '', JSON.stringify({ statistic: item.statistic, sourceKind: item.sourceKind, scope: item.scope, algorithm: item.algorithm, observationDurationMs: item.observationDurationMs, aoiId: item.aoiId, aoiOrder: item.aoiOrder })]));
    return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
  }

  const api = {
    async projects() {
      if (global.EmocogAnalyticsPreviewFixture) return global.EmocogAnalyticsPreviewFixture.projects;
      return listFromResponse(await global.apiGet('/projects'));
    },
    async protocols(projectId) {
      if (global.EmocogAnalyticsPreviewFixture) return global.EmocogAnalyticsPreviewFixture.protocols;
      const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
      return listFromResponse(await global.apiGet('/protocols' + query));
    },
    async sessions(query) {
      if (global.EmocogAnalyticsPreviewFixture) {
        return global.EmocogAnalyticsPreviewFixture.sessions;
      }
      const params = new URLSearchParams();
      if (query.projectId) params.set('project_id', query.projectId);
      if (query.protocolId) params.set('protocol_id', query.protocolId);
      const suffix = params.toString() ? `?${params}` : '';
      return listFromResponse(await global.apiGet('/sessions' + suffix));
    },
    async filterOptions(query) {
      if (global.EmocogAnalyticsPreviewFixture) return normalizeOptions(global.EmocogAnalyticsPreviewFixture.filterOptions);
      const params = new URLSearchParams();
      if (query.projectId) params.set('project_id', query.projectId);
      if (query.protocolId) params.set('protocol_id', query.protocolId);
      if (query.protocolVersion) params.set('protocol_version', query.protocolVersion);
      return normalizeOptions(await global.apiGet('/analytics/v1/filter-options?' + params.toString()));
    },
    async createSnapshot(query) {
      if (global.EmocogAnalyticsPreviewFixture) {
        const sessionIds = query.filters.sessionIds.slice();
        const participants = query.filters.participantIds.slice();
        const groupMode = query.mode === 'group';
        return {
          id: 'preview-snapshot-001',
          datasetHash: 'sha256:preview-interface-only',
          createdAt: new Date().toISOString(),
          queryEcho: query,
          includedParticipantIds: participants.length ? participants : (groupMode ? Array.from({ length: 12 }, (_, index) => `P-${String(index + 1).padStart(3, '0')}`) : ['P-042']),
          includedSessionIds: sessionIds.length ? sessionIds : (groupMode ? Array.from({ length: 12 }, (_, index) => 201 + index) : [105]),
          excludedSessions: groupMode ? [{ sessionId: 213, reasonCode: 'gaze_qc_invalid', channel: 'gaze' }, { sessionId: 214, reasonCode: 'gaze_qc_invalid', channel: 'gaze' }] : [],
          versions: { protocol: query.protocolVersion, aoiSchema: '1.2', metricsCatalog: '1.0', qcRules: 'qc-rules-1.0.0', frontend: 'researcher-web', backend: 'preview' }
        };
      }
      if (typeof global.apiPost !== 'function') throw new Error('501 — analytics snapshot API is unavailable');
      return global.apiPost('/analytics/v1/snapshots', query);
    },
    async sessionSummary(sessionId, snapshot) {
      if (global.EmocogAnalyticsPreviewFixture) return previewSessionSummary(sessionId, snapshot);
      const path = `/analytics/v1/sessions/${encodeURIComponent(sessionId)}/summary?snapshot_id=${encodeURIComponent(snapshot.id)}`;
      return validateAnalyticsResponse(await global.apiGet(path), 'session_summary', snapshot.id);
    },
    async sessionAoi(sessionId, snapshot) {
      if (global.EmocogAnalyticsPreviewFixture) return previewSessionAoi(snapshot);
      const path = `/analytics/v1/sessions/${encodeURIComponent(sessionId)}/aoi?snapshot_id=${encodeURIComponent(snapshot.id)}`;
      return validateAnalyticsResponse(await global.apiGet(path), 'session_aoi', snapshot.id);
    },
    async sessionHeatmap(sessionId, snapshot) {
      if (global.EmocogAnalyticsPreviewFixture) return previewSessionHeatmap(snapshot);
      const path = `/analytics/v1/sessions/${encodeURIComponent(sessionId)}/heatmap?snapshot_id=${encodeURIComponent(snapshot.id)}`;
      return validateAnalyticsResponse(await global.apiGet(path), 'heatmap', snapshot.id);
    },
    async groupSummary(snapshot) {
      if (global.EmocogAnalyticsPreviewFixture) return previewGroupSummary(snapshot);
      const path = `/analytics/v1/groups/summary?snapshot_id=${encodeURIComponent(snapshot.id)}`;
      return validateAnalyticsResponse(await global.apiGet(path), 'group_summary', snapshot.id);
    },
    async groupHeatmap(snapshot) {
      if (global.EmocogAnalyticsPreviewFixture) return previewGroupHeatmap(snapshot);
      const path = `/analytics/v1/groups/heatmap?snapshot_id=${encodeURIComponent(snapshot.id)}`;
      return validateAnalyticsResponse(await global.apiGet(path), 'heatmap', snapshot.id);
    },
    async comparison(comparisonId, snapshot) {
      if (global.EmocogAnalyticsPreviewFixture) return previewModelResult(snapshot, comparisonId);
      const path = `/analytics/v1/comparisons/${encodeURIComponent(comparisonId)}?snapshot_id=${encodeURIComponent(snapshot.id)}`;
      return validateAnalyticsResponse(await global.apiGet(path), 'model_result', snapshot.id);
    },
    async exportSnapshot(state, format, content) {
      const snapshot = state.snapshot;
      if (!snapshot || state.dirty) throw new Error(tr('Нет зафиксированной выборки','No fixed selection'));
      if (global.EmocogAnalyticsPreviewFixture) {
        const bundle = buildExportBundle(state, content);
        const body = format === 'json' ? JSON.stringify(bundle, null, 2) : exportBundleCsv(bundle);
        return { blob: new Blob([body], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), filename: exportFilename(state, format), bundle };
      }
      const params = new URLSearchParams({ snapshot_id: snapshot.id, format, content });
      const base = String(global.API_BASE || '').replace(/\/$/, '');
      const response = await global.fetch(`${base}/analytics/v1/exports?${params.toString()}`, { headers: global.apiHeaders ? global.apiHeaders() : {}, credentials: 'include' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const responseSnapshot = response.headers.get('X-Analysis-Snapshot-Id');
      const responseHash = response.headers.get('X-Dataset-Hash');
      if (!responseSnapshot || String(responseSnapshot) !== String(snapshot.id)) throw new Error('409 — export snapshot does not match the screen');
      if (!responseHash || String(responseHash) !== String(snapshot.datasetHash)) throw new Error('409 — export dataset hash does not match the screen');
      return { blob: await response.blob(), filename: exportFilename(state, format), bundle: null };
    }
  };

  function chooseId(rows, savedId) {
    const saved = String(savedId || '');
    const found = rows.find(row => String(row && row.id) === saved);
    return found ? String(found.id) : (rows[0] && rows[0].id != null ? String(rows[0].id) : '');
  }

  const savedDraft = storedJson(QUERY_KEY, {});
  const defaultDraft = {
    mode: 'session', protocolVersion: '', blockId: '', stimulusId: '', aoiId: '',
    groupId: '', conditionId: '', comparisonId: '',
    qcMode: 'valid_and_borderline', qcChannels: ['task', 'gaze'],
    dateFrom: '', dateTo: '', includeIncompleteSessions: false
  };

  function selectedProtocol(state) {
    return state.protocols.find(row => String(row.id) === String(state.query.protocolId)) || null;
  }

  function protocolVersions(protocol) {
    if (!protocol) return [];
    const values = [];
    if (Array.isArray(protocol.versions)) protocol.versions.forEach(item => values.push(typeof item === 'object' ? item.version : item));
    values.push(protocol.version, protocol.protocol_version, protocol.definition && (protocol.definition.version || protocol.definition.schemaVersion));
    return [...new Set(values.filter(Boolean).map(String))];
  }

  function metricIdsForState(state) {
    const protocol = selectedProtocol(state);
    const plan = protocol && (protocol.analyticsPlan || protocol.analytics_plan || protocol.definition && protocol.definition.analyticsPlan);
    const selected = plan && (plan.selectedMetricIds || plan.metricIds);
    if (Array.isArray(selected) && selected.length) return selected.slice();
    const metrics = global.EmocogAnalyticsPlan && global.EmocogAnalyticsPlan.metrics || [];
    return metrics.filter(item => item.defaultSelected || item.mandatory).map(item => item.id);
  }

  function dateBoundary(value, endOfDay) {
    if (!value) return null;
    const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
    const parsed = new Date(value + suffix);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  function buildAnalyticsQuery(state) {
    const row = selectedSession(state);
    const sessionMode = state.query.mode === 'session';
    const comparison = state.filterOptions.comparisons.find(item => String(item.id) === String(state.query.comparisonId));
    const levelTwo = !sessionMode && state.groupLevel === 'level-2';
    const query = {
      schemaVersion: '1.0',
      mode: state.query.mode,
      analysisLevel: state.query.mode === 'session' ? 'level_1' : state.groupLevel.replace('-', '_'),
      projectId: coerceId(state.query.projectId),
      protocolId: coerceId(state.query.protocolId),
      protocolVersion: state.query.protocolVersion,
      metricIds: metricIdsForState(state),
      filters: {
        participantIds: sessionMode && row && (row.participant_id || row.participant_alias) ? [row.participant_id || row.participant_alias] : [],
        sessionIds: sessionMode && row ? [coerceId(row.id)] : [],
        groupIds: levelTwo && comparison ? (comparison.groupIds || []).slice() : (state.query.groupId ? [state.query.groupId] : []),
        conditionIds: state.query.conditionId ? [state.query.conditionId] : (levelTwo && comparison && Array.isArray(comparison.conditionIds) ? comparison.conditionIds.slice() : []),
        blockIds: state.query.blockId ? [state.query.blockId] : [],
        stimulusIds: state.query.stimulusId ? [state.query.stimulusId] : [],
        aoiIds: state.query.aoiId ? [state.query.aoiId] : [],
        qcMode: state.query.qcMode,
        qcChannels: state.query.qcChannels.slice(),
        minValidFraction: null,
        minSignalConfidence: null,
        dateFrom: dateBoundary(state.query.dateFrom, false),
        dateTo: dateBoundary(state.query.dateTo, true),
        includeIncompleteSessions: state.query.includeIncompleteSessions === true
      }
    };
    if (levelTwo && comparison) query.comparison = { factorIds: (comparison.factorIds || []).slice(), contrastIds: (comparison.contrastIds || []).slice() };
    return query;
  }

  const store = {
    state: {
      status: 'idle',
      emptyKind: '',
      error: null,
      projects: [],
      protocols: [],
      sessions: [],
      filterOptions: normalizeOptions(null),
      filterOptionsError: null,
      query: Object.assign({}, defaultDraft, savedDraft, {
        projectId: selectedStored(PROJECT_KEY),
        protocolId: selectedStored(PROTOCOL_KEY),
        sessionId: selectedStored(SESSION_KEY)
      }),
      groupLevel: savedDraft.analysisLevel === 'level_2' ? 'level-2' : 'level-1',
      dirty: true,
      snapshotStatus: 'idle',
      snapshot: null,
      snapshotError: null,
      summaryStatus: 'idle',
      summaryResponse: null,
      summaryError: null,
      visualStatus: 'idle',
      aoiResponse: null,
      heatmapResponse: null,
      visualError: null,
      layers: { heatmap: true, aoi: true, fixations: true },
      groupStatus: 'idle',
      groupResponse: null,
      groupError: null,
      groupHeatmapStatus: 'idle',
      groupHeatmapResponse: null,
      groupHeatmapError: null,
      comparisonStatus: 'idle',
      comparisonResponse: null,
      comparisonError: null,
      importStatus: 'idle',
      importMessage: ''
    },
    listeners: new Set(),
    requestId: 0,
    summaryRequestId: 0,
    visualRequestId: 0,
    groupRequestId: 0,
    groupHeatmapRequestId: 0,
    comparisonRequestId: 0,
    initialized: false,

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },

    emit() {
      this.listeners.forEach(listener => listener(this.state));
    },

    persist() {
      try {
        global.localStorage.setItem(QUERY_KEY, JSON.stringify(Object.assign({}, this.state.query, { analysisLevel: this.state.groupLevel.replace('-', '_') })));
      } catch (_) {}
    },

    changed() {
      this.state.dirty = true;
      this.state.snapshotError = null;
      this.persist();
      this.emit();
    },

    setStatus(status, patch) {
      Object.assign(this.state, patch || {}, { status });
      this.emit();
    },

    async initialize(force) {
      if (this.initialized && !force) {
        this.emit();
        return;
      }
      this.initialized = true;
      if (!Array.isArray(this.state.query.qcChannels)) this.state.query.qcChannels = defaultDraft.qcChannels.slice();
      if (!hasAuth() || (!global.EmocogAnalyticsPreviewFixture && typeof global.apiGet !== 'function')) {
        this.setStatus('unauthorized', { error: null, projects: [], protocols: [], sessions: [] });
        return;
      }
      const requestId = ++this.requestId;
      this.setStatus('loading', { error: null, emptyKind: '' });
      try {
        const projects = await api.projects();
        if (requestId !== this.requestId) return;
        if (!projects.length) {
          this.state.query.projectId = '';
          this.state.query.protocolId = '';
          this.state.query.sessionId = '';
          this.state.query.protocolVersion = '';
          this.setStatus('empty', { projects: [], protocols: [], sessions: [], emptyKind: 'projects' });
          return;
        }
        const projectId = chooseId(projects, this.state.query.projectId);
        this.state.projects = projects;
        this.state.query.projectId = projectId;
        storeSelected(PROJECT_KEY, projectId);
        await this.loadProjectContext(requestId);
      } catch (error) {
        if (requestId !== this.requestId) return;
        this.handleError(error);
      }
    },

    async importResult(file) {
      this.state.importStatus = 'loading';
      this.state.importMessage = tr('Проверяем и отправляем результат…','Validating and uploading the result…');
      this.emit();
      try {
        const imported = await importResultJson(file, this.state);
        const importedQc = String(imported.result?.qc_validity || '').toLowerCase();
        if (importedQc === 'invalid') this.state.query.qcMode = 'all';
        else if (importedQc === 'borderline' && this.state.query.qcMode === 'valid_only') {
          this.state.query.qcMode = 'valid_and_borderline';
        }
        this.persist();
        const qcSuffix = importedQc
          ? ` · QC: ${statusLabel(importedQc)}`
          : '';
        this.state.importStatus = 'success';
        this.state.importMessage = `${tr('Результат принят и добавлен','Result accepted and imported')} · ${imported.sessionId}${qcSuffix}`;
        await this.initialize(true);
        const importedRow = this.state.sessions.find(row => (
          String(row.session_id || '') === imported.sessionId
        ));
        if (importedRow) {
          this.state.query.sessionId = String(importedRow.id);
          storeSelected(SESSION_KEY, this.state.query.sessionId);
          this.persist();
        }
        this.state.importStatus = 'success';
        this.state.importMessage = `${tr('Результат принят и добавлен','Result accepted and imported')} · ${imported.sessionId}${qcSuffix}`;
        this.emit();
      } catch (error) {
        this.state.importStatus = 'error';
        this.state.importMessage = `${tr('Не удалось импортировать','Import failed')}: ${error.message}`;
        this.emit();
      }
    },

    async loadProjectContext(parentRequestId) {
      const requestId = parentRequestId || ++this.requestId;
      if (!parentRequestId) this.setStatus('loading', { error: null, emptyKind: '' });
      try {
        const protocols = await api.protocols(this.state.query.projectId);
        if (requestId !== this.requestId) return;
        this.state.protocols = protocols;
        this.state.query.protocolId = chooseId(protocols, this.state.query.protocolId);
        const versions = protocolVersions(selectedProtocol(this.state));
        this.state.query.protocolVersion = versions.includes(this.state.query.protocolVersion) ? this.state.query.protocolVersion : (versions[0] || '');
        this.clearDefinitionFilters();
        this.state.query.sessionId = '';
        storeSelected(PROTOCOL_KEY, this.state.query.protocolId);
        storeSelected(SESSION_KEY, '');
        await this.loadSessions(requestId);
      } catch (error) {
        if (requestId !== this.requestId) return;
        this.handleError(error);
      }
    },

    async loadSessions(parentRequestId) {
      const requestId = parentRequestId || ++this.requestId;
      if (!parentRequestId) this.setStatus('loading', { error: null, emptyKind: '' });
      try {
        const results = await Promise.all([
          api.sessions(this.state.query),
          api.filterOptions(this.state.query).catch(error => {
            this.state.filterOptionsError = error;
            return normalizeOptions(null);
          })
        ]);
        const sessions = results[0];
        if (requestId !== this.requestId) return;
        this.state.sessions = sessions;
        this.state.filterOptions = results[1];
        this.state.query.sessionId = chooseId(sessions, this.state.query.sessionId || selectedStored(SESSION_KEY));
        storeSelected(SESSION_KEY, this.state.query.sessionId);
        if (!sessions.length) {
          this.setStatus('empty', { error: null, emptyKind: 'sessions' });
        } else {
          this.persist();
          this.setStatus('ready', { error: null, emptyKind: '' });
        }
      } catch (error) {
        if (requestId !== this.requestId) return;
        this.handleError(error);
      }
    },

    handleError(error) {
      const status = errorStatus(error);
      if (status === 401 || status === 403) {
        this.setStatus('unauthorized', { error });
      } else {
        this.setStatus('error', { error });
      }
    },

    setProject(projectId) {
      this.state.query.projectId = String(projectId || '');
      this.state.query.protocolId = '';
      this.state.query.sessionId = '';
      this.state.query.protocolVersion = '';
      this.clearDefinitionFilters();
      storeSelected(PROJECT_KEY, this.state.query.projectId);
      this.loadProjectContext();
    },

    setProtocol(protocolId) {
      this.state.query.protocolId = String(protocolId || '');
      this.state.query.sessionId = '';
      const versions = protocolVersions(selectedProtocol(this.state));
      this.state.query.protocolVersion = versions[0] || '';
      this.clearDefinitionFilters();
      storeSelected(PROTOCOL_KEY, this.state.query.protocolId);
      this.loadSessions();
    },

    setProtocolVersion(version) {
      this.state.query.protocolVersion = String(version || '');
      this.clearDefinitionFilters();
      this.loadSessions();
    },

    setSession(sessionId) {
      this.state.query.sessionId = String(sessionId || '');
      storeSelected(SESSION_KEY, this.state.query.sessionId);
      this.changed();
    },

    clearDefinitionFilters() {
      this.state.query.groupId = '';
      this.state.query.conditionId = '';
      this.state.query.comparisonId = '';
      this.state.query.blockId = '';
      this.state.query.stimulusId = '';
      this.state.query.aoiId = '';
      this.state.filterOptions = normalizeOptions(null);
      this.state.dirty = true;
    },

    setFilter(name, value) {
      if (!(name in defaultDraft)) return;
      this.state.query[name] = name === 'includeIncompleteSessions' ? value === true : String(value || '');
      if (name === 'blockId') {
        this.state.query.stimulusId = '';
        this.state.query.aoiId = '';
      }
      if (name === 'stimulusId') this.state.query.aoiId = '';
      if (name === 'comparisonId') {
        const comparison = this.state.filterOptions.comparisons.find(item => String(item.id) === this.state.query.comparisonId);
        if (comparison && Array.isArray(comparison.conditionIds) && comparison.conditionIds.length === 1) {
          this.state.query.conditionId = String(comparison.conditionIds[0]);
        }
      }
      this.changed();
    },

    toggleChannel(channel, checked) {
      const values = new Set(this.state.query.qcChannels);
      if (checked) values.add(channel); else values.delete(channel);
      this.state.query.qcChannels = [...values];
      this.changed();
    },

    setMode(mode) {
      this.state.query.mode = mode === 'group' ? 'group' : 'session';
      this.changed();
    },

    resetFilters() {
      Object.assign(this.state.query, defaultDraft, {
        projectId: this.state.query.projectId,
        protocolId: this.state.query.protocolId,
        protocolVersion: protocolVersions(selectedProtocol(this.state))[0] || '',
        sessionId: chooseId(this.state.sessions, '')
      });
      this.state.snapshot = null;
      this.state.snapshotStatus = 'idle';
      this.state.summaryStatus = 'idle';
      this.state.summaryResponse = null;
      this.state.summaryError = null;
      this.state.visualStatus = 'idle';
      this.state.aoiResponse = null;
      this.state.heatmapResponse = null;
      this.state.visualError = null;
      this.state.groupStatus = 'idle';
      this.state.groupResponse = null;
      this.state.groupError = null;
      this.state.groupHeatmapStatus = 'idle';
      this.state.groupHeatmapResponse = null;
      this.state.groupHeatmapError = null;
      this.state.comparisonStatus = 'idle';
      this.state.comparisonResponse = null;
      this.state.comparisonError = null;
      this.changed();
    },

    async apply() {
      if (this.state.query.mode === 'session' && !selectedSession(this.state)) return;
      if (this.state.query.dateFrom && this.state.query.dateTo && this.state.query.dateFrom > this.state.query.dateTo) {
        this.state.snapshotStatus = 'error';
        this.state.snapshotError = new Error(tr('Дата начала не может быть позже даты окончания','Start date cannot be later than end date'));
        this.emit();
        return;
      }
      if (!this.state.query.qcChannels.length) {
        this.state.snapshotStatus = 'error';
        this.state.snapshotError = new Error(tr('Выберите хотя бы один QC-канал','Select at least one QC channel'));
        this.emit();
        return;
      }
      if (this.state.query.mode === 'group' && this.state.groupLevel === 'level-2' && !this.state.query.comparisonId) {
        this.state.snapshotStatus = 'error';
        this.state.snapshotError = new Error(tr('Выберите заранее настроенное сравнение','Select a predefined comparison'));
        this.emit();
        return;
      }
      this.state.snapshotStatus = 'creating';
      this.state.snapshotError = null;
      this.state.summaryStatus = 'idle';
      this.state.summaryResponse = null;
      this.state.summaryError = null;
      this.state.visualStatus = 'idle';
      this.state.aoiResponse = null;
      this.state.heatmapResponse = null;
      this.state.visualError = null;
      this.state.groupStatus = 'idle';
      this.state.groupResponse = null;
      this.state.groupError = null;
      this.state.groupHeatmapStatus = 'idle';
      this.state.groupHeatmapResponse = null;
      this.state.groupHeatmapError = null;
      this.state.comparisonStatus = 'idle';
      this.state.comparisonResponse = null;
      this.state.comparisonError = null;
      this.emit();
      try {
        const response = await api.createSnapshot(buildAnalyticsQuery(this.state));
        this.state.snapshot = response && response.data && !response.id ? response.data : response;
        this.state.snapshotStatus = 'ready';
        this.state.dirty = false;
        this.persist();
        this.emit();
        if (this.state.query.mode === 'session') await Promise.all([this.loadSessionSummary(), this.loadVisualAnalytics()]);
        else if (this.state.groupLevel === 'level-2') await this.loadComparison();
        else await Promise.all([this.loadGroupSummary(), this.loadGroupHeatmap()]);
      } catch (error) {
        this.state.snapshotStatus = 'error';
        this.state.snapshotError = error;
        this.emit();
      }
    },

    async loadSessionSummary() {
      const row = selectedSession(this.state);
      if (!row || !this.state.snapshot) return;
      const requestId = ++this.summaryRequestId;
      this.state.summaryStatus = 'loading';
      this.state.summaryError = null;
      this.emit();
      try {
        const response = await api.sessionSummary(row.id, this.state.snapshot);
        if (requestId !== this.summaryRequestId || this.state.dirty) return;
        this.state.summaryResponse = response;
        this.state.summaryStatus = 'ready';
        this.emit();
      } catch (error) {
        if (requestId !== this.summaryRequestId) return;
        if (global.console && typeof global.console.error === 'function') {
          global.console.error(
            '[analytics][session-summary] request failed:',
            error && error.message ? String(error.message) : String(error)
          );
        }
        this.state.summaryResponse = null;
        this.state.summaryStatus = 'error';
        this.state.summaryError = error;
        this.emit();
      }
    },

    async loadVisualAnalytics() {
      const row = selectedSession(this.state);
      if (!row || !this.state.snapshot) return;
      if (!this.state.query.blockId || !this.state.query.stimulusId) {
        this.state.visualStatus = 'context_required';
        this.state.aoiResponse = null;
        this.state.heatmapResponse = null;
        this.state.visualError = null;
        this.emit();
        return;
      }
      const requestId = ++this.visualRequestId;
      this.state.visualStatus = 'loading';
      this.state.visualError = null;
      this.emit();
      try {
        const responses = await Promise.all([api.sessionAoi(row.id, this.state.snapshot), api.sessionHeatmap(row.id, this.state.snapshot)]);
        if (requestId !== this.visualRequestId || this.state.dirty) return;
        const aoiStimulus = responses[0] && responses[0].data && responses[0].data.stimulus;
        const heatmapStimulus = responses[1] && responses[1].data && responses[1].data.stimulus;
        if (!aoiStimulus || !heatmapStimulus || String(aoiStimulus.id) !== String(heatmapStimulus.id) || String(aoiStimulus.version) !== String(heatmapStimulus.version)) {
          throw new Error('409 — AOI and heatmap stimulus versions do not match');
        }
        this.state.aoiResponse = responses[0];
        this.state.heatmapResponse = responses[1];
        this.state.visualStatus = 'ready';
        this.emit();
      } catch (error) {
        if (requestId !== this.visualRequestId) return;
        this.state.aoiResponse = null;
        this.state.heatmapResponse = null;
        this.state.visualStatus = 'error';
        this.state.visualError = error;
        this.emit();
      }
    },

    setLayer(name, checked) {
      if (!(name in this.state.layers)) return;
      this.state.layers[name] = checked === true;
      this.emit();
    },

    async loadGroupSummary() {
      if (!this.state.snapshot) return;
      const requestId = ++this.groupRequestId;
      this.state.groupStatus = 'loading';
      this.state.groupError = null;
      this.emit();
      try {
        const response = await api.groupSummary(this.state.snapshot);
        if (requestId !== this.groupRequestId || this.state.dirty) return;
        this.state.groupResponse = response;
        this.state.groupStatus = 'ready';
        this.emit();
      } catch (error) {
        if (requestId !== this.groupRequestId) return;
        this.state.groupResponse = null;
        this.state.groupStatus = 'error';
        this.state.groupError = error;
        this.emit();
      }
    },

    async loadGroupHeatmap() {
      if (!this.state.snapshot) return;
      if (!metricIdsForState(this.state).includes('viz.heatmap')) {
        this.state.groupHeatmapStatus = 'not_configured';
        this.emit();
        return;
      }
      if (!this.state.query.blockId || !this.state.query.stimulusId) {
        this.state.groupHeatmapStatus = 'context_required';
        this.emit();
        return;
      }
      const requestId = ++this.groupHeatmapRequestId;
      this.state.groupHeatmapStatus = 'loading';
      this.state.groupHeatmapError = null;
      this.emit();
      try {
        const response = await api.groupHeatmap(this.state.snapshot);
        if (requestId !== this.groupHeatmapRequestId || this.state.dirty) return;
        if (response.data && response.data.equalParticipantWeight !== true) throw new Error('409 — group heatmap must use equal participant weight');
        this.state.groupHeatmapResponse = response;
        this.state.groupHeatmapStatus = 'ready';
        this.emit();
      } catch (error) {
        if (requestId !== this.groupHeatmapRequestId) return;
        this.state.groupHeatmapResponse = null;
        this.state.groupHeatmapStatus = 'error';
        this.state.groupHeatmapError = error;
        this.emit();
      }
    },

    async loadComparison() {
      if (!this.state.snapshot || !this.state.query.comparisonId) return;
      const requestId = ++this.comparisonRequestId;
      this.state.comparisonStatus = 'loading';
      this.state.comparisonError = null;
      this.emit();
      try {
        const response = await api.comparison(this.state.query.comparisonId, this.state.snapshot);
        if (requestId !== this.comparisonRequestId || this.state.dirty) return;
        this.state.comparisonResponse = response;
        this.state.comparisonStatus = 'ready';
        this.emit();
      } catch (error) {
        if (requestId !== this.comparisonRequestId) return;
        this.state.comparisonResponse = null;
        this.state.comparisonStatus = 'error';
        this.state.comparisonError = error;
        this.emit();
      }
    },

    setGroupLevel(level) {
      if (level === 'level-3') return;
      this.state.groupLevel = level;
      this.changed();
    }
  };

  function optionLabel(row, kind) {
    if (kind === 'project') return localizedName(row, row.title || `${tr('Проект','Project')} ${row.id}`);
    if (kind === 'protocol') return localizedName(row, row.title || row.definition?.title || `${tr('Протокол','Protocol')} ${row.id}`);
    const participant = row.participant_alias || row.participant_id || tr('участник не указан', 'participant not specified');
    const session = row.session_id || row.id;
    const started = row.started_at ? new Date(row.started_at) : null;
    const date = started && Number.isFinite(started.getTime()) ? ` · ${new Intl.DateTimeFormat(isEnglish() ? 'en-US' : 'ru-RU').format(started)}` : '';
    const completion = row.status || row.completion_status ? ` · ${statusLabel(row.status || row.completion_status)}` : '';
    const qc = row.qc_validity ? ` · QC: ${statusLabel(row.qc_validity)}` : '';
    return `${session} · ${participant}${date}${completion}${qc}`;
  }

  function selectHtml(id, label, rows, value, kind, disabled) {
    return `<label style="display:flex;flex-direction:column;gap:5px;min-width:${kind === 'session' ? '260px' : '190px'};flex:1;">
      <span style="font-size:10px;font-weight:750;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">${label}</span>
      <select id="${id}" ${disabled ? 'disabled' : ''} style="width:100%;padding:9px 10px;border:1px solid var(--stroke);border-radius:10px;background:var(--card-bg);color:var(--text);font-size:12px;">
        ${rows.length ? rows.map(row => `<option value="${escapeHtml(row.id)}" ${String(row.id) === String(value) ? 'selected' : ''}>${escapeHtml(optionLabel(row, kind))}</option>`).join('') : `<option value="">${tr('Нет доступных вариантов','No options available')}</option>`}
      </select>
    </label>`;
  }

  function simpleSelectHtml(id, label, rows, value, disabled, allLabel) {
    return `<label style="display:flex;flex-direction:column;gap:5px;min-width:170px;flex:1;">
      <span style="font-size:10px;font-weight:750;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">${label}</span>
      <select id="${id}" ${disabled ? 'disabled' : ''} style="width:100%;padding:9px 10px;border:1px solid var(--stroke);border-radius:10px;background:var(--card-bg);color:var(--text);font-size:12px;">
        ${allLabel == null ? '' : `<option value="">${allLabel}</option>`}
        ${rows.map(row => `<option value="${escapeHtml(row.id)}" ${String(row.id) === String(value) ? 'selected' : ''}>${escapeHtml(localizedName(row, row.label || row.id))}</option>`).join('')}
      </select>
    </label>`;
  }

  function appliedChipsHtml(state) {
    const snapshot = state.snapshot;
    const source = snapshot && !state.dirty && snapshot.queryEcho || buildAnalyticsQuery(state);
    const filters = source.filters;
    const optionName = (rows, id) => localizedName(rows.find(row => String(row.id) === String(id)), id);
    const chips = [
      optionName(state.projects, source.projectId),
      `${optionName(state.protocols, source.protocolId)} · v${source.protocolVersion}`,
      source.mode === 'session' ? optionLabel(selectedSession(state) || {}, 'session') : tr('Все подходящие сессии','All matching sessions'),
      source.mode === 'group' && state.query.comparisonId && optionName(state.filterOptions.comparisons, state.query.comparisonId),
      filters.groupIds.length && filters.groupIds.map(id => optionName(state.filterOptions.groups, id)).join(' + '),
      filters.conditionIds.length && filters.conditionIds.map(id => optionName(state.filterOptions.conditions, id)).join(', '),
      filters.blockIds[0] && optionName(state.filterOptions.blocks, filters.blockIds[0]),
      filters.stimulusIds[0] && optionName(state.filterOptions.stimuli, filters.stimulusIds[0]),
      filters.aoiIds[0] && optionName(state.filterOptions.aois, filters.aoiIds[0]),
      qcModeLabel(filters.qcMode)
    ].filter(Boolean);
    return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:0 2px;">
      <span style="font-size:9px;color:var(--muted);font-weight:750;text-transform:uppercase;">${state.snapshot && !state.dirty ? tr('Применённая выборка','Applied selection') : tr('Черновик выборки','Selection draft')}</span>
      ${chips.map(value => `<span style="padding:4px 8px;border-radius:999px;background:rgba(92,102,189,.08);color:var(--accent);font-size:9px;">${escapeHtml(value)}</span>`).join('')}
    </div>`;
  }

  function snapshotStateHtml(state) {
    if (state.snapshotStatus === 'creating') return `<div style="font-size:10px;color:var(--muted);">${tr('Backend фиксирует выборку…','Backend is creating the selection snapshot…')}</div>`;
    if (state.snapshotStatus === 'error') return `<div style="font-size:10px;color:var(--bad);">${tr('Snapshot не создан:','Snapshot was not created:')} ${escapeHtml(state.snapshotError && state.snapshotError.message || '')}</div>`;
    if (state.snapshot && !state.dirty) {
      const included = Array.isArray(state.snapshot.includedSessionIds) ? state.snapshot.includedSessionIds.length : 0;
      return `<div style="font-size:10px;color:var(--good);">${tr('Выборка зафиксирована','Selection fixed')} · ${escapeHtml(state.snapshot.id)} · N=${included} · ${escapeHtml(state.snapshot.datasetHash || '')}</div>`;
    }
    return `<div style="font-size:10px;color:var(--muted);">${tr('Есть неприменённые изменения','There are unapplied changes')}</div>`;
  }

  function validateExportBundle(bundle, state) {
    const snapshot = state.snapshot;
    if (!bundle || bundle.kind !== 'analytics_export') throw new Error('502 — invalid analytics export');
    if (String(bundle.snapshot && bundle.snapshot.id) !== String(snapshot && snapshot.id)) throw new Error('409 — export snapshot does not match the screen');
    if (String(bundle.snapshot && bundle.snapshot.datasetHash) !== String(snapshot && snapshot.datasetHash)) throw new Error('409 — export dataset hash does not match the screen');
    const screenQc = snapshot && snapshot.queryEcho && snapshot.queryEcho.filters && snapshot.queryEcho.filters.qcMode;
    const exportQc = bundle.snapshot && bundle.snapshot.queryEcho && bundle.snapshot.queryEcho.filters && bundle.snapshot.queryEcho.filters.qcMode;
    if (screenQc !== exportQc) throw new Error('409 — export QC mode does not match the screen');
    const group = state.groupResponse && state.groupResponse.data;
    if (group && (bundle.counts.participants !== group.nParticipants || bundle.counts.sessions !== group.nSessions || bundle.counts.observations !== group.nObservations)) {
      throw new Error('409 — export counts do not match the screen');
    }
    (bundle.longData || []).forEach(row => {
      if (row.value == null && row.status === 'computed') throw new Error(`422 — nullable metric ${row.metricId} requires a non-computed status`);
    });
    return true;
  }

  function triggerDownload(blob, filename) {
    const url = global.URL.createObjectURL(blob);
    const anchor = global.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    global.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => global.URL.revokeObjectURL(url), 0);
  }

  function AnalyticsExportView() {
    const pageTitle = global.document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = tr('Экспорт аналитики','Analytics export');
    if (typeof global.setChips === 'function') global.setChips([tr('Единая выборка','Fixed selection')]);
    const root = global.document.createElement('div');
    const state = store.state;
    root.className = 'grid';
    if (!hasAuth() || (!global.EmocogAnalyticsPreviewFixture && typeof global.fetch !== 'function')) {
      root.innerHTML = `<div style="grid-column:span 12;">${stateCard('unauthorized', tr('Нужна авторизация исследователя','Researcher sign-in required'), tr('Production export не создаёт демонстрационные файлы без авторизации.','Production export does not create demo files without authorization.'))}</div>`;
      return root;
    }
    if (!state.snapshot || state.dirty) {
      root.innerHTML = `<div style="grid-column:span 12;">${stateCard('empty', tr('Нет зафиксированной выборки','No fixed selection'), tr('Откройте аналитику, примените фильтры и только затем создайте export. Собственные фильтры на странице export отсутствуют.','Open analytics, apply the filters, and only then create an export. The export page has no independent filters.'), tr('Вернуться к аналитике','Return to analytics'))}</div>`;
      root.querySelector('#analyticsStateAction')?.addEventListener('click', () => global.navigate && global.navigate('#/analytics/session-card'));
      return root;
    }
    const snapshot = state.snapshot;
    const query = snapshot.queryEcho || {};
    const filters = query.filters || {};
    const counts = buildExportBundle(state, 'both').counts;
    root.innerHTML = `<div class="card" style="grid-column:span 12;padding:0;overflow:hidden;">
      <header style="padding:17px 18px;border-bottom:1px solid var(--stroke);display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;"><div><h2 style="font-size:17px;color:var(--text);margin:0;">${tr('Экспорт зафиксированной выборки','Fixed-selection export')}</h2><p style="font-size:11px;color:var(--muted);line-height:1.55;margin:6px 0 0;max-width:700px;">${tr('Файл использует тот же snapshot, QC и версии, что и дашборд. Изменить фильтры на этой странице нельзя.','The file uses the same snapshot, QC, and versions as the dashboard. Filters cannot be changed on this page.')}</p></div>${global.EmocogAnalyticsPreviewFixture ? `<span style="padding:5px 8px;border-radius:999px;background:rgba(245,158,11,.10);color:var(--warn);font-size:9px;font-weight:700;">${tr('PREVIEW · условные данные','PREVIEW · fictional data')}</span>` : ''}</header>
      <section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px;">${[[tr('Snapshot','Snapshot'),snapshot.id],[tr('Dataset hash','Dataset hash'),snapshot.datasetHash],[tr('Участники','Participants'),counts.participants],[tr('Сессии','Sessions'),counts.sessions],[tr('Наблюдения','Observations'),counts.observations],[tr('QC-режим','QC mode'),qcModeLabel(filters.qcMode)]].map(([label,value]) => `<div style="padding:10px;border:1px solid var(--stroke);border-radius:10px;"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">${escapeHtml(label)}</div><div style="font-size:12px;font-weight:700;color:var(--text);margin-top:4px;word-break:break-word;">${escapeHtml(value)}</div></div>`).join('')}</div><div style="font-size:9px;color:var(--muted);line-height:1.6;margin-top:9px;">${tr('Создан','Created')}: ${escapeHtml(formatDateTime(snapshot.createdAt))} · ${tr('Протокол','Protocol')} ${escapeHtml(query.protocolId)} v${escapeHtml(query.protocolVersion)} · ${tr('Каналы','Channels')}: ${escapeHtml((filters.qcChannels || []).map(channelLabel).join(', '))}<br>${Object.entries(snapshot.versions || {}).map(([key,value]) => `${escapeHtml(key)}=${escapeHtml(value == null ? '—' : value)}`).join(' · ')}</div></section>
      <form id="analyticsExportForm" style="padding:16px 18px;display:flex;gap:11px;align-items:flex-end;flex-wrap:wrap;">
        <label style="display:flex;flex-direction:column;gap:5px;min-width:180px;"><span style="font-size:10px;font-weight:700;color:var(--muted);">${tr('Формат','Format')}</span><select id="analyticsExportFormat" style="padding:9px;border:1px solid var(--stroke);border-radius:9px;background:var(--card-bg);color:var(--text);"><option value="csv">CSV</option><option value="json">JSON</option></select></label>
        <label style="display:flex;flex-direction:column;gap:5px;min-width:230px;"><span style="font-size:10px;font-weight:700;color:var(--muted);">${tr('Состав','Contents')}</span><select id="analyticsExportContent" style="padding:9px;border:1px solid var(--stroke);border-radius:9px;background:var(--card-bg);color:var(--text);"><option value="both">${tr('Сводка + длинный формат','Summary + long format')}</option><option value="summary">${tr('Сводка','Summary')}</option><option value="long">${tr('Длинный формат','Long format')}</option></select></label>
        <button id="analyticsExportDownload" type="submit" class="quick-btn" style="padding:10px 16px;background:var(--accent);border-color:var(--accent);color:white;">${tr('Скачать','Download')}</button>
        <button id="analyticsExportBack" type="button" class="quick-btn" style="padding:10px 14px;">${tr('Вернуться к аналитике','Return to analytics')}</button>
        <div id="analyticsExportStatus" role="status" aria-live="polite" style="width:100%;font-size:10px;color:var(--muted);"></div>
      </form>
      <details style="padding:12px 18px;border-top:1px solid var(--stroke);"><summary style="cursor:pointer;font-size:10px;font-weight:700;">${tr('Что входит в файл','What the file contains')}</summary><div style="font-size:9px;color:var(--muted);line-height:1.7;margin-top:7px;">${tr('Data dictionary, versions, query echo, N, numerator/denominator, status/reason для nullable-метрик и provenance. CSV использует отдельные строки counts, dictionary и metric.','Data dictionary, versions, query echo, N, numerator/denominator, nullable metric status/reason, and provenance. CSV uses separate counts, dictionary, and metric rows.')}</div></details>
    </div>`;
    const form = root.querySelector('#analyticsExportForm');
    const status = root.querySelector('#analyticsExportStatus');
    root.querySelector('#analyticsExportBack').addEventListener('click', () => global.navigate && global.navigate(query.mode === 'group' ? '#/analytics/group-comparison' : '#/analytics/session-card'));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const format = root.querySelector('#analyticsExportFormat').value;
      const content = root.querySelector('#analyticsExportContent').value;
      const button = root.querySelector('#analyticsExportDownload');
      button.disabled = true;
      status.style.color = 'var(--muted)';
      status.textContent = tr('Backend формирует файл…','Backend is creating the file…');
      try {
        const result = await api.exportSnapshot(state, format, content);
        if (result.bundle) validateExportBundle(result.bundle, state);
        triggerDownload(result.blob, result.filename);
        status.style.color = 'var(--good)';
        status.textContent = `${tr('Готово','Ready')} · ${result.filename} · snapshot ${snapshot.id}`;
      } catch (error) {
        status.style.color = 'var(--bad)';
        status.textContent = `${tr('Ошибка export','Export error')}: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
    return root;
  }

  function filtersHtml(state) {
    const disabled = state.status === 'loading';
    const protocol = selectedProtocol(state);
    const versions = protocolVersions(protocol).map(id => ({ id, label: id }));
    const blocks = state.filterOptions.blocks;
    const stimuli = state.filterOptions.stimuli.filter(row => !state.query.blockId || String(row.blockId || row.block_id) === state.query.blockId);
    const aois = state.filterOptions.aois.filter(row => !state.query.stimulusId || String(row.stimulusId || row.stimulus_id) === state.query.stimulusId);
    const groups = state.filterOptions.groups;
    const conditions = state.filterOptions.conditions;
    const comparisons = state.filterOptions.comparisons;
    const channels = state.filterOptions.qcChannels.length ? state.filterOptions.qcChannels : ['task', 'gaze'];
    return `<div class="card" style="padding:13px 14px;display:flex;flex-direction:column;gap:12px;">
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
        ${selectHtml('analyticsProjectFilter', tr('Проект','Project'), state.projects, state.query.projectId, 'project', disabled)}
        ${selectHtml('analyticsProtocolFilter', tr('Протокол','Protocol'), state.protocols, state.query.protocolId, 'protocol', disabled)}
        ${simpleSelectHtml('analyticsVersionFilter', tr('Версия','Version'), versions, state.query.protocolVersion, disabled, null)}
        ${state.query.mode === 'session' ? selectHtml('analyticsSessionFilter', tr('Сессия','Session'), state.sessions, state.query.sessionId, 'session', disabled) : ''}
        ${state.query.mode === 'session' ? `<div style="display:flex;flex-direction:column;gap:5px;min-width:180px;"><span style="font-size:10px;font-weight:750;color:var(--muted);text-transform:uppercase;">${tr('Локальный результат','Local result')}</span><input id="analyticsResultImportFile" type="file" accept="application/json,.json" hidden><button id="analyticsResultImport" type="button" class="quick-btn" ${disabled || state.importStatus === 'loading' ? 'disabled' : ''}>${tr('Добавить JSON','Import JSON')}</button></div>` : ''}
      </div>
      ${state.query.mode === 'session' && state.importMessage ? `<div id="analyticsResultImportStatus" role="status" aria-live="polite" style="font-size:10px;color:${state.importStatus === 'error' ? 'var(--bad)' : state.importStatus === 'success' ? 'var(--good)' : 'var(--muted)'};">${escapeHtml(state.importMessage)}</div>` : ''}
      ${state.query.mode === 'group' ? `<div style="display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--stroke);padding-top:10px;"><button type="button" class="quick-btn analytics-level" data-level="level-1" style="${state.groupLevel==='level-1'?'background:rgba(92,102,189,.12);color:var(--accent);border-color:rgba(92,102,189,.3);':''}">${tr('Уровень 1 · Описание','Level 1 · Descriptive')}</button><button type="button" class="quick-btn analytics-level" data-level="level-2" style="${state.groupLevel==='level-2'?'background:rgba(92,102,189,.12);color:var(--accent);border-color:rgba(92,102,189,.3);':''}">${tr('Уровень 2 · Сравнение','Level 2 · Comparison')}</button><button type="button" class="quick-btn" disabled style="opacity:.55;">${tr('Уровень 3 · Модели','Level 3 · Models')} · 🔒</button></div>` : ''}
      <details ${state.query.groupId || state.query.conditionId || state.query.comparisonId || state.query.blockId || state.query.stimulusId || state.query.aoiId || state.query.dateFrom || state.query.dateTo || state.query.includeIncompleteSessions || state.query.qcMode !== defaultDraft.qcMode || state.query.qcChannels.join(',') !== defaultDraft.qcChannels.join(',') ? 'open' : ''} style="border-top:1px solid var(--stroke);padding-top:10px;">
        <summary style="cursor:pointer;font-size:11px;font-weight:700;color:var(--text);">${tr('Уточнить выборку','Refine selection')}</summary>
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:11px;">
          ${state.query.mode === 'group' && state.groupLevel === 'level-2' ? simpleSelectHtml('analyticsComparisonFilter', tr('Сравнение','Comparison'), comparisons, state.query.comparisonId, disabled, tr('Выберите сравнение','Select a comparison')) : ''}
          ${state.query.mode === 'group' && state.groupLevel === 'level-1' ? simpleSelectHtml('analyticsGroupFilter', tr('Группа','Group'), groups, state.query.groupId, disabled, tr('Все группы','All groups')) : ''}
          ${state.query.mode === 'group' ? simpleSelectHtml('analyticsConditionFilter', tr('Условие','Condition'), conditions, state.query.conditionId, disabled, tr('Все условия','All conditions')) : ''}
          ${simpleSelectHtml('analyticsBlockFilter', tr('Блок / задача','Block / task'), blocks, state.query.blockId, disabled, tr('Все блоки','All blocks'))}
          ${simpleSelectHtml('analyticsStimulusFilter', tr('Стимул','Stimulus'), stimuli, state.query.stimulusId, disabled || !state.query.blockId, tr('Все стимулы','All stimuli'))}
          ${simpleSelectHtml('analyticsAoiFilter', 'AOI', aois, state.query.aoiId, disabled || !state.query.stimulusId, tr('Все AOI','All AOIs'))}
          <label style="display:flex;flex-direction:column;gap:5px;min-width:190px;flex:1;"><span style="font-size:10px;font-weight:750;color:var(--muted);text-transform:uppercase;">QC</span><select id="analyticsQcMode" style="padding:9px 10px;border:1px solid var(--stroke);border-radius:10px;background:var(--card-bg);color:var(--text);font-size:12px;"><option value="valid_only" ${state.query.qcMode === 'valid_only' ? 'selected' : ''}>${tr('Только валидные','Valid only')}</option><option value="valid_and_borderline" ${state.query.qcMode === 'valid_and_borderline' ? 'selected' : ''}>${tr('Валидные + пограничные','Valid + borderline')}</option><option value="all" ${state.query.qcMode === 'all' ? 'selected' : ''}>${tr('Все, включая невалидные','All, including invalid')}</option></select></label>
        </div>
        <div style="display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-top:11px;">
          <fieldset style="border:0;padding:0;margin:0;min-width:220px;"><legend style="font-size:10px;font-weight:750;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">${tr('QC-каналы','QC channels')}</legend><div style="display:flex;gap:10px;flex-wrap:wrap;">${channels.map(channel => `<label style="font-size:11px;color:var(--text);display:flex;gap:5px;align-items:center;"><input class="analytics-qc-channel" type="checkbox" value="${escapeHtml(channel)}" ${state.query.qcChannels.includes(channel) ? 'checked' : ''}>${escapeHtml(channelLabel(channel))}</label>`).join('')}</div></fieldset>
          <label style="font-size:10px;color:var(--muted);">${tr('С','From')}<input id="analyticsDateFrom" type="date" value="${escapeHtml(state.query.dateFrom)}" min="${escapeHtml(state.filterOptions.dateMin)}" max="${escapeHtml(state.filterOptions.dateMax)}" style="display:block;margin-top:5px;padding:8px;border:1px solid var(--stroke);border-radius:9px;background:var(--card-bg);color:var(--text);"></label>
          <label style="font-size:10px;color:var(--muted);">${tr('По','To')}<input id="analyticsDateTo" type="date" value="${escapeHtml(state.query.dateTo)}" min="${escapeHtml(state.filterOptions.dateMin)}" max="${escapeHtml(state.filterOptions.dateMax)}" style="display:block;margin-top:5px;padding:8px;border:1px solid var(--stroke);border-radius:9px;background:var(--card-bg);color:var(--text);"></label>
          <label style="font-size:11px;color:var(--text);display:flex;gap:6px;align-items:center;padding-bottom:8px;"><input id="analyticsIncludeIncomplete" type="checkbox" ${state.query.includeIncompleteSessions ? 'checked' : ''}>${tr('Включить незавершённые','Include incomplete')}</label>
        </div>
      </details>
      ${state.filterOptionsError ? `<div style="font-size:9px;color:var(--warn);">${tr('Backend пока не отдал варианты block/stimulus/AOI. Основные фильтры доступны.','Backend has not returned block/stimulus/AOI options yet. Core filters remain available.')}</div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">${state.groupLevel === 'level-2' && state.query.mode === 'group' && !state.query.comparisonId ? `<div style="font-size:10px;color:var(--warn);">${tr('Выберите заранее настроенное сравнение. Факторы и модель задаёт backend.','Select a predefined comparison. Factors and model are configured by the backend.')}</div>` : snapshotStateHtml(state)}<div style="display:flex;gap:7px;flex-wrap:wrap;">${state.snapshot && !state.dirty ? `<button id="analyticsOpenExport" type="button" class="quick-btn">${tr('Экспорт выборки','Export selection')}</button>` : ''}<button id="analyticsResetFilters" type="button" class="quick-btn">${tr('Сбросить','Reset')}</button><button id="analyticsApplyFilters" type="button" class="quick-btn" ${state.snapshotStatus === 'creating' || (state.query.mode === 'session' && !state.query.sessionId) || (state.query.mode === 'group' && state.groupLevel === 'level-2' && !state.query.comparisonId) ? 'disabled' : ''} style="background:var(--accent);border-color:var(--accent);color:white;">${tr('Применить','Apply')}</button></div></div>
    </div>${appliedChipsHtml(state)}`;
  }

  function previewBannerHtml(state) {
    if (!global.EmocogAnalyticsPreviewFixture) return '';
    const description = state && state.query.mode === 'group'
      ? tr('Показана условная группа из 12 участников в формате будущего API. Эти значения не являются результатами реального исследования.','A fictional group of 12 participants is shown in the future API shape. These values are not results from a real study.')
      : tr('Показана одна условная завершённая сессия в формате будущего API. Эти значения не являются результатами реального участника.','One fictional completed session is shown in the future API shape. These values are not results from a real participant.');
    return `<div style="padding:10px 13px;border:1px solid rgba(245,158,11,.28);border-radius:12px;background:rgba(245,158,11,.08);color:#9a6700;font-size:10px;line-height:1.5;"><strong>${tr('Предпросмотр интерфейса.','Interface preview.')}</strong> ${description}</div>`;
  }

  function localPreviewUrl() {
    try {
      const url = new URL(global.location.href);
      url.searchParams.set('analyticsPreview', '1');
      url.hash = '#/analytics/session-card';
      return url.href;
    } catch (_) {
      return '?analyticsPreview=1#/analytics/session-card';
    }
  }

  function canOfferLocalPreview() {
    const protocol = global.location && global.location.protocol;
    const hostname = global.location && global.location.hostname;
    return protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1';
  }

  function stateCard(kind, title, description, actionLabel) {
    const icons = { loading: '◌', unauthorized: '◇', empty: '○', error: '!' };
    return `<div class="card" data-analytics-state="${kind}" style="min-height:310px;display:flex;align-items:center;justify-content:center;text-align:center;padding:28px;">
      <div style="max-width:500px;">
        <div style="width:46px;height:46px;margin:0 auto 14px;border-radius:15px;background:rgba(92,102,189,.09);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:23px;">${icons[kind] || '○'}</div>
        <h2 style="font-size:17px;color:var(--text);margin:0;">${title}</h2>
        <p style="font-size:12px;line-height:1.6;color:var(--muted);margin:9px 0 0;">${description}</p>
        ${actionLabel ? `<button type="button" id="analyticsStateAction" class="quick-btn" style="width:max-content;margin:16px auto 0;justify-content:center;background:rgba(92,102,189,.12);border-color:rgba(92,102,189,.3);color:var(--accent);font-weight:700;">${actionLabel}</button>` : ''}
      </div>
    </div>`;
  }

  function selectedSession(state) {
    return state.sessions.find(row => String(row.id) === String(state.query.sessionId)) || state.sessions[0] || null;
  }

  function metricLabel(metricId) {
    const definitions = global.EmocogAnalyticsPlan && global.EmocogAnalyticsPlan.metrics || [];
    const definition = definitions.find(item => item.id === metricId);
    return definition && definition.label
      ? (definition.label[isEnglish() ? 'en' : 'ru'] || definition.label.ru || metricId)
      : metricId;
  }

  function metricValue(metric) {
    if (!metric || metric.status !== 'computed' || metric.value === null || metric.value === undefined) {
      return tr('Нет данных', 'No data');
    }
    if (metric.unit === 'pct') return `${Number(metric.value).toLocaleString(isEnglish() ? 'en-US' : 'ru-RU')}%`;
    if (metric.unit === 'ms') return `${Number(metric.value).toLocaleString(isEnglish() ? 'en-US' : 'ru-RU')} ${tr('мс','ms')}`;
    if (metric.unit === 'boolean') return metric.value ? tr('Да','Yes') : tr('Нет','No');
    return String(metric.value);
  }

  function qcTone(status) {
    if (status === 'valid') return { color: 'var(--good)', bg: 'rgba(16,185,129,.09)' };
    if (status === 'borderline') return { color: 'var(--warn)', bg: 'rgba(245,158,11,.10)' };
    if (status === 'invalid') return { color: 'var(--bad)', bg: 'rgba(239,68,68,.09)' };
    return { color: 'var(--muted)', bg: 'rgba(100,116,139,.08)' };
  }

  function previewSummaryHtml(summary) {
    if (!summary) return '';
    const metrics = Array.isArray(summary.metrics) ? summary.metrics : [];
    const channels = Array.isArray(summary.qcChannels) ? summary.qcChannels : [];
    const blocks = Array.isArray(summary.blocks) ? summary.blocks : [];
    return `
      <section style="padding:0 18px 18px;">
        <div style="font-size:12px;font-weight:750;color:var(--text);margin:2px 0 9px;">${tr('Качество каналов','Channel quality')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${channels.map(channel => {
            const tone = qcTone(channel.status);
            const valid = Number.isFinite(Number(channel.validFraction)) ? ` · ${Math.round(Number(channel.validFraction) * 100)}%` : '';
            return `<div style="padding:8px 10px;border-radius:10px;background:${tone.bg};color:${tone.color};font-size:10px;font-weight:700;">${escapeHtml(channelLabel(channel.channel))} · ${escapeHtml(statusLabel(channel.status))}${valid}</div>`;
          }).join('')}
        </div>
      </section>
      <section style="padding:16px 18px;border-top:1px solid var(--stroke);">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:end;margin-bottom:10px;"><div><div style="font-size:13px;font-weight:750;color:var(--text);">${tr('Основные показатели сессии','Session highlights')}</div><div style="font-size:10px;color:var(--muted);margin-top:3px;">${tr('Каждая карточка показывает N, QC и версию алгоритма','Every card shows N, QC, and algorithm version')}</div></div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;">
          ${metrics.map(metric => {
            const tone = qcTone(metric.qc && metric.qc.status);
            const denominator = metric.numerator != null && metric.denominator != null
              ? `${metric.numerator}/${metric.denominator}`
              : (metric.denominator != null ? `N=${metric.denominator}` : `N=${metric.nObservations == null ? '—' : metric.nObservations}`);
            return `<article style="padding:12px 13px;border:1px solid var(--stroke);border-radius:12px;background:rgba(255,255,255,.32);">
              <div style="font-size:10px;color:var(--muted);min-height:28px;line-height:1.35;">${escapeHtml(metricLabel(metric.metricId))}</div>
              <div style="font-size:21px;font-weight:780;color:var(--text);margin-top:5px;">${escapeHtml(metricValue(metric))}</div>
              <div style="display:flex;justify-content:space-between;gap:7px;align-items:center;margin-top:9px;font-size:9px;color:var(--muted);"><span>${escapeHtml(denominator)}</span><span style="padding:3px 6px;border-radius:999px;background:${tone.bg};color:${tone.color};font-weight:700;">QC: ${escapeHtml(statusLabel(metric.qc && metric.qc.status))}</span></div>
              <div style="font-size:8px;color:var(--muted2);margin-top:6px;">${tr('алгоритм','algorithm')} ${escapeHtml(metric.algorithm && metric.algorithm.version || '—')}</div>
            </article>`;
          }).join('')}
        </div>
      </section>
      <section style="padding:16px 18px;border-top:1px solid var(--stroke);">
        <div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:10px;">${tr('Блоки эксперимента','Experiment blocks')}</div>
        <div style="overflow:auto;border:1px solid var(--stroke);border-radius:11px;">
          <table style="width:100%;border-collapse:collapse;font-size:10px;">
            <thead><tr style="background:rgba(92,102,189,.05);color:var(--muted);"><th style="padding:9px;text-align:left;">${tr('Блок','Block')}</th><th>${tr('Валидные пробы','Valid trials')}</th><th>${tr('Точность','Accuracy')}</th><th>${tr('Медиана RT','Median RT')}</th><th>QC</th></tr></thead>
            <tbody>${blocks.map(block => `<tr style="border-top:1px solid var(--stroke);"><td style="padding:10px;font-weight:650;color:var(--text);">${escapeHtml(localizedName(block, block.id))}</td><td style="text-align:center;">${block.validTrials}/${block.trials}</td><td style="text-align:center;">${block.accuracy}%</td><td style="text-align:center;">${block.rtMedianMs} ${tr('мс','ms')}</td><td style="text-align:center;">${escapeHtml(statusLabel(block.qc))}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      </section>
      <div style="padding:11px 18px;border-top:1px solid var(--stroke);font-size:9px;color:var(--muted);">${tr('снимок выборки','snapshot')} ${escapeHtml(summary.snapshotId || '—')} · ${tr('контракт','contract')} ${escapeHtml(summary.contractVersion || '—')} · ${tr('сервер аналитики','analytics backend')} ${escapeHtml(summary.algorithmVersion || '—')}</div>`;
  }

  function formatMetricNumber(value, digits) {
    return Number(value).toLocaleString(isEnglish() ? 'en-US' : 'ru-RU', { maximumFractionDigits: digits == null ? 1 : digits });
  }

  function metricPresentation(metric) {
    if (!metric || metric.status !== 'computed' || metric.value === null || metric.value === undefined) {
      return { value: statusLabel(metric && metric.status || 'no_data'), detail: metric && metric.reason ? reasonLabel(metric.reason) : '' };
    }
    if (metric.unit === 'pct') {
      if (metric.numerator == null || metric.denominator == null) return { value: statusLabel('no_data'), detail: tr('API не передал числитель и знаменатель','API did not provide numerator and denominator') };
      return { value: `${formatMetricNumber(metric.numerator)}/${formatMetricNumber(metric.denominator)} (${formatMetricNumber(metric.value)}%)`, detail: '' };
    }
    if (metric.unit === 'ms') {
      const distribution = metric.distribution;
      const iqr = distribution && distribution.q1 != null && distribution.q3 != null
        ? ` [${formatMetricNumber(distribution.q1)}–${formatMetricNumber(distribution.q3)}]`
        : '';
      return { value: `${formatMetricNumber(metric.value)} ${tr('мс','ms')}${iqr}`, detail: distribution && distribution.mean != null && distribution.sd != null ? `${tr('Среднее','Mean')} ${formatMetricNumber(distribution.mean)} ± ${formatMetricNumber(distribution.sd)} ${tr('мс','ms')}` : '' };
    }
    if (metric.unit === 'boolean') return { value: metric.value ? tr('Да','Yes') : tr('Нет','No'), detail: '' };
    return { value: formatMetricNumber(metric.value), detail: '' };
  }

  function scopeLabel(metric) {
    const scope = metric && metric.scope || {};
    return [scope.blockId && `${tr('блок','block')}: ${scope.blockId}`, scope.trialId && `${tr('проба','trial')}: ${scope.trialId}`].filter(Boolean).join(' · ') || tr('вся сессия','whole session');
  }

  function metricCardHtml(metric) {
    const shown = metricPresentation(metric);
    const tone = qcTone(metric.qc && metric.qc.status);
    const n = metric.nObservations == null ? '—' : metric.nObservations;
    return `<article style="padding:12px 13px;border:1px solid var(--stroke);border-radius:12px;background:rgba(255,255,255,.32);min-width:0;">
      <div style="font-size:10px;color:var(--muted);min-height:27px;line-height:1.35;">${escapeHtml(metricLabel(metric.metricId))}</div>
      <div style="font-size:18px;font-weight:760;color:var(--text);margin-top:5px;overflow-wrap:anywhere;">${escapeHtml(shown.value)}</div>
      ${shown.detail ? `<div style="font-size:9px;color:var(--muted);margin-top:4px;">${escapeHtml(shown.detail)}</div>` : ''}
      <div style="display:flex;justify-content:space-between;gap:7px;align-items:center;margin-top:9px;font-size:9px;color:var(--muted);"><span>N=${escapeHtml(n)} · ${escapeHtml(scopeLabel(metric))}</span><span style="padding:3px 6px;border-radius:999px;background:${tone.bg};color:${tone.color};font-weight:700;">QC: ${escapeHtml(statusLabel(metric.qc && metric.qc.status))}</span></div>
      <div style="font-size:8px;color:var(--muted2);margin-top:6px;">${tr('алгоритм','algorithm')} ${escapeHtml(metric.algorithm && metric.algorithm.id || '—')} · v${escapeHtml(metric.algorithm && metric.algorithm.version || '—')}</div>
    </article>`;
  }

  function metricFromAoiRow(row, metricId) {
    return (row.metrics || []).find(metric => metric.metricId === metricId) || null;
  }

  function aoiMetricText(row, metricId, targetReached) {
    const metric = metricFromAoiRow(row, metricId);
    if (!metric) return statusLabel('not_configured');
    if (targetReached && metric.status === 'computed') {
      const fraction = metric.numerator != null && metric.denominator != null ? `${metric.numerator}/${metric.denominator} · ` : '';
      return fraction + (metric.value ? tr('Да','Yes') : tr('Нет','No'));
    }
    return metricPresentation(metric).value;
  }

  function aoiFixationText(row) {
    const count = aoiMetricText(row, 'aoi.fixation_count');
    const rate = aoiMetricText(row, 'aoi.fixation_rate_per_min');
    return `${count} · ${rate}/${tr('мин','min')}`;
  }

  function aoiOverlayHtml(rows, fixationPoints, layers) {
    const shapes = rows.map(row => {
      const aoi = row.aoi || {};
      const points = Array.isArray(aoi.points) ? aoi.points : [];
      if (aoi.shape === 'rectangle' && points.length >= 2) {
        const x = Math.min(points[0].x, points[1].x) * 1000;
        const y = Math.min(points[0].y, points[1].y) * 1000;
        const width = Math.abs(points[1].x - points[0].x) * 1000;
        const height = Math.abs(points[1].y - points[0].y) * 1000;
        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="7" fill="rgba(92,102,189,.10)" stroke="#5c66bd" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      }
      if (aoi.shape === 'polygon' && points.length >= 3) return `<polygon points="${points.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ')}" fill="rgba(245,158,11,.10)" stroke="#d97706" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      return '';
    }).join('');
    const labels = rows.map(row => {
      const points = row.aoi && row.aoi.points || [];
      if (!points.length) return '';
      const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      return `<span style="position:absolute;left:${x * 100}%;top:${y * 100}%;transform:translate(-50%,-50%);max-width:145px;padding:3px 7px;border:1px solid rgba(255,255,255,.9);border-radius:999px;background:rgba(255,255,255,.88);box-shadow:0 2px 7px rgba(15,23,42,.12);color:#334155;font-size:10px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(row.aoi.order)} · ${escapeHtml(row.aoi.name)}</span>`;
    }).join('');
    const fixations = fixationPoints.map((point, index) => `<g><circle cx="${point.x * 1000}" cy="${point.y * 1000}" r="${Math.max(7, Math.min(16, Number(point.durationMs || 0) / 22))}" fill="rgba(15,23,42,.68)" stroke="white" stroke-width="1.5" vector-effect="non-scaling-stroke"/><text x="${point.x * 1000}" y="${point.y * 1000 + 4}" text-anchor="middle" font-size="11" fill="white">${index + 1}</text></g>`).join('');
    return `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:${layers.aoi || layers.fixations ? 'block' : 'none'};">${layers.aoi ? shapes : ''}${layers.fixations ? fixations : ''}</svg>${layers.aoi ? `<div style="position:absolute;inset:0;pointer-events:none;">${labels}</div>` : ''}`;
  }

  function visualAnalyticsHtml(state) {
    if (state.visualStatus === 'context_required') return `<section style="padding:16px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);">${tr('AOI и тепловая карта','AOI and heatmap')}</div><div style="margin-top:9px;padding:12px;border:1px dashed var(--stroke);border-radius:11px;color:var(--muted);font-size:10px;line-height:1.5;">${tr('Выберите конкретные блок и стимул в разделе «Уточнить выборку», затем примените фильтры. Это предотвращает объединение training/main и повторных показов.','Select a specific block and stimulus under “Refine selection”, then apply the filters. This prevents training/main and repeated presentations from being combined.')}</div></section>`;
    if (state.visualStatus === 'loading' || state.visualStatus === 'idle') return `<section style="padding:16px 18px;border-bottom:1px solid var(--stroke);font-size:10px;color:var(--muted);">${tr('Загружаем AOI и heatmap для выбранного показа…','Loading AOI and heatmap for the selected presentation…')}</section>`;
    if (state.visualStatus === 'error') return `<section style="padding:16px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:12px;font-weight:700;color:var(--bad);">${tr('Не удалось загрузить AOI/heatmap','Could not load AOI/heatmap')}</div><div style="font-size:9px;color:var(--muted);margin-top:5px;">${escapeHtml(state.visualError && state.visualError.message || '')}</div><button id="analyticsVisualRetry" class="quick-btn" type="button" style="margin-top:9px;">${tr('Повторить','Retry')}</button></section>`;
    const aoiResponse = state.aoiResponse;
    const heatmapResponse = state.heatmapResponse;
    const aoiData = aoiResponse && aoiResponse.data;
    const heatmap = heatmapResponse && heatmapResponse.data;
    if (!aoiData || !heatmap) return '';
    const rows = Array.isArray(aoiData.aoiRows) ? aoiData.aoiRows : [];
    const points = Array.isArray(heatmap.fixationPoints) ? heatmap.fixationPoints : [];
    const stimulus = aoiData.stimulus;
    const heatmapHasData = heatmap.nFixations > 0 && heatmap.grid && heatmap.grid.maxValue > 0;
    const ratio = stimulus.intrinsicWidth && stimulus.intrinsicHeight ? `${stimulus.intrinsicWidth}/${stimulus.intrinsicHeight}` : '16/9';
    return `<section style="padding:16px 18px;border-bottom:1px solid var(--stroke);">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px;"><div><div style="font-size:13px;font-weight:750;color:var(--text);">${tr('AOI и тепловая карта','AOI and heatmap')}</div><div style="font-size:9px;color:var(--muted);margin-top:3px;">${escapeHtml(stimulus.name)} · v${escapeHtml(stimulus.version)} · ${escapeHtml(aoiData.blockId)} · ${escapeHtml(aoiData.presentationId)}</div></div><div style="display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:var(--text);"><label><input class="analytics-layer-toggle" data-layer="heatmap" type="checkbox" ${state.layers.heatmap ? 'checked' : ''} ${heatmapHasData ? '' : 'disabled'}> Heatmap</label><label><input class="analytics-layer-toggle" data-layer="aoi" type="checkbox" ${state.layers.aoi ? 'checked' : ''}> AOI</label><label><input class="analytics-layer-toggle" data-layer="fixations" type="checkbox" ${state.layers.fixations ? 'checked' : ''} ${points.length ? '' : 'disabled'}> ${tr('Фиксации','Fixations')}</label></div></div>
      <div style="max-width:920px;margin:0 auto;position:relative;aspect-ratio:${ratio};overflow:hidden;border:1px solid var(--stroke);border-radius:12px;background:#eef2f7;">
        ${stimulus.contentUrl ? `<img src="${escapeHtml(stimulus.contentUrl)}" alt="${escapeHtml(stimulus.name)}" style="display:block;width:100%;height:100%;object-fit:contain;">` : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px;">${tr('Изображение стимула недоступно','Stimulus image is unavailable')}</div>`}
        ${state.layers.heatmap && heatmapHasData ? `<canvas class="analytics-heatmap-canvas" role="img" aria-label="${escapeHtml(tr('Heatmap фиксаций одной сессии; числовые значения доступны в AOI-таблице ниже','Session fixation heatmap; numeric values are available in the AOI table below'))}" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:.66;"></canvas>` : ''}
        ${state.layers.heatmap && !heatmapHasData ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.78);color:var(--muted);font-size:11px;">${tr('Нет валидных фиксаций для heatmap','No valid fixations for the heatmap')}</div>` : ''}
        ${aoiOverlayHtml(rows, points, state.layers)}
      </div>
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-top:9px;font-size:9px;color:var(--muted);"><span>${escapeHtml(heatmap.coordinateSpace)} · ${escapeHtml(heatmap.normalizationMode)} · ${escapeHtml(heatmap.smoothing.method)} bandwidth=${escapeHtml(heatmap.smoothing.bandwidthNorm)}</span><span>N ${tr('фиксаций','fixations')}=${escapeHtml(heatmap.nFixations)} · ${tr('валидное время','valid time')}=${escapeHtml(heatmap.validObservationDurationMs)} ${tr('мс','ms')} · ${escapeHtml(heatmap.algorithm.id)} v${escapeHtml(heatmap.algorithm.version)}</span></div>
      ${rows.length ? `<div style="overflow:auto;margin-top:13px;border:1px solid var(--stroke);border-radius:11px;"><table style="width:100%;min-width:1160px;border-collapse:collapse;font-size:9px;"><thead><tr style="background:rgba(92,102,189,.05);color:var(--muted);"><th style="padding:8px;text-align:left;">AOI</th><th>${tr('Достигнута','Reached')}</th><th>TTFF</th><th>${tr('Время','Dwell')}</th><th>${tr('Доля','Share')}</th><th>${tr('Фиксации / мин','Fixations / min')}</th><th>${tr('Медиана фиксации','Fixation median')}</th><th>${tr('Посещения','Visits')}</th><th>${tr('Возвраты','Revisits')}</th><th>${tr('Валидность / QC','Validity / QC')}</th></tr></thead><tbody>${rows.map(row => { const qc = (row.metrics || []).find(metric => metric.qc) && (row.metrics || []).find(metric => metric.qc).qc; return `<tr style="border-top:1px solid var(--stroke);"><td style="padding:9px;font-weight:650;color:var(--text);">${escapeHtml(row.aoi.order)} · ${escapeHtml(row.aoi.name)}${row.aoi.isTarget ? ` <span style="color:var(--accent);">${tr('цель','target')}</span>` : ''}</td><td style="text-align:center;">${escapeHtml(aoiMetricText(row, 'aoi.target_reached', true))}</td><td style="text-align:center;">${escapeHtml(aoiMetricText(row, 'aoi.ttff_ms'))}</td><td style="text-align:center;">${escapeHtml(aoiMetricText(row, 'aoi.dwell_time_ms'))}</td><td style="text-align:center;">${escapeHtml(aoiMetricText(row, 'aoi.dwell_time_pct'))}</td><td style="text-align:center;">${escapeHtml(aoiFixationText(row))}</td><td style="text-align:center;">${escapeHtml(aoiMetricText(row, 'aoi.fixation_duration_median_ms'))}</td><td style="text-align:center;">${escapeHtml(aoiMetricText(row, 'aoi.visit_count'))}</td><td style="text-align:center;">${escapeHtml(aoiMetricText(row, 'aoi.revisit_count'))}</td><td style="text-align:center;">${qc && qc.validFraction != null ? Math.round(qc.validFraction * 100) + '%' : '—'} · ${escapeHtml(statusLabel(qc && qc.status))}</td></tr>`; }).join('')}</tbody></table></div>` : `<div style="margin-top:12px;font-size:10px;color:var(--muted);">${tr('Для выбранного стимула AOI не настроены.','No AOIs are configured for the selected stimulus.')}</div>`}
    </section>`;
  }

  function resolutionLabel(value) {
    return value && value.width && value.height
      ? `${value.width}×${value.height}`
      : tr('Нет данных','No data');
  }

  function technicalDetailsHtml(session, algorithms) {
    const timerRows = Array.isArray(session.protocolTimers)
      ? session.protocolTimers
        .filter(timer => Number.isFinite(Number(timer.durationMs)))
        .map(timer => [
          `${tr('Таймер','Timer')}: ${timer.name || timer.id}`,
          `${(Number(timer.durationMs) / 1000).toFixed(1)} ${tr('с','s')}`
        ])
      : [];
    const rows = [
      [tr('Устройство','Device'), deviceClassLabel(session.deviceClass)],
      [tr('Экран','Screen'), resolutionLabel(session.resolution)],
      [tr('Камера','Camera'), resolutionLabel(session.cameraResolution)],
      [tr('Измеренный FPS','Measured FPS'), session.actualFps],
      [tr('FPS камеры','Camera FPS'), session.cameraFps],
      [tr('FPS анализа','Analysis FPS'), session.analysisFps],
      [tr('Браузер','Browser'), session.browserFamily],
      [tr('Язык браузера','Browser language'), session.browserLanguage],
      [tr('Плотность пикселей','Pixel ratio'), session.pixelRatio],
      [tr('Класс процессора','Processor class'), session.processorClass],
      ...timerRows
    ].filter(([, value]) => value !== null && value !== undefined && value !== '');
    return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:10px;">${rows.map(([label, value]) => `<div style="padding:9px 10px;border:1px solid var(--stroke);border-radius:9px;background:rgba(100,116,139,.04);"><div style="font-size:8px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(label)}</div><div style="font-size:10px;font-weight:650;color:var(--text);margin-top:4px;">${escapeHtml(value)}</div></div>`).join('')}</div><div style="font-size:9px;color:var(--muted);margin-top:9px;line-height:1.5;">${tr('Версии алгоритмов','Algorithm versions')}: ${escapeHtml(algorithms || '—')}</div>`;
  }

  function exclusionRowsHtml(exclusions) {
    return exclusions.map((item, index) => `<div style="display:grid;grid-template-columns:minmax(86px,.45fr) minmax(250px,2fr) minmax(105px,.55fr);gap:14px;align-items:start;padding:10px 12px;border-top:1px solid var(--stroke);font-size:10px;"><span style="font-weight:700;color:var(--text);">${tr('Проба','Trial')} ${index + 1}</span><span style="color:var(--muted);line-height:1.45;">${escapeHtml(reasonLabel(item.reasonCode))}</span><span style="color:var(--muted);">${escapeHtml(item.channel ? channelLabel(item.channel) : tr('Канал не указан','Channel unknown'))}</span></div>`).join('');
  }

  function sessionShellHtml(state) {
    if (state.summaryStatus === 'loading' || state.summaryStatus === 'idle') return stateCard('loading', tr('Загружаем карточку сессии','Loading session dashboard'), tr('Получаем task metrics и channel QC для зафиксированного snapshot.','Fetching task metrics and channel QC for the fixed snapshot.'));
    if (state.summaryStatus === 'error') return `<div class="card" style="min-height:260px;display:flex;align-items:center;justify-content:center;text-align:center;padding:28px;"><div style="max-width:520px;"><h2 style="font-size:16px;color:var(--text);margin:0;">${tr('Карточка сессии недоступна','Session dashboard is unavailable')}</h2><button id="analyticsSummaryRetry" class="quick-btn" type="button" style="margin:14px auto 0;background:rgba(92,102,189,.12);color:var(--accent);">${tr('Повторить загрузку','Retry loading')}</button></div></div>`;
    const response = state.summaryResponse;
    const data = response && response.data;
    if (!data || !data.session) return stateCard('empty', tr('Нет данных карточки сессии','No session dashboard data'), tr('Backend вернул snapshot без session summary. Это не нулевой результат.','Backend returned a snapshot without a session summary. This is not a zero result.'));
    const session = data.session;
    const metrics = Array.isArray(data.metrics) ? data.metrics : [];
    const taskMetrics = metrics.filter(metric => String(metric.metricId).startsWith('task.') && !String(metric.metricId).startsWith('task.trial_count_'));
    const qcMetrics = metrics.filter(metric => String(metric.metricId).startsWith('qc.'));
    const trialValid = metrics.find(metric => metric.metricId === 'task.trial_count_valid');
    const trialExcluded = metrics.find(metric => metric.metricId === 'task.trial_count_excluded');
    const exclusions = Array.isArray(data.exclusions) ? data.exclusions : [];
    const channels = Array.isArray(data.qcChannels) ? data.qcChannels : [];
    const protocol = selectedProtocol(state);
    const algorithms = [...new Set(metrics.map(metric => metric.algorithm && metric.algorithm.version).filter(Boolean))].join(', ') || '—';
    return `<div class="card" style="padding:0;overflow:hidden;">
      <header style="padding:16px 18px;border-bottom:1px solid var(--stroke);display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;">
        <div><div style="font-size:10px;color:var(--muted);">${tr('Участник','Participant')} ${escapeHtml(session.participantAlias)}</div><h2 style="font-size:17px;margin:4px 0 0;color:var(--text);">${tr('Сессия','Session')} ${escapeHtml(session.sessionId)}</h2><div style="font-size:10px;color:var(--muted);margin-top:5px;">${escapeHtml(localizedName(protocol, protocol && protocol.name || session.protocolId))} · v${escapeHtml(session.protocolVersion)}</div></div>
        <div style="text-align:right;"><span style="display:inline-block;padding:5px 9px;border-radius:999px;background:rgba(92,102,189,.09);color:var(--accent);font-size:10px;font-weight:700;">${escapeHtml(statusLabel(session.completionStatus))}</span><div style="font-size:9px;color:var(--muted);margin-top:6px;">${escapeHtml(formatDateTime(session.startedAt))}</div></div>
      </header>
      <section style="padding:14px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:12px;font-weight:750;color:var(--text);margin-bottom:9px;">${tr('Качество каналов','Channel quality')}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;">${channels.map(channel => { const tone = qcTone(channel.status); const reasons = (channel.reasons || []).map(reasonLabel); return `<article style="padding:10px 11px;border-radius:11px;background:${tone.bg};color:${tone.color};"><div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;font-weight:750;"><span>${escapeHtml(channelLabel(channel.channel))}</span><span>${escapeHtml(statusLabel(channel.status))}</span></div><div style="font-size:9px;margin-top:6px;">${tr('Валидность','Validity')}: ${channel.validFraction == null ? '—' : Math.round(channel.validFraction * 100) + '%'}${channel.signalConfidence == null ? '' : ` · confidence ${Math.round(channel.signalConfidence * 100)}%`}</div>${reasons.length ? `<div style="font-size:9px;margin-top:5px;">${escapeHtml(reasons.join('; '))}</div>` : ''}<div style="font-size:8px;opacity:.75;margin-top:5px;">${escapeHtml(channel.ruleVersion || '—')}</div></article>`; }).join('')}</div></section>
      <section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:10px;">${tr('Выполнение задачи','Task performance')}</div>${taskMetrics.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;">${taskMetrics.map(metricCardHtml).join('')}</div>` : `<div style="font-size:11px;color:var(--muted);">${tr('Метрики задачи не настроены для этого протокола.','Task metrics are not configured for this protocol.')}</div>`}</section>
      ${qcMetrics.length ? `<section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:10px;">${tr('Показатели качества данных','Data quality metrics')}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:9px;">${qcMetrics.map(metricCardHtml).join('')}</div></section>` : ''}
      <section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:9px;">${tr('Пробы и исключения','Trials and exclusions')}</div><div style="display:flex;gap:8px;flex-wrap:wrap;"><span style="padding:7px 10px;border-radius:9px;background:rgba(16,185,129,.09);color:var(--good);font-size:10px;">${tr('Валидные','Valid')}: ${trialValid && trialValid.status === 'computed' ? escapeHtml(trialValid.value) : '—'}</span><span style="padding:7px 10px;border-radius:9px;background:rgba(239,68,68,.08);color:var(--bad);font-size:10px;">${tr('Исключённые','Excluded')}: ${trialExcluded && trialExcluded.status === 'computed' ? escapeHtml(trialExcluded.value) : exclusions.length}</span></div>${exclusions.length ? `<details style="margin-top:10px;"><summary style="cursor:pointer;font-size:10px;font-weight:700;color:var(--text);">${tr('Показать причины исключения','Show exclusion reasons')} (${exclusions.length})</summary><div style="margin-top:7px;border:1px solid var(--stroke);border-radius:10px;overflow:hidden;"><div style="display:grid;grid-template-columns:minmax(86px,.45fr) minmax(250px,2fr) minmax(105px,.55fr);gap:14px;padding:8px 12px;background:rgba(100,116,139,.05);font-size:8px;font-weight:750;color:var(--muted);text-transform:uppercase;"><span>${tr('Проба','Trial')}</span><span>${tr('Почему исключена','Why excluded')}</span><span>${tr('Канал','Channel')}</span></div>${exclusionRowsHtml(exclusions)}</div></details>` : `<div style="font-size:10px;color:var(--muted);margin-top:8px;">${tr('Исключений нет','No exclusions')}</div>`}</section>
      ${visualAnalyticsHtml(state)}
      <details style="padding:12px 18px;border-bottom:1px solid var(--stroke);"><summary style="cursor:pointer;font-size:10px;font-weight:700;color:var(--text);">${tr('Технические данные сессии','Session technical details')}</summary>${technicalDetailsHtml(session, algorithms)}</details>
      <footer style="padding:10px 18px;font-size:9px;color:var(--muted);">snapshot ${escapeHtml(response.snapshot.id)} · ${escapeHtml(response.snapshot.datasetHash)} · contract ${escapeHtml(response.contractVersion)} · ${tr('сформировано','generated')} ${escapeHtml(formatDateTime(response.generatedAt))}</footer>
    </div>`;
  }

  function groupMetricPrimary(metric) {
    if (!metric || metric.status !== 'computed' || metric.median == null) return statusLabel(metric && metric.status || 'no_data');
    const unit = metric.unit === 'pct' ? '%' : metric.unit === 'ms' ? ` ${tr('мс','ms')}` : '';
    const iqr = metric.q1 != null && metric.q3 != null ? ` [${formatMetricNumber(metric.q1)}–${formatMetricNumber(metric.q3)}]` : '';
    return `${formatMetricNumber(metric.median)}${iqr}${unit}`;
  }

  function participantDotPlotHtml(metric) {
    const values = (metric.participantValues || []).filter(item => item.value != null);
    if (!values.length || metric.status !== 'computed') return `<div style="padding:12px;border:1px dashed var(--stroke);border-radius:10px;font-size:9px;color:var(--muted);">${tr('Нет participant-level значений','No participant-level values')}</div>`;
    const min = Number(metric.min), max = Number(metric.max);
    const position = value => max > min ? Math.max(1, Math.min(99, (Number(value) - min) / (max - min) * 100)) : 50;
    const q1 = position(metric.q1), q3 = position(metric.q3), median = position(metric.median);
    return `<div role="img" aria-label="${escapeHtml(tr('Индивидуальные значения участников с медианой и IQR','Participant values with median and IQR'))}" style="position:relative;height:54px;margin:5px 5px 0;">
      <div style="position:absolute;left:0;right:0;top:25px;height:1px;background:var(--stroke);"></div>
      <div style="position:absolute;left:${Math.min(q1,q3)}%;width:${Math.max(1,Math.abs(q3-q1))}%;top:18px;height:14px;border:1px solid var(--accent);border-radius:4px;background:rgba(92,102,189,.10);"></div>
      <div style="position:absolute;left:${median}%;top:13px;width:2px;height:24px;background:var(--text);transform:translateX(-1px);" title="Median ${escapeHtml(metric.median)}"></div>
      ${values.map((item, index) => `<span title="${escapeHtml(item.participantId)}: ${escapeHtml(item.value)} (N=${escapeHtml(item.nObservations)})" style="position:absolute;left:${position(item.value)}%;top:${20 + (index % 3) * 7}px;width:7px;height:7px;border:1px solid white;border-radius:50%;background:var(--accent);transform:translate(-50%,-50%);"></span>`).join('')}
      <span style="position:absolute;left:0;bottom:0;font-size:8px;color:var(--muted);">${escapeHtml(formatMetricNumber(min))}</span><span style="position:absolute;right:0;bottom:0;font-size:8px;color:var(--muted);">${escapeHtml(formatMetricNumber(max))}</span>
    </div>`;
  }

  function groupMetricCardHtml(metric) {
    const suffix = metric.unit === 'pct' ? '%' : metric.unit === 'ms' ? ` ${tr('мс','ms')}` : '';
    const fraction = metric.numerator != null && metric.denominator != null ? `${formatMetricNumber(metric.numerator)}/${formatMetricNumber(metric.denominator)}` : (metric.observationDurationMs != null ? `${tr('валидное время','valid time')} ${formatMetricNumber(metric.observationDurationMs)} ${tr('мс','ms')}` : '');
    const ci = metric.estimateCi95;
    return `<article style="padding:13px;border:1px solid var(--stroke);border-radius:12px;background:rgba(255,255,255,.3);min-width:0;">
      <div style="font-size:10px;color:var(--muted);">${escapeHtml(metricLabel(metric.metricId))}</div><div style="font-size:19px;font-weight:760;color:var(--text);margin-top:5px;">${escapeHtml(groupMetricPrimary(metric))}</div>
      <div style="font-size:9px;color:var(--muted);margin-top:4px;">${tr('Среднее','Mean')} ${metric.mean == null ? '—' : escapeHtml(formatMetricNumber(metric.mean) + ' ± ' + formatMetricNumber(metric.sd) + suffix)} · min/max ${metric.min == null ? '—' : escapeHtml(formatMetricNumber(metric.min) + '/' + formatMetricNumber(metric.max) + suffix)}</div>
      ${participantDotPlotHtml(metric)}
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:7px;font-size:9px;color:var(--muted);"><span>N ${tr('участников','participants')}=${escapeHtml(metric.nParticipants)} · N ${tr('наблюдений','observations')}=${escapeHtml(metric.nObservations)}</span><span>${escapeHtml(fraction)}</span></div>
      <div style="font-size:9px;color:var(--muted);margin-top:5px;">95% CI: ${ci && ci.lower != null ? `${escapeHtml(formatMetricNumber(ci.lower))}–${escapeHtml(formatMetricNumber(ci.upper))}${suffix}` : '—'} · ${escapeHtml(ci && ci.method || '—')}</div>
      <div style="font-size:8px;color:var(--muted2);margin-top:5px;">${escapeHtml(metric.algorithm && metric.algorithm.id || '—')} v${escapeHtml(metric.algorithm && metric.algorithm.version || '—')}</div>
    </article>`;
  }

  function groupHeatmapHtml(state) {
    if (state.groupHeatmapStatus === 'not_configured') return `<section style="padding:15px 18px;border-top:1px solid var(--stroke);"><div style="font-size:12px;font-weight:700;color:var(--text);">${tr('Групповая heatmap не настроена','Group heatmap is not configured')}</div><div style="font-size:9px;color:var(--muted);margin-top:4px;">${tr('Метрика viz.heatmap не выбрана в плане аналитики протокола.','The viz.heatmap metric is not selected in the protocol analytics plan.')}</div></section>`;
    if (state.groupHeatmapStatus === 'context_required') return `<section style="padding:15px 18px;border-top:1px solid var(--stroke);"><div style="font-size:12px;font-weight:700;color:var(--text);">${tr('Групповая heatmap','Group heatmap')}</div><div style="font-size:9px;color:var(--muted);margin-top:5px;">${tr('Выберите конкретные block и stimulus и примените фильтры.','Select a specific block and stimulus, then apply the filters.')}</div></section>`;
    if (state.groupHeatmapStatus === 'loading' || state.groupHeatmapStatus === 'idle') return `<section style="padding:15px 18px;border-top:1px solid var(--stroke);font-size:10px;color:var(--muted);">${tr('Загружаем групповую heatmap…','Loading group heatmap…')}</section>`;
    if (state.groupHeatmapStatus === 'error') return `<section style="padding:15px 18px;border-top:1px solid var(--stroke);"><div style="font-size:10px;color:var(--bad);">${escapeHtml(state.groupHeatmapError && state.groupHeatmapError.message || '')}</div><button id="analyticsGroupHeatmapRetry" class="quick-btn" type="button" style="margin-top:8px;">${tr('Повторить','Retry')}</button></section>`;
    const response = state.groupHeatmapResponse;
    const heatmap = response && response.data;
    if (!heatmap) return '';
    const stimulus = heatmap.stimulus;
    const hasData = heatmap.nFixations > 0 && heatmap.grid && heatmap.grid.maxValue > 0;
    const ratio = stimulus.intrinsicWidth && stimulus.intrinsicHeight ? `${stimulus.intrinsicWidth}/${stimulus.intrinsicHeight}` : '16/9';
    return `<section style="padding:15px 18px;border-top:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:9px;">${tr('Групповая heatmap','Group heatmap')} · ${escapeHtml(stimulus.name)}</div><div style="max-width:820px;margin:0 auto;position:relative;aspect-ratio:${ratio};overflow:hidden;border:1px solid var(--stroke);border-radius:12px;background:#eef2f7;">${stimulus.contentUrl ? `<img src="${escapeHtml(stimulus.contentUrl)}" alt="${escapeHtml(stimulus.name)}" style="display:block;width:100%;height:100%;object-fit:contain;">` : ''}${hasData ? `<canvas class="analytics-heatmap-canvas" data-heatmap-kind="group" role="img" aria-label="${escapeHtml(tr('Групповая heatmap с равным весом участников; параметры и N указаны под изображением','Group heatmap with equal participant weight; parameters and N are listed below'))}" style="position:absolute;inset:0;width:100%;height:100%;opacity:.66;"></canvas>` : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.8);color:var(--muted);font-size:10px;">${tr('Недостаточно валидных фиксаций','Insufficient valid fixations')}</div>`}</div><div style="display:flex;justify-content:space-between;gap:9px;flex-wrap:wrap;margin-top:8px;font-size:9px;color:var(--muted);"><span>${escapeHtml(heatmap.coordinateSpace)} · ${escapeHtml(heatmap.normalizationMode)} · ${escapeHtml(heatmap.smoothing.method)} ${escapeHtml(heatmap.smoothing.bandwidthNorm)}</span><span>${tr('Равный вес участников','Equal participant weight')}: ${heatmap.equalParticipantWeight ? tr('да','yes') : tr('нет','no')} · N=${escapeHtml(heatmap.nParticipants)} · ${tr('сессий','sessions')}=${escapeHtml(heatmap.nSessions)} · ${tr('фиксаций','fixations')}=${escapeHtml(heatmap.nFixations)} · ${escapeHtml(heatmap.algorithm.id)} v${escapeHtml(heatmap.algorithm.version)}</span></div></section>`;
  }

  function groupDashboardHtml(state) {
    if (state.groupStatus === 'loading' || state.groupStatus === 'idle') return stateCard('loading', tr('Загружаем групповую аналитику','Loading group analytics'), tr('Backend рассчитывает participant-weighted описательные статистики для snapshot.','Backend is returning participant-weighted descriptive statistics for the snapshot.'));
    if (state.groupStatus === 'error') return `<div style="min-height:260px;display:flex;align-items:center;justify-content:center;text-align:center;padding:25px;"><div><div style="font-size:12px;color:var(--bad);">${escapeHtml(state.groupError && state.groupError.message || '')}</div><button id="analyticsGroupRetry" class="quick-btn" type="button" style="margin-top:9px;">${tr('Повторить','Retry')}</button></div></div>`;
    const response = state.groupResponse;
    const data = response && response.data;
    if (!data || data.nParticipants === 0) return stateCard('empty', tr('Недостаточно групповых данных','Insufficient group data'), tr('В snapshot нет включённых участников. Это отсутствие данных, а не нулевой эффект.','The snapshot contains no included participants. This is no data, not a zero effect.'));
    const metrics = Array.isArray(data.metrics) ? data.metrics : [];
    const aoiMetrics = metrics.filter(metric => String(metric.metricId).startsWith('aoi.'));
    const snapshot = response.snapshot;
    return `<div>
      <section style="padding:16px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);">${tr('Состав выборки','Sample composition')}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px;margin-top:10px;">${[[tr('Участники','Participants'),data.nParticipants],[tr('Сессии','Sessions'),data.nSessions],[tr('Наблюдения','Observations'),data.nObservations],[tr('Исключённые сессии','Excluded sessions'),(snapshot.excludedSessions||[]).length]].map(([label,value],index)=>`<div style="padding:12px;border:1px solid var(--stroke);border-radius:11px;background:${index===0?'rgba(92,102,189,.08)':'rgba(255,255,255,.3)'};"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;">${label}</div><div style="font-size:${index===0?'25':'20'}px;font-weight:780;color:var(--text);margin-top:5px;">${escapeHtml(value)}</div></div>`).join('')}</div></section>
      <section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:9px;">${tr('QC по каналам','QC by channel')}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;">${(data.qcByChannel||[]).map(channel=>`<article style="padding:10px;border:1px solid var(--stroke);border-radius:10px;"><div style="font-size:10px;font-weight:700;color:var(--text);">${escapeHtml(channelLabel(channel.channel))}</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:9px;"><span style="color:var(--good);">${statusLabel('valid')}: ${channel.valid}</span><span style="color:var(--warn);">${statusLabel('borderline')}: ${channel.borderline}</span><span style="color:var(--bad);">${statusLabel('invalid')}: ${channel.invalid}</span><span style="color:var(--muted);">${statusLabel('not_computed')}: ${channel.notComputed}</span></div></article>`).join('')}</div><details style="margin-top:10px;"><summary style="font-size:10px;font-weight:700;cursor:pointer;">${tr('Missingness и причины исключения','Missingness and exclusion reasons')}</summary><div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;">${(data.missingness||[]).map(item=>`<span style="padding:6px 8px;border-radius:8px;background:rgba(100,116,139,.08);font-size:9px;color:var(--muted);">${escapeHtml(reasonLabel(item.reasonCode))}: ${escapeHtml(item.count)}</span>`).join('')}</div>${(snapshot.excludedSessions||[]).map(item=>`<div style="font-size:9px;color:var(--muted);margin-top:6px;">${tr('Сессия','Session')} ${escapeHtml(item.sessionId)} · ${escapeHtml(reasonLabel(item.reasonCode))} · ${escapeHtml(item.channel?channelLabel(item.channel):'—')}</div>`).join('')}</details></section>
      <section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:10px;">${tr('Описательные групповые показатели','Group descriptive metrics')}</div><div style="font-size:9px;color:var(--muted);margin:-5px 0 10px;">${tr('Точки — значения участников; рамка — IQR; тёмная линия — медиана.','Dots are participant values; the box is IQR; the dark line is the median.')}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;">${metrics.map(groupMetricCardHtml).join('')}</div></section>
      ${aoiMetrics.length?`<section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:9px;">${tr('AOI-таблица','AOI table')}</div><div style="overflow:auto;border:1px solid var(--stroke);border-radius:10px;"><table style="width:100%;min-width:720px;border-collapse:collapse;font-size:9px;"><thead><tr style="background:rgba(92,102,189,.05);color:var(--muted);"><th style="padding:8px;text-align:left;">${tr('Метрика','Metric')}</th><th>AOI</th><th>${tr('Медиана [IQR]','Median [IQR]')}</th><th>n/N</th><th>N ${tr('участников','participants')}</th><th>N ${tr('наблюдений','observations')}</th></tr></thead><tbody>${aoiMetrics.map(metric=>`<tr style="border-top:1px solid var(--stroke);"><td style="padding:8px;color:var(--text);font-weight:650;">${escapeHtml(metricLabel(metric.metricId))}</td><td style="text-align:center;">${escapeHtml(metric.scope&&metric.scope.aoiId||'—')}</td><td style="text-align:center;">${escapeHtml(groupMetricPrimary(metric))}</td><td style="text-align:center;">${metric.numerator!=null&&metric.denominator!=null?`${metric.numerator}/${metric.denominator}`:'—'}</td><td style="text-align:center;">${metric.nParticipants}</td><td style="text-align:center;">${metric.nObservations}</td></tr>`).join('')}</tbody></table></div></section>`:''}
      ${groupHeatmapHtml(state)}
      <details style="padding:12px 18px;border-top:1px solid var(--stroke);"><summary style="font-size:10px;font-weight:700;cursor:pointer;">${tr('Технический состав и версии','Technical composition and versions')}</summary><div style="margin-top:8px;font-size:9px;color:var(--muted);">${(data.deviceCounts||[]).map(item=>`${escapeHtml(item.deviceClass)}: ${item.participantCount} ${tr('участников','participants')}, ${item.sessionCount} ${tr('сессий','sessions')}`).join(' · ')||'—'}<br>${Object.entries(snapshot.versions||{}).map(([key,value])=>`${escapeHtml(key)}=${escapeHtml(value==null?'—':value)}`).join(' · ')}</div></details>
      <footer style="padding:10px 18px;border-top:1px solid var(--stroke);font-size:9px;color:var(--muted);">snapshot ${escapeHtml(snapshot.id)} · ${escapeHtml(snapshot.datasetHash)} · contract ${escapeHtml(response.contractVersion)} · ${tr('сформировано','generated')} ${escapeHtml(formatDateTime(response.generatedAt))}</footer>
    </div>`;
  }

  function readinessCheckLabel(id) {
    const labels = {
      sample_size: ['Размер выборки', 'Sample size'],
      repeated_measures: ['Повторные измерения', 'Repeated measures'],
      channel_compatibility: ['Совместимость QC-каналов', 'QC channel compatibility'],
      version_compatibility: ['Совместимость версий', 'Version compatibility'],
      technical_confounding: ['Техническое смешение', 'Technical confounding']
    };
    const pair = labels[id];
    return pair ? pair[isEnglish() ? 1 : 0] : String(id || '').replace(/_/g, ' ');
  }

  function readinessTone(status) {
    if (status === 'available' || status === 'pass') return { color: 'var(--good)', bg: 'rgba(16,185,129,.09)', border: 'rgba(16,185,129,.25)' };
    if (status === 'confounded' || status === 'blocked') return { color: 'var(--bad)', bg: 'rgba(239,68,68,.08)', border: 'rgba(239,68,68,.24)' };
    if (status === 'insufficient_data' || status === 'warning') return { color: 'var(--warn)', bg: 'rgba(245,158,11,.09)', border: 'rgba(245,158,11,.25)' };
    return { color: 'var(--muted)', bg: 'rgba(100,116,139,.07)', border: 'var(--stroke)' };
  }

  function comparisonDashboardHtml(state) {
    if (!state.query.comparisonId) return stateCard('empty', tr('Выберите сравнение','Select a comparison'), tr('На уровне 2 доступны только заранее настроенные сравнения с утверждённой моделью.','Level 2 only offers predefined comparisons with an approved model.'));
    if (!state.snapshot || state.dirty) return stateCard('empty', tr('Примените выборку','Apply the selection'), tr('После применения backend зафиксирует snapshot и проверит готовность сравнения.','After applying, the backend will fix the snapshot and check comparison readiness.'));
    if (state.comparisonStatus === 'loading' || state.comparisonStatus === 'idle') return stateCard('loading', tr('Проверяем готовность сравнения','Checking comparison readiness'), tr('Backend проверяет выборку, совместимость данных и техническое смешение факторов.','The backend is checking the sample, data compatibility, and technical confounding.'));
    if (state.comparisonStatus === 'error') return `<div style="min-height:260px;display:flex;align-items:center;justify-content:center;text-align:center;padding:25px;"><div><div style="font-size:12px;color:var(--bad);">${escapeHtml(state.comparisonError && state.comparisonError.message || '')}</div><button id="analyticsComparisonRetry" class="quick-btn" type="button" style="margin-top:9px;">${tr('Повторить','Retry')}</button></div></div>`;
    const response = state.comparisonResponse;
    const data = response && response.data;
    if (!data) return stateCard('empty', tr('Нет результата сравнения','No comparison result'), tr('Backend не вернул данные. Это состояние не отображается как нулевой эффект.','The backend returned no data. This state is not shown as a zero effect.'));
    const tone = readinessTone(data.readiness);
    const checks = Array.isArray(data.readinessChecks) ? data.readinessChecks : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const available = data.readiness === 'available';
    const ci = data.estimateCi95 || {};
    const comparisonName = localizedName(state.filterOptions.comparisons.find(item => String(item.id) === String(state.query.comparisonId)), state.query.comparisonId);
    const effect = available && data.effect != null ? `${data.effect > 0 ? '+' : ''}${formatMetricNumber(data.effect)} ${data.effectUnit === 'ms' ? tr('мс','ms') : data.effectUnit || ''}` : '—';
    const ciText = available && ci.lower != null && ci.upper != null ? `${formatMetricNumber(ci.lower)}–${formatMetricNumber(ci.upper)} ${data.effectUnit === 'ms' ? tr('мс','ms') : data.effectUnit || ''}` : '—';
    const snapshot = response.snapshot || {};
    const queryEcho = snapshot.queryEcho || {};
    const filters = queryEcho.filters || {};
    return `<div>
      <section style="padding:16px 18px;border-bottom:1px solid var(--stroke);">
        <div style="padding:13px 14px;border:1px solid ${tone.border};border-radius:12px;background:${tone.bg};color:${tone.color};display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;"><div><div style="font-size:13px;font-weight:760;">${escapeHtml(statusLabel(data.readiness))}</div><div style="font-size:10px;line-height:1.5;margin-top:4px;">${data.reason ? escapeHtml(reasonLabel(data.reason)) : tr('Данные готовы для заранее настроенного сравнения.','Data are ready for the predefined comparison.')}</div></div><div style="font-size:10px;font-weight:700;">${escapeHtml(comparisonName)}</div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:10px;">${checks.map(check => { const checkTone = readinessTone(check.status); return `<article style="padding:10px;border:1px solid ${checkTone.border};border-radius:10px;background:${checkTone.bg};"><div style="font-size:10px;font-weight:700;color:var(--text);">${escapeHtml(readinessCheckLabel(check.id))}</div><div style="font-size:9px;color:${checkTone.color};margin-top:5px;">${escapeHtml(statusLabel(check.status))}${check.reason ? ` · ${escapeHtml(reasonLabel(check.reason))}` : ''}</div></article>`; }).join('')}</div>
      </section>
      ${available ? `<section style="padding:18px;border-bottom:1px solid var(--stroke);"><div style="font-size:10px;color:var(--muted);">${escapeHtml(metricLabel(data.metricId))} · ${escapeHtml(data.comparisonLevel || tr('сравниваемая группа','comparison group'))} − ${escapeHtml(data.referenceLevel || tr('референсная группа','reference group'))}</div><div style="font-size:32px;font-weight:790;color:var(--text);margin-top:7px;">${escapeHtml(effect)}</div><div style="font-size:12px;color:var(--muted);margin-top:4px;">95% CI: ${escapeHtml(ciText)} · ${escapeHtml(ci.method || '—')}</div><div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:13px;font-size:10px;color:var(--muted);"><span style="padding:7px 9px;border:1px solid var(--stroke);border-radius:9px;">adjusted p = ${data.pValueAdjusted == null ? '—' : escapeHtml(formatMetricNumber(data.pValueAdjusted, 4))}</span><span style="padding:7px 9px;border:1px solid var(--stroke);border-radius:9px;">N ${tr('участников','participants')} = ${escapeHtml(data.nParticipants)}</span><span style="padding:7px 9px;border:1px solid var(--stroke);border-radius:9px;">N ${tr('наблюдений','observations')} = ${escapeHtml(data.nObservations)}</span></div></section>` : `<section style="padding:20px 18px;border-bottom:1px solid var(--stroke);text-align:center;"><div style="font-size:15px;font-weight:750;color:var(--text);">${tr('Расчёт эффекта заблокирован','Effect calculation is blocked')}</div><div style="font-size:11px;color:var(--muted);line-height:1.6;margin-top:6px;">${tr('Эффект, доверительный интервал и p-value не вычисляются и не заменяются нулями.','Effect, confidence interval, and p-value are not computed and are not replaced with zeros.')}</div></section>`}
      ${warnings.length ? `<section style="padding:13px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:10px;font-weight:700;color:var(--warn);">${tr('Предупреждения','Warnings')}</div>${warnings.map(item => `<div style="font-size:9px;color:var(--muted);margin-top:5px;">${escapeHtml(reasonLabel(item))}</div>`).join('')}</section>` : ''}
      <details style="padding:12px 18px;border-top:1px solid var(--stroke);"><summary style="font-size:10px;font-weight:700;cursor:pointer;">${tr('Модель, выборка и версии','Model, sample, and versions')}</summary><div style="margin-top:8px;font-size:9px;line-height:1.7;color:var(--muted);">${escapeHtml(data.modelId)} v${escapeHtml(data.modelVersion)} · ${escapeHtml(data.formula || '—')}<br>${tr('Коррекция','Adjustment')}: ${escapeHtml(data.adjustmentMethod || '—')} · QC: ${escapeHtml(filters.qcMode || '—')} · ${tr('каналы','channels')}: ${escapeHtml((filters.qcChannels || []).map(channelLabel).join(', ') || '—')}<br>${Object.entries(snapshot.versions || {}).map(([key,value]) => `${escapeHtml(key)}=${escapeHtml(value == null ? '—' : value)}`).join(' · ')}</div></details>
      <footer style="padding:10px 18px;border-top:1px solid var(--stroke);font-size:9px;color:var(--muted);">snapshot ${escapeHtml(snapshot.id || '—')} · ${escapeHtml(snapshot.datasetHash || '')} · contract ${escapeHtml(response.contractVersion)} · ${tr('сформировано','generated')} ${escapeHtml(formatDateTime(response.generatedAt))}</footer>
    </div>`;
  }

  function groupShellHtml(state) {
    const level = state.groupLevel;
    return `<div class="card" style="padding:0;overflow:hidden;">${level==='level-1'?groupDashboardHtml(state):comparisonDashboardHtml(state)}</div>`;
  }

  function dataQualityShellHtml(state) {
    if (state.summaryStatus === 'loading' || state.summaryStatus === 'idle') {
      return stateCard('loading', tr('Загружаем качество данных','Loading data quality'), tr('Получаем QC, технические параметры и причины исключения для зафиксированной сессии.','Fetching QC, technical details, and exclusion reasons for the fixed session.'));
    }
    if (state.summaryStatus === 'error') {
      return `<div class="card" style="min-height:260px;display:flex;align-items:center;justify-content:center;text-align:center;padding:28px;"><div><h2 style="font-size:16px;color:var(--text);margin:0;">${tr('Качество данных недоступно','Data quality is unavailable')}</h2><button id="analyticsSummaryRetry" class="quick-btn" type="button" style="margin:14px auto 0;">${tr('Повторить загрузку','Retry loading')}</button></div></div>`;
    }
    const response = state.summaryResponse;
    const data = response && response.data;
    if (!data || !data.session) {
      return stateCard('empty', tr('Нет данных о качестве','No quality data'), tr('Backend не вернул QC для выбранной сессии. Нулевые значения не подставляются.','The backend returned no QC for the selected session. Zero values are not substituted.'));
    }
    const session = data.session;
    const quality = data.quality || {};
    const channels = Array.isArray(data.qcChannels) ? data.qcChannels : [];
    const exclusions = Array.isArray(data.exclusions) ? data.exclusions : [];
    const metrics = Array.isArray(data.metrics) ? data.metrics : [];
    const algorithms = [...new Set(metrics.map(metric => metric.algorithm && metric.algorithm.version).filter(Boolean))].join(', ') || '—';
    const checks = Object.entries(quality.checks || {});
    const percentages = [
      ['faceVisible', tr('Лицо обнаружено','Face detected')],
      ['faceOk', tr('Лицо полностью видно','Face fully visible')],
      ['poseOk', tr('Положение головы','Head position')],
      ['illuminationOk', tr('Освещение','Lighting')],
      ['eyesOpen', tr('Глаза доступны','Eyes available')],
      ['gazeValid', tr('Валидный взгляд','Valid gaze')],
      ['gazeOnScreen', tr('Взгляд на экране','Gaze on screen')],
      ['lowFps', tr('Кадры с низким FPS','Low-FPS frames')]
    ].filter(([key]) => Number.isFinite(Number(quality.percentages && quality.percentages[key])));
    const duration = Number.isFinite(Number(quality.durationMs))
      ? `${Math.round(Number(quality.durationMs) / 1000)} ${tr('с','s')}`
      : tr('Нет данных','No data');
    const overview = [
      [tr('Статус','Status'), statusLabel(quality.status)],
      [tr('QC-оценка','QC score'), Number.isFinite(Number(quality.score)) ? `${quality.score}%` : tr('Нет данных','No data')],
      [tr('Пройдено проверок','Checks passed'), quality.passedChecks != null && quality.totalChecks != null ? `${quality.passedChecks}/${quality.totalChecks}` : tr('Нет данных','No data')],
      [tr('Длительность','Duration'), duration]
    ];
    return `<div class="card" style="padding:0;overflow:hidden;">
      <header style="padding:16px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:10px;color:var(--muted);">${tr('Сессия','Session')} ${escapeHtml(session.sessionId)}</div><h2 style="font-size:17px;color:var(--text);margin:4px 0 0;">${tr('Качество данных','Data quality')}</h2></header>
      <section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px;">${overview.map(([label,value], index) => `<article style="padding:12px;border:1px solid var(--stroke);border-radius:11px;background:${index === 0 ? qcTone(quality.status).bg : 'rgba(100,116,139,.04)'};"><div style="font-size:8px;color:var(--muted);text-transform:uppercase;">${escapeHtml(label)}</div><div style="font-size:18px;font-weight:770;color:${index === 0 ? qcTone(quality.status).color : 'var(--text)'};margin-top:5px;">${escapeHtml(value)}</div></article>`).join('')}</div></section>
      <section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:10px;">${tr('QC по каналам','QC by channel')}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;">${channels.map(channel => { const tone = qcTone(channel.status); return `<article style="padding:11px;border:1px solid var(--stroke);border-radius:11px;background:${tone.bg};"><div style="display:flex;justify-content:space-between;gap:8px;font-size:10px;font-weight:750;color:${tone.color};"><span>${escapeHtml(channelLabel(channel.channel))}</span><span>${escapeHtml(statusLabel(channel.status))}</span></div><div style="font-size:9px;color:var(--muted);margin-top:6px;">${tr('Валидность','Validity')}: ${channel.validFraction == null ? tr('Нет данных','No data') : Math.round(channel.validFraction * 100) + '%'}${channel.signalConfidence == null ? '' : ` · confidence ${Math.round(channel.signalConfidence * 100)}%`}</div>${(channel.reasons || []).length ? `<div style="font-size:9px;color:${tone.color};margin-top:5px;">${escapeHtml(channel.reasons.map(reasonLabel).join('; '))}</div>` : ''}</article>`; }).join('') || `<div style="font-size:10px;color:var(--muted);">${tr('Каналы QC не выбраны','No QC channels selected')}</div>`}</div></section>
      ${percentages.length ? `<section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:10px;">${tr('Доля качественных кадров','Share of quality frames')}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;">${percentages.map(([key,label]) => { const value = Number(quality.percentages[key]); const inverse = key === 'lowFps'; const good = inverse ? value <= 5 : value >= 80; return `<article style="padding:10px;border:1px solid var(--stroke);border-radius:10px;"><div style="display:flex;justify-content:space-between;gap:8px;font-size:9px;color:var(--muted);"><span>${escapeHtml(label)}</span><strong style="color:${good ? 'var(--good)' : 'var(--warn)'};">${escapeHtml(value)}%</strong></div><div style="height:6px;border-radius:999px;background:rgba(100,116,139,.12);margin-top:7px;overflow:hidden;"><span style="display:block;height:100%;width:${Math.max(0,Math.min(100,value))}%;background:${good ? 'var(--good)' : 'var(--warn)'};"></span></div></article>`; }).join('')}</div></section>` : ''}
      ${checks.length ? `<section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:10px;">${tr('Проверки условий записи','Recording-condition checks')}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px;">${checks.map(([key,passed]) => `<div style="padding:9px 10px;border:1px solid var(--stroke);border-radius:9px;display:flex;justify-content:space-between;gap:9px;align-items:center;"><span style="font-size:9px;color:var(--text);">${escapeHtml(qualityCheckLabel(key))}</span><strong style="font-size:9px;color:${passed ? 'var(--good)' : 'var(--warn)'};">${passed ? tr('Пройдено','Passed') : tr('Требует внимания','Needs attention')}</strong></div>`).join('')}</div></section>` : ''}
      ${(quality.failReasons || []).length ? `<section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);">${tr('Что требует внимания','What needs attention')}</div>${quality.failReasons.map(reason => `<div style="margin-top:7px;padding:9px 10px;border-radius:9px;background:rgba(245,158,11,.08);color:var(--text);font-size:10px;line-height:1.45;">${escapeHtml(reasonLabel(reason))}</div>`).join('')}</section>` : ''}
      ${exclusions.length ? `<section style="padding:15px 18px;border-bottom:1px solid var(--stroke);"><div style="font-size:13px;font-weight:750;color:var(--text);margin-bottom:9px;">${tr('Исключённые пробы','Excluded trials')} (${exclusions.length})</div><div style="border:1px solid var(--stroke);border-radius:10px;overflow:hidden;">${exclusionRowsHtml(exclusions)}</div></section>` : ''}
      <details style="padding:12px 18px;border-bottom:1px solid var(--stroke);"><summary style="cursor:pointer;font-size:10px;font-weight:700;color:var(--text);">${tr('Технические данные сессии','Session technical details')}</summary>${technicalDetailsHtml(session, algorithms)}</details>
      <footer style="padding:10px 18px;font-size:9px;color:var(--muted);">snapshot ${escapeHtml(response.snapshot.id)} · ${escapeHtml(response.snapshot.datasetHash)} · contract ${escapeHtml(response.contractVersion)} · ${tr('сформировано','generated')} ${escapeHtml(formatDateTime(response.generatedAt))}</footer>
    </div>`;
  }

  function roadmapShellHtml(tab) {
    const title = tr('Связанность','Connectedness');
    const text = tr('Модуль связанности зарезервирован в roadmap и не показывает условных или демонстрационных коэффициентов.','The connectedness module is reserved in the roadmap and does not show placeholder or demo coefficients.');
    return `<div class="card" style="min-height:310px;display:flex;align-items:center;justify-content:center;text-align:center;padding:28px;"><div style="max-width:520px;"><h2 style="font-size:16px;color:var(--text);margin:0;">${title}</h2><p style="font-size:12px;line-height:1.6;color:var(--muted);margin:9px 0 0;">${text}</p><span style="display:inline-block;margin-top:14px;padding:5px 9px;border-radius:999px;background:rgba(245,158,11,.10);color:var(--warn);font-size:10px;font-weight:750;">ROADMAP</span></div></div>`;
  }

  function heatmapColor(value) {
    const t = Math.max(0, Math.min(1, value));
    if (t < 0.33) {
      const p = t / 0.33;
      return [Math.round(37 + 10 * p), Math.round(99 + 120 * p), Math.round(235 - 140 * p), Math.round(210 * Math.pow(t, .65))];
    }
    if (t < 0.66) {
      const p = (t - 0.33) / 0.33;
      return [Math.round(47 + 198 * p), Math.round(219 - 61 * p), Math.round(95 - 84 * p), Math.round(210 * Math.pow(t, .65))];
    }
    const p = (t - 0.66) / 0.34;
    return [Math.round(245 - 6 * p), Math.round(158 - 90 * p), Math.round(11 + 57 * p), Math.round(210 * Math.pow(t, .65))];
  }

  function drawHeatmapCanvas(canvas) {
    const response = canvas && canvas.dataset.heatmapKind === 'group' ? store.state.groupHeatmapResponse : store.state.heatmapResponse;
    const data = response && response.data;
    const grid = data && data.grid;
    if (!canvas || !grid || !grid.width || !grid.height || !Array.isArray(grid.values) || grid.values.length !== grid.width * grid.height) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const source = global.document.createElement('canvas');
    source.width = grid.width;
    source.height = grid.height;
    const sourceContext = source.getContext('2d');
    const pixels = sourceContext.createImageData(grid.width, grid.height);
    const max = Number(grid.maxValue) || 1;
    grid.values.forEach((value, index) => {
      const color = heatmapColor(Number(value) / max);
      pixels.data[index * 4] = color[0];
      pixels.data[index * 4 + 1] = color[1];
      pixels.data[index * 4 + 2] = color[2];
      pixels.data[index * 4 + 3] = color[3];
    });
    sourceContext.putImageData(pixels, 0, 0);
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  function bindHeatmapCanvases(root) {
    root.querySelectorAll('.analytics-heatmap-canvas').forEach(canvas => {
      drawHeatmapCanvas(canvas);
      if (typeof global.ResizeObserver === 'function') {
        const observer = new global.ResizeObserver(() => {
          if (!canvas.isConnected) return observer.disconnect();
          drawHeatmapCanvas(canvas);
        });
        observer.observe(canvas);
      }
    });
  }

  function AnalyticsProductionView(sub) {
    const demoEnabled = global.__EMOCOG_ANALYTICS_DEMO__ === true
      || new URLSearchParams(global.location && global.location.search || '').get('analyticsDemo') === '1';
    if (demoEnabled && typeof legacyAnalyticsView === 'function') {
      return legacyAnalyticsView(sub);
    }
    const activeTab = TABS.some(tab => tab.id === sub) ? sub : 'session-card';
    const intendedMode = activeTab === 'group-comparison' ? 'group' : 'session';
    if (store.state.query.mode !== intendedMode) {
      store.state.query.mode = intendedMode;
      store.state.dirty = true;
      store.persist();
    }
    const pageTitle = global.document.getElementById('pageTitle');
    if (pageTitle) pageTitle.textContent = tr('Инструменты аналитики','Analytics tools');
    if (typeof global.setChips === 'function') global.setChips([]);

    const wrapper = global.document.createElement('div');
    wrapper.style.cssText = 'display:flex;flex-direction:column;min-height:100%;margin:-20px;';
    wrapper.innerHTML = `<nav class="analytics-tabs" aria-label="${tr('Разделы аналитики','Analytics sections')}" role="tablist">${TABS.map(tab => `<button type="button" role="tab" aria-selected="${tab.id === activeTab}" class="analytics-tab ${tab.id === activeTab ? 'active' : ''}" data-tab="${tab.id}" style="border:0;background:transparent;">${tr(tab.ru, tab.en)}</button>`).join('')}</nav><main id="analyticsProductionBody" class="analytics-view-body" style="display:flex;flex-direction:column;gap:12px;"></main>`;
    const body = wrapper.querySelector('#analyticsProductionBody');
    let unsubscribe = null;

    function renderState(state) {
      if (!body.isConnected) {
        if (unsubscribe) unsubscribe();
        return;
      }
      if (typeof global.setChips === 'function') {
        const statusLabel = global.EmocogAnalyticsPreviewFixture
          ? (state.query.mode === 'group' ? tr('Предпросмотр · 12 участников','Preview · 12 participants') : tr('Предпросмотр · 1 сессия','Preview · 1 session'))
          : (state.status === 'ready' ? tr('Данные API','API data') : tr('Данные не загружены','Data not loaded'));
        global.setChips([statusLabel]);
      }
      if (state.status === 'unauthorized') {
        body.innerHTML = stateCard('unauthorized', tr('Нужна авторизация исследователя','Researcher sign-in required'), tr('Без API production-аналитика не показывает числа и не переключается на демонстрационные данные. Войдите в систему и повторите запрос.','Without the API, production analytics shows no numbers and never falls back to demo data. Sign in and retry.'), tr('Повторить проверку','Retry'));
        if (canOfferLocalPreview()) {
          body.querySelector('#analyticsStateAction')?.insertAdjacentHTML('afterend', `<a href="${escapeHtml(localPreviewUrl())}" style="display:block;width:max-content;margin:9px auto 0;color:var(--accent);font-size:11px;font-weight:650;text-decoration:none;">${tr('Посмотреть preview с одной сессией','View one-session preview')}</a>`);
        }
      } else if (state.status === 'loading' || state.status === 'idle') {
        body.innerHTML = stateCard('loading', tr('Загружаем выборку','Loading selection'), tr('Получаем проекты, протоколы и сессии из API. Демонстрационные значения в этот момент не отображаются.','Fetching projects, protocols, and sessions from the API. No demo values are displayed while loading.'));
      } else if (state.status === 'error') {
        body.innerHTML = stateCard('error', tr('Не удалось загрузить аналитику','Analytics could not be loaded'), `${tr('Ответ API:','API response:')} ${escapeHtml(state.error && state.error.message || tr('неизвестная ошибка','unknown error'))}. ${tr('Старые данные не отображаются.','Stale data is not displayed.')}`, tr('Повторить','Retry'));
      } else {
        body.innerHTML = filtersHtml(state);
        body.insertAdjacentHTML('beforeend', previewBannerHtml(state));
        if (state.status === 'empty') {
          const title = state.emptyKind === 'projects' ? tr('Нет доступных проектов','No projects available') : tr('По выбранным фильтрам нет сессий','No sessions match the filters');
          const description = state.emptyKind === 'projects' ? tr('Создайте проект или попросите предоставить к нему доступ.','Create a project or request access to one.') : tr('Это состояние «нет данных», а не нулевой результат. Измените протокол или QC-фильтр.','This is a no-data state, not a zero result. Change the protocol or QC filter.');
          body.insertAdjacentHTML('beforeend', stateCard('empty', title, description));
        } else if ((activeTab === 'session-card' || activeTab === 'group-comparison' || activeTab === 'data-quality') && (!state.snapshot || state.dirty)) {
          body.insertAdjacentHTML('beforeend', stateCard('empty', tr('Примените фильтры','Apply the filters'), tr('Дашборд появится после того, как backend зафиксирует единую выборку. Это защищает карточки, графики и будущий export от расхождения.','The dashboard appears after the backend fixes one selection. This keeps cards, charts, and future exports aligned.')));
        } else if (activeTab === 'session-card') {
          body.insertAdjacentHTML('beforeend', sessionShellHtml(state));
        } else if (activeTab === 'group-comparison') {
          body.insertAdjacentHTML('beforeend', groupShellHtml(state));
        } else if (activeTab === 'data-quality') {
          body.insertAdjacentHTML('beforeend', dataQualityShellHtml(state));
        } else {
          body.insertAdjacentHTML('beforeend', roadmapShellHtml(activeTab));
        }
      }
      bindBodyEvents();
      global.requestAnimationFrame(() => bindHeatmapCanvases(body));
    }

    function bindBodyEvents() {
      body.querySelector('#analyticsStateAction')?.addEventListener('click', () => store.initialize(true));
      body.querySelector('#analyticsProjectFilter')?.addEventListener('change', event => store.setProject(event.target.value));
      body.querySelector('#analyticsProtocolFilter')?.addEventListener('change', event => store.setProtocol(event.target.value));
      body.querySelector('#analyticsVersionFilter')?.addEventListener('change', event => store.setProtocolVersion(event.target.value));
      body.querySelector('#analyticsSessionFilter')?.addEventListener('change', event => store.setSession(event.target.value));
      body.querySelector('#analyticsGroupFilter')?.addEventListener('change', event => store.setFilter('groupId', event.target.value));
      body.querySelector('#analyticsConditionFilter')?.addEventListener('change', event => store.setFilter('conditionId', event.target.value));
      body.querySelector('#analyticsComparisonFilter')?.addEventListener('change', event => store.setFilter('comparisonId', event.target.value));
      body.querySelector('#analyticsBlockFilter')?.addEventListener('change', event => store.setFilter('blockId', event.target.value));
      body.querySelector('#analyticsStimulusFilter')?.addEventListener('change', event => store.setFilter('stimulusId', event.target.value));
      body.querySelector('#analyticsAoiFilter')?.addEventListener('change', event => store.setFilter('aoiId', event.target.value));
      body.querySelector('#analyticsQcMode')?.addEventListener('change', event => store.setFilter('qcMode', event.target.value));
      body.querySelector('#analyticsDateFrom')?.addEventListener('change', event => store.setFilter('dateFrom', event.target.value));
      body.querySelector('#analyticsDateTo')?.addEventListener('change', event => store.setFilter('dateTo', event.target.value));
      body.querySelector('#analyticsIncludeIncomplete')?.addEventListener('change', event => store.setFilter('includeIncompleteSessions', event.target.checked));
      body.querySelectorAll('.analytics-qc-channel').forEach(input => input.addEventListener('change', () => store.toggleChannel(input.value, input.checked)));
      body.querySelector('#analyticsResetFilters')?.addEventListener('click', () => store.resetFilters());
      body.querySelector('#analyticsApplyFilters')?.addEventListener('click', () => store.apply());
      body.querySelector('#analyticsResultImport')?.addEventListener('click', () => body.querySelector('#analyticsResultImportFile')?.click());
      body.querySelector('#analyticsResultImportFile')?.addEventListener('change', event => {
        const file = event.target.files && event.target.files[0];
        if (file) store.importResult(file);
        event.target.value = '';
      });
      body.querySelector('#analyticsOpenExport')?.addEventListener('click', () => global.navigate && global.navigate('#/export'));
      body.querySelector('#analyticsSummaryRetry')?.addEventListener('click', () => store.loadSessionSummary());
      body.querySelector('#analyticsVisualRetry')?.addEventListener('click', () => store.loadVisualAnalytics());
      body.querySelector('#analyticsGroupRetry')?.addEventListener('click', () => store.loadGroupSummary());
      body.querySelector('#analyticsGroupHeatmapRetry')?.addEventListener('click', () => store.loadGroupHeatmap());
      body.querySelector('#analyticsComparisonRetry')?.addEventListener('click', () => store.loadComparison());
      body.querySelectorAll('.analytics-layer-toggle').forEach(input => input.addEventListener('change', () => store.setLayer(input.dataset.layer, input.checked)));
      body.querySelectorAll('.analytics-level').forEach(button => button.addEventListener('click', () => store.setGroupLevel(button.dataset.level)));
    }

    wrapper.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.tab === activeTab) return;
      if (typeof global.navigate === 'function') global.navigate('#/analytics/' + button.dataset.tab);
    }));

    unsubscribe = store.subscribe(renderState);
    setTimeout(() => store.initialize(false), 0);
    return wrapper;
  }

  global.EmocogAnalyticsProduction = { api, store, view: AnalyticsProductionView, exportView: AnalyticsExportView, hasAuth, buildAnalyticsQuery, buildExportBundle, validateExportBundle, exportBundleCsv, importResultJson };
  global.AnalyticsView = AnalyticsProductionView;
  global.SessionCardView = function () { return AnalyticsProductionView('session-card'); };
})(typeof window !== 'undefined' ? window : globalThis);
