// respiration-motion.js — частота дыхания по движению головы и плеч (экспериментальный метод).
//
// Зачем: прежний метод (respiration_luma.log_peak.v2) ищет дыхание в колебаниях
// яркости кожи. Смена стимулов на экране меняет яркость кожи сильнее дыхания,
// и метод выдаёт ритм проб вместо дыхания (#146). Здесь дыхание ищется в
// движении: вертикальное смещение переносицы, наклон головы и подъём плеч.
//
// Три независимые оценки, итог — медиана:
//   bridge — вертикаль переносицы в долях высоты лица (без поправки);
//   pitch  — наклон головы (нос между лбом и подбородком) после вычитания
//            составляющей, общей с яркостью щёк;
//   third  — подъём плеч (если в кадре и включён модуль корпуса), иначе
//            масштаб лица; тоже после вычитания яркости щёк.
// Яркость щёк используется как замена известной яркости экрана: модели точек
// чуть смещают найденные точки при смене яркости кадра, и эту общую часть
// мы вычитаем. Публикуется, только если хотя бы две оценки из трёх совпали
// в пределах ±2 вдоха/мин.
//
// Ограничения: метод выбран по стенду с дыханием под метроном (один человек,
// один ноутбук, ноябрь 2026); против дыхательного пояса НЕ валидирован.
// Разговор, кивки и смена позы дают ложные пики — оценки в такие моменты
// часто расходятся и не публикуются, но не всегда.

import { clamp } from "../utils.js";
import { Biquad } from "./Biquad.js";
import { estimateRespirationRate } from "./respiration.js?v=20261107-resp1";

export const MOTION_RESPIRATION_METHOD_VERSION = "respiration_motion.consensus.v1";

const DEFAULTS = Object.freeze({
  windowSec: 20,
  fs: 10,
  bandHz: [0.10, 0.40],
  updateEveryMs: 1000,
  agreeBpm: 2.0,
  minAgreeing: 2,
  maxGapMs: 1500,
  maxLagSec: 1.0,
  shoulderMinVisibility: 0.5,
});

const finite = (v) => typeof v === "number" && Number.isFinite(v);

// Рамка лица по нормированным landmarks → пиксели.
export function faceBox(landmarks, W, H) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of landmarks || []) {
    if (!p || !finite(p.x) || !finite(p.y)) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (!finite(x0) || x1 <= x0 || y1 <= y0) return null;
  return { x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H };
}

// Средняя яркость (BT.601) двух областей щёк; пересвеченные и чёрные пиксели исключаются.
export function cheekLuma(imageData, W, H, box) {
  const d = imageData?.data;
  if (!d || !box) return null;
  let s = 0, n = 0;
  for (const [fx0, fx1] of [[0.2, 0.4], [0.6, 0.8]]) {
    const xa = Math.max(0, Math.floor(box.x + fx0 * box.w)), xb = Math.min(W, Math.floor(box.x + fx1 * box.w));
    const ya = Math.max(0, Math.floor(box.y + 0.45 * box.h)), yb = Math.min(H, Math.floor(box.y + 0.65 * box.h));
    for (let y = ya; y < yb; y += 2) {
      for (let x = xa; x < xb; x += 2) {
        const i = (y * W + x) * 4;
        const Y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (Y > 3 && Y < 250) { s += Y; n++; }
      }
    }
  }
  return n > 50 ? s / n : null;
}

// Признаки движения головы по сетке MediaPipe Face Mesh (468/478 точек).
export function headMotionFeatures(lm) {
  if (!Array.isArray(lm) || lm.length < 468) return null;
  const top = lm[10], chin = lm[152], nose = lm[1], eyeL = lm[33], eyeR = lm[263];
  if (![top, chin, nose, eyeL, eyeR].every(p => p && finite(p.x) && finite(p.y))) return null;
  const faceH = Math.hypot(chin.x - top.x, chin.y - top.y);
  const span = chin.y - top.y;
  if (!(faceH > 1e-4) || !(span > 1e-4)) return null;
  const bridge = [6, 168, 197, 195].reduce((s, i) => s + (lm[i]?.y ?? NaN), 0) / 4;
  const out = {
    bridge: bridge / faceH,                      // вертикаль переносицы, доля высоты лица
    pitch: (nose.y - top.y) / span,              // наклон головы
    scale: Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y), // масштаб лица
  };
  return Object.values(out).every(finite) ? out : null;
}

