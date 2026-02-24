import { clamp } from "../utils.js";
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// lmXY — преобразует координаты landmarks в пиксельные значения
function lmXY(landmarks, idx, W, H) {
  const p = landmarks[idx];
  if (!p) return null;
  const x = clamp01(Number.isFinite(p.x) ? p.x : 0) * W;
  const y = clamp01(Number.isFinite(p.y) ? p.y : 0) * H;
  return { x, y };
}

// percentile — вычисляет перцентиль для отсортированного массива
function percentile(sortedArr, q) {
  if (!sortedArr.length) return 0;
  const pos = (sortedArr.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedArr[lo];
  const a = sortedArr[lo], b = sortedArr[hi];
  return a + (pos - lo) * (b - a);
}

// robustBounds — вычисляет устойчивые границы для landmarks
function robustBounds(landmarks, W, H, q = 0.02) {
  const xs = [];
  const ys = [];
  for (const p of landmarks) {
    if (!p) continue;
    const x = clamp01(Number.isFinite(p.x) ? p.x : 0) * W;
    const y = clamp01(Number.isFinite(p.y) ? p.y : 0) * H;
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); }
  }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);

  const xMin = percentile(xs, q);
  const xMax = percentile(xs, 1 - q);
  const yMin = percentile(ys, q);
  const yMax = percentile(ys, 1 - q);

  return { xMin, xMax, yMin, yMax };
}

const EDGE_L = [234, 93, 132, 58, 172, 127, 162, 21, 54]; // левая граница
const EDGE_R = [454, 323, 361, 288, 397, 356, 389, 251, 284]; // правая граница
// edgeX — вычисляет крайние значения по X для заданных индексов
function edgeX(landmarks, idxs, W, H, mode = "min") {
  let v = (mode === "min") ? 1e9 : -1e9;
  for (const idx of idxs) {
    const p = lmXY(landmarks, idx, W, H);
    if (!p) continue;
    if (mode === "min") v = Math.min(v, p.x);
    else v = Math.max(v, p.x);
  }
  return (mode === "min") ? (Number.isFinite(v) ? v : 0) : (Number.isFinite(v) ? v : W);
}

// clampRectFit — ограничивает прямоугольник в пределах изображения
function clampRectFit(r, W, H) {
  let x = clamp(r.x, 0, W - 2);
  let y = clamp(r.y, 0, H - 2);
  let w = r.w;
  let h = r.h;

  if (!Number.isFinite(w) || w <= 0) w = 2;
  if (!Number.isFinite(h) || h <= 0) h = 2;

  w = clamp(w, 2, W - x);
  h = clamp(h, 2, H - y);

  return { x, y, w, h };
}

// bboxFromIdxs — вычисляет ограничивающий прямоугольник для заданных индексов
function bboxFromIdxs(landmarks, idxs, W, H) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  let ok = false;
  for (const idx of idxs) {
    const p = lmXY(landmarks, idx, W, H);
    if (!p) continue;
    ok = true;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  if (!ok) return null;
  return { x: x0, y: y0, w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0) };
}

// inflateRect — увеличивает размеры прямоугольника на заданные значения
function inflateRect(r, padX, padY) {
  return { x: r.x - padX, y: r.y - padY, w: r.w + 2 * padX, h: r.h + 2 * padY };
}

// intersectRect — вычисляет пересечение двух прямоугольников
function intersectRect(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 1 || h <= 1) return null;
  return { x: x0, y: y0, w, h };
}

/**
 * roiRectsAndMasksFromLandmarksV4
 *
 * v4 = v3 +
 * 1) "каротиды" на шее: добавляем две полосы neckL/neckR (и оставляем neck как центр. fallback)
 * 2) маски исключения (eyes/lips/hairline) для повышения качества усреднения по коже
 * 3) ещё чуть расширяем щёки на дальнем лице (частая проблема: ROI слишком мала)
 */
