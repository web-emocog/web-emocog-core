"use strict";

const { clamp, mean, percentile, std } = require("./utils");
const { computeFrameRms, computeFrameZcr } = require("./audio");

function estimatePitchFeatures(signal, sampleRate) {
  // Быстрая оценка pitch на нулевых пересечениях для low-resource режима.
  if (signal.length < 4) {
    return { pitchMean: 0, pitchStd: 0, pitchVariability: 0, jitterLocal: 0, hnrDb: 0 };
  }

  const diff = new Float32Array(signal.length);
  diff[0] = 0;
  for (let i = 1; i < signal.length; i += 1) {
    diff[i] = signal[i] - signal[i - 1];
  }
  // Поиск нулевых пересечений
  const crossings = [];
  for (let i = 1; i < diff.length; i += 1) {
    if (diff[i - 1] <= 0 && diff[i] > 0) {
      crossings.push(i);
    }
  }
  if (crossings.length < 4) {
    return { pitchMean: 0, pitchStd: 0, pitchVariability: 0, jitterLocal: 0, hnrDb: 0 };
  }

  const periods = []; // Массив для хранения периодов
  for (let i = 1; i < crossings.length; i += 1) {
    const p = crossings[i] - crossings[i - 1];
    if (p <= 0) {
      continue;
    }
    const f0 = sampleRate / p;
    if (f0 >= 50 && f0 <= 350) {
      periods.push(p);
    }
  }

  if (periods.length < 8) {
    return { pitchMean: 0, pitchStd: 0, pitchVariability: 0, jitterLocal: 0, hnrDb: 0 };
  }

  const lo = percentile(periods, 10);
  const hi = percentile(periods, 90);
  const clippedPeriods = periods.filter((p) => p >= lo && p <= hi); // Обрезанные периоды
  if (clippedPeriods.length < 8) {  // Если обрезанных периодов меньше 8
    return { pitchMean: 0, pitchStd: 0, pitchVariability: 0, jitterLocal: 0, hnrDb: 0 };
  }

  const f0Values = clippedPeriods.map((p) => sampleRate / p); // Частоты фундамента
  const pitchMean = mean(f0Values); // Средняя частота фундамента
  const pitchStd = std(f0Values); // Стандартное отклонение частоты фундамента
  const pitchVariability = pitchMean > 0 ? pitchStd / pitchMean : 0; // Изменчивость частоты

  const relDiff = []; // Относительные изменения
  for (let i = 1; i < clippedPeriods.length; i += 1) {
    const prev = clippedPeriods[i - 1];
    const cur = clippedPeriods[i];
    relDiff.push(Math.abs(cur - prev) / Math.max(prev, 1e-8)); 
  }
  const jitterLocal = relDiff.length ? mean(relDiff) : 0;

  const medianPeriod = Math.round(percentile(clippedPeriods, 50)); // Медианный период
  let corr = 0;
  let energy = 0;
  for (let i = 0; i + medianPeriod < signal.length; i += 1) {
    corr += signal[i] * signal[i + medianPeriod];
    energy += signal[i] * signal[i];
  }
  const r = clamp(corr / (energy + 1e-8), 0, 0.99); // Коэффициент корреляции
  const hnrDb = 10 * Math.log10((r + 1e-8) / Math.max(1 - r, 1e-8)); // Отношение шум/сигнал

  return { pitchMean, pitchStd, pitchVariability, jitterLocal, hnrDb };
}

function extractAcousticFeatures(samples, voicedSamples, sampleRate) { // выделенные голосовые фреймы используем их для оценки pitch
  const signal = voicedSamples.length ? voicedSamples : samples;

  const frameLength = 512;
  const hopLength = 256;
  const rms = computeFrameRms(samples, frameLength, hopLength);
  const rmsVoiced = computeFrameRms(signal, frameLength, hopLength);
  const zcr = computeFrameZcr(samples, frameLength, hopLength);

  const { pitchMean, pitchStd, pitchVariability, jitterLocal, hnrDb } = estimatePitchFeatures(signal, sampleRate);
  // Оценка шиммера
  let shimmerLocal = 0;
  if (rmsVoiced.length > 8) {
    const floor = percentile(rmsVoiced, 25);
    const amps = rmsVoiced.filter((v) => v >= floor);
    if (amps.length > 8) {
      const rel = [];
      for (let i = 1; i < amps.length; i += 1) {
        rel.push(Math.abs(amps[i] - amps[i - 1]) / Math.max(amps[i - 1], 1e-8));
      }
      if (rel.length > 3) {
        const upper = percentile(rel, 90);
        const clipped = rel.filter((v) => v <= upper);
        shimmerLocal = clipped.length ? mean(clipped) : 0;
      }
    }
  }
  // Оценка отношения энергии
  const energyCv = rmsVoiced.length ? std(rmsVoiced) / (mean(rmsVoiced) + 1e-8) : 0;

  const features = {
    rms_mean: mean(rms),
    rms_std: std(rms),
    energy_cv: energyCv,
    zcr_mean: mean(zcr),
    spectral_centroid_mean: 0,
    spectral_centroid_std: 0,
    pitch_mean_hz: pitchMean,
    pitch_std_hz: pitchStd,
    pitch_variability: pitchVariability,
    jitter_local: jitterLocal,
    shimmer_local: shimmerLocal,
    hnr_db: hnrDb,
  };

  // Совместимость формата отчёта: оставляем нулевые MFCC-ключи.
  for (let i = 0; i < 13; i += 1) {
    features[`mfcc_${i}_mean`] = 0;
    features[`mfcc_${i}_std`] = 0;
  }

  return features;
}

// Функция для извлечения признаков пауз
function extractPauseFeatures(durationSec, speechSegments, minPauseSec = 0.2) {
  if (durationSec <= 0) {
    return {
      speech_fraction: 0,
      pause_rate: 0,
      avg_pause_duration: 0,
      max_pause_duration: 0,
      num_pauses: 0,
      mean_utterance_duration: 0,
    };
  }

  let speechTotal = 0;
  for (let i = 0; i < speechSegments.length; i += 1) {
    speechTotal += Math.max(0, speechSegments[i][1] - speechSegments[i][0]);
  }

  const pauses = [];
  let prevEnd = 0;
  for (let i = 0; i < speechSegments.length; i += 1) {
    const [start, end] = speechSegments[i];
    const gap = Math.max(0, start - prevEnd);
    if (gap >= minPauseSec) {
      pauses.push(gap);
    }
    prevEnd = Math.max(prevEnd, end);
  }
  const tailGap = Math.max(0, durationSec - prevEnd); // Задержка в конце
  if (tailGap >= minPauseSec) {
    pauses.push(tailGap);
  }

  const pauseRate = pauses.length / durationSec;
  const avgPause = pauses.length ? mean(pauses) : 0;
  const maxPause = pauses.length ? Math.max(...pauses) : 0;
  const meanUtt = speechSegments.length ? speechTotal / speechSegments.length : 0;

  return {
    speech_fraction: Math.min(speechTotal / durationSec, 1),
    pause_rate: pauseRate,
    avg_pause_duration: avgPause,
    max_pause_duration: maxPause,
    num_pauses: pauses.length,
    mean_utterance_duration: meanUtt,
  };
}

module.exports = { // Экспортируем функции для использования в других модулях
  estimatePitchFeatures,
  extractAcousticFeatures,
  extractPauseFeatures,
};
