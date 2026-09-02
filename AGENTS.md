# AGENTS.md: инструкция для ИИ-агентов проекта EmoCog

Актуальность описания: 2026-08-16.

Этот файл задаёт правила работы ИИ-агента во всём репозитории
`web-emocog-core`. Он является инженерной инструкцией, а не заявлением о
медицинской эффективности продукта. Если локальный `AGENTS.md` появится в
подпапке, его более узкие правила применяются внутри этой подпапки вместе с
данным документом.

## 1. Назначение проекта

EmoCog — браузерная платформа для проведения когнитивных и поведенческих
исследований. Исследователь создаёт проект, протокол, стимулы, AOI и приглашение;
участник проходит опубликованный протокол по коду; камера и пользовательский
ввод обрабатываются в браузере; API принимает типизированные агрегаты, выполняет
QC и предоставляет аналитику и экспорт.

Основная продуктовая ценность:

- единый инструмент для создания и проведения мультимодальных исследований;
- обработка видеосигнала на устройстве участника без штатной отправки сырых
  кадров на сервер;
- синхронизация gaze, blinks/PERCLOS, rPPG/BPM, эмоций, позы и RT по одной
  временной шкале сессии;
- контроль качества, повтор только повреждённых заданий и восстановление после
  перезагрузки;
- tenant-scoped кабинет исследователя с AOI, heatmap, аналитикой и экспортом.

Проект не является медицинским изделием, не ставит диагноз и не заменяет
клиническую оценку, лабораторный eye tracker, ЭКГ/контактный PPG,
полисомнографию или валидированную нейропсихологическую батарею.

## 2. Неподлежащие нарушению принципы

1. Сырое видео и сырое аудио не отправляются на API штатным participant flow.
2. Участник проходит только опубликованный протокол; свободный Test Hub допустим
   только в явно авторизованном developer/local preview.
3. Gaze prediction должен быть target-blind: координаты стимула или цели нельзя
   использовать для притягивания предсказания.
4. `raw`, `corrected` и `display` gaze signals нельзя смешивать. Аналитика
   использует валидный `corrected`, UI может использовать `display`.
5. Положение головы является отдельным nuisance/QC/OOD-каналом и не должно
   незаметно заменять движение глаз.
6. Ошибка качества не должна скрыто останавливать активное испытание. Попытка
   завершается, помечается невалидной и повторяется после объяснения причины.
7. Ручная пауза разрешена только на экране инструкции и снимается явной кнопкой.
8. Завершение сессии идемпотентно, а итоговый ingest выполняется через один
   typed transport `POST /ingest`.
9. Invitation, session, protocol и project не перепривязываются по данным
   клиента. Participant token проверяется по полному server-issued tuple.
10. Любой staff-доступ, кроме platform-admin, требует organization и project
    membership. Роль без tenant membership недостаточна.
11. Клиент не задаёт файловый путь. Все пути server-owned и обязаны оставаться
    внутри resolved `UPLOADS_ROOT`.
12. Новая зависимость, модель, датасет или stimulus допускается только после
    проверки открытой лицензии, фиксации версии, источника и attribution.
13. Нельзя описывать proxy-метрику как клинически валидную без отдельного
    протокола, ground truth, статистической проверки и научной приёмки.
14. Ошибки API не должны раскрывать stack trace, SQL, пути сервера, токены,
    invitation code или персональные данные пользователю.

## 3. Источники истины и приоритет информации

При конфликте источников использовать следующий порядок:

1. Фактически подключённый runtime-код и миграции текущей ветки.
2. Версионированные схемы в `packages/shared/contracts/` и схемы аналитики в
   `apps/web/docs/analytics-contract/`.
3. Автоматические тесты, воспроизводимые на текущем commit.
4. `docs/api/`, `docs/reports/` и `docs/research/`.
5. Корневой `README.md` и README отдельных модулей.
6. GitHub Issues, roadmap и проектные договорённости.
7. Старые файлы с суффиксами `new`, `updated`, `phase*` и неиспользуемые
   прототипы.

Не переносить число пройденных тестов из старого отчёта в новый отчёт без
повторного запуска. Не считать строку в README доказательством корректности
алгоритма.

Канонические документы:

| Тема | Источник |
| --- | --- |
| Общая карта и запуск | `README.md` |
| Session lifecycle и transport | `docs/api/session-runtime-v1.md` |
| RBAC и tenant scope | `docs/api/authorization-matrix-v1.md` |
| Secure ingest и threat model | `docs/reports/2026-07-s2-01-secure-ingest.md` |
| Статус спринтов 1–2 и release gates | `docs/reports/2026-08-07-s1-s2-integration.md` |
| Gaze/blink/body методика | `docs/research/gaze-blink-body-methods.md` |
| Лицензии assets и моделей | `docs/THIRD_PARTY_LICENSES.md` |
| Analytics contract | `apps/web/docs/analytics-contract/README.md` |
| API и env | `apps/api/README.md`, `apps/api/.env.example` |

