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
  qc-signal.mjs                accepted corrected signal для live QC, не display
  eye-patch-features.mjs        local-only experimental eye appearance, без recapture
  eye-gradient-features.mjs     local-only gradient-center eye signal, same-frame pixels
  eye-tophat-features.mjs       local-only horizontal black top-hat, same-frame pixels
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

### Feature geometry: `same_eye_iris.v2`

С 2026-11-05 радужка нормализуется относительно контура того же анатомического
глаза: left iris 473..477 и контур 362/263/386/374; right iris 468..472 и
133/33/159/145. Mirroring видео не меняет индексы. Roll вычисляется по вектору
right-to-left, который у горизонтального лица близок к нулю, а не к разрыву
`atan2` возле +/-pi. Размерность признаков, ridge, correction и QC-пороги не
меняются. `getStatus()` и prediction содержат `featureMethod`, participant
producer сохраняет его в опциональном `meta.tech.gazeFeatureMethod`.

Синтетическая регрессия: `node scripts/reference-data/issue143-synthetic.mjs
b16ce38` из корня. Это проверка геометрии/реализации, не webcam accuracy.
Локальный camera-тест и ограничения приёмки описаны в
`docs/reports/2026-11-06-issue143-gaze.md`. Полный протокол по-прежнему обязателен
для real-device приёмки; независимые проверки не вставляются внутрь блока.

`open_eye_calibration.v1` использует тот же base-confidence cutoff 0.28,
что prediction: закрытые/неразличимые глаза не обучают ridge. Статус содержит
`calibrationFrames` (attempted/accepted/rejected) и `calibrationSampling`, а ingest
только опциональный `meta.tech.gazeCalibrationSampling`. `minFrames` четвёртого
аргумента `addAveragedCalibrationPoint()` относится к usable frames после gate.
Недостаточная точка не добавляется; UI/диагностика могут повторить её, не
притягивая прогноз к цели. Это не гарантия от всех переходных blink landmarks.

### Диагностический candidate, не default

`new GazeTracker({ experimentalGeometry: 'corner_width' })` явно выбирает
`corner_width_iris.experimental.v1`. Вертикальный iris offset берётся от
середины углов и делится на ширину глаза; текущая высота век остаётся только
openness/confidence. Предыдущие floors переводятся в новые единицы по median
aperture только обучающих rows (в каждом held-out fold отдельно). Численные
confidence/OOD cutoffs не меняются, но распределение признаков другое: нужны
реальные specificity, missingness, latency и robustness, не только синтетика.
Candidate не экспортируется как разрешённый SessionFeature method и не включается
по умолчанию. Локальный A/B использует одну калибровку и одни кадры для обеих
моделей; targets доступны только fit и downstream error accumulator.

## Signal contract

Каждый accepted/rejected prediction явно разделен на три сигнала:

| Signal | Поля | Назначение |
| --- | --- | --- |
| Raw | `rawX`, `rawY` | Непосредственный iris-only ridge prediction |
| Corrected | `correctedX`, `correctedY` | Raw с LOOCV-approved residual-bias correction; heatmap и аналитика |
| Display | `displayX`, `displayY`, совместимые `x`, `y` | Только визуальный overlay и gaze-brush |

Adaptive filter измеряет скорость между соседними `corrected` inputs. Он не
сравнивает вход с запаздывающим display output, поэтому сглаженная траектория
не подается обратно в расчет скорости и не дублирует маршрут.

Основной `handleGazeUpdate()` передаёт live QC один input **до** display-ветки.
`corrected_validity.v1` требует `valid===true` и finite corrected coordinates;
accepted off-screen прогноз без display не считается missing. Explicit false
onScreen или выход corrected за content viewport не может стать on-screen.
Raw/display/legacy x/y не используются как запасной аналитический сигнал.
Provenance сохраняется в `meta.tech.gazeQcSignalMethod`; legacy записи не
пересчитываются. Формулы QC/thresholds прежние, но источник наблюдений исправлен.
Это не доказательство AOI accuracy, а условные availability/on-screen доли.

### Eye-appearance experiment — не default

`experimentalEyePatch: { frameWidth, frameHeight, region: 'full' | 'core',
readFeatures }` используется только локальным `?models=appearance`.
`readFeatures(landmarks)` читает transient WeakMap того же завершённого frame.
`eyePatchFeaturesForFrame()` получает RGBA только через `getFramePixels(frame)`
и требует точного frameSize. Missing/mismatched/flat patch даёт missing sample,
не прежний прогноз, не новый захват video и не fallback на target/raw/display.

