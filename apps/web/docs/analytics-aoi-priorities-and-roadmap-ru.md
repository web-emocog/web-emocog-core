# Аналитика AOI и взгляда в Emocog: приоритеты метрик и план реализации

**Статус:** проект документа для согласования с научным руководителем и технической командой
**Контекст:** roadmap «Исследователь видит heatmap и gaze-on-target по реальным session/stimulus/AOI данным с QC и confidence»
**Цель документа:** определить минимально необходимое научное ядро аналитики, единые правила вычисления и отображения показателей, а также последовательность перехода от демонстрационных экранов к данным реальных сессий.

---

## 1. Краткое решение

Для первой рабочей версии аналитики предлагается оставить три пользовательских раздела:

1. **Обзор сессии** — выбор конкретной сессии, QC, полнота данных и краткая сводка.
2. **AOI и взгляд** — stimulus с heatmap и AOI-overlay, таблица показателей по каждой AOI.
3. **Качество данных** — причины исключения данных, confidence, off-screen и технические показатели.

В первую очередь необходимо реализовать:

- heatmap;
- gaze-on-target;
- dwell time по AOI;
- fixation count;
- fixation duration;
- time to first fixation (TTFF);
- visits и revisits;
- обязательный QC-контекст: число сэмплов, валидное время, доля валидных данных, low confidence, off-screen и версия алгоритма.

**Групповые сравнения, корреляции/«связанность», эмоции, pupil size, скорость саккад и сложные нормативные оценки не входят в первый релиз.** Их следует возвращать только после научного обоснования, проверки качества данных и появления достаточного количества реальных сессий.

Выбор в конструкторе протокола должен управлять **составом отчёта**, но не сбором исходных данных. Если протокол использует eye tracking, необходимые исходные gaze/QC данные собираются независимо от того, какие карточки исследователь решил показывать по умолчанию. Это позволит пересчитать или добавить метрику после завершения эксперимента без повторного прохождения участниками.

---

## 2. Что обнаружено в текущей реализации

### 2.1. Аналитические экраны

Сейчас аналитика не является production-ready:

- в `researcher-analytics.js` глобальный `SESSION_DATA` изначально заполнен демонстрационными значениями;
- четыре вкладки — «Карточка сессии», «Групповое сравнение», «Качество данных» и «Связанность метрик» — содержат крупные demo-наборы данных;
- часть демонстрационных метрик не относится к текущей AOI-задаче: valence, arousal, эмоции, pupil size, saccade velocity, корреляции и условные групповые нормы;
- в production-интерфейсе нет единой каскадной фильтрации project → protocol → session → block → stimulus;
- API bridge добавляет селектор сессии только при наличии live API, но при пустом результате или ошибке сообщает, что ниже используются demo-данные;
- реальная строка сессии преобразуется и записывается поверх глобального demo-объекта. Если API не вернул отдельное поле, существует риск сохранить или показать старое демонстрационное значение;
- экспорт имеет собственный набор фильтров и поэтому пока не гарантирует совпадение с выборкой, показанной на экране.

Следствие: demo fallback нельзя «постепенно скрыть» несколькими проверками. Production-путь должен получать всё состояние только из API и иметь явные состояния `loading`, `ready`, `empty`, `error`, `unauthorized`.

### 2.2. Шаг «Аналитика» в конструкторе

Текущий шаг позволяет включать и выключать четыре целые вкладки. Конфигурация хранится как `tabs` в `localStorage`, а затем попадает в `analyticsConfig` протокола. Она:

- не описывает конкретные метрики;
- не задаёт различия между задачами/блоками;
- не фиксирует алгоритм и правила расчёта;
- перегружает исследователя выбором абстрактных дашбордов до появления данных.

Нужна модель «профиль отчёта + необязательная тонкая настройка», описанная в разделе 9.

### 2.3. Доступные данные участника