`docs/architecture.md` сейчас слишком краток и частично описывает планируемые
директории. Не использовать его в одиночку для архитектурных решений.

## 4. Состояние продукта

Код спринтов 1–2 собран как release candidate. Реализованы session lifecycle,
typed ingest, RBAC, tenant isolation, AOI, analytics/export, безопасная
конвертация документов и браузерные signal modules. Формальный статус
production-ready не достигнут до закрытия инфраструктурных, независимых
security и real-device scientific gates.

Текущие пользовательские поверхности:

| Поверхность | Канонический вход | Назначение |
| --- | --- | --- |
| Staff login | `apps/web/developer/login.html` | cookie staff auth и CSRF |
| Исследователь | `apps/web/researcher.html` | проекты, протоколы, стимулы, AOI, результаты |
| Участник | `apps/participant-web/run_new.html?code=<CODE>` | вход только по приглашению |
| Полный participant flow | `apps/participant-web/mvp_with_precheck_1-updated.html` | consent, precheck, calibration, protocol, finish |
| Developer tools | `apps/web/developer.html` | изолированные диагностические экраны |
| API | `apps/api/server.js` → `apps/api/app.js` | Express API |

Не делать старые `mvp_with_precheck_1.html`, `app.js`, `tests.js`,
`experimental_task.js` или `server_phase4_updated.js` новыми каноническими
точками входа без отдельной миграции и удаления неоднозначности.

## 5. Структура репозитория

```text
web-emocog-core/
├── apps/api/                 Node.js/Express API, SQL, миграции и tests
├── apps/web/                 researcher/developer static frontend
├── apps/participant-web/     participant UI, browser ML и session runtime
├── apps/autotests/           Playwright E2E/contract tests
├── apps/shared/              shared browser registries
├── apps/researcher-web/      legacy shell и Python converter prototype
├── packages/shared/          versioned JSON Schema и TypeScript declarations
├── lib/rppg_.../             browser rPPG/BPM engine
├── rt_component-/            Python RT post-analysis
├── Audio_detection/          standalone audio core, пока не session-integrated
├── docs/                     API, research, licenses и мини-отчёты
├── deploy/                   nginx snippets
├── ml/, packages/ui/, db/    преимущественно заготовки, не runtime source
└── README.md
```

Монорепозиторий не использует npm workspaces и сборщик frontend. У API и
Playwright собственные `package.json` и lockfile. Static frontend загружается
напрямую браузером, поэтому порядок `<script>`, browser cache и MIME для ESM
существенны.

## 6. Архитектура и поток данных

```text
Researcher UI ──cookie + CSRF──> Express API ──SQL──> PostgreSQL
      │                              │
      ├── protocol/AOI/stimuli       ├── analytics snapshots/export
      └── invitation                 └── server-owned uploads

Participant UI
      ├── camera -> one frame pipeline -> face/iris/blink/emotion/rPPG/QC
      ├── pose landmarker -> body movement/QC
      ├── keyboard/pointer -> RT events
      ├── IndexedDB checkpoint/delta chunks
      └── final SessionFeature v1 + participant ingest token -> POST /ingest
```

Participant flow:

1. Участник открывает invitation URL.
2. API только читает существующее приглашение; неизвестный code возвращает 404.
3. Участник подтверждает consent.
4. API атомарно admission-reserves run и выдаёт короткоживущий ingest token,
   связанный с session, invitation, project и protocol.
5. Precheck показывает видео участника и проверяет камеру/условия.
6. Calibration показывает guide; независимая validation не обучает модель.
7. Перед каждым блоком показывается отдельная инструкция; затем начинается
   измерительный trial без ручной паузы.
8. Фоновые модули работают на протяжении измерительной сессии и не являются
   самостоятельными заданиями.
9. Невалидные trial/block повторяются после объяснения, а принятые не теряются.
10. При finish модули и camera tracks останавливаются, строятся агрегаты и
    выполняется один идемпотентный ingest.
11. При сетевой ошибке terminal checkpoint остаётся в IndexedDB и отправляется
    повторно с тем же `Idempotency-Key`.

## 7. Session runtime

Канонический код находится в `apps/participant-web/js/session-runtime/`.

State machine:

```text
idle -> starting -> instruction -> running -> instruction -> ...
                         │             │
                         v             v
                       paused      quality_error / technical_error
                         │             │
                         └-------> instruction или running по правилам state

instruction -> finishing -> completed
```

