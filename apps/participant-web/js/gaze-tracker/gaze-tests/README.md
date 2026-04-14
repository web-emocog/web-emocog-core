# Gaze Tests Module

Подпапка `gaze-tests` содержит отдельные исследовательские тесты, которые запускаются через Test Hub после калибровки и валидации.

## Что здесь есть

- `index.js` — оркестратор Test Hub (`RT / Tracking / VPC / Visuospatial`), возврат в меню после завершения теста.
- `session-schema.js` — additive-расширение `sessionData` полями `testHub` и `gazeTests`.
- `common/analysis-loop.js` — single-flight цикл анализа кадров для custom gaze-тестов (VPC/visuospatial).
- `vpc/*` — протокол Visual Paired Comparison с fallback загрузки стимулов и метриками novelty preference.
- `visuospatial/*` — тест рисования взглядом (случайный prompt из круга/часов/человечка) + агрегаты траектории.

## Протоколы

### VPC (Felidae)

- 12 trials
- `fixation=800ms`
- `familiarization=2500ms`
- `ISI=500ms`
- `pair=3500ms`
- `ITI=700ms`
- Стимулы загружаются с Wikimedia Commons (open-license).
- Fallback: при ошибке загрузки берётся другой стимул из того же species-пула; если не удалось — trial помечается `skipped`.

Считаемые run-level метрики:
- `validTrials`
- `meanNoveltyPreferencePct`
- `totalLookMs`

### Visuospatial drawing

- Случайный prompt из 3: `draw_circle`, `draw_clock`, `draw_person`
- Рисование запускается вручную кнопкой.
- Timeout: `60s`.
- Пользователь видит gaze-dot и след линии на «листе».

Считаемые run-level метрики:
- `pointCount`
- `pathLengthPx`
- `drawingDurationMs`
- `coveragePct`
- `boundingBox`
- `idlePct`
- `onScreenPct`

## Влияние на QC

- Новые тесты исследовательские (`research-only`).
- `qcSummary.overallPass` не зависит от метрик VPC/visuospatial.

## Лицензии

- Источники изображений и атрибуция: `VPC_ATTRIBUTION.md`.
- Базовая политика зависимостей: `docs/THIRD_PARTY_LICENSES.md`.
