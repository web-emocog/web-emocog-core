/**
 * skinSampling_v4 = v3 + HSV gate (мягкий фильтр не-кожи)
 */
export function isSkinRGBv4(r, g, b) {
  const maxRGB = Math.max(r, g, b);
  const minRGB = Math.min(r, g, b);

  const rgbRule =
    (r > 95 && g > 40 && b > 20) &&
    ((maxRGB - minRGB) > 15) &&
    (Math.abs(r - g) > 15) &&
    (r > g) && (r > b);

  const y  = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

  const ycbcrRule =
    (y >= 30) &&
    (cb >= 65 && cb <= 140) &&
    (cr >= 125 && cr <= 195);

  // HSV gate (очень широкий)
  const R = r / 255, G = g / 255, B = b / 255;
  const cMax = Math.max(R, G, B);
  const cMin = Math.min(R, G, B);
  const d = cMax - cMin;

  const V = cMax;
  const S = cMax <= 1e-6 ? 0 : d / (cMax + 1e-12);

  let H = 0;
  if (d <= 1e-8) H = 0;
  else if (cMax === R) H = 60 * (((G - B) / d) % 6);
  else if (cMax === G) H = 60 * (((B - R) / d) + 2);
  else H = 60 * (((R - G) / d) + 4);
  if (H < 0) H += 360;

  const hueOk = (H <= 65) || (H >= 295);
  const satOk = (S >= 0.10);
  const valOk = (V >= 0.15) && (V <= 0.98);

  return (rgbRule || ycbcrRule) && (hueOk && satOk && valOk);
}

function insideRect(x, y, r) { // Проверяет, находится ли точка (x, y) внутри прямоугольника r
  return x >= r.x && x < (r.x + r.w) && y >= r.y && y < (r.y + r.h);
}

export function sampleRectStatsV4(imageData, W, H, rect, opts = {}, excludeRects = []) { // Функция для выборки статистики из прямоугольной области
  const step = opts.sampleStep ?? 2;
  const minSkinRatio = opts.minSkinRatio ?? 0.18;
  const minSkinPixels = opts.minSkinPixels ?? 180;
  const specCfg = opts.specularFilter ?? {};
  const specEnabled = specCfg.enabled ?? false;
  const specLumaMax = specCfg.lumaMax ?? 220;
  const specSatMin = specCfg.satMin ?? 12;

  const x0 = Math.floor(rect.x), y0 = Math.floor(rect.y);
  const x1 = Math.min(W, Math.floor(rect.x + rect.w));
  const y1 = Math.min(H, Math.floor(rect.y + rect.h));

  const data = imageData.data;

  let r = 0, g = 0, b = 0;
  let skin = 0, total = 0;

  let ySum = 0, ySum2 = 0;
  let satSum = 0;
  let clipped = 0;
  let specular = 0;
  let skipped = 0;

  for (let y = y0; y < y1; y += step) { // Проходим по всем пикселям в области выборки
    for (let x = x0; x < x1; x += step) {
      let isExcluded = false;
      for (let j = 0; j < excludeRects.length; j++) {
        const er = excludeRects[j];
        if (er && insideRect(x, y, er)) { isExcluded = true; break; }
      }
      if (isExcluded) { skipped++; continue; }

      const i = (y * W + x) * 4;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      total++;

      const Y = 0.299 * R + 0.587 * G + 0.114 * B;
      ySum += Y; ySum2 += Y * Y;

      const sat = (Math.max(R, G, B) - Math.min(R, G, B));
      satSum += sat;
      if (R <= 4 || G <= 4 || B <= 4 || R >= 251 || G >= 251 || B >= 251) clipped++;

      const isSpec = specEnabled && (Y >= specLumaMax) && (sat <= specSatMin);
      if (isSpec) specular++;

      if (isSkinRGBv4(R, G, B) && !isSpec) {
        skin++;
        r += R; g += G; b += B;
      }
    }
  }

  const skinRatio = skin / Math.max(1, total);
  const yMean = ySum / Math.max(1, total);
  const yVar = ySum2 / Math.max(1, total) - yMean * yMean;
  const yStd = Math.sqrt(Math.max(0, yVar));
  const satMean = satSum / Math.max(1, total);
  const clippedRatio = clipped / Math.max(1, total);
  const specularRatio = specular / Math.max(1, total);

  const ok = (skin >= minSkinPixels) && (skinRatio >= minSkinRatio);

  return ok ? {
    ok: true,
    r: r / skin, g: g / skin, b: b / skin,
    skinRatio, skinPixels: skin, totalPixels: total,
    skippedPixels: skipped,
    lumaMean: yMean, lumaStd: yStd, satMean,
    clippedRatio,
    specularRatio,
  } : {
    ok: false,
    r: 0, g: 0, b: 0,
    skinRatio, skinPixels: skin, totalPixels: total,
    skippedPixels: skipped,
    lumaMean: yMean, lumaStd: yStd, satMean,
    clippedRatio,
    specularRatio,
  };
}