Основные файлы:

| Файл | Ответственность |
| --- | --- |
| `session-state-machine.mjs` | состояния, issue, repeat queue, finish guards |
| `index.js` | оркестрация lifecycle, checkpoint и модулей |
| `frame-pipeline.js` | один анализирующий цикл для face-derived modules |
| `quality-detector.mjs` | sustained quality/technical issue thresholds |
| `checkpoint-store.mjs` | IndexedDB snapshots и delta chunks |
| `contracts.mjs` | typed event/lifecycle builders |
| `ingest-transport.mjs` | единственный participant network transport |
| `runtime-ui.js` | instructions, pause/lock, repeat и notification UI |

Правила изменения runtime:

- не создавать второй `requestAnimationFrame`/MediaPipe loop;
- не ставить trial timer на скрытую паузу из-за QC;
- не удалять failed attempt: он нужен для missingness и аудита;
- повторять минимальную единицу, которую определяет протокол;
- checkpoint writes сериализовать и дожидаться in-flight save перед clear;
- восстановленная активная попытка считается прерванной и требует повтора;
- финальный экран показывать только после teardown camera/module handles;
- итоговый blink count и остальные summaries строить до очистки accumulators.

## 8. Signal modules

### 8.1 Gaze on target

Код: `apps/participant-web/js/gaze-tracker/`.

Основа: MediaPipe Face Landmarker, 478 landmarks, iris-only ridge predictor,
персональная калибровка, OOD/confidence gate и отдельный display filter.

Signal contract:

| Сигнал | Назначение | Разрешённый потребитель |
| --- | --- | --- |
| `rawX/rawY` | прямое предсказание ridge | benchmark/диагностика |
| `correctedX/correctedY` | LOOCV-approved correction | heatmap/аналитика |
| `displayX/displayY` | сглаженный визуальный feedback | overlay/gaze brush |

Критические правила:

- calibration target берётся через `getBoundingClientRect()` относительно
  content viewport с учётом `visualViewport`;
- browser tabs/address bar не входят в координаты страницы и не вычитаются;
- validation targets не участвуют в fit или выборе correction;
- correction принимается только при held-out улучшении, иначе rollback к
  baseline;
- target coordinates запрещены в `predict()`;
- OOD/off-screen/low-confidence frame даёт отсутствующий sample, а не последнюю
  точку и не координаты фигуры;
- display smoothing не возвращается в raw/corrected pipeline;
- изменение положения камеры, размера/масштаба viewport или заметная смена позы
  требует повторной validation.

Перед изменением модели выполнить baseline-versus-new benchmark по accuracy,
precision/jitter, latency, off-screen specificity, missingness и head-motion
robustness. Синтетический unit test не доказывает webcam accuracy.

### 8.2 Blinks и PERCLOS

Код: `apps/participant-web/js/gaze-tracker/attention-metrics.js` и общий frame
pipeline.

Сохраняются blink count, duration, closure amplitude, opening speed, incomplete
blink proxy и PERCLOS windows. Детекция должна учитывать динамику EAR во
времени, а не один кадр. Обычный blink не равен микросну. PERCLOS и blink
dynamics нельзя интерпретировать клинически без размеченного ground truth.

Обязательная валидация: очки, блики, частичная окклюзия, разные FPS, камеры,
разрез глаз и освещение; сравнение с вручную размеченным видео.

### 8.3 rPPG / BPM и respiration

Код: `lib/rppg_alg_qc_test_web_alg_test_v10/` и
`apps/participant-web/js/session-runtime/continuous-bpm.js`.

Движок использует POS/CHROM, ROI, signal-quality gates и публикует только
допустимые значения. BPM работает фоново и не должен появляться как отдельный
обязательный protocol block. Не выдавать held/низкокачественное значение как
измеренный пульс.

Обязательная валидация: синхронный reference PPG/ECG, движение, экспозиция,
разные тона кожи, камеры/FPS, очки и длительные сессии. Это исследовательская
оценка, не медицинский показатель.

### 8.4 Emotion / FACS

Код: `apps/participant-web/js/emotion/` и `frame-pipeline.js`.

Модуль формирует Action Unit/proxy, valence/arousal и confidence summary
фоново. Название эмоции является модельной гипотезой, а не наблюдаемым фактом.
Не делать выводы о психическом состоянии, лжи, диагнозе или личности. Требуются
описание модели, benchmark по подгруппам, calibration, uncertainty и
missingness. UI участника не должен подсказывать «правильную» эмоцию.

### 8.5 Head pose и body movement

Код: `head-pose-guide.js`, `continuous-body-pose.js`, Pose Landmarker assets.

