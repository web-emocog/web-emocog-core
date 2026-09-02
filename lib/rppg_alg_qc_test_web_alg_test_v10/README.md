# rPPG SAFE Engine

Библиотека для оценки ЧСС (HR) и частоты дыхания (RR) по видео лица.
Основной режим — **SAFE**: публикуем только значения, прошедшие строгий гейт качества.

Важно: это исследовательский код, не медицинское изделие.

## Что измеряем
- ЧСС (bpm)
- Частоту дыхания (breaths/min)

## Что внутри
- rPPG по POS и CHROM (CHROM используется для диагностики/согласования)
- Стабилизация ROI, удаление бликов (specular), контроль экспозиции
- SAFE‑gate (confidence/snr/pqi/стабильность) для публикации
- Оценка дыхания по низкочастотной составляющей luma‑сигнала
- Формирование JSON сессии (опубликованные и удержанные значения)

## Как интегрировать
Библиотека не включает захват видео и детекцию лица.  
Вы передаёте `ImageData` и landmarks (например MediaPipe FaceMesh).

Минимальный пример:
```js
import { RppgEngine, SessionReporter } from "./rppg_alg/index.js";

const engine = new RppgEngine({ algorithm: "pos", mode: "safe" });
const reporter = new SessionReporter();

// цикл по кадрам:
// frame = { imageData, width, height, timestampMs, landmarks }
const out = engine.update({
  timestampMs: frame.timestampMs,
  frameW: frame.width,
  frameH: frame.height,
  imageData: frame.imageData,
  landmarks: frame.landmarks,
  fps: 30,
});

if (out) reporter.push(out, frame.timestampMs);

// при завершении сессии:
const sessionJson = reporter.finalize();
// отправить/сохранить: sendSessionJsonStub(sessionJson)
```

## Формат JSON за сессию
```json
{
  "session": {
    "start_ms": 0,
    "end_ms": 0,
    "samples": 0
  },
  "range_bpm": {
    "min": 0,
    "max": 0,
    "count": 0
  },
  "samples": [
    {
      "t_ms": 0,
      "published": true,
      "publish_reason": "ok",
      "bpm_published": 86.4,
      "bpm_hold": 86.4,
      "bpm_smoothed": 85.9,
      "confidence": 0.74,
      "resp_rate": 12.3
    }
  ]
}
```

`range_bpm` считается по **удержанным значениям** после мягкой очистки выбросов (median ± 3×MAD).

## Заглушки интеграции
См. `rppg_alg/integration/io_stubs.js`:
- `getVideoFrameStub()`
- `getLandmarksStub()`
- `sendSessionJsonStub()`

## Используемые источники и лицензии
Алгоритмические идеи:
- **POS**: Wang et al., “Algorithmic Principles of Remote PPG” (2017).
- **CHROM**: de Haan & Jeanne, “Robust Pulse Rate from Chrominance‑Based rPPG” (2013).

Инструменты/зависимости (не включены в репозиторий, но совместимы):
- **MediaPipe FaceMesh** (Apache‑2.0) — для landmarks лица.
- **Vite** (MIT) — использовался в тестовом веб‑обёртывании (удалено из финального репо).

Все реализации в этом репозитории — собственный код, без копирования GPL‑кода.

## Структура
- `rppg_alg/` — ядро алгоритма
  - `RppgEngine.js` — основной движок
  - `roi/` — формирование ROI и масок
  - `signal/` — спектр, SQI, дыхание
  - `session/SessionReporter.js` — сбор JSON по сессии
  - `integration/io_stubs.js` — заглушки I/O

