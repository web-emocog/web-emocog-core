
## Стек

- **Runtime:** Node.js 18+
- **Framework:** Express
- **БД:** PostgreSQL
- **Миграции:** node-pg-migrate

## Установка

```bash
cd apps/api
cp .env.example .env
# Отредактировать .env: DATABASE_URL, JWT_SECRET
npm install
npm run migrate:up
npm start
```

## Миграции

- `npm run migrate:up` — применить все
- `npm run migrate:down` — откатить одну
- `npm run migrate:create -- name` — создать новую

Порядок: users → organizations, projects, user_organizations → protocols, invitations → sessions, events, session_features, session_qc_summary.

Дополнительно (миграция `1699000000008_qc_proxy_indexes`):
- таблица `session_proxy_metrics` (скалярные proxy-поля + `payload` / `source_payload`),
- уникальный индекс по `session_id`,
- индекс по `(payload->>'proxy_ready')` для агрегатов experiments.

Миграция `1699000000012_atomic_ingest_security` добавляет
`invitations.used_runs`, неизменяемую связь `sessions.invitation_id` и
ограничения счётчика запусков. `up` и `down` поддерживаются.

Публичный `POST /invitations/by-code/:code/ingest-token` одновременно выполняет
атомарный admission: после consent и до испытания резервирует `used_runs` и
создаёт immutable session binding. Повтор для того же `session_id` не расходует
run повторно; чужой invitation возвращает `409`. Незавершённая admitted session
не освобождается автоматически и должна учитываться retention-политикой.

Миграция `1699000000013_staff_token_version` связывает staff JWT с актуальной
версией учётной записи. Смена пароля или роли отзывает все ранее выданные
токены; после rollout всем сотрудникам нужно войти заново.

Миграция `1699000000014_analytics_snapshots` добавляет immutable snapshots
аналитической выборки. Dashboard и export используют один `snapshot_id` и
проверяют один `dataset_hash`.

## Роли (RBAC)

- **admin**, **PI**, **researcher**, **analyst**, **assistant**, **developer**, **respondent**

Защищённые маршруты используют единый модуль
`security/permissions.js`: browser `HttpOnly` cookie или внешний staff JWT,
operation matrix и обязательное членство
в организации и проекте. Только `admin` (`platform-admin`) имеет
platform-wide scope. Полная матрица:
[`docs/api/authorization-matrix-v1.md`](../../docs/api/authorization-matrix-v1.md).

