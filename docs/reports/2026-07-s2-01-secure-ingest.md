# S2-01: безопасный и атомарный ingest

> Отчёт фиксирует состояние на 25.07.2026. Актуальные результаты общей
> интеграции и повторной security-проверки приведены в
> `docs/reports/2026-08-07-s1-s2-integration.md`.

Дата: 2026-07-25
Статус: готово к проверке ответственным
GitHub: код для #31 подготовлен, закрытие issue требует PR, CI и приёмки

## Результат

Invitation и session больше не создаются или перепривязываются неявно.
Participant ingest token связан с полным tuple
`session + invitation + protocol + project`. Запись итогов и резервирование
запуска invitation выполняются атомарно. Upload path задаётся сервером и
ограничивается `UPLOADS_ROOT`. PII, неизвестные поля и превышение лимитов
отклоняются до записи. Новые invitation bearer codes генерируются только
сервером из 128 бит энтропии, token TTL составляет 15 минут.

## Threat model

| Угроза | Защита |
| --- | --- |
| Подмена invitation/session | Immutable binding, полный token tuple, `409` до записи |
| Создание invitation чтением | GET resolver выполняет только `SELECT`, unknown code даёт `404` |
| Race сверх `max_runs` | Conditional `UPDATE ... WHERE used_runs < max_runs` под row lock |
| Частично записанный ingest | Одна DB-транзакция для session/features/QC/proxy |
| Повтор finish | `Idempotency-Key`, replay того же ключа без новых записей |
| PII и произвольные поля | Allowlist schema и content scanner, ответ `422` |
| Resource exhaustion | Route-specific body, depth, array и rate limits |
| Path traversal | Server-owned path и проверка resolved path относительно uploads root |
| Symlink escape | Чтение делает `realpath` файла и корня и повторно проверяет confinement |
| Самовыдача admin | Нет email/config bypass; bootstrap вынесен в CLI |
| Cross-tenant staff access | Единый permission module и обязательные memberships |
| Угадываемый invitation code | Client-owned code запрещён; server-side CSPRNG, sensitive lookup rate profile |
| Доступ участника к чужим стимулам | Public route выдаёт только protocol-referenced stimuli того же project без private metadata |
| Утечка invitation URL через referrer | Participant entry pages задают `no-referrer` |

## Закрываемые findings

| Finding | Реализация |
| --- | --- |
| Audit 3 | Удалено fallback-создание invitation из ingest |
| Audit 4, 16 | Existing session нельзя перепривязать к invitation/participant/project/protocol |
| Audit 5 | GET invitation resolver не создаёт записи |
| Audit 10 | Absolute path, `..`, Windows traversal и symlink-выход из root запрещены |
| Audit 11 | Exact CORS allowlist, route body/rate profiles |
| Audit 12 | Session/features/QC/proxy объединены транзакцией |
| Audit 13 | Denylist заменён allowlist schema и явным PII rejection |
| Audit 14 | `used_runs` резервируется условным атомарным UPDATE |
| Audit 15 | Исправлена нумерация параметров project PATCH |
| GitHub #31 | Реализация готова; issue не закрывается без PR/CI/приёмки |

## Миграции

`1699000000012_atomic_ingest_security`:

- добавляет `invitations.used_runs`;
- добавляет `sessions.invitation_id`;
- выполняет безопасный backfill только при совпадении code/protocol/project;
- добавляет ограничения `used_runs >= 0` и `used_runs <= max_runs`;
- добавляет индекс по `sessions.invitation_id`;
- имеет симметричный `down`.

Миграция не вычисляет новый tenant scope по одному invitation code: сомнительные
старые строки остаются без `invitation_id` и должны быть разобраны отдельно.

## Транзакционная схема

1. Валидировать body, schema, PII и token signature вне транзакции.
2. Открыть транзакцию и взять advisory lock по `session_id`.
3. Заблокировать invitation через `SELECT ... FOR UPDATE`.
4. Проверить token tuple и существующую session до любых write.
5. Для новой session атомарно зарезервировать `used_runs`.
6. Создать или завершить session.
7. Записать `session_features`.
8. Записать QC summary.
9. Записать proxy metrics.
10. Commit только после успешного последнего шага; любая ошибка вызывает rollback.

Одинаковый `Idempotency-Key` завершённой session возвращает прежний результат.
Другой ключ для завершённой session возвращает `409`.

## Ingest token lifecycle

1. Клиент получает существующее invitation по коду; unknown code даёт `404`.
2. Клиент отправляет `session_id` на
   `POST /invitations/by-code/:code/ingest-token`.
3. Сервер проверяет invitation и, если session уже существует, её immutable
   binding.
4. Сервер выдаёт JWT сроком 15 минут с `sid`, `invitation_id`,
   `invitation_code`, `protocol_id`, `project_id`, issuer и audience.
5. `/ingest` повторно проверяет весь tuple под DB lock.
6. Получение token не расходует run; run резервируется только при создании
   session внутри ingest-транзакции.

Последний пункт обеспечивает атомарность финального ingest, но пока не
резервирует место перед длительным испытанием. До production требуется
отдельный admission/start lifecycle с TTL и политикой освобождения abandoned
reservation, иначе при одном оставшемся run несколько участников смогут
одновременно пройти тест, а один из финальных payload получит `410`.