На precheck показывается видео. Далее контур головы отображается только на
инструкциях, паузах и locks; активный stimulus нельзя закрывать guide-элементом.
Body movement использует torso/shoulder/hip landmarks и является отдельным
поведенческим каналом. Head pose не заменяет gaze и не должен автоматически
браковать естественное краткое движение.

### 8.6 RT

Код: `apps/participant-web/js/rt-input/`, `apps/shared/rt-registry.js`,
`rt_component-/`.

Поддерживаются click/keyboard и явно выбранный `pointer-intent`. Pointer-intent
нельзя включать глобально: он зависит от task semantics. Защита от mouse
micro-tremor должна включать amplitude threshold, dwell/debounce, trusted event
и максимум один response на trial.

Обязательная валидация: клавиатура, мышь, touchpad, browser/OS, display refresh,
click-versus-pointer latency, false positives и omissions.

### 8.7 VPC и visuospatial

Код: `apps/participant-web/js/gaze-tracker/gaze-tests/`.

VPC показывает familiar и novel изображения семейства Felidae и считает
novelty preference по dwell. Текущий протокол является исследовательской
адаптацией. Его timings, webcam accuracy и стимулы не эквивалентны опубликованным
клиническим VPC-протоколам, поэтому результат не диагностирует MCI/деменцию.

Visuospatial task предлагает нарисовать взглядом круг, часы или человечка после
явного старта. Gaze используется как кисть, а display signal показывается
участнику. Это кастомная eye-control задача, а не валидированный Clock Drawing
Test: моторный канал, feedback и scoring отличаются. До научной интерпретации
нужны scoring rubric, inter-rater/automated agreement, test-retest reliability,
нормативная выборка и comparison с обычным рисованием.

### 8.8 Audio

`Audio_detection/` — standalone MIT-licensed эвристическое ядро. Оно пока не
подключено к canonical session frame/transport и не должно описываться как
работающий throughout-session module. Перед интеграцией нужны отдельное
согласие на микрофон, data-flow/privacy review, quality gates, typed contract,
teardown, browser tests и запрет отправки сырой записи по умолчанию.

## 9. API, данные и контракты

API: Node.js 18+, Express 4, PostgreSQL, прямой параметризованный SQL без ORM.
Каноническая точка входа: `apps/api/server.js`.

Основные route groups:

| Route | Назначение |
| --- | --- |
| `/auth` | staff login, cookie/bearer, users |
| `/organizations`, `/projects` | tenant hierarchy и membership |
| `/protocols`, `/invitations` | protocol publication и participant admission |
| `/sessions` | session lifecycle/read |
| `/ingest` | атомарный `session_feature.v1` |
| `/analytics/v1` | filters, snapshots, session/group metrics, AOI, heatmap |
| `/analytics/v1/exports` | snapshot-bound CSV/JSON export |
| `/stimuli` | stimulus metadata/content и document conversion |
| `/contracts` | опубликованные JSON Schema |
| `/health`, `/ready` | liveness и DB readiness |

Canonical contracts:

- `packages/shared/contracts/session-feature.v1.schema.json`;
- `packages/shared/contracts/session-event.v1.schema.json`;
- `packages/shared/contracts/session-lifecycle.v1.schema.json`;
- `packages/shared/contracts/ingest-session-feature-response.v1.schema.json`;
- `packages/shared/contracts/session-contracts.d.ts`.

Contract change procedure:

1. Изменить JSON Schema и TypeScript declaration.
2. Изменить client builder и server validator.
3. Определить backward compatibility и schema version.
4. Добавить positive, negative, oversized и PII tests.
5. Проверить researcher analytics/export consumer.
6. Обновить `docs/api/` и mini-report.

Сейчас top-level SessionFeature строго ограничен, но ряд summary/event объектов
намеренно допускает расширяемое внутреннее содержимое. Это риск contract drift:
новые аналитические поля должны получать явную схему, лимиты и тесты, а не
скрываться в произвольном JSON.

Основные таблицы создаются миграциями `apps/api/migrations/`. Не менять
production schema вручную. Любая миграция обязана иметь проверяемый `up` и
безопасный `down`, описание backfill, lock/timeout impact и rollout/rollback.

## 10. Безопасность и приватность

### 10.1 Auth и authorization

Browser staff должен использовать `HttpOnly`, `Secure` в production,
`SameSite=Lax` cookie и CSRF header. Bearer JWT предназначен для внешнего API
client. Канонический permission module: `apps/api/security/permissions.js`.

В legacy frontend ещё существуют чтения `emocog_api_token` из `localStorage` и
developer compatibility paths. Не добавлять новые записи токена в
`localStorage`; постепенно удалить эти чтения после миграционного теста.