В participant-приложении уже формируются gaze-сэмплы с временной и экспериментальной привязкой, включая `blockId`, `trialId`, `stimulusId`, `onScreen`, `confidence`, скорректированные координаты и размеры экрана. Также существует локальное построение heatmap по stimulus и block.

Однако текущая aggregate-only модель явно исключает сырые массивы eye tracking и heatmap из отправляемой сводки. Поэтому до реализации аналитики необходимо принять архитектурное решение:

- либо сервер получает безопасный gaze event stream без видео и персональных данных и сам вычисляет versioned-метрики;
- либо participant-приложение вычисляет versioned fixations/AOI events и отправляет их вместе с достаточной информацией для аудита;
- предпочтительный вариант — хранить на сервере минимально необходимый нормализованный gaze/event stream и вычислять производные показатели серверным versioned pipeline. Это обеспечивает одинаковый расчёт для UI и export и позволяет воспроизводимо пересчитывать результаты.

---

## 3. Единица анализа и идентичность данных

Минимальная строка аналитических данных должна быть однозначно привязана к:

```text
projectId
  → protocolId + protocolVersion
    → sessionId
      → blockId
        → trialId / presentationId
          → stimulusId
            → aoiId + aoiSchemaVersion
```

`blockId` и `presentationId` обязательны. Один и тот же `stimulusId` может использоваться в тренировке и основной части, но AOI и результаты этих показов должны оставаться независимыми.

Рекомендуемые уровни вывода:

- **основной уровень первой версии:** session × block × trial/presentation × stimulus × AOI;
- **сводка внутри сессии:** агрегация по повторениям с явным `n_trials_total` и `n_trials_valid`;
- **групповой уровень позднее:** сначала агрегация до участника, затем между участниками. Нельзя считать отдельные gaze-сэмплы независимыми наблюдениями группы.

---

## 4. Приоритетные показатели первой версии

### 4.1. Обязательный контекст качества — показывается всегда

Эти поля не являются выбираемыми научными outcomes. Они должны сопровождать каждую таблицу, график и экспорт:

| Поле | Смысл |
|---|---|
| `sample_count_total` | Все gaze-сэмплы в рассматриваемом окне |
| `sample_count_valid` | Сэмплы, прошедшие правила валидности и confidence |
| `valid_duration_ms` | Суммарное валидное время, рассчитанное по timestamps, а не как `samples / expected FPS` |
| `valid_gaze_pct` | Валидное время / время показа, % |
| `low_confidence_duration_ms` | Время с gaze prediction ниже принятого порога |
| `off_screen_duration_ms` | Валидно распознанный взгляд вне экрана |
| `outside_stimulus_duration_ms` | Взгляд на экране, но вне фактического прямоугольника stimulus |
| `qc_class`, `qc_score`, `qc_reasons` | Итог QC и причины |
| `algorithm_id`, `algorithm_version` | Версия preprocessing/fixation/AOI pipeline |
| `aoi_schema_version`, `protocol_version` | Версии определения AOI и протокола |

`low confidence`, `off-screen` и `outside stimulus` — разные состояния. Их нельзя объединять в одно «не смотрел на цель».

### 4.2. Heatmap — приоритет P0

**Назначение:** визуально показать распределение валидного взгляда на конкретном показе stimulus.

Правила:

- используются координаты, нормализованные относительно **видимой области stimulus**, а не viewport или canvas аналитики;
- точки вне stimulus не «прижимаются» к его краям;
- heatmap строится только из выборки, соответствующей активным фильтрам;
- плотность должна быть time-weighted, чтобы изменение FPS не меняло вклад участка траектории;
- вместе с картой показываются `sample_count_valid`, `valid_gaze_pct`, QC и версия алгоритма;
- AOI рисуются теми же normalized coordinates поверх того же content rectangle;
- при resize используется текущий размер stimulus, но исходные точки `[0, 1]` не пересчитываются и не теряются.

Heatmap — средство описания, а не самостоятельный статистический тест. Цветовая шкала должна отражать плотность внутри текущей выборки; нельзя сравнивать две карты по цвету, если у них автоматически разные шкалы. Для сравнения нужен общий scale или явная подпись normalization mode.