## Коды ошибок

| HTTP | Код | Значение |
| ---: | --- | --- |
| 400 | `invalid_json` / validation errors | Невалидный JSON или базовый контракт |
| 401 | `ingest_token_mismatch` | Token отсутствует, истёк или неверно подписан |
| 403 | `cors_origin_denied` / `forbidden` | Origin или операция запрещены |
| 404 | `invitation_not_found` / `session_not_found` | Ресурс отсутствует |
| 409 | `ingest_token_mismatch` | Tuple token не совпадает |
| 409 | `session_invitation_mismatch` / `session_participant_mismatch` | Попытка перепривязать session |
| 409 | `idempotency_conflict` | Finish уже принят с другим ключом |
| 410 | `invitation_run_limit` | Лимит запусков исчерпан |
| 413 | `payload_too_large` | Body превышает лимит маршрута |
| 413 | `upload_too_large` | Загружаемый файл превышает лимит |
| 422 | `pii_forbidden` / `payload_schema_invalid` | PII, unknown field или structural limit |
| 429 | `rate_limit_exceeded` | Исчерпан лимит маршрута |

## Проверки

- Unit/contract suite проверяет admin bypass, schemas, PII, depth/array,
  upload paths и symlink escape, CORS/body/rate profiles, безопасные fallback
  конфигурации, rollback и source guards.
- PostgreSQL integration suite проверяет unknown invitation без insert,
  immutable binding, idempotent replay, forced late failure rollback и
  20 параллельных запросов при `max_runs=5`, atomic staff membership и
  invitation-scoped participant stimuli.
- Полный API suite с PostgreSQL: `117/117` в 30 наборах.
- PostgreSQL-сценарии: `10/10`.
- Полный прогон миграций на чистой PostgreSQL 16 прошёл.
- `down` и повторный `up` миграции `0012` прошли.
- Актуальный aggregate
  `session_S-DEV-HBPQFU_aggregates.json` проходит policy после добавления
  обязательного `schemaVersion`; старый aggregate отклоняется только из-за
  отсутствующего `lifecycle`, без ложного PII на URL стимула.

Команды:

```bash
cd apps/api
npm test
S2_TEST_DATABASE_URL=postgres://... npm test -- tests/s2-postgres.integration.test.js
```

Интеграционный тест очищает свои таблицы. Использовать только отдельную
тестовую БД.

## Rollout

1. Сделать backup БД и uploads.
2. Настроить `JWT_SECRET`, `CORS_ORIGINS`, route limits и `UPLOADS_ROOT`.
3. Перевыпустить старые короткие/человекочитаемые invitation links: новые
   ссылки всегда формируются сервером, но legacy rows автоматически не
   инвалидируются, чтобы не ломать активные исследования.
4. Если перед Node стоит доверенный proxy, закрыть прямой доступ к Node и
   задать точное число hops в `TRUST_PROXY_HOPS`.
5. Убедиться, что reverse proxy имеет body limits не выше серверных.
6. Запустить `npm run migrate:up`.
7. Выполнить smoke test invitation -> token -> ingest -> replay.
8. Перелогинить staff: новые JWT проверяют issuer/audience.
9. Для нескольких API instances включить общий rate limiter на reverse proxy
   или Redis: встроенный limiter защищает только один Node.js process.
10. Настроить proxy access-log redaction для invitation codes и
    `Authorization`.
11. Мониторить `401`, `409`, `413`, `422`, `429`, rollback и latency.

## Rollback

1. Остановить запись ingest.
2. Откатить приложение на предыдущую версию.
3. Выполнить `npm run migrate:down` один раз только после подтверждения, что
   старое приложение не использует `used_runs` и `invitation_id`.
4. При необходимости восстановить backup.

Rollback миграции удаляет новые поля, поэтому теряет новые привязки и счётчик.
Предпочтителен forward fix.

## Правила приёма

1. Работа принята ответственным по задаче.
2. Unknown invitation возвращает `404` и не создаёт запись.
3. Foreign session не перепривязывается; token mismatch даёт `409` без writes.
4. Позднее падение откатывает все writes; replay ключа не создаёт дубли.
5. `used_runs` не превышает `max_runs` при конкурентной нагрузке.
6. Absolute path и `..` не читаются и не удаляются.
7. CORS/body/rate различаются по route; PII/unknown fields отклоняются.
8. Up/down, concurrency и negative security tests проходят.
9. GitHub #31 закрыт после PR, CI и приёмки.
10. Работа принята тимлидом/техлидом.

Пункты 1, 9 и 10 являются организационными gate и не отмечены выполненными
автоматически.

## Остаточные риски до production

- атомарный admission/reservation должен происходить до начала испытания, а не
  только при финальном ingest;
- process-local rate limiter нужно заменить общим limiter для multi-instance;
- access/error logs и APM должны исключать invitation code, bearer token и PII;
- staff bearer token в `localStorage` должен быть заменён на защищённую
  cookie/BFF-сессию;
- backup/restore, staging load, full HTTP tenant matrix и incident runbook ещё
  не прошли приёмку.
