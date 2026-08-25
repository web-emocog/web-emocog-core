# Аналитика Emocog: последовательный frontend-backlog и передача backend-команде

**Основание:** `Аналитика.pdf` и `комментарии.docx`
**Frontend-зона:** шаг «Аналитика» в конструкторе протокола и раздел «Инструменты аналитики»
**Цель первой волны:** до начала исследований получить воспроизводимую аналитику реальных сессий и групп без demo-значений.

## 1. Итоговое направление

В первой волне frontend должен поддерживать четыре раздела:

1. **Сессия** — результаты одного участника и выполнения задач.
2. **AOI и heatmap** — stimulus, heatmap и показатели по AOI.
3. **Группа** — состав выборки, распределения и описательные сравнения.
4. **Качество данных** — QC по каналам, пропуски и причины исключения.

В групповой аналитике предусматриваются три уровня:

- **Уровень 1 — «Описание и качество»**: реализуется сейчас полностью;
- **Уровень 2 — «Сравнение групп/условий»**: сейчас готовим интерфейс и API-контракт; расчёты подключаем после готовности backend-моделей;
- **Уровень 3 — «Продвинутый анализ»**: показываем только как будущий модуль, без псевдорезультатов.

Главное правило: production UI никогда не подставляет demo-данные. Допустимы отдельные dev-fixtures для разработки, которые невозможно включить в production случайно.

## 2. Что есть сейчас и чего не хватает

### Конструктор

Сейчас шаг «Аналитика»:

- включает и выключает четыре demo-вкладки;
- хранит выбор в `localStorage` как `analyticsConfig.tabs`;
- не позволяет выбирать пакеты или конкретные метрики;
- не поддерживает настройки отдельных задач/блоков;
- сохраняет конфигурацию в protocol definition, но её модель не соответствует новым требованиям.

### Инструменты аналитики

Сейчас:

- `researcher-analytics.js` начинается с заполненного demo-объекта `SESSION_DATA`;
- групповой, QC- и connectedness-дашборды используют демонстрационные наборы;
- API bridge подмешивает реальные поля в demo-объект и при ошибке возвращается к demo;
- селектор session добавляется monkey patch-слоем, а не является частью общего состояния фильтров;
- отсутствуют AOI-таблица и heatmap по реальным данным;
- `0`, no data и неприменимые показатели не имеют единой модели состояния.

### Доступный backend

Уже существуют полезные основы:

- `GET /projects`;
- `GET /protocols?project_id=`;
- `GET /sessions?project_id=&protocol_id=&date_from=&date_to=&qc_validity=`;
- `GET /sessions/:id`;
- `GET /analytics/group`;
- `GET /analytics/qc`;
- `GET /analytics/features`;
- `GET /export`.

Но текущих контрактов недостаточно:

- групповой endpoint считает в основном средние по старому набору `attention/arousal/valence/blinks/rt/omissions`;
- нет dwell, fixations, TTFF, revisits, Target reached и AOI-heatmap;
- QC хранится преимущественно как один session-level статус;
- нет фильтров block/stimulus/AOI/QC channel/device;
- export использует другой, более узкий набор фильтров;
- нет analysis snapshot/hash;
- session связана с изменяемым protocol row, но для воспроизводимости нужен snapshot версии protocol/stimulus/AOI на момент прохождения;
- текущая aggregate-only отправка участника исключает eye-tracking arrays и heatmaps, поэтому источник данных для серверного AOI-расчёта необходимо согласовать отдельно.

## 3. Порядок нашей работы

Задания выполняются последовательно. Каждое заканчивается проверяемым артефактом, который можно передать backend-команде.

---

## Задание AN-FE-01. Зафиксировать frontend-контракты аналитики

**Статус frontend:** реализовано; contracts v1 остаются draft до научного и backend-согласования.

**Результат:** frontend и backend одинаково понимают metric IDs, состояния данных, фильтры и версии.