### 4.3. Dwell time — приоритет P0

**Рекомендуемое определение:** сумма длительностей фиксаций, отнесённых к AOI, в пределах окна активности AOI.

Показывать два значения:

- `dwell_time_ms` — абсолютное время;
- `dwell_time_pct` — доля от валидного времени взгляда на stimulus в том же окне.

Абсолютное время без процента плохо сравнимо при разной длительности stimulus, а процент без абсолютного времени скрывает короткое или низкокачественное наблюдение. Поэтому они отображаются вместе.

### 4.4. Fixation count и fixation duration — приоритет P0

- `fixation_count` — количество валидных фиксаций, центроид которых находится в AOI и время которых пересекается с validity interval AOI;
- `fixation_duration_median_ms` — медианная длительность таких фиксаций;
- `fixation_duration_mean_ms` — среднее значение можно включить в export и расширенную таблицу;
- `total_fixation_duration_ms` — технический эквивалент суммы длительностей фиксаций; в основном UI не нужно дублировать его рядом с dwell time, если определения совпадают.

Для первой карточки предпочтительнее медиана: она устойчивее к единичным очень длинным событиям. В export следует сохранять и среднее, и медиану, и `fixation_count`.

### 4.5. Time to first fixation — приоритет P0

`ttff_ms` — время от начала активности AOI до начала первой валидной фиксации в AOI.

Если `validityInterval.startMs = 500`, рекомендуемая точка отсчёта — 500 ms после начала stimulus, а не 0. Дополнительно в данных сохраняется `ttff_reference = "aoi_active_start"`.

Если валидное наблюдение было, но фиксации в AOI не произошло, TTFF не равен 0 и не должен искусственно приравниваться к длительности trial. Значение остаётся `null` с причиной `no_fixation`. Для последующего статистического анализа это случай с цензурированием/отсутствием события, а не нулевая задержка.

### 4.6. Visits и revisits — приоритет P0

- `visit_count` — число отдельных посещений AOI;
- `revisit_count = max(visit_count - 1, 0)`;
- посещения разделяются как минимум одной валидной фиксацией вне AOI либо согласованным временным gap;
- пропуск данных из-за low confidence сам по себе не должен автоматически создавать новый revisit.

В UI можно показывать только revisits, но `visit_count` нужен в API и export для прозрачности расчёта.

### 4.7. Gaze-on-target — приоритет P0

Для всех AOI с `isTarget = true`:

```text
gaze_on_target_pct =
  valid time inside union(active target AOIs)
  ------------------------------------------------ × 100
  valid on-stimulus gaze time in the same window
```

Рекомендации:

- использовать время, а не простое отношение числа сэмплов;
- при пересечении двух target AOI учитывать их объединение, чтобы процент не превышал 100%;
- рядом всегда показывать `valid_gaze_pct`, иначе высокий gaze-on-target при очень малом количестве данных может ввести в заблуждение;
- отдельно хранить `target_hit_duration_ms`, `denominator_duration_ms` и `denominator_policy`;
- не считать low confidence и off-screen как «взгляд на дистрактор» — эти интервалы исключаются из знаменателя и показываются в QC.

Это рекомендуемая политика знаменателя. Её необходимо отдельно утвердить с научным руководителем, поскольку возможна другая исследовательская интерпретация — доля от полного времени экспозиции.

---

## 5. Что означает «нет данных», «ноль», low confidence и off-screen

API каждой метрики должен возвращать не только `value`, но и статус вычисления:

```json
{
  "metricId": "aoi.fixation_count",
  "value": 0,
  "unit": "count",
  "status": "computed",
  "reason": null,
  "sampleCount": 428,
  "validDurationMs": 6120,
  "qcClass": "VALID",
  "algorithmVersion": "gaze-aoi-1.0.0"
}
```

