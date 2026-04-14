"use strict";

const { concatFloat32, percentile } = require("./utils");

// Преобразование AudioBuffer в моно
function toMonoFromAudioBuffer(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  if (channels === 1) {
    mono.set(audioBuffer.getChannelData(0));
    return mono;
  }
  for (let ch = 0; ch < channels; ch += 1) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i += 1) {
      mono[i] += channelData[i];
    }
  }
  const scale = 1 / channels;
  for (let i = 0; i < length; i += 1) {
    mono[i] *= scale;
  }
  return mono;
}

// Функция для преобразования сэмплов в Float32Array
function toFloat32Array(samples) {
  if (samples instanceof Float32Array) {
    return samples;
  }
  if (ArrayBuffer.isView(samples)) {
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      out[i] = Number(samples[i]);
    }
    return out;
  }
  if (Array.isArray(samples)) {
    return Float32Array.from(samples);
  }
  throw new Error("Ожидается массив сэмплов (Float32Array/TypedArray/Array).");
}

// Функция для линейной интерполяции сэмплов
function resampleLinear(samples, inputSampleRate, targetRate = 16000) {
  const src = toFloat32Array(samples);
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error("sample_rate должен быть положительным числом.");
  }
  if (inputSampleRate === targetRate) {
    return { samples: src, sampleRate: targetRate };
  }
  const ratio = targetRate / inputSampleRate;
  const outLength = Math.max(1, Math.floor(src.length * ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i / ratio;
    const lo = Math.floor(srcIndex);
    const hi = Math.min(lo + 1, src.length - 1);
    const t = srcIndex - lo;
    out[i] = src[lo] * (1 - t) + src[hi] * t;
  }
  return { samples: out, sampleRate: targetRate };
}

// Функция для нормализации сэмплов
function normalizeSamples(samples) {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i]);
    if (a > maxAbs) {
      maxAbs = a;
    }
  }
  if (maxAbs < 1e-8) {
    return samples;
  }
  const scale = 1 / maxAbs;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = samples[i] * scale;
  }
  return out;
}

// Функция для вычисления RMS (среднеквадратичного значения) в кадрах
function computeFrameRms(samples, frameLength, hopLength) {
  if (samples.length < frameLength) {
    return [];
  }
  const values = [];
  for (let start = 0; start + frameLength <= samples.length; start += hopLength) {
    let sumSq = 0;
    for (let i = start; i < start + frameLength; i += 1) {
      const s = samples[i];
      sumSq += s * s;
    }
    values.push(Math.sqrt(sumSq / frameLength));
  }
  return values;
}

// Функция для вычисления ZCR (коэффициента пересечения нуля) в кадрах
function computeFrameZcr(samples, frameLength, hopLength) {
  if (samples.length < frameLength) {
    return [];
  }
  const values = [];
  for (let start = 0; start + frameLength <= samples.length; start += hopLength) {
    let crossings = 0;
    for (let i = start + 1; i < start + frameLength; i += 1) {
      const a = samples[i - 1];
      const b = samples[i];
      if ((a >= 0 && b < 0) || (a < 0 && b >= 0)) {
        crossings += 1;
      }
    }
    values.push(crossings / frameLength);
  }
  return values;
}

// Функция для обнаружения речевых сегментов
function detectSpeechSegments(samples, sampleRate, topDb = 30, minSpeechSec = 0.15) {
  const frameLength = Math.max(256, Math.round(sampleRate * 0.03));
  const hopLength = Math.max(128, Math.round(sampleRate * 0.015));
  const rms = computeFrameRms(samples, frameLength, hopLength);
  if (!rms.length) {
    return [];
  }

  const noiseFloor = percentile(rms, 35);
  const medianRms = percentile(rms, 50);
  const peakRms = percentile(rms, 95);
  const threshold = Math.max(noiseFloor * (1 + topDb / 60), medianRms * 1.5, peakRms * 0.08, 0.004);

  const minSpeechSamples = Math.round(minSpeechSec * sampleRate);
  const frameFlags = rms.map((v) => v >= threshold);

  const segments = [];
  let activeStart = -1;
  for (let i = 0; i < frameFlags.length; i += 1) {
    if (frameFlags[i] && activeStart < 0) {
      activeStart = i;
    }
    if (!frameFlags[i] && activeStart >= 0) {
      const startSample = activeStart * hopLength;
      const endSample = Math.min(samples.length, i * hopLength + frameLength);
      if (endSample - startSample >= minSpeechSamples) {
        segments.push([startSample / sampleRate, endSample / sampleRate]);
      }
      activeStart = -1;
    }
  }
  if (activeStart >= 0) {
    const startSample = activeStart * hopLength;
    const endSample = samples.length;
    if (endSample - startSample >= minSpeechSamples) {
      segments.push([startSample / sampleRate, endSample / sampleRate]);
    }
  }

  if (!segments.length) {
    return [];
  }

  const merged = []; // Объединенные сегменты
  let cur = [...segments[0]];
  for (let i = 1; i < segments.length; i += 1) {
    const next = segments[i];
    if (next[0] - cur[1] <= 0.08) {
      cur[1] = next[1];
    } else {
      merged.push(cur);
      cur = [...next];
    }
  }
  merged.push(cur);
  return merged;
}