### Что делаем

1. Создаём versioned-схемы:
   - `analytics-plan-v1.schema.json`;
   - `analytics-query-v1.schema.json`;
   - `analytics-response-v1.schema.json`.
2. Создаём каталог метрик первой волны с русским и английским названием, единицей, применимостью и tooltip.
3. Фиксируем состояния значения:
   - `computed` — результат вычислен, включая настоящий `0`;
   - `no_event` — наблюдение было, событие не произошло;
   - `no_data` — исходных данных нет;
   - `insufficient_quality` — данные не прошли QC;
   - `not_configured` — показатель не был настроен;
   - `not_applicable` — показатель неприменим к задаче;
   - `failed` — ошибка расчёта.
4. Разводим понятия:
   - `signalConfidence` — надёжность измерения/алгоритма;
   - `estimateCi95` — 95% доверительный интервал групповой оценки.
5. Фиксируем обязательные provenance-поля: protocol, stimulus, AOI, metric, algorithm и QC rule versions.

### Минимальный объект метрики

```json
{
  "metricId": "aoi.ttff_ms",
  "value": null,
  "unit": "ms",
  "status": "no_event",
  "reason": "target_not_reached_before_presentation_end",
  "numerator": null,
  "denominator": 24,
  "observationDurationMs": 8000,
  "nParticipants": 1,
  "nObservations": 24,
  "signalConfidence": null,
  "estimateCi95": null,
  "qc": { "channel": "gaze", "status": "VALID", "validFraction": 0.91 },
  "algorithm": { "id": "gaze-aoi", "version": "1.0.0" }
}
```

### Готово, когда

- JSON schemas проходят валидацию;
- у каждой метрики есть стабильный ID;
- в схемах невозможно спутать `0`, no event и no data;
- документы переданы backend-команде до начала реализации endpoints.

---

## Задание AN-FE-02. Переделать шаг «Аналитика» в конструкторе

**Статус frontend:** реализовано; пакеты, отдельные метрики и block overrides сохраняются в `analyticsPlan`.

**Результат:** исследователь выбирает понятные пакеты результатов без перегруженного списка метрик.

### Основной экран

Показываем четыре пакета:

1. **AOI и внимание** — автоматически доступен, если в протоколе есть AOI.
2. **Выполнение задачи** — доступен только для совместимых типов задач.
3. **Групповая аналитика** — описания и подготовка сравнений.
4. **Качество данных** — обязательный пакет, полностью отключить нельзя.

Отдельные метрики находятся в закрытом по умолчанию разделе «Настроить отдельные показатели».

### Настройки по блокам

- общий профиль применяется ко всему эксперименту;
- в «Разных настройках для отдельных задач» можно задать block override;
- тренировка и основная часть имеют разные `blockId` и независимые настройки;
- настройка не выполняется для каждого trial/stimulus отдельно.

### Хранение

Заменяем `analyticsConfig.tabs` на versioned `analyticsPlan` внутри protocol definition:

```json
{
  "analyticsPlan": {
    "schemaVersion": "1.0",
    "defaultPackages": ["aoi_attention", "task_performance", "group_descriptive", "data_quality"],
    "selectedMetricIds": [
      "viz.heatmap",
      "aoi.gaze_on_target_pct",
      "aoi.dwell_time_ms",
      "aoi.dwell_time_pct",
      "aoi.fixation_count",
      "aoi.fixation_duration_median_ms",
      "aoi.ttff_ms",
      "aoi.target_reached",
      "aoi.revisit_count"
    ],
    "blockOverrides": {
      "training-block": {
        "packages": ["task_performance", "data_quality"]
      }
    }
  }
}
```

### Обязательное поведение

- выбор определяет начальный состав отчёта, но не отключает сбор исходных gaze/QC данных;
- редактирование протокола восстанавливает сохранённый `analyticsPlan`;
- старый `analyticsConfig.tabs` читается только для миграции;
- источник истины после сохранения — protocol definition из API, не `localStorage`;
- весь интерфейс работает на русском и английском.

