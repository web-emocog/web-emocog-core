"use strict";

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function norm(v, lo, hi) {
  if (hi <= lo) {
    return 0;
  }
  return clamp((v - lo) / (hi - lo));
}

function invNorm(v, lo, hi) {
  return 1 - norm(v, lo, hi);
}

function level(score) {
  if (score < 0.33) {
    return "low";
  }
  if (score < 0.66) {
    return "medium";
  }
  return "high";
}

function mean(values) {
  if (!values.length) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
  }
  return sum / values.length;
}

function std(values) {
  if (!values.length) {
    return 0;
  }
  const m = mean(values);
  let acc = 0;
  for (let i = 0; i < values.length; i += 1) {
    const d = values[i] - m;
    acc += d * d;
  }
  return Math.sqrt(acc / values.length);
}

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp((p / 100) * (sorted.length - 1), 0, sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return sorted[lo];
  }
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

function concatFloat32(chunks) {
  let total = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    total += chunks[i].length;
  }
  const out = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    out.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return out;
}

function roundObjectValues(input, digits = 6) {
  const out = {};
  Object.entries(input).forEach(([k, v]) => {
    out[k] = Number(Number(v).toFixed(digits));
  });
  return out;
}

module.exports = {
  clamp,
  norm,
  invNorm,
  level,
  mean,
  std,
  percentile,
  concatFloat32,
  roundObjectValues,
};
