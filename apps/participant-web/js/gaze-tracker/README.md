# Gaze Tracker Module v2.2.0

Модуль оценки направления взгляда на основе **MediaPipe Face Landmarker** iris landmarks (468-477).

## Архитектура

```
gaze-tracker.js          ← Browser wrapper (window.GazeTracker)
gaze-tracker/
  ├── index.js           ← ES module entry point
  ├── GazeTracker.js     ← Main class
  ├── constants.js       ← Landmark indices, defaults
  ├── features.js        ← Iris feature extraction (17-dim vector)
  ├── ridge.js           ← Ridge regression solver
  ├── attention-metrics.js ← Research-only аналитика: blink/PERCLOS/saccade/micro-shift/hippus
  └── README.md
```

## Принцип работы

1. **Калибровка**: пользователь смотрит на точки экрана (сетка задаётся приложением; в `participant-web` используется расширенная 21-точечная схема с 2 кликами на точку) → для каждой точки извлекаются iris features из 478 landmarks → собирается обучающая выборка
2. **Обучение**: ridge regression `w = (XᵀX + λI)⁻¹ Xᵀy` — два набора весов (для X и Y координат), λ=0.001
3. **Standardization**: z-score нормализация фич перед обучением и prediction
4. **Prediction**: iris features → standardize → dot product с весами → координаты экрана (x, y)
5. **Сглаживание**: exponential moving average (α=0.10) для баланса стабильности и задержки

## Feature Vector (17 элементов)

| Индекс | Описание |
|--------|----------|
| 0-1 | Нормализованная позиция левого iris (x, y) относительно глаза |
| 2-3 | Нормализованная позиция правого iris (x, y) |
| 4-5 | Среднее iris двух глаз (x, y) |
| 6-7 | Head pose proxies: yaw, pitch |
| 8-9 | Head position in frame (x, y) — 0..1 |
| 10-11 | Eye aspect ratio (left, right) — openness |
| 12 | irisX × yaw — interaction: horizontal gaze × head turn |
| 13 | irisY × pitch — interaction: vertical gaze × head tilt |
| 14 | irisX × headX — interaction: iris position × head position |
| 15 | irisY × headY — interaction: iris position × head position |
| 16 | Bias term (1.0) |

Interaction terms (12-15) capture non-linear dependency between iris position
and head pose, especially important for screen corners/edges.

## API

```js
const tracker = new GazeTracker({
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    smoothingFactor: 0.10,      // 0 = нет сглаживания, 1 = максимум
    ridgeLambda: 0.001,         // регуляризация
    onGazeUpdate: (gaze) => {}, // callback
    onCalibrationComplete: (info) => {}
});

// Калибровка (single frame)
tracker.addCalibrationPoint(landmarks, screenX, screenY);

// Калибровка (multi-frame averaged — preferred)
tracker.addAveragedCalibrationPoint(landmarksArray, screenX, screenY);

tracker.calibrate();           // → boolean (min 4 точки, рекомендуется 32+)

// Prediction
tracker.predict(landmarks);    // → { x, y, rawX, rawY, confidence, timestamp } | null

// Tracking (автономный режим)
tracker.startTracking(analyzer, videoElement, 33);
tracker.stopTracking();

// Утилиты
tracker.isCalibrated();        // → boolean
tracker.isTracking();          // → boolean
tracker.getStatus();           // → { isCalibrated, calibrationPoints, totalPredictions, ... }
tracker.updateScreenSize(w, h);
tracker.reset();
tracker.clearCalibrationData();
```

## Changelog

- **v2.2.0**: 17-feature vector with 4 iris×head interaction terms for better corner/edge accuracy. 4×4 calibration grid (32 points). z-score standardization.
- **v2.1.1**: 13-feature vector, z-score standardization, `addAveragedCalibrationPoint()`.
- **v2.1.0**: 13-feature vector, λ=0.001, smoothing=0.10.

## Attention Metrics Scope

`attention-metrics.js` теперь находится в `js/gaze-tracker/` и отвечает за research-only метрики:
- blink dynamics;
- PERCLOS episodes + window stats (30s/60s);
- saccade/fixation;
- micro-shift proxy;
- hippus proxy.

Важно: слой attention-метрик не используется как gate для `qcSummary.overallPass`.

## Потенциальная чистка (без изменений сейчас)

Ниже зафиксированы кандидаты на будущий рефакторинг; сейчас они сохранены намеренно, чтобы не менять формат JSON и поведение.

1. `rawBlinkEvents` в blink-детекции.
Причина: сейчас это отладочное поле, но вне `attention-metrics.js` не потребляется; можно убрать или вынести под debug-flag для уменьшения payload.

2. Дублирование `durationMs` и `eyeDurationMs` в subset-метриках.
Причина: оба поля сейчас равны; можно оставить одно поле и алиас для совместимости.

3. Дублирование `closedThresholdNorm` и `closedThresholdRel`.
Причина: оба поля несут одно и то же значение порога; можно оставить один канонический ключ.

4. Дублирование `perclosEpisodeMinMs` и `perclosCriteria.minDurationMs`.
Причина: значение одно и то же; можно сохранить только критерии в одном объекте.

5. Объёмные диагностические payload-поля (`blinkDynamics.blinks`, `blinkDynamics.closureEvents`, расширенный `bothOpenDiagnostics`).
Причина: полезны для R&D-разборов, но заметно увеличивают JSON; можно делать условную сериализацию (summary-only vs debug).

## Зависимости

- **MediaPipe Face Landmarker** (Apache-2.0) — уже загружен в проекте
- **PrecheckAnalyzer** — используется для получения 478 landmarks через `analyzeFrame()`

## Лицензия

- MediaPipe: Apache-2.0
- Этот код: MIT