### Готово, когда

- пакетный выбор, детальная настройка и block overrides сохраняются и восстанавливаются;
- несовместимые метрики недоступны с объяснением;
- QC остаётся обязательным;
- training/main не влияют друг на друга;
- JSON протокола соответствует schema из AN-FE-01.

### Что передаём backend

- JSON schema `analyticsPlan`;
- примеры create/update protocol;
- требование сохранять definition без потери полей;
- требование фиксировать immutable protocol/AOI snapshot для каждой session.

---

## Задание AN-FE-03. Создать production-каркас «Инструментов аналитики»

**Статус frontend:** реализовано; demo доступно только по явному development-флагу, preview помечен отдельно.

**Результат:** аналитика имеет чистый API-driven путь и предсказуемые состояния.

### Что делаем

1. Выносим все demo datasets из production-кода в dev-only fixtures.
2. Удаляем глобальный заполненный `SESSION_DATA` как источник состояния.
3. Заменяем monkey patch подход на явные модули:
   - API client;
   - analytics store/query state;
   - router/view components;
   - renderers таблиц и графиков.
4. Для каждого запроса реализуем состояния:
   - loading;
   - ready;
   - empty;
   - error;
   - unauthorized.
5. Сохраняем четыре основных раздела.
6. В «Группе» добавляем sub-tabs Level 1, Level 2 и Level 3. Level 3 остаётся заблокированным roadmap-модулем.

### Готово, когда

- без API нет ни одного научного числа;
- ошибка API не показывает старые или demo-значения;
- dev-fixtures подключаются только явным development flag;
- переключение разделов не сбрасывает активную выборку.

---

## Задание AN-FE-04. Единая панель фильтров и analysis snapshot

**Статус frontend:** реализовано; ожидаются production endpoints filter-options/snapshots.

**Результат:** карточки, графики, модели и export используют одну выборку.

### Фильтры

```text
Project
→ protocol/version
→ participant/session или group
→ block/task
→ stimulus
→ AOI
→ QC mode/channel
→ period
```

`Тип устройства` не является пользовательским фильтром: платформа поддерживает только desktop-прохождение. Device/browser/resolution остаются техническими атрибутами сессии для QC и диагностики.

### Поведение

- фильтры каскадные: изменение родителя очищает несовместимые дочерние значения;
- в режиме одной сессии session обязательна;
- session option содержит participant alias, дату, completion status и channel QC badges;
- активные фильтры всегда видны chips-строкой;
- фильтры сериализуются в URL или один shareable query state;
- кнопка «Применить» создаёт `analysisSnapshotId` и `datasetHash`;
- snapshot содержит included/excluded session IDs, версии, QC mode и причины исключения.

### Готово, когда

- любой экран получает один и тот же query object;
- refresh восстанавливает выборку;
- невозможно случайно объединить training/main или разные protocol/AOI versions;
- отображаемое число включённых наблюдений совпадает с snapshot.

### Что передаём backend

- `analytics-query-v1`;
- список необходимых filter options;
- запрос на endpoint создания/получения snapshot;
- правило: export и statistical model принимают тот же snapshot ID.

---

## Задание AN-FE-05. Дашборд одной сессии

**Статус frontend:** реализовано по versioned fixture/API contract; ожидаются реальные session summary данные backend.

**Результат:** исследователь выбирает реальную session и видит выполнение задач и пригодность каналов.

### Блоки экрана

1. **Заголовок:** participant alias, session ID, дата, завершённость, protocol/version, device, resolution, FPS и algorithm version.
2. **QC-полоса:** отдельные статусы Task, Gaze/AOI и других реально подключённых каналов.
3. **Выполнение задачи:** accuracy `n/N (%)`, RT median `[IQR]`, mean ± SD в подробностях/export, errors, omissions и commissions.
4. **Блоки/пробы:** число валидных и исключённых trials с раскрываемыми причинами.
5. **Состояния значений:** визуально различимые `0`, no event, no data, INVALID, not configured и not applicable.