Public registration не создаёт staff privileges. Platform-admin создаётся
только операционной командой `npm run admin:bootstrap`. Нельзя добавлять email,
env или localhost admin bypass.

### 10.2 Participant boundary

Invitation code является bearer credential. Entry pages обязаны иметь
`Referrer-Policy: no-referrer`, URL очищается после admission, а ingest token
имеет короткий TTL и полный tuple binding. Долгосрочная цель — обмен invitation
URL на server-side participant cookie/session.

Unknown invitation не создаёт fallback row. `used_runs` резервируется атомарно
и не превышает `max_runs` при concurrency. Политика abandoned admissions пока
требует продуктового и юридического решения.

### 10.3 Ingest

До записи проверяются CORS, body limit, JSON shape, depth/array/string limits,
PII и token. Session/features/QC/proxy записываются в одной транзакции с lock и
rollback. Replay одинакового `Idempotency-Key` не создаёт дубли; другой key для
завершённой session возвращает conflict.

### 10.4 Uploads и conversion

PDF/PPT/PPTX проверяются по extension и binary signature. Ограничиваются bytes,
pages, timeout и concurrency. LibreOffice/Poppler запускаются только с
server-owned temporary paths. Проверять path traversal, symlink escape,
archive/document bombs, cleanup при исключении и MIME ответа.

### 10.5 Browser security

API security headers не заменяют CSP для static frontend, которую должен
выставлять nginx. Legacy researcher UI содержит большие inline style/script
блоки, что усложняет строгий CSP. Не ослаблять XSS escaping ради отображения
API/import/localStorage данных. Не использовать `innerHTML` с недоверенными
значениями без явной sanitizer/escaping стратегии.

### 10.6 Логи

Не логировать:

- `Authorization`, cookie, CSRF и ingest token;
- invitation code и URL с ним;
- email, телефон и иные PII;
- raw landmarks, frames, image buffers и audio samples;
- absolute server paths и SQL bind values с чувствительными данными.

Технический лог может содержать correlation ID, route template, status, safe
error code, latency, module/channel и redacted session ID.

## 11. UX для когнитивных исследований

Researcher UI может быть насыщенным, participant UI должен минимизировать
когнитивную нагрузку и экспериментальное вмешательство.

Правила participant UX:

- один главный action на экран;
- инструкция отделена от trial физически и состоянием runtime;
- формулировки короткие, нейтральные и не подсказывают ожидаемую реакцию;
- feedback не перекрывает stimulus/AOI и не меняет salience условий;
- alert имеет понятную причину, способ исправления и доступную кнопку закрытия;
- цвет не является единственным носителем значения;
- keyboard focus, reduced motion, контраст и target size проверяются;
- таймер начинается после готовности stimulus/assets, а не после открытия DOM;
- layout shift, animation и network latency не входят в RT незаметно;
- язык и wording версионируются вместе с protocol;
- camera/quality UI показывается только тогда, когда помогает исправить условия;
- participant не видит исследовательскую аналитику и меню модулей.

Для researcher UX сохранять явную иерархию:

```text
organization -> project -> protocol -> publish -> invitation -> monitoring
             -> session/results -> analytics snapshot -> export
```

Цель доступности — WCAG 2.2 AA, но автоматические проверки не заменяют
keyboard/screen-reader и human review. Изменения participant UX требуют
проверки исследователем на отсутствие bias/confound, а не только визуального
одобрения.

## 12. Сильные стороны текущего решения

- Privacy-oriented browser processing и отсутствие штатной отправки raw video.
- Один frame pipeline вместо конкурирующих MediaPipe loops.
- Разделённые gaze signals и target-blind prediction.
- Независимая gaze validation и rollback correction при ухудшении.
- Единая state machine, repeat queue, IndexedDB recovery и idempotent finish.
- Typed/versioned participant transport и опубликованные JSON Schema.
- Атомарный ingest, immutable participant binding и concurrency controls.
- Централизованный RBAC/tenant permission module.
- Server-owned file paths и ограниченная document conversion pipeline.
- Snapshot-based analytics, explicit missingness/QC и participant-equal group
  aggregation.
- CSV formula-injection protection и export provenance/hash.
- Vendored MediaPipe runtime/models с зафиксированными лицензиями и hash.
- Наличие unit, contract, PostgreSQL integration и Playwright tests.

## 13. Слабые места и риски

### P0: блокируют production approval