Оригинальный preprocessing: выровненный по углам глаза pixel crop 1.25×.75 eye
widths, 10×6 grid на глаз, четыре bilinear subsamples, mean/contrast normalization
с floor .04. Full даёт 120 признаков; core использует центральные 6×2 cells на глаз
и нормализует их отдельно (24 признака). Это разные versioned method tags:
`eye_patch_ridge.experimental.v1` и `eye_patch_core_ridge.experimental.v1`.
Head/eye/confidence/iris-OOD остаются baseline, не становятся predictor inputs.

Fit использует dual ridge с unpenalized intercept и training-fold стандартизацией
(floor .05), grouped-target CV по λ `[.01,.1,1,10,100]`. Не более 50 training rows;
после fit они удаляются. Incremental/targeted patch fit без reset не поддерживается.
В local comparison все модели усредняют пересечение full/core-usable captures,
не разные поднаборы одного click window. Timing extraction, fit/CV и regression
разделены; это не end-to-end latency или FPS acceptance.
Prediction не получает target; модель не обучается по мыши, AOI или контрольным
целям. Методологическая ссылка — в THIRD_PARTY_LICENSES, код/веса WebGazer
не включены. Reports не содержат patch images/vectors или ridge weights.

Full-patch получает тяжёлую ошибку на synthetic lid-pixel shift при неизменном
baseline gate. Core снижает именно эту зависимость, но теряет часть информации
и не защищает от больших изменений/окклюзий. Это исследовательские прототипы,
не доказанное улучшение real-camera accuracy/drift. Оба запрещены в ingest;
production default по-прежнему `same_eye_iris.v2`.
Методика и отрицательные результаты: [отчёт v6](../../../../docs/reports/2026-11-07-issue143-eye-appearance.md).

### Gradient-center experiment — не default

Тот же explicit `experimentalEyePatch` opt-in допускает `region: 'gradient'`
(lateral support) и `'gradient_all'` (all directions). Вместо яркостей grid
в ridge идут четыре координаты центров в corner/eye-width системе. Сама
локализация не читает iris/eyelid landmarks: только corners и pixels текущего
завершённого кадра. Базовые eye/head/iris gates остаются прежними.

40×24 eye grid → binomial smoothing → strong gradient directions → dark-center
weighted objective → stride-2/5×5 refinement → parabolic subpixel center.
Отсутствие центра/невидимый crop даёт missing, не last gaze. Есть отдельные tags
`eye_gradient_iris.experimental.v1` / `eye_gradient_all_iris.experimental.v1`;
оба запрещены ingest. В памяти нет истории изображений; training rows очищаются
до callback, stop/reset удаляет веса/ссылки. Model selection только calibration CV.

`?models=gradient` создаёт короткую v7: baseline/full-patch/all/lateral на общих
кадрах, прежняя calibration/correction, одна 9-target проверка **без** 4-минутного
интервала (`intervalMs=0`, `after=[]`). Это spatial comparison, не новый drift
pass. Не выбирать вариант по synthetic результату и не объявлять AOI пригодными
без real-device/full-protocol приёмки. Блики и near-closure остаются ограничениями.
Подробности: [отчёт v7](../../../../docs/reports/2026-11-07-issue143-eye-gradient.md).