// Ряд {t, v} → равномерный ряд fs Гц за последние windowSec до tEnd; null, если данных мало.
export function resampleWindow(points, tEnd, { windowSec, fs, maxGapMs }) {
  const tStart = tEnd - windowSec * 1000;
  let j = 0;
  while (j < points.length && points[j].t < tStart - 500) j++;
  const pts = points.slice(j);
  if (pts.length < 20 || pts[0].t > tStart + maxGapMs) return null;
  const n = Math.round(windowSec * fs);
  const out = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = tStart + i * 1000 / fs;
    while (k < pts.length - 2 && pts[k + 1].t < t) k++;
    const a = pts[k], b = pts[k + 1];
    if (!b || b.t - a.t > maxGapMs) return null;
    const u = clamp((t - a.t) / (b.t - a.t), 0, 1);
    out[i] = a.v + u * (b.v - a.v);
  }
  return out;
}

function bandpass(signal, fs, bandHz) {
  const lo = Math.max(0.02, bandHz[0] * 0.5);
  const hi = Math.min(fs * 0.45, bandHz[1] * 1.5);
  const hp1 = new Biquad("highpass", fs, lo, 0.707), hp2 = new Biquad("highpass", fs, lo, 0.707);
  const lp1 = new Biquad("lowpass", fs, hi, 0.707), lp2 = new Biquad("lowpass", fs, hi, 0.707);
  const m = signal.reduce((s, v) => s + v, 0) / Math.max(1, signal.length);
  return signal.map(v => lp2.process(lp1.process(hp2.process(hp1.process(v - m)))));
}

function lagStats(a, b, lag, skip) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let i = skip; i < a.length; i++) {
    const j = i - lag;
    if (j < skip || j >= b.length) continue;
    sa += a[i]; sb += b[j]; saa += a[i] * a[i]; sbb += b[j] * b[j]; sab += a[i] * b[j]; n++;
  }
  if (n < 10) return null;
  const cov = sab / n - (sa / n) * (sb / n);
  const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  if (!(va > 1e-12) || !(vb > 1e-12)) return null;
  return { corr: cov / Math.sqrt(va * vb), beta: cov / vb };
}

// Вычитает из signal составляющую, общую с reference (поиск сдвига ±maxLagSec, регрессия
// в полосе дыхания). Если опора плоская — возвращает null (вычитать нечего).
export function removeReferenceComponent(signal, reference, fs, bandHz, maxLagSec = 1.0) {
  const n = Math.min(signal?.length ?? 0, reference?.length ?? 0);
  if (n < 20) return null;
  const a = signal.slice(signal.length - n), b = reference.slice(reference.length - n);
  const fa = bandpass(a, fs, bandHz), fb = bandpass(b, fs, bandHz);
  const skip = Math.min(Math.floor(n / 4), Math.round(fs * 2));
  const maxLag = Math.round(maxLagSec * fs);
  let best = null;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const s = lagStats(fa, fb, lag, skip);
    if (s && (!best || Math.abs(s.corr) > Math.abs(best.corr))) best = { ...s, lag };
  }
  if (!best) return null;
  return {
    signal: a.map((v, i) => v - best.beta * b[clamp(i - best.lag, 0, n - 1)]),
    corr: best.corr, lag: best.lag,
  };
}

