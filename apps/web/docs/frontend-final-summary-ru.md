# Итоговый frontend-аудит Emocog

Дата проверки: 05.08.2026.

## 1. AOI и конструктор протокола

- AOI перенесены в предназначенный для них шаг конструктора и показываются только для стимулов, выбранных в пробах.
- AOI хранятся независимо в `blockConfig.aoiDefinitions[stimulusId]`; training и main могут использовать один stimulus, не разделяя AOI.
- Новые протоколы не дублируют AOI в корневом `stimuliDefinitions`; старый формат поддерживается только для импорта.
- Схема `1.2` поддерживает rectangle/polygon, normalized points `0..1`, target flag, validity interval и gaze order.
- Реализованы создание, редактирование, удаление, preview, изменение названия при вводе, drag мышью, resize угловыми маркерами и перестановка порядка.
- Нумерация AOI обновляется автоматически; подписи заметны, но не перекрывают углы и маркеры масштаба.
- Модальное окно оформлено как остальные диалоги конструктора: светлая непрозрачная панель, затемнение и blur фона.

## 2. Дополнительные задачи конструктора и библиотеки

- Название эксперимента проверяется на уникальность внутри проекта локально и через `/protocols?project_id=...`; поле получает inline-ошибку RU/EN.
- Проверка API поддерживает массив и envelope-ответы `items/results/data/protocols`.
- PDF/PPT/PPTX в библиотеке отправляются в authenticated `POST /stimuli/convert`; локальной browser-конвертации нет.
- Серверные требования к LibreOffice/Poppler, storage и security описаны в `stimuli-document-conversion-backend.md`.

## 3. Аналитика — AN-FE-01…10

| Задача | Frontend-результат |
|---|---|
| AN-FE-01 | Versioned plan/query/response/export contracts и каталог из 30 metric IDs |
| AN-FE-02 | Компактные пакеты метрик, подробный выбор и block overrides на шаге «Аналитика» |
| AN-FE-03 | Production API shell без автоматического demo fallback |
| AN-FE-04 | Единые filters/query/snapshot; device filter отсутствует |
| AN-FE-05 | Выбор session, metadata, task metrics, channel QC, exclusions и состояния данных |
| AN-FE-06 | AOI table, responsive normalized heatmap и fixation overlay |
| AN-FE-07 | Participant-weighted group summary, distributions, CI, QC/missingness и equal-weight heatmap |
| AN-FE-08 | Predefined Level 2 comparisons, readiness checks, effect/CI и блокировка confounded analysis |
| AN-FE-09 | CSV/JSON export по тому же snapshot/hash/QC/N, dictionary и provenance |
| AN-FE-10 | Playwright spec, RU/EN, keyboard/ARIA labels и browser regression check |

Production UI не подставляет научные demo-значения при отсутствии API. Условные данные включаются только явно через `?analyticsPreview=1`; старый dashboard — через development-флаг `?analyticsDemo=1`.

## 4. Результаты проверки

- Все JSON-файлы успешно разобраны.
- Metric catalog и frontend config содержат одинаковые 30 ID.
- `git diff --check` не обнаружил ошибок форматирования.
- Headless Chrome загрузил актуальные скрипты и прошёл сценарий session/AOI/heatmap → export → group, включая nullable states, N, RU/EN и accessibility labels.
- Проверены состояния `available` и `confounded` Level 2.
- Playwright spec подготовлен, но в текущем окружении не запущен: Node и `@playwright/test` не установлены.

## 5. Проверка файлов

Временные Chrome profiles, screenshots и browser-check HTML удалены. Каталоги `developer`, `docs` и `tests` являются рабочими.

Новые файлы имеют назначение:

- `researcher-analytics-config.js` — каталог/сохранение analytics plan;
- `researcher-analytics-production.js` — production analytics и export;
- `researcher-analytics-preview-fixture.js` — только явный interface preview;
- `docs/analytics-contract/` — backend/frontend contracts и examples;
- `tests/analytics-production.spec.ts` и `playwright.analytics.config.ts` — regression e2e.

Исходные `docs/Аналитика.pdf` и `docs/комментарии.docx` сохранены как материалы постановки задачи. Лишних generated/download/temp-файлов в `apps/web` не найдено.

## 6. Что остаётся вне frontend

- Реализовать backend analytics endpoints, перечисленные в `production-shell-api-handoff-ru.md`.
- Реализовать `/stimuli/convert` и серверные зависимости конвертации.
- Обеспечить backend uniqueness constraint для названия протокола внутри проекта.
- Подключить реальные session/fixation/AOI данные и выполнить полный end-to-end на тестовой завершённой сессии.
- На participant/runtime стороне отдельно зафиксировать пересчёт gaze относительно фактического stimulus content rect при browser zoom. AOI в конструкторе уже нормализованы, но этот runtime-сценарий ранее был отложен и не считается закрытым данным frontend-аудитом.
