"use strict";

const {
  DEFAULT_CONFIG,
  DISABLED_TEXT_FEATURES,
  MODULE_VERSION,
  STRICT_CONFIDENCE_THRESHOLD,
  STRICT_FLAG_THRESHOLD_DELTA,
  STRICT_QUALITY_THRESHOLD,
} = require("./constants");
const {
  collectVoicedSamples,
  decodeAndPrepareArrayBufferBrowser,
  decodeAndPrepareAudioBrowser,
  detectSpeechSegments,
  prepareFromRawSamples,
} = require("./audio");
const { extractAcousticFeatures, extractPauseFeatures } = require("./acoustic_features");
const { buildConditionFlags, applyActiveThresholds } = require("./condition_flags");
const { scoreMarkers } = require("./marker_scoring");
const { evaluateQuality } = require("./quality");
const { roundObjectValues } = require("./utils");

function mergeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...(config || {}),
  };
}

function buildAnalysisResult(prepared, config) {
  const speechSegments = detectSpeechSegments(prepared.samples, prepared.sampleRate, 30, 0.15);
  const voicedSamples = collectVoicedSamples(prepared.samples, speechSegments, prepared.sampleRate);

  const acoustic = extractAcousticFeatures(prepared.samples, voicedSamples, prepared.sampleRate);
  const pauseMetrics = extractPauseFeatures(prepared.durationSec, speechSegments);

  const features = {
    ...acoustic,
    ...pauseMetrics,
    ...DISABLED_TEXT_FEATURES,
    speech_rate_wps: 0,
    duration_sec: prepared.durationSec,
  };

  const quality = evaluateQuality(
    prepared.samples,
    prepared.sampleRate,
    prepared.durationSec,
    Number(features.speech_fraction || 0),
    speechSegments,
    0,
  );

  const markerResult = scoreMarkers(features);
  const conditionResult = buildConditionFlags(features, markerResult.markers);
  const conditionFlags = applyActiveThresholds(conditionResult.flags, Boolean(config.strict_mode));

  const notes = [...markerResult.notes, ...quality.warnings];
  notes.push("Локальный эвристический анализ выполнен без передачи данных во внешние сервисы.");

  if (prepared.wasTruncated) {
    notes.push(
      `Аудио было обрезано до ${prepared.durationSec.toFixed(2)} с (из ${prepared.originalDurationSec.toFixed(2)} с) из-за max_audio_duration_sec=${config.max_audio_duration_sec}.`,
    );
  }

  notes.push(
    `Контур надежности: snr_proxy_db=${quality.snr_proxy_db.toFixed(2)}, clipping_ratio=${quality.clipping_ratio.toFixed(3)}, quality_score=${quality.score.toFixed(3)}.`,
  );
  notes.push(`Жесткий режим: ${config.strict_mode ? "вкл" : "выкл"} (сбалансированный preset).`);
  if (config.max_audio_duration_sec <= 0) {
    notes.push("Лимит длительности аудио: без ограничений.");
  } else {
    notes.push(`Лимит длительности аудио: ${config.max_audio_duration_sec} с.`);
  }

  const abstainReasons = []; // Причины воздержания
  if (quality.is_ood) abstainReasons.push("quality_ood");
  if (markerResult.confidence < config.abstain_confidence_threshold) abstainReasons.push("low_marker_confidence");
  if (quality.score < config.abstain_quality_threshold) abstainReasons.push("low_quality_score");

  const strictReasons = []; // Причины строгого режима
  if (config.strict_mode) {
    if (quality.score < STRICT_QUALITY_THRESHOLD) strictReasons.push("strict_low_quality");
    if (markerResult.confidence < STRICT_CONFIDENCE_THRESHOLD) strictReasons.push("strict_low_confidence");
    if (quality.is_ood) strictReasons.push("strict_ood");
  }

  const strictPassed = strictReasons.length === 0; // Строгие причины не найдены
  let status = abstainReasons.length ? "abstain" : "ok";
  let warningLevel = "none";
  if (config.strict_mode && !strictPassed) {
    status = "abstain";
    warningLevel = "strict_warning";
    notes.push(
      "Предупреждение жесткого режима: строгий gate надежности не пройден. Флаги состояний показаны с более строгими порогами.",
    );
  }

  return {
    version: MODULE_VERSION,
    disclaimer:
      "Этот инструмент не ставит диагнозы. Он показывает речевые маркеры, которые могут требовать профессиональной оценки.",
    duration_sec: Number(prepared.durationSec.toFixed(3)),
    marker_confidence: Number(markerResult.confidence.toFixed(3)),
    markers: markerResult.markers,
    condition_flags: conditionFlags,
    quality: {
      score: quality.score,
      is_ood: quality.is_ood,
      duration_sec: quality.duration_sec,
      speech_fraction: quality.speech_fraction,
      clipping_ratio: quality.clipping_ratio,
      snr_proxy_db: quality.snr_proxy_db,
      warnings: quality.warnings,
    },
    decision: {
      status,
      abstained: status === "abstain",
      reasons: abstainReasons,
      strict_mode: Boolean(config.strict_mode),
      strict_passed: strictPassed,
      strict_reasons: strictReasons,
      warning_level: warningLevel,
      marker_confidence: Number(markerResult.confidence.toFixed(6)),
      quality_score: Number(quality.score.toFixed(6)),
      thresholds: {
        marker_confidence: Number(config.abstain_confidence_threshold.toFixed(6)),
        quality_score: Number(config.abstain_quality_threshold.toFixed(6)),
        strict_marker_confidence: STRICT_CONFIDENCE_THRESHOLD,
        strict_quality_score: STRICT_QUALITY_THRESHOLD,
        strict_flag_delta: STRICT_FLAG_THRESHOLD_DELTA,
      },
    },
    indicator_percentages: conditionResult.indicatorPercentages,
    raw_features: roundObjectValues(features, 6),
    notes,
    literature: conditionResult.literature,
  };
}