### Готово, когда

- экран нельзя открыть с неопределённой session без понятного приглашения выбрать её;
- ни одна доля не отображается без numerator/denominator;
- общий QC используется для навигации, но не заменяет channel QC;
- exclusion reasons доступны пользователю;
- карточки показывают N, unit, QC, filter context и version.

### Что передаём backend

- ожидаемый session summary response;
- список channel QC полей;
- список task metrics и их numerator/denominator;
- перечень обязательных technical metadata.

---

## Задание AN-FE-06. AOI-панель и responsive heatmap

**Статус frontend:** реализовано по normalized API contract; ожидается fixation/AOI pipeline backend.

**Результат:** heatmap и AOI построены по реальным normalized session/stimulus данным и остаются совмещёнными при resize.

### Экран

- stimulus и heatmap в одном responsive coordinate space;
- AOI overlay с target/order/name;
- переключатели heatmap, AOI и fixation points;
- таблица AOI:
  - Target reached `n/N`;
  - dwell time, ms и %;
  - fixation count и частота на валидное время;
  - median fixation duration;
  - TTFF median `[IQR]` среди достигших;
  - visits/revisits;
  - valid fraction и gaze QC.

### Обязательные правила

- `TTFF = no_event`, если AOI не достигнута до конца показа;
- TTFF показывается рядом с Target reached;
- low confidence, off-screen и outside stimulus не смешиваются;
- координаты нормализованы относительно фактического stimulus content rect;
- training/main и повторные presentation не объединяются без фильтра;
- legend сообщает normalization mode, smoothing, sample/observation count и algorithm version.

### Готово, когда

- overlay совпадает со stimulus после resize и browser zoom;
- rectangle и polygon AOI обрабатываются одинаково по schema;
- no data не превращается в пустую heatmap, похожую на нулевой результат;
- visual regression проверяет несколько viewport sizes.

### Что передаём backend

- контракт normalized fixation/heatmap data;
- необходимые IDs: session, block, trial/presentation, stimulus/version, AOI/version;
- правила denominator, event status и validity interval;
- требование versioned fixation/AOI algorithm.

---

## Задание AN-FE-07. Групповой дашборд — уровень 1

**Статус frontend:** реализовано по participant-weighted fixture/API contract; ожидаются group endpoints backend.

**Результат:** исследователь видит реальный состав выборки и описательные групповые результаты.

### Состав выборки

- N участников — главное N;
- N сессий;
- N валидных trials/events;
- включено/исключено по channel QC;
- причины исключения;
- missingness;
- распределение устройств и версий.

### Для каждой метрики

- N участников и N наблюдений;
- median `[IQR]` как основная сводка;
- mean ± SD дополнительно;
- min/max;
- 95% CI, рассчитанный с пересэмплированием участников или корректной моделью;
- numerator/denominator или observation duration.

### Визуализации

- индивидуальные точки + median/IQR или boxplot с точками;
- для повторных условий — соединение значений одного участника;
- AOI table и Target reached n/N;
- group heatmap по одному stimulus;
- missingness и channel QC panel.

### Правило group heatmap

```text
сначала session heatmap
→ затем среднее сессий одного участника
→ затем среднее участников группы
```

Один участник не получает больший вес из-за большего числа сессий или кадров.

### Готово, когда

- непрерывные данные не показаны только bar chart;
- цвет не является единственным носителем смысла;
- heatmaps используют одинаковые coordinates, smoothing и scale;
- интерфейс показывает недостаток данных вместо нестабильного результата;
- отдельные gaze-сэмплы не выдаются за независимое N.

### Что передаём backend