| Риск | Почему важен | Требуемое закрытие |
| --- | --- | --- |
| Нет обязательного CI/branch protection | Локально пройденные тесты не защищают develop | migration, API, PostgreSQL, Playwright, SAST/secret/dependency gates |
| Process-local rate limiter | Не согласован между несколькими API instances | reverse-proxy/Redis limiter и distributed tests |
| Local uploads | Не durable и плохо масштабируются | object storage/on-prem durable storage, backup и confinement tests |
| Нет production-like backup/restore/load drill | Возможна невосстановимая потеря данных | runbook, RPO/RTO, restore evidence, alerts |
| Нет независимого security review | Legacy DOM/XSS и business logic могут быть пропущены | white-box audit по OWASP ASVS и retest |
| Нет real-device scientific acceptance | Unit/E2E не доказывают точность сигналов | preregistered benchmark и ground truth |
| Legal data classification не утверждена | Gaze/face/health context может менять режим обработки | data map, consent, retention и legal audit |

### P1: высокий технический и продуктовый долг

| Риск | Наблюдение | Направление |
| --- | --- | --- |
| Monolithic frontend | `researcher-builder.js` > 3300 строк, `researcher.html` > 3100 | декомпозиция без преждевременной смены стека |
| Duplicate legacy files | `new/updated/phase*` затрудняют поиск entrypoint | migration map, удаление только после tests |
| Auth compatibility remnants | frontend ещё читает bearer из localStorage | cookie-only browser path и regression tests |
| Static inline UI | строгий CSP и cache invalidation сложнее | внешние versioned assets, CSP nonce/hash strategy |
| Broad nested aggregate objects | schema drift и скрытые PII поля | versioned sub-schemas и field-level limits |
| Final-only server upload | длинная offline/session потеря всё ещё риск | encrypted/minimized recoverable chunks или утверждённая durable policy |
| IndexedDB/memory pressure | длинные сессии и raw arrays могут исчерпать quota | multi-hour memory/quota/reload stress |
| Invitation in URL | остаётся в browser history/profile threat model | server-side participant session exchange |
| Abandoned admission policy | run расходуется без завершённого результата | retention/status UX и controlled operator action |
| Нет централизованной observability | сложно отличить module, QC и network failures | redacted metrics, traces, SLO/alerts |
| Audio не интегрирован | README core не равен работающему session module | consent, contract, QC, runtime и tests |

### P2: методические риски

- webcam gaze не достигает универсальной lab-grade точности;
- calibration может переобучиться на конкретную позу/освещение;
- OOD rejection улучшает правдивость, но повышает missingness;
- webcam EAR/PERCLOS чувствителен к очкам, FPS и анатомии век;
- rPPG зависит от движения, света, compression и skin-tone performance;
- emotion labels требуют demographic fairness и construct-validity review;
- VPC Felidae может иметь uncontrolled visual salience и category familiarity;
- gaze drawing смешивает зрительно-пространственный навык, eye control,
  calibration error и feedback learning;
- pointer-intent RT зависит от устройства и task context;
- body pose из одной камеры даёт 2D/relative proxies, а не точную кинематику;
- multiple comparisons и Level 2 analytics нельзя включать без заранее
  утверждённой статистической модели и minimum-N policy.

## 14. Локальный запуск

Требования: Node.js 18+, PostgreSQL 13+, современный Chromium, камера;
LibreOffice и Poppler нужны для document conversion.

```bash
cd apps/api
cp .env.example .env
npm ci
npm run migrate:up
npm start
```

Из корня репозитория:

```bash
python3 -m http.server 8080
```

Открыть:

```text
http://localhost:8080/apps/web/developer/login.html
http://localhost:8080/apps/web/researcher.html
http://localhost:8080/apps/participant-web/run_new.html?code=<CODE>
```

Не использовать production DB для тестов и миграционных экспериментов. Для
камеры нужен secure context: localhost допустим браузером, production обязан
работать по HTTPS. Настройки production `.env` не должны копировать dev
fallbacks.

## 15. Тестовая матрица

Минимальная проверка зависит от области изменения.

| Изменение | Обязательные проверки |
| --- | --- |
| API/contract/security | `cd apps/api && npm test` |
| SQL/migration/tenant/ingest | отдельная test DB и `s2-postgres.integration.test.js` |
| Researcher/participant UI | Playwright targeted spec + typecheck |
| Analytics/AOI/export | analytics Playwright config + API contract tests |
| RT mapping | Node tests + `npm run test:rt-python` |
| Gaze/blink/filter | signal unit tests + real-device benchmark plan/evidence |
| rPPG/emotion/body | unit/synthetic tests + reference-device validation |
| PDF/PPT/PPTX | signature/boundary/cleanup tests + real conversion smoke |
| Dependency/model update | license/hash update, audit, full browser smoke |

Команды:

```bash
cd apps/api
npm test
npm run test:rt-python

cd ../autotests
npm ci
npm run typecheck
npx playwright test tests/session-runtime.spec.ts
npx playwright test --config=playwright.analytics.config.ts
```

