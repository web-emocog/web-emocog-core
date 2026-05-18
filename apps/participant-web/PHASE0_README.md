# Фаза 0 — Инфобез и политика (реализовано)

План: [IMPROVEMENT_PLAN.md](../../../docs/IMPROVEMENT_PLAN.md). Исходные файлы не удалялись; добавлены новые и обновлённые копии.

## Шаг 0.1 — Исключение PII из payload

- **`js/unified-aggregates-new.js`** — функция `buildAggregatesPayload(sessionData)`:
  - В `meta.user` только `interfaceLanguage` (без email и иных PII).
  - Без сырых массивов (eyeTracking, eyeSignals, trackingTest, heatmaps).
  - Использовать этот payload при отправке данных на сервер и при скачивании «только сводка».

## Шаг 0.2 — Опция «Скачать только агрегаты»

- На финальном шаге (step7) в **`mvp_with_precheck_1-updated.html`** добавлен чекбокс «Только сводка (без сырых массивов)».
- При отмеченном чекбоксе кнопка «Скачать JSON» отдаёт тот же объект, что и для сервера (результат `buildAggregatesPayload`), в файл `session_<id>_aggregates.json`.
- Логика в **`js/web-page/ui-updated.js`** (функция `downloadData`).

## Шаг 0.3 — Политика в UI и в коде

- Текст на лэндинге (step1) и в блоке согласия (step2):  
  *«Видео не записывается и не передаётся; все расчёты — на вашем устройстве; на сервер отправляются только обезличенные сводки.»*
- Константы в **`js/unified-config-new.js`**: `PRIVACY_POLICY_SHORT`, `PRIVACY_POLICY_SHORT_EN`.
- Переводы для политики и чекбокса в **`js/translations-updated.js`**.

## Как запускать вариант с Фазой 0

- Открывать **`mvp_with_precheck_1-updated.html`** (не `mvp_with_precheck_1.html`).
- Подключается **`js/web-page/app-updated.js`**, который тянет **`ui-updated.js`** и остальные модули.

## Ветки

- **web-emocog-core-main**, **web-emocog-core-feature-before_start_analyse**: полный набор (web-page + все новые файлы).
- **web-emocog-core-bpm_module**, **web-emocog-core-feature-rt_component**: скопированы только новые модули (`unified-aggregates-new.js`, `unified-config-new.js`, `translations-updated.js`) и `mvp_with_precheck_1-updated.html`; структуры `js/web-page/` там нет, поэтому для работы обновлённой страницы в этих ветках нужно при необходимости добавить аналог web-page или подключать агрегаты в существующий код.
