# Фаза 1 — Участник: QC, протокол, эмоции (реализовано)

План: [IMPROVEMENT_PLAN.md](../../../docs/IMPROVEMENT_PLAN.md). Исходные файлы не удалялись; добавлены обновлённые копии и новые модули.

## Шаг 1.1 — Pre-check как gate (paper Table 1)

- **`js/web-page/precheck-updated.js`** — при завершении pre-check в `sessionData.precheck` записываются:
  - `pass_fail: boolean` — true только при стабильном прохождении всех индикаторов;
  - `fail_reason: string | null` — при неудаче: `low_light`, `face_not_found`, `pose_out`, `visibility` или `unknown`.
- Кнопка «Начать калибровку» активна только при `pass_fail === true`.
- **`js/web-page/tests-updated.js`** — в `startCalibration()` добавлена проверка: при `pass_fail === false` калибровка не запускается, показ сообщения из перевода `precheck_must_pass`.
- В **`translations.js`** добавлены ключи `precheck_must_pass` (ru/en).

## Шаг 1.2 — Мягкая автопауза и подсказки по QC

- **`js/qc-pause-overlay-new.js`** — компонент overlay:
  - При падении QC ниже порога (по умолчанию `qcScore < 0.6`) или потере лица дольше N сек (по умолчанию 3 с) показывается overlay: «Верните лицо в кадр» / «Улучшите освещение».
  - Конфиг: `qcScoreThreshold`, `faceLostSec`, `getLang`.
- Интеграция: в **`js/web-page/experimental_task-updated.js`** (цикл когнитивной задачи) и в **`js/web-page/tests-updated.js`** (цикл tracking test) после `processFrame` вызывается `updateFromMetrics(metrics, precheckResult)`.
- Инициализация overlay в **`js/web-page/app-updated.js`** при загрузке.

## Шаг 1.3 — Face-emotions в браузере (заглушка valence/arousal)

- **`js/emotion-stub-new.js`** — заглушка: `getEmotionSample(precheckResult)` возвращает `{ valence: 0, arousal: 0 }` (в v1 планируется модель по landmarks).
- Сэмплы пишутся в `sessionData.emotionSamples` через `appendEmotionSample(state, sample, t, tRelMs)`.
- Вызов из того же цикла, что gaze/eyeSignals: в **experimental_task-updated.js** и **tests-updated.js** (tracking test).

## Шаг 1.4 — Valence/arousal в агрегатах

- В **`js/unified-aggregates-new.js`** в payload добавлен блок `emotion_summary`: `valence_mean`, `arousal_mean`, `n` (при `n > 0`), через `getEmotionSummary(sessionData)` из **emotion-stub-new.js**.

## Как запускать вариант с Фазой 1

- Открывать **`mvp_with_precheck_1-updated.html`**.
- Подключается **`app-updated.js`**, который использует:
  - **precheck-updated.js** (gate),
  - **tests-updated.js** (guard калибровки + overlay в tracking test),
  - **experimental_task-updated.js** (overlay + emotion samples в когнитивной задаче),
  - **qc-pause-overlay-new.js**, **emotion-stub-new.js**.

## Ветки

- **web-emocog-core-main**: полный набор Фазы 1.
- **web-emocog-core-feature-before_start_analyse**: скопированы Phase 1 файлы (precheck-updated, tests-updated, experimental_task-updated, qc-pause-overlay-new, emotion-stub-new), обновлены app-updated, ui-updated, unified-aggregates-new, translations.
- **web-emocog-core-bpm_module**: добавлены emotion-stub-new.js и блок emotion_summary в unified-aggregates-new.js (без web-page).