PostgreSQL integration запускать только с отдельной БД:

```bash
cd apps/api
S2_TEST_DATABASE_URL=postgres://... \
  node --test tests/s2-postgres.integration.test.js
```

Дополнительно перед передачей:

```bash
git diff --check
git status --short
rg -n '^(<<<<<<<|=======|>>>>>>>)' . --glob '!**/node_modules/**'
```

Если среда не позволила запустить тест, написать это явно. Нельзя заменять
непройденный тест предположением «должно работать».

## 16. Рабочий процесс ИИ-агента

### 16.1 Перед изменением

1. Выполнить `git status --short --branch`.
2. Не откатывать чужие изменения и не очищать dirty worktree.
3. Найти canonical entrypoint и все consumers через `rg`.
4. Прочитать ближайшие tests и соответствующий contract/doc.
5. Определить data/security/scientific invariants, затронутые правкой.
6. Для временно изменяемой информации проверить официальный первичный источник.
7. Для рискованной операции сформулировать rollback до редактирования.

Если во время работы появились неожиданные изменения, которых агент не делал,
остановиться и запросить решение пользователя.

### 16.2 Во время изменения

- делать минимальный coherent diff;
- не вводить новый framework только ради локального удобства;
- сохранять vanilla HTML/CSS/JS patterns до утверждённой миграции;
- использовать parameterized SQL;
- проверять authorization server-side, а не скрытием кнопки;
- не доверять ID, role, path, MIME, session state и timestamps клиента;
- обновлять schema, producer, validator и consumer одним изменением;
- добавлять regression test до или вместе с исправлением бага;
- не снижать quality/security threshold ради зелёного теста без evidence;
- не менять научные thresholds без benchmark и версии метода;
- не добавлять raw biometric media в payload, logs, fixtures или screenshots;
- для UI сохранять нейтральность задания и доступность.

### 16.3 После изменения

1. Запустить targeted tests.
2. Запустить более широкий suite для общей инфраструктуры.
3. Проверить negative и edge cases.
4. Проверить teardown, retry, reload/offline и duplicate action, если применимо.
5. Проверить role × operation × own/foreign tenant для access changes.
6. Обновить docs, contract version, migration notes и third-party licenses.
7. Составить мини-отчёт.

Мини-отчёт должен содержать:

- внесённые правки;
- технические новые включения;
- особенности реализации;
- спорные вопросы и решения;
- затронутые API/schema/migration;
- security/privacy impact;
- scientific/measurement impact;
- выполненные тесты и точные результаты;
- непротестированное и residual risks;
- rollout и rollback для существенной правки.

## 17. Обязательные edge cases

Для session/runtime:

- double-click и повторный finish;
- reload на instruction, trial, finish и после accepted ingest;
- offline до finish, во время fetch и после server commit до ответа;
- camera track ended, permission denied и MediaPipe exception;
- краткий и длительный low light/head movement/FPS drop;
- invalid trial subset и repeat queue без повторения валидных trial;
- смена viewport/zoom/camera pose после calibration;
- teardown всех tracks/listeners/timers/workers.

Для API/security:

- missing/expired/mismatched token;
- own, same-org foreign-project и foreign-org resources;
- IDOR/BOLA и mass assignment;
- parallel `used_runs`, duplicate idempotency key и forced late rollback;
- malformed/deep/oversized JSON и unknown/PII fields;
- SQL/XSS/CSV formula payloads;
- absolute path, `..`, encoded traversal, Windows path и symlink escape;
- MIME/signature mismatch, archive bomb, timeout и cleanup;
- revoked staff token, changed password/role и CSRF absent/mismatch;
- CORS exact-origin, proxy IP and rate-limit behavior.

Для signal processing:

- no face, multiple faces, partial face, glasses and glare;
- 15/30/60 FPS, dropped and duplicate timestamps;
- head translation without eye movement и eye movement without head motion;
- off-screen gaze, OOD pose и calibration edge targets;
- correction improves training but worsens independent validation;
- natural blink versus long closure;
- low quality rPPG with a plausible but false spectral peak;
- device/browser performance degradation over a long session.

## 18. Definition of Done

Работа считается технически завершённой только если:

1. Поведение соответствует задаче и canonical architecture.
2. Security/privacy/scientific invariants сохранены.
3. Contract и migration совместимы или явно versioned.
4. Positive, negative, edge и regression tests добавлены и пройдены.
5. UI проверен на desktop/mobile и keyboard path, если он затронут.
6. Нет merge markers, syntax errors и `git diff --check` ошибок.
7. Third-party license/source/hash обновлены при изменении assets.
8. Документация и мини-отчёт отражают фактический код.
9. Непроверенные hardware/scientific свойства названы ограничениями.
10. Есть review ответственного и финальная приёмка тимлида/техлида.

