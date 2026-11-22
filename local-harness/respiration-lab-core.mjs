// Чистые функции стенда «Дыхание: проверка гипотез» — без DOM, проверяются в Node.
import { estimateRespirationRate } from '../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/signal/respiration.js?v=20261107-resp1';
import { removeReferenceComponent } from '../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/signal/respiration-motion.js?v=20261120-motion1';

export const WINDOW_SEC = 20, FS = 10, BAND = [0.10, 0.40];

// Ряд {t, v} (t в мс) → равномерный ряд FS Гц за последние WINDOW_SEC до tEnd.
export function resample(arr, tEnd, windowSec = WINDOW_SEC, fs = FS) {
  const tStart = tEnd - windowSec * 1000;
  const pts = arr.filter(p => p.t >= tStart - 500 && Number.isFinite(p.v));
  if (pts.length < 20 || pts[0].t > tStart + 1500) return null;
  const out = []; let j = 0;
  for (let k = 0; k < windowSec * fs; k++) {
    const t = tStart + k * 1000 / fs;
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j], b = pts[j + 1];
    if (!b || b.t - a.t > 1500) return null;
    const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
    out.push(a.v + u * (b.v - a.v));
  }
  return out;
}

export const est = (x) => x ? estimateRespirationRate(x, FS, BAND) : null;

const variance = (x) => { const m = x.reduce((s, v) => s + v, 0) / x.length; return x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length; };

// Оценка по сигналу после вычитания известной яркости экрана.
// Если экран не менялся — вычитать нечего, оценка по сигналу как есть.
export function estCorrected(signal, screen) {
  if (!signal) return null;
  if (!screen || variance(screen) < 1e-8) return { ...est(signal), corr: null };
  const c = removeReferenceComponent(signal, screen, FS, BAND, 1.0);
  if (!c) return { ...est(signal), corr: null };
  return { ...est(c.signal), corr: c.corr };
}

// Медиана оценок нескольких методов (только найденные частоты).
export function consensus(outs) {
  const v = outs.map(o => o?.bpm).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const m = v.length >> 1;
  return { bpm: v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2, conf: null, n: v.length };
}

// Расписание проб: стимул stimMs, пауза случайно в [isi0, isi1]; детерминировано по seed.
export function trialSchedule(totalMs, stimMs, isi, nImages, seed = 7) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const out = []; let t = 1000, last = -1;
  while (t < totalMs) {
    let img = Math.floor(rnd() * nImages); if (img === last) img = (img + 1) % nImages; last = img;
    out.push({ start: t, end: t + stimMs, img });
    t += stimMs + isi[0] + rnd() * (isi[1] - isi[0]);
  }
  return out;
}

// sRGB (0–255) → линейная светимость (0–1)
export function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export function hexLuminance(hex) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  const r = srgbToLinear((n >> 16) & 255), g = srgbToLinear((n >> 8) & 255), b = srgbToLinear(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
