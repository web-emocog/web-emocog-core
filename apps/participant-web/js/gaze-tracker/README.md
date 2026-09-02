# Gaze Tracker Module v3

Браузерная оценка point-of-gaze по 478 landmarks MediaPipe Face Landmarker.
Модуль использует калибровку конкретного участника и не подменяет измерение
положением цели.

## Архитектура

```text
gaze-tracker.js                 window-wrapper без второго analyze loop
gaze-tracker/
  GazeTracker.js               target-blind iris predictor и signal contract
  features.js                  iris, head и eye признаки
  ridge.js                     ridge regression
  signal-processing.mjs        confidence/OOD gate и adaptive display filter
  viewport-coordinates.mjs     content viewport coordinates
  attention-metrics.js         blinks, PERCLOS и research-only метрики
```

Все модули сессии получают один face frame из
`session-runtime/frame-pipeline.js`. Автономный `startTracking()` удален:
параллельный анализ тех же кадров создавал задержку и дублированный маршрут.

## Predictor

Калибровочная выборка содержит два независимых набора признаков:

- `iris`: нормализованные координаты обеих радужек относительно глаз, разница
  между глазами и bias;
- `head`: yaw/pitch/roll proxy, translation, face scale и interocular distance.

Ridge-модель обучается только на `iris`. Head-признаки не получают target и не
могут тянуть прогноз к калибровочной точке. Для iris и head отдельно
оценивается распределение калибровочных значений. Во время сессии
`confidence/OOD gate` отклоняет:

- закрытые или плохо различимые глаза;
- iris, значительно вышедший за calibration distribution;
- позу или translation головы далеко за пределами calibration distribution.

Естественные движения головы допускаются. Если кадр невалиден, display point
становится `null`; модуль не продолжает рисовать последнюю правдоподобную
траекторию.

## Signal contract

Каждый accepted/rejected prediction явно разделен на три сигнала:

| Signal | Поля | Назначение |
| --- | --- | --- |
| Raw | `rawX`, `rawY` | Непосредственный iris-only ridge prediction |
| Corrected | `correctedX`, `correctedY` | Raw с LOOCV-approved affine correction; heatmap и аналитика |
| Display | `displayX`, `displayY`, совместимые `x`, `y` | Только визуальный overlay и gaze-brush |

Adaptive filter измеряет скорость между соседними `corrected` inputs. Он не
сравнивает вход с запаздывающим display output, поэтому сглаженная траектория
не подается обратно в расчет скорости и не дублирует маршрут.

## Content viewport coordinates

Калибровка и prediction используют CSS pixels внутри видимой области страницы:

```js
const rect = target.getBoundingClientRect();
const vv = window.visualViewport;
const x = rect.left + rect.width / 2 - vv.offsetLeft;
const y = rect.top + rect.height / 2 - vv.offsetTop;
```

Панель вкладок, адресная строка и рамка браузера не входят в page viewport, и
вычитать их высоту вручную нельзя. `visualViewport` нужен для смещения и
масштаба при mobile/pinch zoom; на обычном desktop его offsets равны нулю.

## Calibration и validation

1. Основная калибровка обучает iris-only ridge.
2. Отдельный correction set собирает raw prediction на девяти целях.
3. Affine correction выбирается только при LOOCV минимум по пяти целям и
   held-out улучшении не менее `max(3 px, 2%)`.
4. Пять benchmark targets не используются ни для fitting, ни для выбора
   correction.
5. В `gazeValidation.baselineVsNew` сохраняются независимые raw,
   corrected и display metrics.

Такой benchmark не выдает in-sample ошибку за точность на новых данных.

## API

```js
const tracker = new GazeTracker({
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    ridgeLambda: 0.001
});

tracker.addCalibrationPoint(landmarks, targetX, targetY);
tracker.addAveragedCalibrationPoint(landmarksFrames, targetX, targetY);
tracker.calibrate();

const prediction = tracker.predict(landmarks, {
    timestamp: frame.timestamp,
    wallTimestamp: Date.now()
});

tracker.setPostCalibrationCorrection({
    matrixX,
    matrixY,
    source: 'loocv_affine'
});
tracker.updateScreenSize(viewport.width, viewport.height);
tracker.resetSmoothingState();
tracker.reset();
```

## Ограничения

- Обычная RGB-камера не обеспечивает точность лабораторного IR eye tracker.
- Метрики саккад, микросдвигов и hippus являются webcam proxies и не должны
  использоваться как клинический диагноз.
- При выходе head/iris за calibration distribution кадр намеренно теряется,
  а не экстраполируется.
- Изменение положения камеры или окна после калибровки требует повторной
  validation и, при необходимости, калибровки.

## Лицензии и источники

- MediaPipe: Apache-2.0.
- Код проекта: Apache-2.0.
- Научные и web-platform основания перечислены в
  `docs/research/gaze-blink-body-methods.md`.