function median(values) {
  const v = values.filter(finite).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export class MotionRespirationEstimator {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.series = { bridge: [], pitch: [], scale: [], luma: [], shoulders: [] };
    this.lastEstimateAt = -Infinity;
    this.last = null;
  }

  reset() {
    for (const k of Object.keys(this.series)) this.series[k] = [];
    this.lastEstimateAt = -Infinity;
    this.last = null;
  }

  _push(key, t, v) {
    if (!finite(t) || !finite(v)) return;
    const arr = this.series[key];
    if (arr.length && t <= arr[arr.length - 1].t) return;
    arr.push({ t, v });
    const keepFrom = t - (this.cfg.windowSec + 5) * 1000;
    let drop = 0;
    while (drop < arr.length && arr[drop].t < keepFrom) drop++;
    if (drop) arr.splice(0, drop);
  }

  // Кадр с лицом: landmarks в нормированных координатах, imageData — RGBA кадра.
  pushFace(tMs, landmarks, imageData, W, H) {
    const m = headMotionFeatures(landmarks);
    if (!m) return false;
    this._push("bridge", tMs, m.bridge);
    this._push("pitch", tMs, m.pitch);
    this._push("scale", tMs, m.scale);
    const luma = cheekLuma(imageData, W, H, faceBox(landmarks, W, H));
    if (luma != null) this._push("luma", tMs, luma);
    return true;
  }

  // Плечи из модели позы (нормированные координаты, visibility 0–1).
  pushShoulders(tMs, left, right) {
    const vis = (p) => (finite(p?.visibility) ? p.visibility : 1);
    if (!left || !right || ![left.x, left.y, right.x, right.y].every(finite)) return false;
    if (Math.min(vis(left), vis(right)) < this.cfg.shoulderMinVisibility) return false;
    const width = Math.hypot(left.x - right.x, left.y - right.y);
    if (!(width > 0.05)) return false;
    this._push("shoulders", tMs, ((left.y + right.y) / 2) / width);
    return true;
  }

  _rate(signal) {
    if (!signal) return null;
    // Неподвижный ряд (точка не найдена/заморожена) — не оценка, а шум квантования.
    const mean = signal.reduce((a, v) => a + v, 0) / signal.length;
    if (!(signal.reduce((a, v) => a + (v - mean) ** 2, 0) / signal.length > 1e-14)) return null;
    const out = estimateRespirationRate(signal, this.cfg.fs, this.cfg.bandHz);
    return finite(out?.bpm) ? out.bpm : null;
  }

  _rateCorrected(signal, reference) {
    if (!signal) return null;
    const c = reference ? removeReferenceComponent(signal, reference, this.cfg.fs, this.cfg.bandHz, this.cfg.maxLagSec) : null;
    return this._rate(c ? c.signal : signal);
  }

  // Оценка на момент tMs (пересчёт не чаще updateEveryMs).
  estimate(tMs) {
    if (this.last && tMs - this.lastEstimateAt < this.cfg.updateEveryMs) return this.last;
    this.lastEstimateAt = tMs;
    const w = {};
    for (const k of Object.keys(this.series)) w[k] = resampleWindow(this.series[k], tMs, this.cfg);
    const bridge = this._rate(w.bridge);
    const pitch = this._rateCorrected(w.pitch, w.luma);
    let third = null, thirdSource = null;
    if (w.shoulders) { third = this._rateCorrected(w.shoulders, w.luma); thirdSource = "shoulders"; }
    if (third == null && w.scale) { third = this._rateCorrected(w.scale, w.luma); thirdSource = third == null ? null : "face_scale"; }
    const votes = [bridge, pitch, third];
    const rate = median(votes);
    const agreeing = rate == null ? 0 : votes.filter(v => finite(v) && Math.abs(v - rate) <= this.cfg.agreeBpm).length;
    const published = rate != null && agreeing >= this.cfg.minAgreeing;
    this.last = {
      rate,
      conf: agreeing / 3,
      published,
      reason: rate == null ? "insufficient_window" : (published ? null : "estimates_disagree"),
      agreeing,
      votes: { bridge, pitch, third },
      thirdSource,
      methodVersion: MOTION_RESPIRATION_METHOD_VERSION,
    };
    return this.last;
  }
}