| Ситуация | `value` | `status` / `reason` | Отображение |
|---|---:|---|---|
| Было валидное окно, фиксаций в AOI не было | `0` для count/dwell | `computed` | `0` |
| Нет gaze-сэмплов | `null` | `no_data` | «Нет данных» |
| Данных недостаточно по QC | `null` | `insufficient_quality` | «Недостаточно качественных данных» |
| TTFF: фиксация не произошла | `null` | `no_event` / `no_fixation` | «Фиксации не было» |
| Метрика неприменима к stimulus/task | `null` | `not_applicable` | «Не применимо» |
| Алгоритм завершился ошибкой | `null` | `failed` | «Ошибка расчёта» |

Нельзя применять конструкции вида `value || 0`. Нулём считается только реально вычисленный нулевой результат.

Для классификации gaze-сэмпла рекомендуется хранить:

- первичный `validityStatus`: `valid`, `low_confidence`, `missing_prediction`, `invalid_geometry`;
- отдельный `onScreen: true/false/null`;
- отдельный `insideStimulus: true/false/null`;
- исходный числовой `confidence`.

Так low confidence не смешивается с корректно определённым off-screen.

---

## 6. Координаты и выравнивание heatmap

### 6.1. Нормализация во время прохождения

Для каждого сэмпла используются границы фактически показанного контента stimulus:

```text
xNorm = (gazeX - stimulusRect.left) / stimulusRect.width
yNorm = (gazeY - stimulusRect.top)  / stimulusRect.height
```

Нужно учитывать letterboxing при `object-fit: contain`: область HTML-элемента и видимая область изображения могут различаться. Нормализация должна происходить относительно изображения/кадра, а не внешнего контейнера.

В gaze event рекомендуется сохранять:

```json
{
  "stimulusXNorm": 0.4721,
  "stimulusYNorm": 0.3184,
  "insideStimulus": true,
  "timestampMs": 1732,
  "blockId": "main-block",
  "trialId": "trial-7",
  "presentationId": "presentation-7",
  "stimulusId": "stim-42",
  "confidence": 0.81,
  "onScreen": true,
  "layoutRevision": 3
}
```

При resize, browser zoom или смене ориентации увеличивается `layoutRevision`, а новые точки нормализуются по новому rect. Координаты AOI остаются неизменными `[0, 1]`.

### 6.2. Отрисовка в аналитике

Stimulus, AOI и heatmap должны находиться в одном responsive wrapper. При изменении его content box:

- определяется новый фактический content rectangle stimulus;
- normalized AOI и heatmap bins проецируются в этот rectangle;
- исходные значения не мутируются;
- canvas использует корректный `devicePixelRatio`, но CSS-размер совпадает с stimulus;
- для image/video сохраняются intrinsic aspect ratio и режим fit.

Для реакции на изменение размера можно использовать `ResizeObserver`; спецификация W3C определяет его как API наблюдения за изменением размера элемента.

---

## 7. Фильтры и выбор сессии

### 7.1. Единая панель фильтров

Панель должна быть общей для всех трёх разделов и работать каскадно:

1. **Project** — обязателен, по умолчанию текущий проект.
2. **Protocol + version** — обязателен.
3. **Session** — в карточке сессии выбирается ровно одна; в будущей групповой аналитике допускается набор.
4. **Block/task** — конкретный экземпляр блока, включая разделение тренировки и основной части.
5. **Stimulus** — только stimulus, реально показанные в выбранном block/session.
6. **AOI** — дополнительный фильтр таблицы/overlay.
7. **QC** — `VALID`, `BORDERLINE`, `INVALID`, а также минимальный confidence и политика исключения.

Селектор сессии должен показывать псевдоним/код участника, дату завершения, статус, QC badge и процент валидного gaze. Нужны поиск и понятное пустое состояние.

### 7.2. Один объект выборки для UI и export

UI не должен самостоятельно строить один query, а export — другой. Нужен канонический объект:

```json
{
  "projectId": "project-1",
  "protocolId": "protocol-7",
  "protocolVersion": "3",
  "sessionIds": ["session-55"],
  "blockIds": ["main-block"],
  "stimulusIds": ["stim-42"],
  "aoiIds": [],
  "qcClasses": ["VALID", "BORDERLINE"],
  "confidenceMin": 0.65,
  "metricIds": [
    "viz.heatmap",
    "aoi.gaze_on_target_pct",
    "aoi.dwell_time_ms",
    "aoi.fixation_count",
    "aoi.fixation_duration_median_ms",
    "aoi.ttff_ms",
    "aoi.revisit_count"
  ]
}
```

Backend возвращает `queryEcho`, `datasetId` или hash выборки, counts и algorithm versions. Export принимает этот же query или выданный query token. Тогда выгрузка воспроизводит ровно то, что показано на экране.

В CSV/JSON для nullable-метрик обязательно выгружаются `status` и `reason`, иначе «нет данных» снова превратится в пустое или нулевое значение без объяснения.

---

## 8. Предлагаемая структура production-аналитики

### Раздел 1. Обзор сессии

- единая панель фильтров;
- метаданные session/protocol/device;
- QC class/score/reasons;
- total/valid sample count и valid gaze %;
- low confidence, off-screen, outside stimulus;
- список blocks со статусом данных;
- переход к выбранному stimulus/AOI.

### Раздел 2. AOI и взгляд

- stimulus + heatmap + AOI overlay;
- переключатель отображения heatmap/AOI/fixation points;
- компактная сводка gaze-on-target;
- таблица AOI: order, name, target, active interval, dwell ms/%, fixation count, median duration, TTFF, revisits, QC/status;
- раскрытие строки для counts, denominator, algorithm version и причин отсутствия результата.

### Раздел 3. Качество данных

- QC по session/block/stimulus;
- временная шкала valid / low confidence / off-screen / missing;
- sample counts и durations;
- сведения о calibration/validation, FPS, пропусках и версии алгоритма;
- причины исключения из расчёта.

### Отложить

- «Связанность метрик» и автоматические корреляции;
- групповые inferential tests;
- автоматические нормы, percentile и трактовку «выше = лучше»;
- emotion/valence/arousal, если для них нет отдельно валидированного production pipeline;
- pupil size в миллиметрах для webcam-источника без физической калибровки;
- saccade velocity в градусах/секунду без надёжной геометрии viewing distance и физического размера экрана;
- scanpath entropy, transition matrices и анализ заданного порядка AOI — возможный следующий этап после устойчивого P0.

---

## 9. Выбор метрик на шаге «Аналитика» в конструкторе

### 9.1. Основной UX-принцип

Не показывать сразу длинный каталог чекбоксов. На основном экране отображать 2–3 **пакета результатов**, автоматически доступных по содержимому протокола:

1. **AOI и внимание — рекомендуется**, если в блоках есть AOI: heatmap, gaze-on-target, dwell, fixations, TTFF, revisits.
2. **Выполнение задачи**, если задача содержит ответы: reaction time, accuracy, omissions/commissions — только показатели, действительно поддержанные типом задачи.
3. **Качество данных — обязательно:** QC, counts, confidence, algorithm metadata; пакет включён и заблокирован.

Под пакетами находится одна ссылка **«Настроить отдельные показатели»**, открывающая accordion/side panel с группами:

- Визуализации;
- AOI и внимание;
- Выполнение задачи;
- Дополнительные показатели — только когда они реально реализованы и валидированы.

У каждой метрики — короткое название, единица и tooltip с определением. Зависимости включаются автоматически: фиксационные метрики требуют fixation pipeline, AOI-метрики недоступны без AOI.

### 9.2. Настройки для конкретной задачи без перегрузки

По умолчанию пакет применяется ко всему эксперименту. Ниже — свёрнутый блок **«Разные настройки для отдельных задач»**:

| Задача/блок | Настройка |
|---|---|
| Тренировка | Наследует общий профиль / собственный профиль |
| Основная часть | Наследует общий профиль / собственный профиль |