Локальный `?models=tophat&pose=1` — v10: baseline, full patch, Gradient All и
`eye_tophat_ridge.experimental.v1`. Горизонтальный black top-hat на
corner-aligned grid 32×20, pooling 2×2, 320 признаков; `region:'tophat'` —
только explicit constructor opt-in. Общий subset калибровки full/all/tophat,
прежние head/iris gates, correction и target-group CV. Протокол не выбирает
этот метод, ingest его отвергает, production default не меняется. Есть
synthetic regressions на texture/near-closure; данных webcam acceptance нет.
Сценарий A–B–A и результаты: [отчёт v10](../../../../docs/reports/2026-11-08-issue143-eye-tophat.md).

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
3. Residual-bias correction выбирается только при LOOCV минимум по пяти целям и
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
    // Пример формы; применять только после независимой приёмки correction.
    offsetX: 3,
    offsetY: -2,
    source: 'validation_residual_bias_loocv'
});
tracker.updateScreenSize(viewport.width, viewport.height);
tracker.resetSmoothingState();
tracker.reset();
```

## Ограничения

### Локальные варианты модели (не production default)

Только диагностика `?models=ablation` создаёт четыре regressions на **одной**
камере/MediaPipe inference: baseline, camera-pixel quadratic, normalized linear,
camera-pixel linear. Constructor `experimentalModel` требует geometry/basis и
размер исходного capture; координаты target/стимула в `predict()` не передаются.
В camera-pixel варианте геометрия вычисляется в общем масштабе `x, y*height/width`
(эквивалентно `x*width,y*height` с общим делителем). Linear удаляет только три
квадратичных/смешанных члена, не меняет fit targets, ridge candidates или min rows.
Confidence/head/iris-OOD используют исходные normalized baseline groups во всех
вариантах. Fit/correction независимы для каждого; before/after ничего не обучают.
API не принимает tags `camera_pixel_{quadratic,linear}.experimental.v1` и
`normalized_linear.experimental.v1`. Default `same_eye_iris.v2` не заменён.

Управляемый pixel-roll на прямоугольном synthetic кадре обнаруживает геометрическую
чувствительность baseline, но не объясняет весь реальный drift. Lids-only case
остаётся плохим у всех четырёх; linear хуже quadratic на известной нелинейной
synthetic mapping. Нужен real-device paired benchmark, не автоматический выбор.

Диагностический `?models=axis` (`issue143_axis_regularization.v5`) сравнивает
12 regressions: default quadratic-auto, linear-auto, каждую формулу с фиксированной
λ из `[.001,.01,.1,1]`, mixed X-quadratic/Y-linear с отдельной λ, и `axis_auto`.
Последний выбирает и basis, и λ независимо для X/Y по калибровке. Он не обязан
быть линейным по Y и не переключается на основании текущей цели/времени сессии.
Каждый held-out fold исключает оба клика цели; mean/std считаются без этого fold.
Контрольные before/after targets ничего не выбирают и не обучают. Голова,
confidence, iris-OOD и набор входных кадров остаются общими.

`getCalibrationDiagnostics()` возвращает копию агрегированной CV-кривой (4 строки
для одной формулы, 8 для `axis_auto`), basisX/Y и lambdaX/Y. Training rows,
landmarks и веса не экспортируются. Совместимый scalar `selectedRidgeLambda`
обозначает λX; для λY смотреть `ridgeSelection.lambdaY` в JSON v5. Минимум той
же CV-кривой после выбора модели оптимистичен и **не** заменяет независимую
validation. Fixed-λ controls не используют CV для выбора λ. Ни один новый
experimental method не разрешён сервером и не включён основным flow.

Повторяемая проверка: `node scripts/reference-data/issue143-axis-synthetic.mjs`.
Она содержит linear/nonlinear truth, шум, общий ненаблюдаемый сдвиг входа и
negative nonlinear-Y case. Принудительный mixed не универсален, а auto-selection
не восстанавливает отсутствующий/изменившийся вертикальный сигнал. Это
проверка регрессии на искусственных входах, не проверка точности webcam.

Калибровка основного flow и локальная диагностика v3 используют общий
`calibration-capture.mjs` (`click_capture.v1`): 25 точек × 2 клика, ближайшие
свежие capture frames после клика, без ожидания перед сбором. Duplicate/stale
кадры и закрытые глаза не входят в usable minimum; отвергнутый глаз/pose
сбрасывает неполную серию. Сбор ограничен 2000 ms, действует прежний first-attempt
минимум/pose limits без ослабления после неудачных кликов. Это не гарантия
устойчивости к дрейфу; модель требует новой real-camera проверки.
`validation-metrics.mjs` разделяет прежние correction/independent benchmark
вычисления с диагностикой. V3 оценивает raw/corrected одной модели, не включает
экспериментальный predictor и не воспроизводит весь multimodal pipeline.

`onCalibrationComplete` — уведомление: его исключение или отклонённый Promise
не отменяет уже рассчитанную калибровку и не меняет коэффициенты/предсказания.
Готовность определяется результатом `calibrate()` и `isCalibrated()`.
Ошибки внутреннего расчёта по-прежнему возвращают `false`; необязательная
диагностика пишет фиксированный код, а не исключение с данными калибровки.

- Обычная RGB-камера не обеспечивает точность лабораторного IR eye tracker.
- Метрики саккад, микросдвигов и hippus являются webcam proxies и не должны
  использоваться как клинический диагноз.
- При выходе head/iris за calibration distribution кадр намеренно теряется,
  а не экстраполируется.
- Изменение положения камеры или окна после калибровки требует повторной
  validation и, при необходимости, калибровки.
- Высокая доступность/confidence не подтверждает попадание в AOI. Средняя
  ошибка pre-session validation и SD её радиальных ошибок не измеряют дрейф
  на протяжении блока; SD радиальных ошибок не равна пространственному jitter.

## Лицензии и источники

Отдельное сравнение в developer panel: `apps/participant-web/tools/gaze-benchmark.html`.
Baseline/full patch/Gradient All/top-hat получают общие кадры; fixed spatial,
posture и temporal программы. Локальный JSON, без автоматической отправки;
camera требует согласия и свежего admin/developer auth. Это не новый default и
не приёмка accuracy. Методика/приватность/rollout:
`docs/reports/2026-11-08-issue143-developer-benchmark.md`.

- MediaPipe: Apache-2.0.
- Код проекта: Apache-2.0.
- Научные и web-platform основания перечислены в
  `docs/research/gaze-blink-body-methods.md`.
