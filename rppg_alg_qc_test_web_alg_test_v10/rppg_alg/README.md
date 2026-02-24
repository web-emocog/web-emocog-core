# rppg_alg — RGB rPPG multi-ROI (POS/CHROM), чистая библиотека

Это модуль для извлечения пульса по обычной RGB-камере:
- multi-ROI: лоб, 2 щеки, шея (нижнее веко исключено из‑за артефактов)
- алгоритмы: **POS** и **CHROM** (переключение параметром `algorithm`)
- динамические веса ROI (с ограничениями, особенно для шеи)
- устойчивость: skin-filter, motion penalty, brightness penalty, SNR, нормировка сигналов при смешивании
- выход: `bpm`, `confidence`, `weights`, `roiDiagnostics`, дыхание (resp_rate)

## Быстрое использование
```js
import { RppgEngine } from "./rppg_alg/index.js";

const engine = new RppgEngine({ algorithm: "pos" }); // или "chrom"

const out = engine.update({
  timestampMs,
  frameW: W,
  frameH: H,
  imageData,   // ctx.getImageData(...)
  landmarks,   // landmarks лица от MediaPipe FaceLandmarker
});

if (out?.valid) console.log(out.bpm, out.confidence, out.weights);
```

## Корректность формул
- **CHROM**: X = 3R - 2G, Y = 1.5R + G - 1.5B, alpha = std(X)/std(Y), S = X - alpha*Y (streaming last-sample).
- **POS**: нормализованный RGB, S1 = G - B, S2 = -2R + G + B, alpha = std(S1)/std(S2), S = S1 + alpha*S2 (streaming last-sample).

## Ожидаемая точность
Без эталонного датчика нельзя гарантировать точность, но в типовых лабораторных условиях
классические методы POS/CHROM обычно дают пригодные оценки HR, при этом:
- качество сильно падает при движении головы, плохом свете, автопересвете, косметике/бороде/волосах на лбу, и при частичном закрытии кожи.
- multi-ROI и динамические веса повышают устойчивость (когда одна зона “падает”, другие вытягивают).

## Устойчивость к FPS/залипанию
- HR считается по сигналу, интерполированному на фиксированный Fs (targetFs), поэтому меньше зависит от FPS/overlay.
- Tracking вокруг прошлого BPM + escape из ложного залипания на неправильной частоте.
- Нижнее веко (infra) отключено: движение глаз даёт артефакты.

## SQI / SAFE gate
- Добавлен N_SQI (npj Biosensing, 2024): `N_SQI = var(|y|) / var(y)` на bandpass-сигнале `y`.
- SAFE MODE публикует только при хорошем SQI и правдоподобных условиях (agreement/continuity/motion/luma).

## Сессии и JSON
Для выдачи одного JSON за всю сессию используйте `SessionReporter`
из `rppg_alg/session/SessionReporter.js`.