После выбора «собственный профиль» показываются только пакеты и метрики, применимые к этому блоку. Не нужно настраивать каждый trial или stimulus отдельно: конкретный stimulus исследователь выбирает фильтром уже в аналитике.

Компактная итоговая строка перед переходом далее:

```text
Общий профиль: AOI и внимание · QC обязательно
Исключение: Тренировка — только QC
Основная часть — наследует общий профиль
```

### 9.3. Предлагаемая схема протокола

```json
{
  "analyticsPlan": {
    "schemaVersion": "1.0",
    "defaultProfile": "aoi_core",
    "requiredMetricIds": [
      "qc.sample_coverage",
      "qc.validity",
      "meta.algorithm_version"
    ],
    "selectedMetricIds": [
      "viz.heatmap",
      "aoi.gaze_on_target_pct",
      "aoi.dwell_time_ms",
      "aoi.dwell_time_pct",
      "aoi.fixation_count",
      "aoi.fixation_duration_median_ms",
      "aoi.ttff_ms",
      "aoi.revisit_count"
    ],
    "blockOverrides": {
      "training-block": {
        "profile": "qc_only",
        "selectedMetricIds": []
      }
    }
  }
}
```

`analyticsPlan` определяет стартовый состав UI и export, но не должен удалять собираемые gaze/QC события. После окончания сбора исследователь сможет изменить отображаемый набор и пересчитать производные показатели, если исходные данные и разрешения это допускают.

Текущий `analyticsConfig.tabs` следует мигрировать в `analyticsPlan`; временно можно прочитать старый формат, но новый production UI не должен зависеть от `localStorage` как источника протокольной истины.

---

## 10. Контракт API и распределение ответственности

### Frontend / participant

- применить точную версию block-scoped AOI из protocol snapshot;
- фиксировать stimulus presentation lifecycle и validity intervals;
- вычислять normalized stimulus coordinates с учётом текущего content rect;
- передавать timestamps, context IDs, confidence, onScreen/insideStimulus и layout revision;
- не подставлять demo при сетевой ошибке;
- отображать состояния no data/error отдельно.

### Backend / data pipeline

- хранить protocol/AOI snapshot, связанный с session;
- принимать и валидировать gaze/event stream;
- хранить или воспроизводимо строить fixations и AOI hits;
- реализовать versioned алгоритм и immutable provenance;
- предоставлять фильтры project/protocol/session/block/stimulus/AOI/QC;
- возвращать nullable values со status/reason/counts/QC/version;
- использовать один query contract для analytics и export;
- обеспечить авторизацию и project isolation.

### Совместное научно-техническое решение

- fixation detector и его параметры;
- confidence threshold и допустимые gaps;
- QC-пороги;
- правила AOI overlap и присвоения фиксации AOI;
- знаменатель gaze-on-target;
- политика агрегации повторов и групп.

Таким образом, задача не является только frontend-задачей. Frontend отвечает за корректный контекст и представление, но вычисление воспроизводимых метрик, фильтрация и export требуют backend/data-pipeline контракта.

---

## 11. Пошаговый план реализации

### Этап 0. Научное согласование

1. Утвердить определения из раздела 4.
2. Выбрать fixation detector и параметры для фактической частоты/шума webcam eye tracking.
3. Утвердить confidence/QC thresholds и denominator gaze-on-target.
4. Зафиксировать правила overlaps, validity intervals, gaps и повторов.
5. Выпустить `metrics-catalog-v1` и `gaze-aoi-algorithm-v1` как versioned спецификации.

**Готово, когда:** одна тестовая запись при ручном пересчёте даёт однозначно ожидаемые результаты.

### Этап 1. Data contract и protocol snapshot

1. Ввести `analyticsPlan.schemaVersion` и стабильные metric IDs.
2. Передавать в participant опубликованную версию протокола вместе с block-scoped AOI.
3. Сохранять snapshot AOI/protocol в session, а не читать позднее изменённый draft.
4. Ввести `presentationId`, чтобы различать повторные показы одного stimulus.

