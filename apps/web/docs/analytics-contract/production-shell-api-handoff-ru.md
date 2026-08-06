# Production-каркас аналитики: передача backend

Статус frontend: реализован API-driven shell без автоматического demo fallback.

## Используемые сейчас запросы

```http
GET /projects
GET /protocols?project_id={projectId}
GET /sessions?project_id={projectId}&protocol_id={protocolId}
GET /analytics/v1/filter-options?project_id={projectId}&protocol_id={protocolId}&protocol_version={version}
POST /analytics/v1/snapshots
```

Frontend принимает как массив, так и envelope с массивом в `items`, `results`, `data`, `projects`, `protocols` или `sessions`.

Минимальные поля:

- project: `id`, `name`;
- protocol: `id`, `name` или `definition.title`;
- session: `id`, `session_id`, `participant_id`/`participant_alias`, `status`, `started_at`, `stopped_at`, `qc_validity`.

Все идентификаторы могут быть строками или числами, но frontend сравнивает их как строки.

## Состояния ответа

- `200` и непустой массив — `ready`;
- `200` и пустой массив — `empty`, это не нулевой результат;
- `401`/`403` — `unauthorized`;
- прочие ошибки — `error`;
- во время запроса — `loading`.

При `error` и `unauthorized` предыдущие показатели не показываются. Без API-токена production UI не отображает научные числа.

## Единая выборка AN-FE-04

Frontend формирует объект строго по `analytics-query-v1.schema.json` и передаёт его телом `POST /analytics/v1/snapshots`. Ответ должен соответствовать `examples/analysis-snapshot.json`.

Черновик сохраняется одним ключом `emocog_analytics_query_draft_v1` и восстанавливается после refresh. Каскадные сбросы:

- project сбрасывает protocol/version/session/block/stimulus/AOI;
- protocol/version сбрасывает session/block/stimulus/AOI;
- block сбрасывает stimulus/AOI;
- stimulus сбрасывает AOI.

До успешного snapshot дашборд не показывает результаты. После ответа UI показывает `snapshot.id`, `datasetHash` и число `includedSessionIds`. Этот же snapshot ID должны принимать export и статистические endpoints.

`GET /analytics/v1/filter-options` ожидает:

```json
{
  "blocks": [{ "id": "main-block", "name_ru": "Основная часть", "name_en": "Main task" }],
  "stimuli": [{ "id": "stimulus-42", "blockId": "main-block", "name_ru": "Целевой стимул", "name_en": "Target stimulus" }],
  "aois": [{ "id": "aoi-target", "stimulusId": "stimulus-42", "name_ru": "Целевая область", "name_en": "Target AOI" }],
  "groups": [{ "id": "control", "name_ru": "Контрольная группа", "name_en": "Control group" }],
  "conditions": [{ "id": "condition-a", "name_ru": "Условие A", "name_en": "Condition A" }],
  "comparisons": [{
    "id": "clinical-vs-control",
    "name_ru": "Клиническая vs контрольная",
    "name_en": "Clinical vs control",
    "factorIds": ["group"],
    "contrastIds": ["clinical-vs-control@condition-a"],
    "groupIds": ["control", "clinical"],
    "conditionIds": ["condition-a"],
    "metricId": "aoi.dwell_time_ms"
  }],
  "qcChannels": ["task", "gaze"],
  "dateMin": "2026-08-01",
  "dateMax": "2026-08-05"
}
```

Если endpoint вариантов ещё не реализован, project/protocol/session остаются рабочими, а UI явно сообщает, что block/stimulus/AOI недоступны.

Фильтра типа устройства в UI нет и `deviceClasses` не отправляется: participant flow рассчитан только на компьютеры. Device/browser/resolution сохраняются как технические атрибуты сессии для QC и диагностики.

## Карточка сессии AN-FE-05

После создания snapshot frontend выполняет:

```http
GET /analytics/v1/sessions/{sessionId}/summary?snapshot_id={snapshotId}
```

Ответ должен иметь `kind: "session_summary"` и соответствовать `analytics-response-v1.schema.json`. Frontend отклоняет ответ, если `snapshot.id` не совпадает с запрошенным snapshot.

Обязательные данные:

- session metadata: participant alias, completion status, protocol/version, timestamps, resolution и FPS;
- отдельный QC для каждого реально подключённого канала: status, valid fraction, signal confidence, reasons и rule version;
- task metric results с `nObservations`, scope, QC и algorithm version;
- для процентов — обязательные `numerator` и `denominator`;
- для RT — `distribution` с median, Q1, Q3, mean и SD;
- `task.trial_count_valid` и `task.trial_count_excluded`;
- exclusions с entity ID, reason code и channel.

Frontend не вычисляет IQR, mean или SD из сырых trial-массивов. `0` передаётся как computed value; отсутствие результата передаётся статусами `no_data`, `no_event`, `insufficient_quality`, `not_configured` или `not_applicable`.

## AOI и heatmap AN-FE-06

После выбора конкретных block и stimulus frontend параллельно выполняет:

```http
GET /analytics/v1/sessions/{sessionId}/aoi?snapshot_id={snapshotId}
GET /analytics/v1/sessions/{sessionId}/heatmap?snapshot_id={snapshotId}
```

Frontend не вызывает эти endpoints без block/stimulus-контекста и проверяет совпадение `stimulus.id` и `stimulus.version` в двух ответах.

Требования к backend:

- AOI и fixation coordinates нормализованы относительно фактического stimulus content rect: `stimulus_normalized_0_1`;
- AOI привязаны к immutable protocol/block/presentation/stimulus version из session snapshot;
- rectangle и polygon возвращаются в одной AOI schema;
- проценты содержат numerator/denominator, каждая метрика — N, QC, scope и algorithm version;
- `TTFF` имеет `status: "no_event"`, если фиксация не наступила до конца показа;
- heatmap grid содержит только валидные фиксации и не смешивает low confidence, off-screen и outside stimulus;
- при `nFixations: 0` frontend показывает no data, а не пустую «нулевую» карту;
- session heatmap может передавать необязательные `fixationPoints`; frontend не строит их из сырых samples;
- legend использует `normalizationMode`, smoothing, `nFixations`, valid observation duration и algorithm version из ответа.

Export и последующие AOI endpoints должны принимать тот же snapshot ID.

## Групповой дашборд AN-FE-07

Для snapshot с `mode: "group"` frontend выполняет:

```http
GET /analytics/v1/groups/summary?snapshot_id={snapshotId}
GET /analytics/v1/groups/heatmap?snapshot_id={snapshotId}
```

Group summary должен содержать:

- главное N участников, отдельно N сессий и N наблюдений;
- channel-specific QC counts;
- missingness и причины исключения;
- participant-level values для визуализации распределения;
- median, Q1/Q3, mean, SD, min/max;
- participant-level 95% CI и название метода;
- numerator/denominator или valid observation duration;
- metric scope и algorithm version.

Frontend не рассчитывает агрегаты или CI. Gaze-сэмплы и отдельные trials не используются как независимое N участников.

Group heatmap принимается только с `equalParticipantWeight: true`:

```text
среднее сессий участника
→ среднее участников
```

Количество сессий или кадров одного участника не должно увеличивать его вес. При несовпадении этого флага frontend отклоняет ответ. Device composition остаётся только в сворачиваемой технической диагностике.

## Сравнения Level 2 AN-FE-08

Frontend показывает только определения из `filter-options.comparisons`. После создания group snapshot с `analysisLevel: "level_2"` и каноническими `comparison.factorIds/contrastIds` выполняется:

```http
GET /analytics/v1/comparisons/{comparisonId}?snapshot_id={snapshotId}
```

Ответ имеет `kind: "model_result"` и соответствует `examples/model-result-response.json`. Backend обязан вернуть:

- readiness: `available`, `insufficient_data`, `confounded` или `not_configured`;
- `readinessChecks` для sample size, repeated measures, channel/version compatibility и technical confounding;
- причину и warnings как стабильные codes;
- при `available`: effect, unit, reference/comparison levels, 95% CI, adjusted p-value, adjustment method, model ID/version/formula, N participants и N observations;
- при блокировке: nullable effect/CI/p-value, а не нули.

Frontend не выбирает тест, не строит формулу и не рассчитывает p-value. Полное совпадение группы с camera model, protocol version или другим техническим фактором должно давать `confounded` и блокировать результат. Effect и CI в UI первичны; adjusted p-value отображается нейтрально.

## Export AN-FE-09

Frontend выполняет только следующий запрос, без независимых фильтров:

```http
GET /analytics/v1/exports?snapshot_id={snapshotId}&format={csv|json}&content={summary|long|both}
```

Обязательные response headers:

```text
X-Analysis-Snapshot-Id: {snapshotId}
X-Dataset-Hash: {datasetHash}
```

При несовпадении любого значения frontend отклоняет файл. JSON соответствует `analytics-export-v1.schema.json`; пример — `examples/analytics-export-both.json`. CSV должен содержать те же сведения в строках типов `counts`, `dictionary`, `metric`.

Обязательные правила:

- counts participants/sessions/observations совпадают с дашбордом;
- в файл входят query echo, QC mode/channels, versions, dictionary и provenance;
- проценты сохраняют numerator/denominator;
- отсутствие значения сохраняется как пустое/`null` вместе со `status` и `reason`, никогда как искусственный `0`;
- имя файла содержит protocol version и snapshot ID.

## Проверки AN-FE-10

Frontend e2e находится в `tests/analytics-production.spec.ts`, конфигурация — `playwright.analytics.config.ts`. Он покрывает block-scoped AOI для общего training/main stimulus, analyticsPlan overrides, session AOI/heatmap, resize, snapshot export, nullable states, group N и RU/EN accessibility labels.

## Demo-режим

Legacy dashboard доступен только при явном development-флаге:

```text
?analyticsDemo=1
```

или:

```js
window.__EMOCOG_ANALYTICS_DEMO__ = true;
```

В production-маршруте заполненный `SESSION_DATA` не создаётся и bridge не внедряет старый session picker.

Для просмотра будущего API-driven интерфейса с одной условной завершённой сессией используется отдельный frontend-preview:

```text
?analyticsPreview=1#/analytics/session-card
```

Preview явно помечен и повторяет versioned session-summary contract; он не включается автоматически при отсутствии API.

## Следующие backend endpoints

Для production analytics нужны versioned endpoints, возвращающие структуры из:

- `analytics-query-v1.schema.json`;
- `analytics-response-v1.schema.json`;
- примеров `session-summary`, `session-aoi`, `group-summary`, `group-heatmap`;
- единого export, принимающего тот же query или `analysisSnapshotId`.