Публичная регистрация не выдаёт staff-роли. Первого или аварийного
platform-admin создаёт только оператор:

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_PASSWORD='<min-12-char-secret>' \
npm run admin:bootstrap
```

Пароль должен содержать 12-72 символа и не более 72 UTF-8 байт: это исключает
неявное усечение входа в `bcrypt`. Staff JWT действует 1 час и отзывается при
смене роли или пароля через `token_version`.

Код приглашения является bearer-секретом. Новые коды генерируются только
сервером из 128 бит энтропии; клиентское поле `code` при создании отклоняется.
Participant ingest token действует 15 минут, привязан к invitation/session/
protocol/project и автоматически перевыпускается клиентом при истечении.
Cookie-authenticated изменяющие запросы требуют `X-CSRF-Token`; browser login
не сохраняет staff JWT в `localStorage`.

## Эндпоинты

| Метод | Путь | Описание | Auth |
|-------|------|----------|------|
| POST | /auth/register | Регистрация | — |
| POST | /auth/login | Логин: `HttpOnly` cookie для browser или JWT для API-клиента | — |
| GET | /auth/me | Текущий пользователь; восстанавливает CSRF для cookie-сессии | Cookie / JWT |
| GET | /auth/users | Список аккаунтов (для RBAC-менеджмента) | JWT + роль |
| POST | /auth/users | Создание аккаунта с ролью | JWT + роль |
| PATCH | /auth/users/:id | Обновление роли/display_name/password | JWT + роль |
| GET/POST/PATCH/DELETE | /organizations | CRUD организаций | JWT + роль |
| GET/POST/PATCH/DELETE | /projects | CRUD проектов | JWT + роль |
| GET/POST/PATCH/DELETE | /protocols | Versioned protocol и server-side AOI validation | Cookie/JWT + membership |
| GET/POST | /invitations | Server-generated invitation codes | Cookie/JWT + membership |
| POST | /sessions/start | Старт сессии | JWT |
| POST | /sessions/stop | Стоп сессии | JWT |
| GET | /sessions | Список сессий (фильтры, QC + proxy source) | JWT |
| GET | /sessions/:id | Карточка сессии + features + QC/proxy source payload | JWT |
| POST | /ingest | Единственный типизированный transport событий и итогов SessionFeature | JWT / participant ingest token |
| POST | /invitations/by-code/:code/ingest-token | Короткоживущий participant token, связанный с session + invitation | Код приглашения |
| GET | /export | Экспорт CSV/JSON (project_id, protocol_id, date_from, date_to, qc_validity) | JWT |
| GET/POST | /analytics/v1/* | Filter options, snapshots, session/group AOI, heatmap, comparison readiness, export | Cookie/JWT + membership |
| POST | /stimuli/convert | PDF/PPT/PPTX в набор JPEG-стимулов | Cookie/JWT + project membership |
| GET | /experiments | Сводный учет экспериментов по сессиям/QC + proxy readiness | JWT |
| GET | /experiments/recent | Последние сессии экспериментов c QC + proxy source | JWT |
| GET | /health | Health check | — |
| GET | /ready | DB readiness | — |
| GET | /proxy-metrics/schema | Контракт proxy metrics v1 | — |
| GET | /sessions/:sessionRef/proxy-metrics | Proxy metrics одной сессии (id или session_id) | JWT |
| GET | /projects/:id/proxy-metrics | Список proxy metrics по проекту | JWT |
| GET | /protocols/:id/proxy-metrics | Список proxy metrics по протоколу | JWT |
| POST | /proxy-metrics/internal/sessions/:sessionRef | Upsert v1 metrics (только admin + `ENABLE_PROXY_METRICS_INTERNAL_UPSERT=true`) | JWT |

## Proxy metrics v1 (read infrastructure)

Таблица `session_proxy_metrics` хранит ingest-скаляры (`attention_score`, `emotion_*`, `mean_rt_ms`, …) и JSONB `metrics` для будущего расчётчика.

- **Без строки** → `GET .../proxy-metrics` возвращает `status: "not_computed"`, `metrics: {}` (без synthetic values).
- **После ingest** → `status: "partial"` (скаляры + mapping adapter).
- **После будущего calculator** → запись в `metrics` JSONB, `status: "computed"`.

Миграции: `1699000000008_qc_proxy_indexes`, `1699000000009_add_respiration_proxy_metrics`, `1699000000010_proxy_metrics_v1_contract`.

Тесты контракта: `npm test` (без БД).

## HTTP security и PII

- **В проде** приложение должно работать только по HTTPS (reverse proxy или TLS). Опция `FORCE_HTTPS=true` отклоняет HTTP с `426 https_required`; API не перенаправляет POST-body или bearer token.
- **В запросах к API не должно быть PII.** В теле запросов не передавайте email, ФИО и другие персональные данные участников. Участник идентифицируется только по `participant_id` и `session_id`.
- **При приёме агрегатов** `POST /ingest` отклоняет PII, неизвестные поля,
  слишком глубокие объекты, длинные массивы и oversized body. Данные не
  «очищаются» молча.
- **CORS, body limit и rate limit** настраиваются отдельно для `auth`,
  `ingest` и остальных маршрутов через `.env`.
- **IP за reverse proxy** учитывается только при явном `TRUST_PROXY_HOPS`.
  Прямой доступ к Node при этом должен быть закрыт firewall/security group.
- **Файлы стимулов** получают `content_path` только на сервере. Чтение и
  удаление разрешены исключительно внутри resolved `UPLOADS_ROOT`.

## Analytics v1

Канонический поток: `filter-options` -> `POST /analytics/v1/snapshots` ->
session/group endpoints -> `GET /analytics/v1/exports` с тем же `snapshot_id`.
Production UI не использует demo fallback. `null + status/reason` означает
отсутствие данных и не заменяется нулём. Level 2 comparison возвращает
`not_configured`/`insufficient_data`, пока в протоколе нет утверждённого метода;
backend не фабрикует effect, CI или p-value.

## Конвертация документов

`POST /stimuli/convert` принимает `multipart/form-data` с `file` и
`project_id`. PDF проверяется через Poppler; PPT/PPTX сначала переводится в PDF
headless LibreOffice. Расширение сверяется с сигнатурой, применяются лимиты
размера/страниц/timeout/concurrency, временные файлы удаляются в `finally`, а
записи БД и созданные JPEG откатываются при частичной ошибке.

Production host должен иметь `soffice`, `pdfinfo` и `pdftoppm`. Параметры:
`MAX_DOCUMENT_BYTES`, `MAX_DOCUMENT_PAGES`, `DOCUMENT_CONVERSION_TIMEOUT_MS`,
`DOCUMENT_CONVERSION_DPI`, `DOCUMENT_CONVERSION_CONCURRENCY`.

## UPLOAD_AGGREGATES_URL

В конфиге участника (unified-config) укажите URL инжеста, например: `https://api.example.com/ingest`. Тогда клиент сможет отправлять результат `buildAggregatesPayload` на этот адрес после завершения сессии.