export function roiRectsAndMasksFromLandmarksV4(landmarks, W, H) {
  const b = robustBounds(landmarks, W, H, 0.02);
  const xMin = b.xMin, xMax = b.xMax, yMin = b.yMin, yMax = b.yMax;

  const FW = Math.max(10, xMax - xMin);
  const FH = Math.max(10, yMax - yMin);

  const pFore = lmXY(landmarks, 10, W, H) ?? { x: (xMin + xMax) * 0.5, y: yMin + 0.1 * FH };
  const pChin = lmXY(landmarks, 152, W, H) ?? { x: (xMin + xMax) * 0.5, y: yMax - 0.05 * FH };
  const faceH = Math.max(40, pChin.y - pFore.y);

  const pLipU = lmXY(landmarks, 13, W, H) ?? { x: (xMin + xMax) * 0.5, y: yMin + 0.65 * FH };
  const pLipL = lmXY(landmarks, 14, W, H) ?? { x: (xMin + xMax) * 0.5, y: yMin + 0.70 * FH };
  const yMouth = (pLipU.y + pLipL.y) * 0.5;

  const pEyeLO = lmXY(landmarks, 33,  W, H) ?? { x: xMin + 0.30 * FW, y: yMin + 0.35 * FH };
  const pEyeLI = lmXY(landmarks, 133, W, H) ?? { x: xMin + 0.40 * FW, y: yMin + 0.35 * FH };
  const pEyeRI = lmXY(landmarks, 362, W, H) ?? { x: xMin + 0.60 * FW, y: yMin + 0.35 * FH };
  const pEyeRO = lmXY(landmarks, 263, W, H) ?? { x: xMin + 0.70 * FW, y: yMin + 0.35 * FH };

  const xMid = (pEyeLO.x + pEyeRO.x) * 0.5;
  const yEye = (pEyeLO.y + pEyeLI.y + pEyeRI.y + pEyeRO.y) * 0.25;

  const xEdgeL = edgeX(landmarks, EDGE_L, W, H, "min");
  const xEdgeR = edgeX(landmarks, EDGE_R, W, H, "max");

  const pNose = lmXY(landmarks, 4, W, H) ?? { x: xMid, y: yEye + 0.25 * faceH };

  const eyeToMouth = Math.max(25, yMouth - yEye);

  const smallFace = FW < 150 || faceH < 180;

  // ---------------- Forehead ----------------
  const fTop = pFore.y + 0.08 * faceH;
  const fBot = yEye - 0.06 * faceH;
  const forehead = {
    x: xMin + 0.24 * FW,
    y: fTop,
    w: 0.52 * FW,
    h: Math.max(2, fBot - fTop),
  };

  // ---------------- Cheeks ----------------
  const yCheekTop = yEye + (smallFace ? 0.08 : 0.14) * eyeToMouth;
  const yCheekBot = yEye + (smallFace ? 1.02 : 0.86) * eyeToMouth;

  const xInnerInset = (smallFace ? 0.040 : 0.06) * FW;
  const xOuterInset = (smallFace ? 0.050 : 0.10) * FW;

  const xInnerL = Math.min(xMid - xInnerInset, pNose.x - 0.03 * FW);
  const xInnerR = Math.max(xMid + xInnerInset, pNose.x + 0.03 * FW);

  let xOuterL = xEdgeL + xOuterInset;
  let xOuterR = xEdgeR - xOuterInset;

  // На дальнем лице гарантируем минимум ширины 
  const minCheekW = smallFace ? 30 : 28;
  if (xInnerL - xOuterL < minCheekW) xOuterL = xInnerL - minCheekW;
  if (xOuterR - xInnerR < minCheekW) xOuterR = xInnerR + minCheekW;

  const cheekL = {
    x: xOuterL,
    y: yCheekTop,
    w: Math.max(2, xInnerL - xOuterL),
    h: Math.max(2, yCheekBot - yCheekTop),
  };
  const cheekR = {
    x: xInnerR,
    y: yCheekTop,
    w: Math.max(2, xOuterR - xInnerR),
    h: Math.max(2, yCheekBot - yCheekTop),
  };

  // ---------------- Neck (base) ----------------
  const neckTop = pChin.y + 0.06 * faceH;
  const neckBot = pChin.y + 0.52 * faceH;
  const neck = {
    x: xMid - 0.24 * FW,
    y: neckTop,
    w: 0.48 * FW,
    h: Math.max(2, neckBot - neckTop),
  };

  const rects = {
    forehead: clampRectFit(forehead, W, H),
    cheekL: clampRectFit(cheekL, W, H),
    cheekR: clampRectFit(cheekR, W, H),
    // Нижнее веко/infra удалено: движение глаз даёт сильные артефакты.
    neck: clampRectFit(neck, W, H),
  };

  // ---------------- Exclude masks ----------------
  // Минимально-инвазивные bbox, чтобы исключить явные "не-кожа" области.
  // (глаза, губы, верхняя кромка лба рядом с волосами)
  const eyeL = bboxFromIdxs(landmarks, [33, 133, 159, 145], W, H);
  const eyeR = bboxFromIdxs(landmarks, [263, 362, 386, 374], W, H);
  const mouth = bboxFromIdxs(landmarks, [61, 291, 13, 14], W, H);

  // Две версии инфлейта: крупная для cheek/forehead.
  const eyePads = (r) => ({
    large: inflateRect(r, Math.max(10, 0.25 * r.w), Math.max(8, 0.45 * r.h)),
  });

  const masks = {};
  for (const k of Object.keys(rects)) masks[k] = [];

  // Hairline для лба: исключаем верхнюю полосу, чтобы волосы/чёлка не портили цвет.
  {
    const r = rects.forehead;
    const bandH = Math.max(4, 0.18 * r.h);
    masks.forehead.push({ x: r.x, y: r.y, w: r.w, h: bandH });
  }

  if (eyeL) {
    const p = eyePads(eyeL);
    // cheeks/forehead: крупнее
    for (const k of ["cheekL", "cheekR", "forehead"]) {
      const it = intersectRect(rects[k], p.large);
      if (it) masks[k].push(it);
    }
  }
  if (eyeR) {
    const p = eyePads(eyeR);
    for (const k of ["cheekL", "cheekR", "forehead"]) {
      const it = intersectRect(rects[k], p.large);
      if (it) masks[k].push(it);
    }
  }

  if (mouth) {
    const m = inflateRect(mouth, Math.max(8, 0.18 * mouth.w), Math.max(6, 0.28 * mouth.h));
    for (const k of ["chin", "cheekL", "cheekR"]) {
      const it = intersectRect(rects[k], m);
      if (it) masks[k].push(it);
    }
  }

  return { rects, masks };
}