- group summary schema;
- требование participant-weighted aggregation;
- требование CI по участникам, не по кадрам;
- expected response для distributions и group heatmap.

---

## Задание AN-FE-08. Уровень 2 — подготовка сравнений групп/условий

**Статус frontend:** реализовано 05.08.2026; ожидается подключение backend endpoint и научное утверждение comparison definitions.

**Результат первой волны:** frontend готов показать корректно рассчитанный backend-результат, но сам не выбирает статистический тест и не считает p-value.

### Что делаем сейчас

- экран выбора заранее заданных group/condition;
- readiness panel: достаточность данных, повторность, совместимость каналов/версий и техническое смешение;
- состояния `available`, `insufficient_data`, `confounded`, `not_configured`;
- карточка результата: effect estimate, 95% CI, adjusted p-value, model name/formula, N participants, N observations, QC set и versions;
- блокировка сравнения, если group почти полностью совпадает с camera/protocol version или другим technical factor;
- Level 3 показывается только как roadmap.

### Что не делаем на frontend

- не выбираем модель по форме графика;
- не рассчитываем mixed models в браузере;
- не подменяем модель простым t-test;
- не выделяем результат только по `p < 0.05`.

### Готово, когда

- UI может отобразить versioned model result из contract fixture;
- причина недоступности сравнения понятна;
- effect и CI визуально важнее p-value.

### Что передаём backend/data analyst

- model-result schema;
- readiness/error codes;
- список моделей из научных комментариев как требования для отдельного backend/statistics этапа;
- правило multiple-comparison correction и фиксации model formula в snapshot.

---

## Задание AN-FE-09. Export из той же выборки

**Статус frontend:** реализовано 05.08.2026; ожидается backend endpoint `/analytics/v1/exports`.

**Результат:** CSV/JSON воспроизводят экран без расхождений.

### Что делаем

- export работает по `analysisSnapshotId`;
- пользователь выбирает long-format data, summary или оба;
- в выгрузку входят data dictionary и versions;
- nullable metrics сохраняют `status` и `reason`;
- проценты содержат numerator/denominator;
- UI показывает snapshot/hash, время создания и активные фильтры;
- имя файла содержит protocol/version и snapshot ID.

### Готово, когда

- автоматический тест сравнивает экранные значения и export;
- число participants/sessions/observations совпадает;
- export нельзя незаметно построить с другим QC mode;
- отсутствующие значения не сериализуются как `0`.

### Что передаём backend

- export schema и примеры CSV/JSON;
- требование принимать snapshot ID;
- требование возвращать data dictionary/provenance.

---

## Задание AN-FE-10. Тесты, доступность и локализация

**Статус frontend:** реализовано 05.08.2026; browser fixture пройден, Playwright spec подготовлен для CI.

**Результат:** основной путь защищён от регрессий до подключения реальных исследований.

### Unit/contract tests

- сериализация и восстановление `analyticsPlan`;
- block overrides training/main;
- metric states и форматирование;
- query/filter cascade;
- API response validation;
- participant-weighted group heatmap fixture;
- zero/no event/no data/INVALID/not configured;
- denominator и N.

### Playwright e2e

1. Создать protocol с training и main, использующими один stimulus.
2. Создать AOI только в main.
3. Выбрать пакеты аналитики и сохранить protocol.
4. Открыть завершённую test session.
5. Отфильтровать main block и stimulus.
6. Проверить AOI, heatmap, session metrics и channel QC.
7. Открыть group Level 1.
8. Скачать export и сверить snapshot/hash.
9. Проверить resize alignment.
10. Проверить русскую и английскую локализацию.

### Доступность

- status кодируется текстом/иконкой, не только цветом;
- filters, tables и package selectors доступны с клавиатуры;
- графики имеют текстовую таблицу/описание;
- одинаковая терминология во всех разделах.

---

## 4. Пакет передачи backend-разработчикам

