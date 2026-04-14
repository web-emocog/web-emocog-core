"use strict";

const { clamp, invNorm, mean, norm } = require("./utils");

// Функция для построения маски речи
function buildSpeechMask(nSamples, speechSegments, sampleRate) {
  const mask = new Uint8Array(nSamples);
  for (let i = 0; i < speechSegments.length; i += 1) {
    const [startSec, endSec] = speechSegments[i];
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const end = Math.min(nSamples, Math.ceil(endSec * sampleRate));
    for (let j = start; j < end; j += 1) {
      mask[j] = 1;
    }
  }
  return mask;
}

// Функция для оценки качества аудио
function evaluateQuality(samples, sampleRate, durationSec, speechFraction, speechSegments, transcriptWordCount) {
  if (!samples.length || sampleRate <= 0 || durationSec <= 0) {
    return {
      score: 0,
      is_ood: true,
      duration_sec: Math.max(durationSec, 0),
      speech_fraction: Math.max(speechFraction, 0),
      clipping_ratio: 0,
      snr_proxy_db: 0,
      transcript_word_count: Math.max(transcriptWordCount, 0),
      warnings: ["Невозможно оценить качество: входное аудио пустое."],
    };
  }

  let clipped = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) >= 0.98) {
      clipped += 1;
    }
  }
  const clippingRatio = clipped / samples.length;
  // Построение маски речи
  const speechMask = buildSpeechMask(samples.length, speechSegments, sampleRate);
  let speechEnergyAcc = 0;
  let speechCount = 0;
  let noiseEnergyAcc = 0;
  let noiseCount = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const e = samples[i] * samples[i];
    if (speechMask[i]) {
      speechEnergyAcc += e;
      speechCount += 1;
    } else {
      noiseEnergyAcc += e;
      noiseCount += 1;
    }
  }

  const speechEnergy = speechCount ? speechEnergyAcc / speechCount : mean(samples.map((s) => s * s));
  const noiseEnergy = noiseCount ? noiseEnergyAcc / noiseCount : speechEnergy * 0.35 + 1e-8;
  const snrProxyDb = 10 * Math.log10((speechEnergy + 1e-8) / (noiseEnergy + 1e-8));

  const durationComponent = norm(durationSec, 8, 90);
  const speechComponent = norm(speechFraction, 0.15, 0.9);
  const clippingComponent = invNorm(clippingRatio, 0.005, 0.10);
  const snrComponent = norm(snrProxyDb, 3, 24);
  const textComponent = transcriptWordCount <= 0 ? 0.5 : norm(transcriptWordCount, 8, 180);

  const score = clamp(mean([durationComponent, speechComponent, clippingComponent, snrComponent, textComponent]));

  const warnings = [];
  if (durationSec < 8) warnings.push("Короткая запись может снижать устойчивость маркеров.");
  if (speechFraction < 0.15) warnings.push("Обнаружена очень низкая доля речи.");
  if (clippingRatio > 0.05) warnings.push("Обнаружены сильные клиппинг-искажения.");
  if (snrProxyDb < 3) warnings.push("Низкий SNR proxy; фоновый шум может снижать надёжность.");
  if (transcriptWordCount > 0 && transcriptWordCount < 8) warnings.push("Низкое покрытие транскриптом; лексические маркеры слабые.");

  const isOod = durationSec < 3 || speechFraction < 0.08 || clippingRatio > 0.15 || snrProxyDb < -2;

  return {
    score: Number(score.toFixed(6)),
    is_ood: Boolean(isOod),
    duration_sec: Number(durationSec.toFixed(6)),
    speech_fraction: Number(speechFraction.toFixed(6)),
    clipping_ratio: Number(clippingRatio.toFixed(6)),
    snr_proxy_db: Number(snrProxyDb.toFixed(6)),
    transcript_word_count: Number(transcriptWordCount.toFixed(6)),
    warnings,
  };
}

module.exports = {
  evaluateQuality,
};
