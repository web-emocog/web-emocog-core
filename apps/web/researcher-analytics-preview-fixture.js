(function (global) {
  'use strict';

  const enabled = new URLSearchParams(global.location && global.location.search || '').get('analyticsPreview') === '1';
  if (!enabled) return;

  global.EmocogAnalyticsPreviewFixture = {
    projects: [{ id: 12, name_ru: 'Исследование визуального внимания', name_en: 'Visual attention study' }],
    protocols: [{
      id: 25,
      name_ru: 'Поиск целевого объекта',
      name_en: 'Target search task',
      version: '1.0.0',
      analyticsPlan: {
        selectedMetricIds: ['viz.heatmap', 'task.accuracy_pct', 'task.rt_median_ms', 'qc.valid_gaze_pct', 'aoi.gaze_on_target_pct', 'aoi.dwell_time_ms', 'aoi.ttff_ms', 'aoi.target_reached_pct']
      }
    }],
    filterOptions: {
      blocks: [
        { id: 'training-block', name_ru: 'Тренировка', name_en: 'Training' },
        { id: 'main-block', name_ru: 'Основная часть', name_en: 'Main task' }
      ],
      stimuli: [
        { id: 'stimulus-training-01', blockId: 'training-block', name_ru: 'Тренировочный стимул', name_en: 'Training stimulus' },
        { id: 'stimulus-42', blockId: 'main-block', name_ru: 'Целевой стимул', name_en: 'Target stimulus' }
      ],
      aois: [
        { id: 'aoi-target', stimulusId: 'stimulus-42', name_ru: 'Целевая область', name_en: 'Target AOI' },
        { id: 'aoi-distractor', stimulusId: 'stimulus-42', name_ru: 'Дистрактор', name_en: 'Distractor' }
      ],
      groups: [
        { id: 'control', name_ru: 'Контрольная группа', name_en: 'Control group' },
        { id: 'clinical', name_ru: 'Клиническая группа', name_en: 'Clinical group' }
      ],
      conditions: [
        { id: 'condition-a', name_ru: 'Условие A', name_en: 'Condition A' }
      ],
      comparisons: [
        { id: 'clinical-vs-control', name_ru: 'Клиническая vs контрольная', name_en: 'Clinical vs control', factorIds: ['group'], contrastIds: ['clinical-vs-control@condition-a'], groupIds: ['control', 'clinical'], conditionIds: ['condition-a'], metricId: 'aoi.dwell_time_ms', previewResult: 'available' },
        { id: 'camera-confounded', name_ru: 'Пример технического смешения', name_en: 'Technical confounding example', factorIds: ['group'], contrastIds: ['clinical-vs-control@condition-a'], groupIds: ['control', 'clinical'], conditionIds: ['condition-a'], metricId: 'aoi.dwell_time_ms', previewResult: 'confounded' }
      ],
      qcChannels: ['task', 'gaze'],
      dateMin: '2026-08-01',
      dateMax: '2026-08-05'
    },
    sessions: [{
      id: 105,
      session_id: 'SESSION-105',
      participant_alias: 'P-042',
      status: 'completed',
      started_at: '2026-08-03T09:00:00.000Z',
      stopped_at: '2026-08-03T09:12:40.000Z',
      qc_validity: 'borderline',
      device_class: 'desktop_webcam',
      resolution: { width: 1920, height: 1080 },
      actual_fps: 29.7,
      protocol_version: '1.0.0',
      analytics_summary: {
        contractVersion: '1.0',
        snapshotId: 'preview-snapshot-001',
        algorithmVersion: 'analytics-api-1.0.0',
        qcChannels: [
          { channel: 'task', status: 'valid', validFraction: 0.96, reasons: [] },
          { channel: 'gaze', status: 'borderline', validFraction: 0.74, signalConfidence: 0.78, reasons: ['low_valid_gaze_fraction'] }
        ],
        metrics: [
          { metricId: 'task.accuracy_pct', value: 75, unit: 'pct', status: 'computed', numerator: 18, denominator: 24, nObservations: 24, qc: { status: 'valid' }, algorithm: { version: '1.0.0' } },
          { metricId: 'task.rt_median_ms', value: 438, unit: 'ms', status: 'computed', denominator: 18, nObservations: 18, distribution: { n: 18, mean: 451.7, sd: 86.4, median: 438, q1: 392, q3: 501, min: 310, max: 690 }, qc: { status: 'valid' }, algorithm: { id: 'rt-analyzer', version: '1.0.0', parametersHash: 'sha256:rt-default-v1' } },
          { metricId: 'task.error_count', value: 4, unit: 'count', status: 'computed', denominator: 24, nObservations: 24, qc: { status: 'valid' }, algorithm: { version: '1.0.0' } },
          { metricId: 'task.omission_count', value: 2, unit: 'count', status: 'computed', denominator: 24, nObservations: 24, qc: { status: 'valid' }, algorithm: { version: '1.0.0' } },
          { metricId: 'task.commission_count', value: 0, unit: 'count', status: 'computed', denominator: 24, nObservations: 24, qc: { status: 'valid' }, algorithm: { version: '1.0.0' } },
          { metricId: 'task.trial_count_valid', value: 22, unit: 'count', status: 'computed', denominator: 24, nObservations: 24, qc: { status: 'valid' }, algorithm: { version: '1.0.0' } },
          { metricId: 'task.trial_count_excluded', value: 2, unit: 'count', status: 'computed', denominator: 24, nObservations: 24, qc: { status: 'valid' }, algorithm: { version: '1.0.0' } },
          { metricId: 'qc.valid_gaze_pct', value: 74, unit: 'pct', status: 'computed', numerator: 53280, denominator: 72000, nObservations: 2138, signalConfidence: 0.78, qc: { status: 'borderline' }, algorithm: { version: '1.0.0' } },
          { metricId: 'qc.low_confidence_pct', value: 18, unit: 'pct', status: 'computed', numerator: 12960, denominator: 72000, nObservations: 521, signalConfidence: 0.58, qc: { status: 'borderline' }, algorithm: { version: '1.0.0' } },
          { metricId: 'qc.off_screen_pct', value: 0, unit: 'pct', status: 'computed', numerator: 0, denominator: 72000, nObservations: 0, signalConfidence: 0.78, qc: { status: 'borderline' }, algorithm: { version: '1.0.0' } },
          { metricId: 'aoi.gaze_on_target_pct', value: 62, unit: 'pct', status: 'computed', denominator: 53280, nObservations: 1320, signalConfidence: 0.78, qc: { status: 'borderline' }, algorithm: { version: '1.0.0' } },
          { metricId: 'aoi.dwell_time_ms', value: 1320, unit: 'ms', status: 'computed', denominator: 2240, nObservations: 6, signalConfidence: 0.78, qc: { status: 'borderline' }, algorithm: { version: '1.0.0' } },
          { metricId: 'aoi.ttff_ms', value: 410, unit: 'ms', status: 'computed', denominator: 1, nObservations: 1, signalConfidence: 0.78, qc: { status: 'borderline' }, algorithm: { version: '1.0.0' } }
        ],
        blocks: [
          { id: 'training-block', name_ru: 'Тренировка', name_en: 'Training', trials: 6, validTrials: 6, qc: 'valid', accuracy: 83, rtMedianMs: 421 },
          { id: 'main-block', name_ru: 'Основная часть', name_en: 'Main task', trials: 24, validTrials: 22, qc: 'borderline', accuracy: 75, rtMedianMs: 438 }
        ],
        exclusions: [
          { level: 'trial', entityId: 'trial-11', reasonCode: 'response_before_rt_min', channel: 'task' },
          { level: 'trial', entityId: 'trial-19', reasonCode: 'low_valid_gaze_fraction', channel: 'gaze' }
        ]
      }
    }]
  };
})(typeof window !== 'undefined' ? window : globalThis);
