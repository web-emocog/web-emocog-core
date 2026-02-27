"use strict";

const { LITERATURE, STRICT_FLAG_THRESHOLD_DELTA } = require("./constants");
const { clamp, invNorm, level, mean, norm } = require("./utils");

// Функция для получения оценки маркера
function markerScore(markerMap, key, fallback = 0) {
  return Number(markerMap[key] ?? fallback);
}

// Функция для оценки значений вне диапазона
function outsideBandScore(value, lowExtreme, lowBand, highBand, highExtreme) {
  const lowScore = value <= lowBand ? invNorm(value, lowExtreme, lowBand) : 0;
  const highScore = value >= highBand ? norm(value, highBand, highExtreme) : 0;
  return Math.max(lowScore, highScore);
}

// Функция для построения флага
function buildFlag(flagId, label, score, threshold, evidenceStrength, rationale, supportingMarkers, references) {
  const normalized = clamp(score);
  return {
    id: flagId,
    label,
    score: normalized,
    base_threshold: Number(threshold.toFixed(4)),
    active_threshold: Number(threshold.toFixed(4)),
    percentage: Number((normalized * 100).toFixed(2)),
    level: level(normalized),
    flagged: normalized >= threshold,
    evidence_strength: evidenceStrength,
    rationale,
    supporting_markers: supportingMarkers,
    references,
  };
}

