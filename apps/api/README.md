# Emocog API (Фаза 2)

Бэкенд: Node/Express, Postgres, миграции (node-pg-migrate). Реализованы шаги 2.1–2.8 плана улучшений.

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

## Роли (RBAC)

- **admin**, **PI**, **researcher**, **analyst**, **assistant**, **developer**, **respondent**

Защищённые маршруты проверяют JWT и роль через middleware `requireAuth` и `requireRole`.

## Эндпоинты

| Метод | Путь | Описание | Auth |
|-------|------|----------|------|
| POST | /auth/register | Регистрация | — |
| POST | /auth/login | Логин, выдача JWT | — |
| GET | /auth/me | Текущий пользователь | JWT |
| GET | /auth/users | Список аккаунтов (для RBAC-менеджмента) | JWT + роль |
| POST | /auth/users | Создание аккаунта с ролью | JWT + роль |
| PATCH | /auth/users/:id | Обновление роли/display_name/password | JWT + роль |
| GET/POST/PATCH/DELETE | /organizations | CRUD организаций | JWT + роль |
| GET/POST/PATCH/DELETE | /projects | CRUD проектов | JWT + роль |
| POST | /sessions/start | Старт сессии | JWT |
| POST | /sessions/stop | Стоп сессии | JWT |
| GET | /sessions | Список сессий (фильтры) | JWT |
| GET | /sessions/:id | Карточка сессии + features | JWT |
| POST | /events/batch | Батч событий (session_id, participant_id, events[]) | JWT |
| POST | /ingest | Приём агрегатов (payload buildAggregatesPayload) | — |
| GET | /export | Экспорт CSV/JSON (project_id, protocol_id, date_from, date_to, qc_validity) | JWT |
| GET | /experiments | Сводный учет экспериментов по сессиям/QC | JWT |
| GET | /experiments/recent | Последние сессии экспериментов | JWT |
| GET | /health | Health check | — |

## HTTPS и PII (Фаза 2.8)

- **В проде** приложение должно работать только по HTTPS (reverse proxy или TLS). Опция `FORCE_HTTPS=true` включает редирект с HTTP на HTTPS.
- **В запросах к API не должно быть PII.** В теле запросов не передавайте email, ФИО и другие персональные данные участников. Участник идентифицируется только по `participant_id` и `session_id`.
- **При приёме агрегатов** (POST /ingest) поле `meta.user.email` не сохраняется в SessionFeatures; сохраняются только обезличенные сводки.

## UPLOAD_AGGREGATES_URL

В конфиге участника (unified-config) укажите URL инжеста, например: `https://api.example.com/ingest`. Тогда клиент сможет отправлять результат `buildAggregatesPayload` на этот адрес после завершения сессии.

## Контракт payload (v1.0)

`POST /ingest` ожидает агрегированный payload из participant-клиента.

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

Для `POST /ingest` достаточно передать `qcSummary` и `blocks`.

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