// Функция для сбора озвученных сэмплов
function collectVoicedSamples(samples, speechSegments, sampleRate) {
  if (!speechSegments.length) {
    return samples;
  }
  const chunks = [];
  for (let i = 0; i < speechSegments.length; i += 1) {
    const [startSec, endSec] = speechSegments[i];
    const start = Math.max(0, Math.floor(startSec * sampleRate));
    const end = Math.min(samples.length, Math.ceil(endSec * sampleRate));
    if (end > start) {
      chunks.push(samples.slice(start, end));
    }
  }
  return chunks.length ? concatFloat32(chunks) : samples;
}

// Функция для обрезки сэмплов по максимальной длительности
function truncateSamples(samples, sampleRate, maxDurationSec) {
  const originalDurationSec = samples.length / sampleRate;
  if (!maxDurationSec || maxDurationSec <= 0) {
    return {
      samples,
      durationSec: originalDurationSec,
      originalDurationSec,
      wasTruncated: false,
    };
  }
  const maxSamples = Math.floor(maxDurationSec * sampleRate);
  if (samples.length <= maxSamples) {
    return {
      samples,
      durationSec: originalDurationSec,
      originalDurationSec,
      wasTruncated: false,
    };
  }
  return {
    samples: samples.slice(0, maxSamples),
    durationSec: maxSamples / sampleRate,
    originalDurationSec,
    wasTruncated: true,
  };
}

function prepareFromRawSamples(samples, sampleRate, maxDurationSec) {
  const input = toFloat32Array(samples);
  const resampled = resampleLinear(input, Number(sampleRate), 16000);
  const normalized = normalizeSamples(resampled.samples);
  const truncated = truncateSamples(normalized, resampled.sampleRate, maxDurationSec);
  return {
    samples: truncated.samples,
    sampleRate: resampled.sampleRate,
    durationSec: truncated.durationSec,
    originalDurationSec: truncated.originalDurationSec,
    wasTruncated: truncated.wasTruncated,
  };
}

// Функция для декодирования и подготовки ArrayBuffer в браузере
async function decodeAndPrepareArrayBufferBrowser(arrayBuffer, maxDurationSec) {
  if (typeof window === "undefined") {
    throw new Error("decodeAndPrepareArrayBufferBrowser доступна только в браузере.");
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("WebAudio API не поддерживается в этом браузере.");
  }
  const audioCtx = new AudioContextCtor();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const mono = toMonoFromAudioBuffer(decoded);
    const resampled = resampleLinear(mono, decoded.sampleRate, 16000);
    const normalized = normalizeSamples(resampled.samples);
    const truncated = truncateSamples(normalized, resampled.sampleRate, maxDurationSec);
    return {
      samples: truncated.samples,
      sampleRate: resampled.sampleRate,
      durationSec: truncated.durationSec,
      originalDurationSec: truncated.originalDurationSec,
      wasTruncated: truncated.wasTruncated,
    };
  } finally {
    await audioCtx.close();
  }
}

// Функция для анализа аудиофайлов в браузере
async function decodeAndPrepareAudioBrowser(file, maxDurationSec) {
  const arrayBuffer = await file.arrayBuffer();
  return decodeAndPrepareArrayBufferBrowser(arrayBuffer, maxDurationSec);
}

module.exports = {
  toMonoFromAudioBuffer,
  toFloat32Array,
  resampleLinear,
  normalizeSamples,
  computeFrameRms,
  computeFrameZcr,
  detectSpeechSegments,
  collectVoicedSamples,
  truncateSamples,
  prepareFromRawSamples,
  decodeAndPrepareArrayBufferBrowser,
  decodeAndPrepareAudioBrowser,
};