// Функция для анализа PCM-образцов
function analyzePcmSamples(samples, sampleRate, runtimeConfig = {}) {
  const config = mergeConfig(runtimeConfig);
  const prepared = prepareFromRawSamples(samples, sampleRate, config.max_audio_duration_sec);
  return buildAnalysisResult(prepared, config);
}

// Функция для анализа аудиофайлов в браузере
async function analyzeAudioFileBrowser(file, runtimeConfig = {}) {
  const config = mergeConfig(runtimeConfig);
  const prepared = await decodeAndPrepareAudioBrowser(file, config.max_audio_duration_sec);
  return buildAnalysisResult(prepared, config);
}

// Функция для анализа аудиомассивов в браузере
async function analyzeAudioArrayBufferBrowser(arrayBuffer, runtimeConfig = {}) {
  const config = mergeConfig(runtimeConfig);
  const prepared = await decodeAndPrepareArrayBufferBrowser(arrayBuffer, config.max_audio_duration_sec);
  return buildAnalysisResult(prepared, config);
}

// Совместимость с предыдущим названием API.
async function analyzeAudioFile(file, runtimeConfig = {}) {
  return analyzeAudioFileBrowser(file, runtimeConfig);
}

function getCapabilities() { // Функция для получения возможностей модуля
  return {
    module_id: "vocal_biomarkers_core",
    module_version: MODULE_VERSION,
    mode: "heuristic_only",
    endpoints: {},
    entrypoints: {
      commonjs: "core/index.js",
      esm: "core/index.mjs",
    },
    runtime_config_keys: [
      "max_audio_duration_sec",
      "abstain_confidence_threshold",
      "abstain_quality_threshold",
      "strict_mode",
    ],
    supported_inputs: [
      "Float32Array samples + sample_rate",
      "ArrayBuffer audio (browser helper)",
      "File/Blob audio (browser helper)",
    ],
    supported_outputs: [
      "markers",
      "condition_flags",
      "quality",
      "decision",
      "indicator_percentages",
      "raw_features",
      "notes",
      "literature",
    ],
    report_format: "json",
    report_helpers: ["toJsonReport", "analyzePcmSamplesJson", "analyzeAudioFileBrowserJson", "fromJsonReport"],
    notes: [
      "No UI and no backend required.",
      "No network calls for analysis.",
      "Non-diagnostic heuristic screening only.",
    ],
  };
}

module.exports = {
  mergeConfig,
  buildAnalysisResult,
  analyzePcmSamples,
  analyzeAudioArrayBufferBrowser,
  analyzeAudioFileBrowser,
  analyzeAudioFile,
  getCapabilities,
};