// Функция для построения флагов состояний
function buildConditionFlags(features, markers) {
  const markerMap = {};
  for (let i = 0; i < markers.length; i += 1) {
    markerMap[markers[i].id] = Number(markers[i].score || 0);
  }

  const jitter = Number(features.jitter_local || 0);
  const shimmer = Number(features.shimmer_local || 0);
  const hnr = Number(features.hnr_db || 0);
  const pauseRate = Number(features.pause_rate || 0);
  const avgPause = Number(features.avg_pause_duration || 0);
  const speechRate = Number(features.speech_rate_wps || 0);
  const pitchVar = Number(features.pitch_variability || 0);
  const pitchMean = Number(features.pitch_mean_hz || 0);
  const energyCv = Number(features.energy_cv || 0);
  const fillerRatio = Number(features.filler_ratio || 0);
  const typeTokenRatio = Number(features.type_token_ratio || 0);
  const wordCount = Number(features.word_count || 0);
  const meanUtt = Number(features.mean_utterance_duration || 0);
  const speechFraction = Number(features.speech_fraction || 0);
  const speechRateAvailable = speechRate > 0 && wordCount > 0;

  // Оценка аномалий
  const schizoPitchAbnormality = outsideBandScore(pitchVar, 0.06, 0.16, 0.30, 0.52);
  const schizoEnergyAbnormality = outsideBandScore(energyCv, 0.08, 0.18, 0.55, 0.90);
  const schizoPauseBurden = mean([norm(pauseRate, 0.18, 0.60), norm(avgPause, 0.25, 1.20)]);
  const schizoJitterComponent = norm(jitter, 0.12, 0.28);
  const schizoShimmerComponent = norm(shimmer, 0.08, 0.22);
  const schizoHnrComponent = invNorm(hnr, 2.0, 8.0);
  const schizoMotorComponent = markerScore(markerMap, "motor_speech_instability");
  const schizoCognitiveComponent = markerScore(markerMap, "cognitive_load_pattern");

  // Оценка шизофрении
  let schizophreniaScore =
    0.10 * schizoJitterComponent +
    0.09 * schizoShimmerComponent +
    0.18 * schizoHnrComponent +
    0.24 * schizoPitchAbnormality +
    0.10 * schizoEnergyAbnormality +
    0.13 * schizoPauseBurden +
    0.10 * schizoMotorComponent +
    0.06 * schizoCognitiveComponent;

  if (schizoPitchAbnormality < 0.10 && schizoMotorComponent < 0.35) {
    schizophreniaScore = clamp(schizophreniaScore - 0.12);
  }
  if (
    speechFraction >= 0.60 &&
    meanUtt >= 1.05 &&
    pitchVar >= 0.18 &&
    pitchVar <= 0.42 &&
    hnr <= 2.5
  ) {
    schizophreniaScore = clamp(schizophreniaScore + 0.055);
  }
  if (
    avgPause >= 1.15 &&
    meanUtt <= 0.90 &&
    speechFraction <= 0.50 &&
    pitchVar >= 0.48
  ) {
    schizophreniaScore = clamp(schizophreniaScore * 0.58);
  }

  const pauseBurden = norm(avgPause, 0.30, 1.40) * norm(pauseRate, 0.20, 0.90);
  const adrdComponents = [
    pauseBurden,
    markerScore(markerMap, "cognitive_load_pattern"),
    markerScore(markerMap, "lexical_organization_pattern"),
  ];
  if (speechRateAvailable) {
    adrdComponents.push(invNorm(speechRate, 1.2, 2.8));
    adrdComponents.push(invNorm(typeTokenRatio, 0.35, 0.72));
  }
  let adrdScore = mean(adrdComponents);
  if (speechRateAvailable && speechRate > 2.2 && pauseRate < 0.10) {
    adrdScore = clamp(adrdScore - 0.25);
  }

  // Оценка депрессивно-связанной речи
  const depressionComponents = [
    norm(avgPause, 0.50, 1.40),
    norm(pauseRate, 0.25, 0.65),
    norm(hnr, 4.0, 12.0),
    invNorm(pitchMean, 160.0, 260.0),
    markerScore(markerMap, "cognitive_load_pattern"),
  ];
  if (speechRateAvailable) {
    depressionComponents.push(invNorm(speechRate, 1.2, 2.9));
  }
  let depressionScore = mean(depressionComponents);
  if (speechRateAvailable && speechRate > 2.2) {
    depressionScore = clamp(depressionScore - 0.12);
  }

  // Оценка болезни Паркинсона
  const parkinsonVoiceQuality = mean([
    norm(jitter, 0.04, 0.20),
    norm(shimmer, 0.08, 0.28),
    invNorm(hnr, 3.0, 10.0),
  ]);
  const parkinsonMonotony = mean([
    invNorm(pitchVar, 0.10, 0.22),
    invNorm(energyCv, 0.15, 0.45),
  ]);
  const parkinsonRateSlowing = speechRateAvailable ? invNorm(speechRate, 1.2, 2.8) : 0;
  let parkinsonScore =
    0.45 * parkinsonVoiceQuality +
    0.40 * parkinsonMonotony +
    0.15 * parkinsonRateSlowing;

  if (pitchVar > 0.30 && energyCv > 0.55) {
    parkinsonScore = clamp(parkinsonScore * 0.82);
  }
  if (markerScore(markerMap, "motor_speech_instability") > 0.65 && parkinsonMonotony > 0.45) {
    parkinsonScore = clamp(parkinsonScore + 0.05);
  }
  if (
    pitchVar < 0.14 &&
    energyCv < 0.18 &&
    parkinsonScore >= 0.60 &&
    schizoMotorComponent < 0.50
  ) {
    schizophreniaScore = clamp(schizophreniaScore * 0.55);
  }

  // Оценка синдрома Даун
  const downComponents = [
    norm(pitchMean, 170.0, 300.0),
    norm(pauseRate, 0.20, 0.70),
    invNorm(meanUtt, 0.80, 2.20),
    norm(shimmer, 0.07, 0.25),
  ];
  if (speechRateAvailable) {
    downComponents.push(invNorm(speechRate, 1.20, 2.60));
  }
  if (fillerRatio > 0) {
    downComponents.push(norm(fillerRatio, 0.02, 0.14));
  }
  downComponents.push(markerScore(markerMap, "motor_speech_instability"));
  downComponents.push(invNorm(hnr, 2.0, 10.0));
  let downSyndromeScore = mean(downComponents);

  if (speechRateAvailable && speechRate > 2.8 && meanUtt > 2.5) {
    downSyndromeScore = clamp(downSyndromeScore - 0.12);
  }
  if (
    downSyndromeScore >= 0.60 &&
    meanUtt <= 1.00 &&
    pitchVar >= 0.16 &&
    pitchVar <= 0.30 &&
    schizoMotorComponent <= 0.70
  ) {
    schizophreniaScore = clamp(schizophreniaScore * 0.72);
  }

  // Построение флагов состояний
  const flags = [
    buildFlag(
      "schizophrenia_spectrum_marker",
      "Маркер речи шизофренического спектра",
      schizophreniaScore,
      0.35,
      "moderate",
      "Флаг основан на нестабильности голосообразования, атипичной просодии и паттернах речи с повышенной когнитивной нагрузкой.",
      {
        motor_speech_instability: markerScore(markerMap, "motor_speech_instability"),
        cognitive_load_pattern: markerScore(markerMap, "cognitive_load_pattern"),
        pitch_variability: pitchVar,
        jitter_local: jitter,
        hnr_db: hnr,
      },
      ["jang2025_schizophrenia_acoustic"],
    ),
    buildFlag(
      "ad_mci_speech_marker",
      "Маркер речи AD/MCI",
      adrdScore,
      0.60,
      "moderate",
      "Флаг акцентирует динамику пауз, снижение темпа речи и особенности лексической организации.",
      {
        cognitive_load_pattern: markerScore(markerMap, "cognitive_load_pattern"),
        lexical_organization_pattern: markerScore(markerMap, "lexical_organization_pattern"),
        avg_pause_duration: avgPause,
        pause_rate: pauseRate,
        speech_rate_wps: speechRate,
        type_token_ratio: typeTokenRatio,
      },
      ["li2025_adrd_benchmark", "kent2025_adrd_pauses"],
    ),
    buildFlag(
      "depression_related_speech_marker",
      "Маркер депрессивно-связанной речи",
      depressionScore,
      0.45,
      "moderate",
      "Флаг отслеживает аффективное уплощение: просодия, паузы, темп речи.",
      {
        affective_expression_pattern: markerScore(markerMap, "affective_expression_pattern"),
        pitch_variability: pitchVar,
        energy_cv: energyCv,
        avg_pause_duration: avgPause,
        speech_rate_wps: speechRate,
      },
      ["kong2025_depression_voice"],
    ),
    buildFlag(
      "parkinsonian_speech_marker",
      "Маркер паркинсонической речи",
      parkinsonScore,
      0.62,
      "moderate",
      "Флаг опирается на признаки гипокинетической дизартрии: jitter/shimmer/HNR и монотонность.",
      {
        motor_speech_instability: markerScore(markerMap, "motor_speech_instability"),
        jitter_local: jitter,
        shimmer_local: shimmer,
        hnr_db: hnr,
        pitch_variability: pitchVar,
        speech_rate_wps: speechRate,
      },
      ["godinho2020_parkinson_voice"],
    ),
    buildFlag(
      "down_syndrome_related_speech_marker",
      "Маркер речи при синдроме Дауна",
      downSyndromeScore,
      0.56,
      "limited",
      "Исследовательский флаг по моторно-речевым и просодическим особенностям при синдроме Дауна.",
      {
        pitch_mean_hz: pitchMean,
        pitch_variability: pitchVar,
        pause_rate: pauseRate,
        speech_rate_wps: speechRate,
        filler_ratio: fillerRatio,
        motor_speech_instability: markerScore(markerMap, "motor_speech_instability"),
        hnr_db: hnr,
      },
      ["lowit2019_down_syndrome_speech", "naess2012_down_syndrome_voice"],
    ),
  ];

  const indicatorPercentages = {};
  Object.entries(markerMap).forEach(([id, score]) => {
    indicatorPercentages[`marker_${id}`] = Number((score * 100).toFixed(2));
  });
  for (let i = 0; i < flags.length; i += 1) {
    indicatorPercentages[`condition_${flags[i].id}`] = flags[i].percentage;
  }

  // Построение литературы
  const usedRefIds = [...new Set(flags.flatMap((f) => f.references))].sort();
  const literature = usedRefIds
    .filter((id) => LITERATURE[id])
    .map((id) => ({
      id,
      title: LITERATURE[id].title,
      url: LITERATURE[id].url,
      year: LITERATURE[id].year,
    }));

  return { flags, indicatorPercentages, literature };
}

// Функция для применения активных порогов
function applyActiveThresholds(flags, strictMode, strictDelta = STRICT_FLAG_THRESHOLD_DELTA) {
  return flags.map((flag) => {
    const baseThreshold = Number(flag.base_threshold ?? flag.active_threshold ?? 0.5);
    const activeThreshold = strictMode ? Math.min(1, baseThreshold + strictDelta) : baseThreshold;
    const score = Number(flag.score ?? 0);
    return {
      ...flag,
      base_threshold: Number(baseThreshold.toFixed(4)),
      active_threshold: Number(activeThreshold.toFixed(4)),
      flagged: score >= activeThreshold,
    };
  });
}

module.exports = {
  buildConditionFlags,
  applyActiveThresholds,
};
