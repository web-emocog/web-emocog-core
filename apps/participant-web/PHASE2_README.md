# Фаза 2 — Бэкенд: ядро API и данные (реализовано)

План: [IMPROVEMENT_PLAN.md](../../../docs/IMPROVEMENT_PLAN.md). Исходные файлы не удалялись; добавлена новая папка `apps/api` во всех ветках.

## Где находится API

- **web-emocog-core-main (2):** `apps/api/`
- **web-emocog-core-bpm_module (1):** `apps/api/`
- **web-emocog-core-feature-before_start_analyse (1):** `apps/api/`
- **web-emocog-core-feature-rt_component (1):** `apps/api/`

Подробности — в `apps/api/README.md`.

## Реализованные шаги

| Шаг | Описание |
|-----|----------|
| 2.1 | Стек: Node/Express, Postgres, node-pg-migrate. Структура: routes, middleware, config, migrations. |
| 2.2 | Auth: POST /auth/register, POST /auth/login, JWT, роли admin, PI, researcher, analyst, assistant. Middleware requireAuth, requireRole. |
| 2.3 | Organizations & Projects: CRUD, user_organizations. |
| 2.4 | Sessions: POST /sessions/start, POST /sessions/stop. Participant events and results use only typed POST /ingest. |
| 2.5 | POST /ingest — приём payload из buildAggregatesPayload. Session + SessionFeatures. |
| 2.6 | QC Aggregator: qc_score, valid/borderline/invalid, fail_reasons. SessionQcSummary. |
| 2.7 | GET /export — фильтры project_id, protocol_id, date_from, date_to, qc_validity. Ответ: JSON или CSV. |
| 2.8 | README и config: в проде только HTTPS; в запросах не должно быть PII; при приёме агрегатов email не сохраняется. |

## Запуск API

```bash
cd apps/api
cp .env.example .env
# Заполнить DATABASE_URL, JWT_SECRET
npm install
npm run migrate:up
npm start
```

Участник отправляет агрегаты на `POST /ingest` только с server-issued ingest
token. Клиент получает его через
`POST /invitations/by-code/:code/ingest-token`; token связан с `session_id`,
invitation, protocol и project. Для отправки в конфиге участника задайте
`UPLOAD_AGGREGATES_URL` (например `https://your-api/ingest`).
