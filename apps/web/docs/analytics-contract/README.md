# Emocog Analytics Contract v1

Этот каталог — общий договор между:

- шагом «Аналитика» в конструкторе;
- разделом «Инструменты аналитики»;
- participant/data pipeline;
- backend analytics и export.

Статус версии `1.0`: **draft для согласования frontend/backend и научного руководителя**. До начала основного сбора необходимо зафиксировать спорные методические параметры и выпустить утверждённую версию.

## Состав

| Файл | Назначение |
|---|---|
| `analytics-plan-v1.schema.json` | Что конструктор сохраняет в `protocol.definition.analyticsPlan` |
| `analytics-query-v1.schema.json` | Единая выборка для UI, групповых расчётов и export |
| `analytics-response-v1.schema.json` | Общий API envelope и записи session/AOI/heatmap/group/model |
| `analytics-export-v1.schema.json` | Snapshot-based JSON export, long-format rows, dictionary и provenance |
| `metric-catalog-v1.json` | Стабильные metric IDs, названия, единицы, зависимости и правила агрегации |
| `examples/protocol-with-analytics-plan.json` | Протокол с общим профилем и отдельным training override |
| `examples/analysis-query-session.json` | Запрос выборки одной сессии |
| `examples/analysis-snapshot.json` | Зафиксированная воспроизводимая выборка |
| `examples/session-summary-response.json` | Метаданные, channel QC и task metrics одной сессии |
| `examples/session-aoi-response.json` | AOI-ответ, различающий реальный `0` и `no_event` |
| `examples/session-heatmap-response.json` | Session heatmap и нормализованные fixation points |
| `examples/group-summary-response.json` | Level 1 group summary с participant-level values и CI |
| `examples/group-heatmap-response.json` | Group heatmap с равным весом участников |
| `examples/model-result-response.json` | Level 2 readiness/result; пример блокировки confounded-анализа |
| `examples/analytics-export-both.json` | Export summary + long-format с `null + status/reason` |

Каталог версии 1.1 содержит 39 записей, но это не означает 39 карточек на экране. В него входят визуализация heatmap, пользовательские outcomes, дополнительные export-показатели и обязательный технический QC-контекст. Конструктор группирует показатели в компактные пакеты; фоновым сигналам соответствует пакет continuous_signals.

## RT Connectedness Extension (2026-10-08)

Session summaries optionally include `data.connectedness`, with the bounded
`rt_alignment.v1` windows, session ID, source and a descriptive-only policy.
Generic JSON selection exports include this report per session; the Connectedness
tab also exports snapshot-bound long-format CSV/JSON. Existing metrics retain
their IDs. This extension does not add group inference or raw video replay.

### Interactive Selection And Background Signals (2026-10-19)

The timeline, scatter points and table select the same trial. Previous/next,
keyboard activation, an explicit trial selector and 5 s / 30 s zoom are available.
The detail panel shows all recorded channels before the stimulus, until response
and after the trial, with valid/total sample counts and maximum signal gaps.

Catalog 1.1 adds nine `continuous_signals` metrics, defined in the shared registry
`apps/shared/passive-metrics.js`: heart rate, respiration, blink count/rate,
60 s PERCLOS, body mean/retained-sample P95 velocity and facial valence/arousal
proxies. Session/group cards and snapshot exports include these metrics even
for a historical analytics plan which did not select this new package.
The session PDF includes the currently displayed background-signal section.

Unknown/missing data remains `null + status/reason`. A measured zero is retained;
unknown sample counts remain unknown, not one. PERCLOS60 requires at least 60 s
of recorded eye-series time; incomplete recovered eye histories abstain. This
duration check alone is not independent signal validation. Body P95 refers only
to retained observations. Legacy physiology method versions are labelled.

Whole-session summaries return `session_summary_not_interval` when a block,
condition, stimulus or AOI filter is selected. Group aggregation averages sessions
within each participant before computing the participant-level distribution;
frames or numbers of sessions do not increase a participant's weight. This is
descriptive analysis, not inferential comparison of physiological conditions.

`event-windows-1.1.0` optionally adds respiration while retaining compatibility
with 1.0.0 reports. Respiration requires fresh, non-held published estimates,
confidence >=0.20 and the existing 6-24/min range. Short RT windows around rolling
BPM/respiration are contextual only; correlations for these channels are disabled.
No ECG/RR intervals, HRV, clinical mood or microsleep diagnosis is produced.

Scientific and product rationale:

- [iMotions official analysis documentation](https://imotions.com/products/imotions-lab/features/analysis/): synchronized event context, interactive visualization and timeline zoom as UX reference, not evidence of this product's accuracy.
- [A linear model for event-related respiration responses](https://discovery.ucl.ac.uk/1522233/1/1-s2.0-S0165027016301224-main.pdf): event-related respiration requires an explicit signal model and design. Our short-window rolling-rate context is not an implementation or validation of that model.

## Publication Versions And Descriptive Comparisons (2026-10-16)

`protocolVersion` identifies an immutable publication, not the JSON format:
`publication:2`, historical `invitation:123`, or `legacy` for sessions without
an invitation binding. GET `/protocols` lists `versions`; GET `/sessions` accepts
`protocol_version` and `include_incomplete`. Filter options, snapshots, images,
AOIs and exports use the selected publication definition. A format tag such as
`v2.0_universal` is rejected with 409 when published definitions differ.
Unverified imports retain session/task metrics but never borrow current AOIs or
media. Existing snapshots using the previous fingerprint must be recreated.

Group level-2 supports custom **descriptive** comparisons via the canonical
query `comparison` object, without configuring a backend preset:

```json
{
  "design": "paired",
  "axis": "condition",
  "metricId": "task.rt_mean_ms",
  "referenceId": "A",
  "comparisonId": "B"
}
```

The independent design replaces `axis` and level IDs with nonempty disjoint
`referenceParticipantIds` and `comparisonParticipantIds` (up to 500 each).
Participant IDs must belong to the selected protocol publication and project.
Trial-level selection filters are incompatible with this custom design; common
QC/date filters remain active. GET `/comparisons/custom?snapshot_id=...` returns
the snapshot-bound result. JSON/CSV exports include the same result and query.

Supported outcomes: mean correct-valid RT, median correct-valid RT, and accuracy
among quality-valid trials with a boolean correctness result. Trials are pooled across sessions per participant;
participant estimates then receive equal weight. Paired comparisons retain only
complete pairs; independent groups cannot overlap. Difference is B minus A;
accuracy differences are percentage points, not relative percentage changes.
Missingness, participant N and trial counts are explicit. Confidence intervals
and p-values remain null: no significance claim or approved inferential model
is implied. The implementation rejects datasets above 2000 sessions rather than
silently truncating the analysis. Paginated analysis is a separate follow-up.
The ingest schema is `packages/shared/contracts/rt-alignment.v1.schema.json`;
the API exposes it at `/contracts/rt-alignment.v1.schema.json`.
See `docs/research/rt-connectedness-methods.md` for timing, missingness and
scientific acceptance requirements. Legacy sessions remain event-only.

## Главные правила контракта

### 1. Metric ID стабилен

UI, protocol, backend и export используют один ID, например:

```text
aoi.ttff_ms
task.rt_median_ms
qc.valid_gaze_pct
```

Названия на русском и английском берутся из каталога и не передаются как идентификаторы.

### 2. `analyticsPlan` — план отчёта

Он задаёт, что показывать по умолчанию. Он не является разрешением удалить или не собирать исходные обезличенные события, необходимые для повторного расчёта.

`data_quality` обязателен в общем профиле и каждом block override.

### 3. `0` не равен отсутствию результата

- `value: 0, status: computed` — реальный нулевой результат;
- `value: null, status: no_event` — наблюдение было, событие не произошло;
- `value: null, status: no_data` — исходных данных нет;
- `value: null, status: insufficient_quality` — данные не прошли QC;
- `value: null, status: not_configured` — канал/метрика не настроены;
- `value: null, status: not_applicable` — метрика неприменима;
- `value: null, status: failed` — ошибка расчёта.

Frontend не должен использовать `value || 0`.

### 4. Два разных вида неопределённости

- `signalConfidence` — качество сигнала или уверенность алгоритма, диапазон 0–1;
- `estimateCi95` — доверительный интервал групповой оценки.

Их нельзя объединять в одно поле `confidence`.

### 5. QC по каналам

Канонические значения `qc.status` в API — lowercase:

```text
valid | borderline | invalid | not_computed
```

Frontend отображает локализованные `VALID/BORDERLINE/INVALID`, но не меняет семантику. Общий session QC может использоваться для навигации, однако пригодность метрики определяется QC соответствующего канала.

Первая версия резервирует каналы:

```text
task | gaze | blink | face | head_hands | rppg | respiration
```

В первой волне обязательны реально поддержанные `task` и `gaze`; остальные не должны изображаться как вычисленные, если данных нет.

### 6. Всегда сохраняются N и знаменатель

Метрика сопровождается:

- `numerator` и `denominator`, когда применимо;
- `observationDurationMs`;
- `nParticipants`;
- `nObservations`;
- QC и algorithm version.

Для группы `nParticipants` — главное N. Gaze-сэмплы не считаются независимыми участниками.

### 7. TTFF связан с Target reached

Если валидное наблюдение завершилось без фиксации на AOI:

```json
{
  "metricId": "aoi.ttff_ms",
  "value": null,
  "status": "no_event",
  "reason": "target_not_reached_before_presentation_end"
}
```

TTFF на группе описывается среди достигших AOI и всегда показывается рядом с `aoi.target_reached_pct`.

### 8. Один query и snapshot

`deviceClasses` остаётся необязательным техническим полем контракта для совместимости и диагностики. Текущий frontend не показывает этот фильтр и не отправляет его, поскольку participant flow поддерживает только компьютеры.

Frontend создаёт один `analytics-query-v1`, backend фиксирует:

- включённых участников и сессии;
- исключения и причины;
- protocol/stimulus/AOI/QC/algorithm versions;
- `datasetHash`.

Карточки, графики, Level 2 models и export используют один `snapshot.id`.

Для распределяемых метрик, например RT, backend дополнительно передаёт `distribution`: `n`, `median`, `q1`, `q3`, `mean`, `sd`, `min`, `max`. Frontend только форматирует эти значения и не пересчитывает статистики локально.

### 9. Group heatmap имеет равный вес участников

Агрегация выполняется так:

```text
session heatmap
→ среднее сессий участника
→ среднее участников группы
```

Для group response обязательно `equalParticipantWeight: true`.

Group summary передаёт participant-level values. Median/IQR, mean/SD и CI рассчитываются backend на уровне участников; frontend использует индивидуальные точки только для отображения распределения.

### 10. Normalized coordinate space

AOI и heatmap используют:

```text
coordinateSpace = stimulus_normalized_0_1
```

Координаты считаются относительно фактического content rect stimulus с учётом letterboxing, а не относительно viewport.

Для одной сессии heatmap может дополнительно содержать `fixationPoints` с нормализованными `x/y`, duration и signal confidence. Сырые gaze-сэмплы frontend для этого не восстанавливает.

### 11. Level 2 задаётся заранее

Список доступных сравнений приходит из `filter-options.comparisons`. Frontend передаёт выбранные factor/contrast IDs и показывает готовый `model_result`, но не выбирает статистический тест и не вычисляет модель.

При `confounded`, `insufficient_data` или `not_configured` effect, CI и p-value остаются `null` и не заменяются нулями. Backend возвращает отдельные readiness checks и блокирует сравнение, если исследуемый фактор совпадает с camera/protocol version или другим техническим фактором.

## Как использует frontend

1. Конструктор читает `packages` и `metrics` из catalog.
2. Доступность метрики определяется её `requires` и содержимым protocol block.
3. При сохранении формируется `analyticsPlan`.
4. Analytics filters формируют `analytics-query-v1`.
5. API responses валидируются на границе data layer.
6. UI форматирует значения по catalog и `status`.
7. Export получает snapshot ID, а не независимо собранные фильтры.

## Что требуется от backend

1. Сохранять `analyticsPlan` в protocol definition без переименования metric IDs.
2. Фиксировать immutable protocol/stimulus/block-scoped AOI snapshot для session.
3. Вернуть channel-specific QC и reasons.
4. Реализовать versioned fixation/AOI pipeline.
5. Возвращать metric status, N, denominator, valid time и algorithm metadata.
6. Создавать immutable analysis snapshot с query echo и dataset hash.
7. Считать group summaries на уровне участников.
8. Строить group heatmap с равным весом участников.
9. Рассчитывать Level 2 model result и readiness только на backend.
10. Создавать export по snapshot ID.
11. Не возвращать demo fallback из production endpoints.

## Export по той же выборке

Экран export не имеет собственных project/QC/date-фильтров. Он использует только уже созданный `snapshot.id` и показывает его `datasetHash`, query echo, versions и N до скачивания.

Backend отвечает на `GET /analytics/v1/exports` и обязательно возвращает заголовки `X-Analysis-Snapshot-Id` и `X-Dataset-Hash`. Frontend блокирует файл, если они отличаются от открытого дашборда. JSON соответствует `analytics-export-v1.schema.json`; CSV содержит строки `counts`, `dictionary` и `metric`. Nullable metric сохраняется как пустое значение плюс ненулевой `status/reason`, а не как `0`.

## Что ещё должно быть научно утверждено

До смены статуса catalog с `draft` на `approved` необходимо решить:

1. Dwell time: только фиксации или все валидные gaze points.
2. Точка отсчёта TTFF: stimulus onset или AOI validity start.
3. Fixation detector, параметры и допустимые gaps.
4. Confidence threshold и channel QC thresholds.
5. Правило overlaps нескольких AOI.
6. Знаменатель gaze-on-target.
7. Минимальное N для CI и Level 2 readiness.
8. Допустимое объединение device/protocol/AOI versions.

После утверждения изменяется `catalogVersion` и соответствующие algorithm/QC versions. Семантику выпущенной версии нельзя менять задним числом.

## Совместимость с текущим проектом

- Текущий `analyticsConfig.tabs` считается legacy и мигрируется в `analyticsPlan`.
- Текущие backend IDs `rt_median`, `omission_rate`, `commission_rate` могут оставаться внутренними. API analytics v1 отображает их на публичные ID из catalog.
- Текущий session-level `qc_validity` может временно использоваться как navigation badge, но не заменяет channel QC.
- Старый `/analytics/group` не соответствует этому контракту; рекомендуется новая versioned API-группа `/analytics/v1`.

## Проверка файлов

Минимальная синтаксическая проверка из `apps/web`:

```powershell
Get-ChildItem docs\analytics-contract -Recurse -Filter *.json |
  ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json | Out-Null }
```

Следующий шаг — добавить contract tests с JSON Schema validator на frontend и backend.