ИИ-агент не закрывает GitHub Issue только на основании локального diff: нужны PR,
зелёный CI и человеческая приёмка по roadmap.

## 19. Научная приёмка

Для каждого измерительного канала до продуктовых выводов зафиксировать:

| Поле | Требование |
| --- | --- |
| Construct | что именно измеряется и чего метрика не измеряет |
| Ground truth | референсное устройство или ручная разметка |
| Population | возраст, зрение, очки, skin tone и другие применимые подгруппы |
| Devices | камеры, разрешения, FPS, браузеры, OS, экраны |
| Conditions | свет, движение, дистанция, окклюзия, длительность |
| Metrics | accuracy, precision, latency, missingness, sensitivity/specificity |
| Baseline | предыдущая версия и простой baseline |
| Validation | независимые targets/sessions/participants, не training data |
| Thresholds | заранее заданные acceptance thresholds |
| Statistics | sample size, uncertainty, exclusions, multiple comparisons |
| Versioning | model, code, protocol, stimulus и calibration version |

Нельзя оптимизировать алгоритм на session-файле конкретного участника и затем
называть этот же файл независимой validation.

## 20. Внешние источники

Использовать первичные, официальные или рецензируемые источники. Проверять
актуальность стандартов и лицензий перед релизом.

### Web ML и координаты

- [MediaPipe Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [MediaPipe, Apache-2.0 license](https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE)
- [CSSOM View: `getBoundingClientRect`](https://drafts.csswg.org/cssom-view/#dom-element-getboundingclientrect)
- [Visual Viewport API](https://wicg.github.io/visual-viewport/)

### Gaze, blinks и pose

- [MPIIGaze: Real-World Dataset and Deep Appearance-Based Gaze Estimation](https://arxiv.org/abs/1711.09017)
- [Offset Calibration for Appearance-Based Gaze Estimation via Gaze Decomposition](https://openaccess.thecvf.com/content_WACV_2020/html/Chen_Offset_Calibration_for_Appearance-Based_Gaze_Estimation_via_Gaze_Decomposition_WACV_2020_paper.html)
- [1 Euro Filter](https://doi.org/10.1145/2207676.2208639)
- [Eye-Blink Detection Using Facial Landmarks](https://cmp.felk.cvut.cz/ftp/articles/cech/Soukupova-TR-2016-05.pdf)
- [PERCLOS validity report](https://rosap.ntl.bts.gov/view/dot/113)
- [BlazePose](https://arxiv.org/abs/2006.10204)

### rPPG

- [Algorithmic Principles of Remote PPG](https://doi.org/10.1109/TBME.2016.2609282)
- [Robust Pulse Rate from Chrominance-Based rPPG](https://doi.org/10.1109/TBME.2013.2266196)

### Cognitive paradigms

- [The visual paired-comparison task as a measure of declarative memory](https://pmc.ncbi.nlm.nih.gov/articles/PMC17349/)
- [Eye Tracking During a VPC Task as a Predictor of Early Dementia](https://pmc.ncbi.nlm.nih.gov/articles/PMC2701976/)
- [Eye-tracking paradigms for MCI: systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC10399700/)
- [Digital and paper drawing tests: systematic review and meta-analysis](https://pmc.ncbi.nlm.nih.gov/articles/PMC9381608/)

Эти статьи обосновывают исследовательские парадигмы, но не валидируют текущую
реализацию EmoCog автоматически.

### Security, privacy и UX

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP API Security Top 10](https://owasp.org/API-Security/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Федеральный закон № 152-ФЗ «О персональных данных»](https://ips.pravo.gov.ru/api/ips/legislation/document?baseid=None&hash=98490812b3409e2a8d78a11ca9010f434ea3d9250a11dbbdb78690cd5551bdd6)

Правовую применимость, категории данных, основания обработки, локализацию,
retention и тексты согласий должен подтвердить независимый юрист по фактической
data-flow схеме и deployment, а не ИИ-агент.

## 21. Поддержание этого файла

Обновлять `AGENTS.md` в том же PR, если изменились:

- canonical entrypoint или структура приложения;
- session state machine или participant flow;
- API/schema/migration/auth/tenant model;
- состав фоновых signal modules;
- data-flow raw/aggregate данных;
- научная интерпретация или acceptance benchmark;
- лицензия/версия MediaPipe, модели, stimulus или dependency;
- production gates и обязательные тестовые команды.

Не превращать этот документ в журнал изменений. Историю реализации хранить в
`docs/reports/`, а здесь оставлять только актуальные правила и карту системы.
