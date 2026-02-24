export const DEFAULTS = {
  algorithm: "pos", // только  "pos" 
  useChrom: false,

  // --- Аналитическое окно для HR ---
  windowSec: 10,
  updateEveryMs: 500,

  // --- HR band (B: поднята верхняя граница) ---
  // Narrow band: 0.70–2.5 Hz (~42–150 bpm) — для трекинга
  hrBandHz: [0.70, 2.5],
  // Full band: 0.70–4.0 Hz (~42–240 bpm) — для escape/high HR
  hrBandHzFull: [0.70, 4.0],

  // --- Сэмплинг пикселей по ROI ---
  sampleStep: 3,
  minSkinRatio: 0.20,
  minSkinPixels: 250,
  minSkinPixelsFrac: 0.18,
  minTotalSamples: 55,

  // --- Публикационный гейт ---
  publish: {
    minConfidence: 0.86,
    minConfidenceProb: 0.90,
    minConfidenceAcquire: null, // минимальная вероятность уверенности для получения
    minConfidenceHold: null,
    holdBandBpm: 8, // диапазон удержания BPM
    minConfidenceProbHold: null, // минимальная вероятность уверенности для удержания
    maxDeltaFromLastBpm: null,
    deltaLimitWindowSec: 3.0, // временной интервал для ограничения дельты
    holdLastMs: 2500, // время удержания последнего значения
    minAgreement01: 0.0,
    conditionalDisable: {
      bpmLessThan: 60,
      powerAtFreqHz: 2.0,
      powerLessThan: 0.5,
    },
  },

  // Физиологический лимит скорости изменения HR
  physiology: {
    maxDeltaBpmPerSec: 20,
  },

  // Физиологический приоритет (данные, необязательный)
  physioPrior: {
    softRateBpmPerSec: 6.0,
    hardRateBpmPerSec: 15.0,
    scaleBpmPerSec: 4.0,
    minPrior: 0.20,
  },

  /// --- Авто-режим (плавная адаптация к изменениям качества) --- 
  algoAuto: {
    hysteresis: 0.04,
    usePqiComparison: true,
    posPqiBoost: 0.0,
    chromPqiPenalty: 1.0, // штраф за использование CHROM
  },

  // Harmonic disambiguation (настройки для spectrum.js)
  chromRawScoreWeights: { p2: 0.35, pHalf: 0.08 },
  // SAFE: понижены пороги для POS, чтобы дать ему больше шансов при слабом сигнале (особенно в сочетании с усиленным учётом skinPixels)
  posRawScoreWeights: { p2: 0.15, pHalf: 0.05 },

  // Двойное окно
  dualWindow: {
    shortSec: 10,
    longSec: 18,
    agreeDeltaBpm: 5.0,
    minConfidenceShortOnly: 0.70,
    minConfidenceLongOnly: 0.63,
  },

  // Сглаживание прямоугольников
  rectSmoothing: {
    alphaMin: 0.18,
    alphaMax: 0.62,
  },

  // ROI веса (E: усилен учёт skinPixels) 
  roiWeights: {
    forehead: { base: 0.20, min: 0.06, max: 0.30 },
    cheekL:   { base: 0.20, min: 0.12, max: 0.45 },
    cheekR:   { base: 0.20, min: 0.12, max: 0.45 },
    // infra удалены: движение нижнего века даёт артефакты
    neck:     { base: 0.20, min: 0.03, max: 0.30 },
  },

  roiPrior: {
    forehead: 0.98,
    cheekL: 1.00,
    cheekR: 1.00,
    neck: 1.00,
  },

  // Sampling overrides для сложных ROI
  roiSamplingOverrides: {
    cheekL: { minSkinRatio: 0.10, minSkinPixels: 140, minSkinPixelsFrac: 0.10, sampleStep: 2 },
    cheekR: { minSkinRatio: 0.10, minSkinPixels: 140, minSkinPixelsFrac: 0.10, sampleStep: 2 },
    neck:   { minSkinRatio: 0.10, minSkinPixels: 120, minSkinPixelsFrac: 0.10, sampleStep: 2 },
  },

  // Фильтрация бликов
  specularFilter: {
    enabled: true,
    lumaMax: 210,   // максимальная яркость для пикселей
    satMin: 18,     // низкая насыщенность + высокая яркость => блик
  },
  specularPenalty: {
    ratioThreshold: 0.02,
    minFactor: 0.85,
  },

  // Экспозиционная стабильность
  exposure: {
    lumaMeanMin: 40,
    lumaMeanMax: 210,
    lumaStdMax: 60,
    penalty: 0.70,
  },

  // Весовая динамика
  gamma: 1.6,

  // Целевая частота дискретизации
  targetFs: 30,
  minSamplesForWindow: 120,

  // Оценка дыхания (низкочастотная)
  respiration: {
    windowSec: 20,
    bandHz: [0.10, 0.40], // ~6–24 breaths/min
    targetFs: 10,
    minSamples: 80,
    minConfForCoupling: 0.20,
    couplingWeight: 0.25,
  },

  // Сглаживание BPM
  bpmSmoothing: {
    historySize: 6,
    maxJumpBpm: 20,
    minConfidenceForJump: 0.60,
    escape: {
      ratioMin: 1.25, // новый BPM должен быть на 25% выше, чтобы разрешить прыжок
      snrDbMin: 5,
      peakRatioMin: 1.3,
    },
  },

  // Трекинг
  tracking: {
    rangeBpm: 60,
    fallbackSNR: 0.25, // запасное значение SNR
    escapeRatio: 1.12,
    escapeMinPeak01: 0.30, // минимальный пик для побега
    escapeConfirm: 1,
    switchMarginScore: 0.06, // маржа переключения
    minSwitchBpm: 12, // минимальный переключаемый BPM
    preferBpmRange: null,
    preferBoost: 1.15, // предпочтительное усиление
    continuityStrength: 0.60, // сила непрерывности
    fullContinuityStrength: 0.35, // полная сила непрерывности
    fullBandMinPrevBpm: 85,
    fullBandMinRatio: 0.60,
    highHrEscape: { // настройки для побега на высокой частоте
      minBpm: 100,
      lowToHighRatioMax: 0.85,
      scoreMinRatio: 0.50,
      peakMin: 0.18,
    },
    // Продвижение низкого кандидата в полный пик, если он выглядит правдоподобно.
    lowCandidatePromote: {
      maxCandidateBpm: 80,
      minFullBpm: 90,
      minScoreRatio: 0.45,
      minPeak01: 0.20,
      minSignal01: 0.45,
    },
  },

  // Пороги "слабого пика"
  peakSelect: {
    weakPeakRatio: 1.35,
    weakPeak01: 0.55,
    weakSignal01: 0.60,
    weakPickMinRawFrac: 0.75,
  },

  // Согласование между POS и CHROM
  agreement: {
    softDeltaBpm: 5.0,
    hardDeltaBpm: 15.0,
    hardPenalty: 0.72,
  },

  // Непрерывность
  continuity: {
    softDeltaBpm: 8.0,
    falloffBpm: 18.0,
  },

  // Составление уверенности (спектральная + правдоподобие)
  confidence: {
    spectralWeights: { signal: 0.55, peak: 0.15, ac: 0.10, quality: 0.20 },
    continuityWeight: 0.22,
    agreementWeight: 0.24,
    motionWeight: 0.25,
    motionFloor: 0.45, // минимальный уровень движения
    priorBlendSafe: 0.20, // безопасное смешивание приоритета
  },

  // SAFE publication gate (report-oriented, "trustworthy")
  safeGate: {
    // порог уверенности для публикации (требуем более высокую уверенность для публикации, чтобы компенсировать более низкие пороги качества)
    nsqiMin: 0.275,
    nsqiMax: 0.450,
    minAgreement01: null,
    // ВАЖНО: непрерывность может быть низкой во время реальных изменений ЧСС (например, 120–130),
    // поэтому мы НЕ ограничиваем публикацию по непрерывности в режиме SAFE.
    minContinuity01: null,
    maxMotionAvg: 0.006,
    maxLumaDeltaAvg: 12.0,
    minLumaMeanAvg: 40,
    maxLumaMeanAvg: 210,
    maxLumaStdAvg: 60,
    maxSpecularRatioAvg: 0.04,
    minSkinPixelsAvg: 120,
    maxClippedRatioAvg: 0.18,
  },

  // --- SAFE publication gate (report-oriented, "trustworthy") ---
  safePublishGate: {
    confidenceMin: 0.45,
    snrDbMin: 5.5,
    agreementDeltaMax: 12,
    pqiMin: 0.55,
    std3Max: 2,
    maxStepMax: 3.5,
    requiredStreak: 3,
    agreementChromPqiMin: 0.55,
    agreementChromSnrDbMin: 4.0,
    upshift: {
      ratioMax: 1.12,
      snrDbMin: 8.0,
      peakRatioMin: 1.8,
      signal01Min: 0.55,
      confidenceMin: 0.60,
      pqiMin: 0.70,
    },
    halfFreq: { // настройки для полуволновой частоты
      ratioThreshold: 0.65,
      maxBpmDiff: 6,
      minScoreRatio: 0.85,
      lowBpmThreshold: 75,
      snrDbMin: 5,
      minPeakRatio: 1.25,
      minSignal01: 0.40,
    },
    downshift: { // настройки для понижения частоты
      ratioMin: 0.88,
      snrDbMin: 7,
      peakRatioMin: 1.6,
      signal01Min: 0.55,
    },
    respCoupling: { // настройки для связи с респираторным сигналом
      enabled: true,
      minRespConf: 0.20,
      minCoupling01: 0.20,
      ratioMax: 0.80,
    },
    // блокировка субгармоников
    subharmonicBlock: {
      enabled: true,
      ratioMax: 0.72,
      minAltBpm: 90,
      minAltScoreRatio: 0.40,
      minAltPowerRatio: 0.25,
      maxAltSnrDrop: 0.12,
    },
  },

  // --- (E) Штраф за автоподстройки камеры (быстрые изменения lumaMean) ---
  lumaChange: {
    // если |lumaMean - prevLumaMean| > threshold, штрафуем качество ROI
    threshold: 12,
    penalty: 0.7,  // множитель качества при резком изменении
    emaAlpha: 0.15, // EMA для отслеживания lumaMean
  },

  // --- (E) Усиленный учёт skinPixels ---
  skinPixelsWeight: {
    // минимум пикселей для полного качества
    minForFullQuality: 300,
    // ниже этого значения — сильный штраф
    criticalMin: 80,
    // вес в формуле качества (увеличен)
    qualityWeight: 0.12,
  },

  // --- (C) Harmonic disambiguation (настройки для spectrum.js) ---
  harmonic: {
    // если новый bpm < prevPub * ratioThreshold и пик не супер-выраженный,
    // проверяем кандидата 2× и выбираем если он "почти не хуже"
    ratioThreshold: 0.85,
    doubleCheckMinPeakRatio: 0.45,  // минимальный peakRatio для принятия удвоенной частоты
    doubleCheckScoreMargin: 0.18,   // допустимая разница в rawScore
    rescueLowMaxBpm: 75, // rescue на старте, когда prevPubBpm ещё нет
    rescueMinDoubleBpm: 70,
    rescueMinScoreRatio: 0.40,
    rescueMaxSnrDrop: 0.18,
    // для повышения от слабого пика до доминантного, требуем более высокие метрики для 2×, чтобы избежать прыжков на субгармоники
    up2DominanceRatio: 1.15,
    up2MinSnrMargin: 0.02,
    up2PeakRatioMax: 3.0,
    up2LowBpmMax: 80,
    // для продвижения низкого кандидата в полный пик, если он выглядит правдоподобно
    halfMinPowerRatio: 1.25,
    halfMinSnrMargin: 0.12,
    // для блокировки субгармоников, если они выглядят подозрительно
    subGuardMaxBpm: 80,
    subGuardMinDoubleBpm: 90,
    subGuardMinScoreRatio: 0.45,
    subGuardMinPowerRatio: 0.30,
    subGuardMaxSnrDrop: 0.12,
    subGuardPrevRatioMax: 0.72,
  },

  // --- SAFE-only режим ---
  modes: {
    safe: {
      tracking: {
        // Узкий трекинг, чтобы не уезжать в субгармонику
        rangeBpm: 30,
      },
    },
  },
};