После AN-FE-01 и AN-FE-02 backend-команде передаётся один каталог:

```text
docs/analytics-contract/
  README.md
  analytics-plan-v1.schema.json
  analytics-query-v1.schema.json
  analytics-response-v1.schema.json
  analytics-export-v1.schema.json
  metric-catalog-v1.json
  examples/
    protocol-with-analytics-plan.json
    analysis-query-session.json
    analysis-snapshot.json
    session-summary-response.json
    session-aoi-response.json
    session-heatmap-response.json
    group-summary-response.json
    group-heatmap-response.json
    model-result-response.json
    analytics-export-both.json
```

### Обязательные backend-задачи

1. **Protocol snapshot:** сохранить immutable protocol, stimulus и block-scoped AOI versions для session.
2. **Data source:** согласовать обезличенный fixation/gaze event stream без видео и полной face geometry.
3. **Channel QC:** возвращать Task, Gaze/AOI и другие QC независимо.
4. **AOI pipeline:** versioned fixation detection, AOI hit detection и P0 metrics.
5. **Canonical query:** поддержать все фильтры и analysis snapshot/hash.
6. **Session endpoints:** metadata, task summary, AOI metrics, heatmap и exclusions.
7. **Group Level 1:** participant-level aggregation, distributions, missingness и equal-weight heatmap.
8. **Export:** строить данные по тому же snapshot.
9. **Level 2:** отдельный statistics service/model results после утверждения дизайна.
10. **Authorization:** project isolation для всех analytics/export endpoints.

### Предлагаемая versioned API-группа

Названия могут быть изменены backend-командой, но frontend нуждается в эквивалентных ресурсах:

```text
GET  /analytics/v1/filter-options
POST /analytics/v1/snapshots
GET  /analytics/v1/snapshots/:id
GET  /analytics/v1/sessions/:id/summary
GET  /analytics/v1/sessions/:id/aoi
GET  /analytics/v1/sessions/:id/heatmap
GET  /analytics/v1/groups/summary
GET  /analytics/v1/groups/heatmap
GET  /analytics/v1/comparisons/:id
GET  /analytics/v1/exports?snapshot_id=:snapshotId&format=csv|json&content=summary|long|both
```

Новые endpoints лучше версионировать отдельно, не расширяя бесконечно текущий demo-ориентированный `/analytics/group`.

## 5. Что можем сделать на frontend до готовности backend

Без ожидания backend можно полностью выполнить:

- AN-FE-01 — schemas и metric catalog;
- AN-FE-02 — шаг конструктора;
- AN-FE-03 — production shell без demo;
- AN-FE-04 — filter/query state на contract fixtures;
- layout и все состояния AN-FE-05/06/07/08;
- response validation, i18n, accessibility и component tests.

Для интеграции понадобятся реальные backend responses:

- session/channel QC;
- AOI metrics и heatmap;
- group summaries;
- analysis snapshot;
- export по snapshot.

## 6. Очерёдность ближайших работ

Работаем в таком порядке:

1. **AN-FE-01:** схемы, каталог метрик и примеры ответов.
2. **AN-FE-02:** новый шаг «Аналитика» в конструкторе.
3. **AN-FE-03:** удаление production demo path и новый каркас аналитики.
4. **AN-FE-04:** единые фильтры и snapshot state.
5. **AN-FE-05:** реальная карточка session и channel QC.
6. **AN-FE-06:** AOI-таблица и responsive heatmap.
7. **AN-FE-07:** групповая аналитика Level 1.
8. **AN-FE-09:** export той же выборки.
9. **AN-FE-08:** интерфейс готовности Level 2.
10. **AN-FE-10:** полный e2e, локализация и accessibility audit.

Первым практическим заданием будет AN-FE-01. После него backend-разработчики смогут параллельно строить API, а мы — последовательно реализовывать интерфейс на тех же контрактах.