### Этап 2. Нормализованные gaze events

1. Определять фактический content rect image/video.
2. Добавить `stimulusXNorm/YNorm`, `insideStimulus`, timestamps и layout revision.
3. Разделить validity, confidence, onScreen и insideStimulus.
4. Проверить resize/zoom/orientation на тестовом stimulus и AOI в углах/центре.
5. Решить формат пакетной загрузки, retry/idempotency и ограничения объёма.

### Этап 3. Backend pipeline метрик

1. Добавить storage/ingest для gaze events или согласованного event stream.
2. Реализовать preprocessing и fixation detection как отдельный versioned модуль.
3. Реализовать AOI hit detection с rectangle/polygon и validity intervals.
4. Рассчитать P0-метрики и quality metadata.
5. Добавить повторный расчёт по `algorithmVersion` без изменения исходной session.
6. Покрыть модуль unit-тестами на synthetic trajectories.

### Этап 4. Analytics API и export

1. Реализовать каскадные endpoints/queries для фильтров.
2. Реализовать session summary, heatmap bins/points и AOI metric rows.
3. Ввести status/reason для каждой nullable-метрики.
4. Возвращать query echo/hash, counts, QC и versions.
5. Подключить CSV/JSON export к тому же canonical query.
6. Добавить authorization и тесты project isolation.

### Этап 5. Production frontend аналитики

1. Вынести demo datasets в dev-only fixtures/отдельный demo route.
2. Удалить глобальный предзаполненный `SESSION_DATA` из production path.
3. Реализовать state machine `loading/ready/empty/error/unauthorized`.
4. Добавить единую панель фильтров и обязательный session picker.
5. Создать три раздела из раздела 8.
6. Проверить, что отсутствующее API-поле никогда не оставляет старое значение на экране.

### Этап 6. Responsive heatmap

1. Рисовать stimulus, heatmap и AOI в одном coordinate space.
2. Обрабатывать aspect ratio, letterboxing, resize и devicePixelRatio.
3. Добавить legend, normalization mode и sample/QC подпись.
4. Сделать visual regression tests на нескольких размерах viewport.

### Этап 7. Конструктор протокола

1. Заменить выбор demo-вкладок на пакеты метрик.
2. Сделать QC-пакет обязательным.
3. Добавить контекстную доступность пакетов по задачам/AOI.
4. Добавить block overrides для тренировки и основной части.
5. Сохранять `analyticsPlan` в protocol definition через API.
6. Отобразить краткое резюме выбранного отчёта перед публикацией.

### Этап 8. End-to-end и приёмка

Playwright-сценарий должен:

1. создать protocol с двумя block, использующими один stimulus;
2. создать AOI только для основной части;
3. опубликовать protocol и invitation;
4. пройти participant session с заранее контролируемой gaze trajectory или test provider;
5. дождаться завершения обработки;
6. выбрать project/protocol/session/main block/stimulus;
7. проверить AOI overlay, heatmap и ожидаемые P0-метрики;
8. проверить no data, zero, low confidence и off-screen как разные состояния;
9. скачать export и сравнить его query hash/строки со значениями UI;
10. повторить visual alignment после resize.

Дополнительно нужны unit/contract tests: rectangle/polygon boundaries, overlapping target AOI, validity interval, no fixation TTFF, low-confidence gap, variable sample rate и повторный stimulus в разных blocks.

---

## 12. Вопросы для согласования с научным руководителем