## Контракт payload (v1.0)

`POST /ingest` ожидает агрегированный `session_feature.v1` из
participant-клиента. Единственный browser transport:
`apps/participant-web/js/session-runtime/ingest-transport.mjs`.

Participant token должен совпасть по `session + invitation + protocol +
project`; mismatch возвращает `409`. Staff JWT может отправлять результат
только для project-scoped сессии, созданной через `/sessions/start`.
Запись `session`, `session_features`, `session_qc_summary` и
`session_proxy_metrics`, а также резервирование invitation run выполняются в
одной транзакции под session/advisory lock. Повтор с тем же
`Idempotency-Key` возвращает сохранённый результат без дублей.

- `qcSummary`:
  - поддерживаются `qc_score` и `qcScore` (оба приводятся к шкале 0..100),
  - поддерживается `checks` в `camelCase` и `snake_case` (`faceVisible`/`face_visible`, `gazeValid`/`gaze_valid` и т.д.),
  - `failReasons` может быть массивом строк.
- `blocks`:
  - ожидаемый формат: массив объектов `[{ name, attention, arousal, valence, blinks, rt, omissions }]`,
  - `analytics` и `export` используют этот массив как контрактный источник метрик по блокам,
  - при отсутствии `blocks` backend выполняет fallback (например, `Session` block в analytics/group) и не ломает ответ.
- `emotion_summary`:
  - формат: `{ valence_mean, arousal_mean, n }`,
  - агрегируется на клиенте из `emotionEvents` и сохраняется как часть feature payload.
- `bpm_summary`:
  - формат: `{ runs, sampleCount, bpmMean, lastRun }`,
  - `lastRun` содержит `{ sampleCount, bpmMean, stopReason }`,
  - используется как стабилизированный срез rPPG/BPM без сырых кадровых данных.

## Минимальный контракт ingest payload

Минимальный legacy-набор `qcSummary` и `blocks` больше не является полным
контрактом. Обязательны `schemaVersion=session_feature.v1`, `ids.session`,
`lifecycle` и typed `events`; JSON Schema публикуется на
`GET /contracts/session_feature.v1`.

- `qcSummary`:
  - принимаются оба варианта ключа score: `qc_score` и `qcScore`,
  - сервер нормализует значение score к шкале `0..100`.
- `blocks`:
  - ожидается массив объектов блоков,
  - контрактные поля блока: `name`, `attention`, `arousal`, `valence`, `blinks`, `rt`, `omissions`,
  - `rt` и `omissions` могут быть дорассчитаны/нормализованы сервером из `cognitiveResults`, если в блоке они отсутствуют или переданы частично.
- PII:
  - payload не должен содержать персональные данные (email, ФИО и т.п.),
  - используйте только обезличенные идентификаторы (`participant_id`, `session_id`) и агрегаты.
- Stimulus uploads:
  - принимаются JPEG, PNG, WebP, GIF, MP3, OGG, WAV, MP4, WebM и PDF;
  - MIME сверяется с сигнатурой файла, HTML/SVG и несовпадение типа отклоняются;
  - имя и `content_path` формирует сервер, PDF выдаётся как attachment;
  - встроенный rate limiter рассчитан на один Node.js process; для нескольких
    instances необходим общий limiter на reverse proxy или Redis.

## Проверка S2-01

```bash
npm test
S2_TEST_DATABASE_URL=postgres://... node --test tests/s2-postgres.integration.test.js
```

Вторая команда выполняет destructive setup только в отдельной тестовой БД.
Она проверяет unknown invitation, immutable binding, admission replay/reload,
rollback ingest writes и параллельный лимит `used_runs`.
