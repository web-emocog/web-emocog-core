"use strict";

const { clamp, invNorm, level, mean, norm } = require("./utils");

// Функция для построения маркера
function buildMarker(markerId, label, score, rationale, evidence) {
  const normalized = clamp(score);
  return {
    id: markerId,
    label,
    score: normalized,
    level: level(normalized),
    rationale,
    evidence,
  };
}

// Функция для оценки маркеров
function scoreMarkers(features) {
  const jitter = Number(features.jitter_local || 0);
  const shimmer = Number(features.shimmer_local || 0);
  const hnr = Number(features.hnr_db || 0);

  const motorScore = mean([
    norm(jitter, 0.01, 0.20),
    norm(shimmer, 0.02, 0.35),
    invNorm(hnr, 3.0, 20.0),
  ]);
  // Оценка моторной речи
  const pauseRate = Number(features.pause_rate || 0);
  const avgPause = Number(features.avg_pause_duration || 0);
  const fillerRatio = Number(features.filler_ratio || 0);
  const speechRate = Number(features.speech_rate_wps || 0);
  // Оценка когнитивной нагрузки
  const cognitiveComponents = [
    norm(pauseRate, 0.15, 0.80),
    norm(avgPause, 0.25, 1.20),
    norm(fillerRatio, 0.02, 0.15),
  ];
  if (speechRate > 0) {
    cognitiveComponents.push(invNorm(speechRate, 1.3, 3.2));
  }
  const cognitiveScore = mean(cognitiveComponents);

  // Оценка аффективной выразительности
  const pitchVar = Number(features.pitch_variability || 0);
  const energyCv = Number(features.energy_cv || 0);
  const flatPitch = norm(Math.max(0.08 - pitchVar, 0), 0, 0.08);
  const excessivePitch = norm(Math.max(pitchVar - 0.35, 0), 0, 0.35);
  const pitchInstability = Math.max(flatPitch, excessivePitch);
  const lowEnergyDynamics = norm(Math.max(0.20 - energyCv, 0), 0, 0.20);
  const affectiveScore = mean([pitchInstability, lowEnergyDynamics]);

  // Оценка лексической организации
  const wordCount = Number(features.word_count || 0);
  const typeTokenRatio = Number(features.type_token_ratio || 0);
  const repetitionRatio = Number(features.repetition_ratio || 0);
  const wordsPerSentence = Number(features.mean_words_per_sentence || 0);

  let lexicalScore = 0;
  if (wordCount >= 3) {
    lexicalScore = mean([
      invNorm(typeTokenRatio, 0.35, 0.75),
      norm(repetitionRatio, 0.02, 0.20),
      invNorm(wordsPerSentence, 6.0, 16.0),
    ]);
  }

  const markers = [
    buildMarker(
      "motor_speech_instability",
      "Маркер моторно-речевой нестабильности",
      motorScore,
      "Повышенные jitter/shimmer и сниженная гармоничность могут указывать на нестабильность голосообразования.",
      {
        jitter_local: jitter,
        shimmer_local: shimmer,
        hnr_db: hnr,
      },
    ),
    buildMarker(
      "cognitive_load_pattern",
      "Маркер когнитивной нагрузки",
      cognitiveScore,
      "Частые и длинные паузы, слова-паразиты и сниженный темп речи могут отражать повышенную когнитивную нагрузку.",
      {
        pause_rate: pauseRate,
        avg_pause_duration: avgPause,
        filler_ratio: fillerRatio,
        speech_rate_wps: speechRate,
      },
    ),
    buildMarker(
      "affective_expression_pattern",
      "Маркер аффективной выразительности",
      affectiveScore,
      "Сильно уплощенная или резко нестабильная просодия может указывать на атипичную аффективную выразительность.",
      {
        pitch_variability: pitchVar,
        energy_cv: energyCv,
      },
    ),
    buildMarker(
      "lexical_organization_pattern",
      "Маркер лексической организации",
      lexicalScore,
      "Снижение лексического разнообразия и повторы слов могут указывать на снижение лексической организации.",
      {
        word_count: wordCount,
        type_token_ratio: typeTokenRatio,
        repetition_ratio: repetitionRatio,
      },
    ),
  ];

  const duration = Number(features.duration_sec || 0);
  const speechFraction = Number(features.speech_fraction || 0);
  const words = Number(features.word_count || 0);
  const wordComponent = words <= 0 ? 0.5 : norm(words, 8, 120);
  const confidence = clamp(
    0.45 * norm(duration, 8, 60) +
      0.35 * norm(speechFraction, 0.20, 0.90) +
      0.20 * wordComponent,
    0.10,
    0.95,
  );

  const notes = [];
  if (duration < 8) {
    notes.push("Запись короткая; устойчивость маркеров ограничена.");
  }
  if (words === 0) {
    notes.push("Текстовый контур отключен; текстовые/лексические маркеры не используются в этом профиле.");
  }
  if (speechFraction < 0.15) {
    notes.push("Обнаружена низкая доля речи; маркеры пауз и темпа речи могут быть нестабильны.");
  }

  return { markers, confidence, notes };
}

module.exports = {
  scoreMarkers,
};