1. Считать dwell time только по фиксациям или по всем валидным gaze-сэмплам внутри AOI? В документе рекомендован fixation-based dwell.
2. Gaze-on-target делить на валидное on-stimulus время или на полное время экспозиции? Рекомендовано первое с отдельным показом coverage.
3. TTFF отсчитывать от старта stimulus или от `validityInterval.startMs`? Рекомендован старт активности AOI.
4. Как назначать фиксацию пересекающимся AOI: каждой подходящей AOI, AOI с меньшей площадью или по явному priority? Для target summary рекомендовано объединение областей.
5. Какой fixation detector и параметры допустимы для текущей частоты и точности webcam eye tracking?
6. Какой минимальный confidence, valid gaze % и длительность нужны для статусов VALID/BORDERLINE/INVALID?
7. Какой gap разделяет visits и как трактовать пропуск low-confidence между фиксациями?
8. При повторных trials использовать медиану участника, среднее или взвешивание по valid duration?
9. Нужно ли в первом релизе анализировать заданную последовательность AOI? Если да, следующим модулем будут переходы, доля соблюдения порядка и transition matrix, а не только номер AOI.
10. Какие метрики объявляются primary outcomes до начала сбора, чтобы не увеличивать число необоснованных сравнений?

---

## 13. Критерии готовности первой версии

- в production нет demo fallback и смешивания real/demo полей;
- без выбранной session AOI-метрики не показываются;
- сценарий AOI → protocol → invitation → participant session → analytics проходит end-to-end;
- heatmap и AOI совпадают на разных viewport/zoom и используют normalized stimulus coordinates;
- все P0-показатели получены из API/session data;
- каждая строка имеет sample count, QC/validity и algorithm version;
- no data не отображается как zero;
- low confidence, off-screen и outside stimulus различаются;
- UI и export используют один canonical query и одинаковый dataset hash;
- block-scoped AOI не перетекает между тренировкой и основной частью;
- Playwright, unit и contract tests проходят;
- определения метрик согласованы научным руководителем, реализация принята тимлидом/техлидом.

---

## 14. Научно-методические источники

1. Dunn M. J. et al. *Minimal reporting guideline for research involving eye tracking (2023 edition).* Behavior Research Methods, 2024. DOI: [10.3758/s13428-023-02187-1](https://doi.org/10.3758/s13428-023-02187-1). Обосновывает обязательность прозрачного описания оборудования, процедур, качества данных и анализа.
2. Andersson R. et al. *One algorithm to rule them all? An evaluation and discussion of ten eye movement event-detection algorithms.* Behavior Research Methods, 2017. DOI: [10.3758/s13428-016-0738-9](https://doi.org/10.3758/s13428-016-0738-9). Показывает, что выбор event detector существенно влияет на длительности и классификацию событий.
3. Salvucci D. D., Goldberg J. H. *Identifying fixations and saccades in eye-tracking protocols.* ETRA, 2000. DOI: [10.1145/355017.355028](https://doi.org/10.1145/355017.355028). Даёт базовую классификацию fixation-identification algorithms.
4. Nyström M., Holmqvist K. *An adaptive algorithm for fixation, saccade, and glissade detection in eyetracking data.* Behavior Research Methods, 2010. DOI: [10.3758/BRM.42.1.188](https://doi.org/10.3758/BRM.42.1.188). Один из вариантов адаптивного event detection; конкретное применение требует проверки на данных Emocog.
5. Hessels R. S. et al. *Noise-robust fixation detection in eye movement data: Identification by two-means clustering (I2MC).* Behavior Research Methods, 2017. DOI: [10.3758/s13428-016-0822-1](https://doi.org/10.3758/s13428-016-0822-1). Особенно релевантен данным с шумом и потерями; не означает автоматического выбора I2MC без локальной валидации.
6. Orquin J. L., Holmqvist K. *Threats to the validity of eye-movement research in psychology.* Behavior Research Methods, 2018. DOI: [10.3758/s13428-017-0998-z](https://doi.org/10.3758/s13428-017-0998-z). Обращает внимание на methodological flexibility, множественные метрики и угрозы валидности.
7. W3C. *Resize Observer.* [Specification](https://www.w3.org/TR/resize-observer-1/). Техническая основа для синхронизации responsive overlay с изменением размера stimulus container.

Приведённые источники поддерживают необходимость versioned algorithm, прозрачного QC и заранее определённого небольшого набора outcomes. Они не заменяют локальную валидацию webcam gaze pipeline Emocog.
