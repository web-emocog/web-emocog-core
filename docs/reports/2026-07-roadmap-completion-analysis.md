# Оценка выполнения роудмепа на 2026-07-25

> Исторический срез. Актуальная оценка интеграции спринтов 1 и 2 находится в
> `docs/reports/2026-08-07-s1-s2-integration.md`. Проценты и release blockers
> ниже не отражают исправления, внесённые после 25.07.2026.

Источник: roadmap 2026-07-21...2026-08-31, код ветки `develop`, локальные
изменения и доступные тесты. Проценты отражают инженерную готовность, а не
формальную приёмку. Без отчёта, ответственного review и финального
тимлид/техлид review задача не считается закрытой.

## Сводка

| Спринт | Инженерная готовность | Формально принято |
| --- | ---: | ---: |
| Спринт 1 | около 71% | 0 из 4 |
| Спринт 2 | около 47% | 0 из 4 |
| Спринт 3 | около 16% | 0 из 5 |
| Весь roadmap | около 43% | 0 из 13 |

Проект ещё не готов к релизу. Главные release blockers: семантика резервирования
`max_runs` до начала длинного испытания, безопасная staff-аутентификация без
JWT в `localStorage`, AOI и исследовательский web, CI/security automation,
полный HTTP RBAC E2E, real-device gaze benchmark, длинные session checkpoints,
RT semantics, audio integration, дизайн в коде и production hardening.

## По задачам

| ID | Оценка | Что уже есть | Что осталось до приёмки |
| --- | ---: | --- | --- |
| S1-01 RBAC/API contracts | 90% | Typed contracts, permission matrix, tenant scope, DB-backed/revocable staff JWT, ingest token, atomic memberships | HttpOnly/SameSite staff session, полный HTTP API E2E по ролям/tenant, PR/CI, review и приёмка |
| S1-02 AOI/цели | 10% | Базовые gaze/heatmap primitives | CRUD AOI, versioning, assignment, researcher UI, analytics |
| S1-03 Session state machine | 95% | Lifecycle, continuous modules, chunked/serialized checkpoint, reload/offline recovery, terminal-write ordering, idempotent finish и browser E2E | Long-session memory/quota stress, real-camera/staging E2E, PR/CI и приёмка |
| S1-04 UX/UI design | 90% | Архитектура и SVG/design artifacts | Дизайн-review и формальная приёмка |
| S2-01 Secure ingest | 98% | Atomic ingest, negative/concurrency tests, realpath-confined uploads, invitation-scoped stimuli, server-generated invitations | Run admission/reservation policy, multi-instance rate limiter, PR/CI, GitHub #31, review ответственного и тимлида/техлида |
| S2-02 AOI analytics | 10% | Общая analytics база | AOI metrics, emotion/engagement layers, export и UI |
| S2-03 Gaze accuracy | 70% | Raw/corrected/display, viewport scaling, fail-closed inputs, head/iris separation, validation/LOOCV | Baseline-vs-new benchmark минимум на 5 участниках/разных устройствах, thresholds и отчёт |
| S2-04 RT semantics | 5% | Общий RT compute helper | Mouse movement mode, tremor/debounce rules, mode selection, tests; исправить Python `stim_type` |
| S3-01 Backend/DB/CI handover | 20% | Миграции и часть security tests | CI pipeline, backup/restore rehearsal, observability, runbook, ownership handover |
| S3-02 Audio module | 25% | Отдельное audio ядро | Session integration, permissions/QC, privacy, summaries, tests |
| S3-03 Multimodal/game package | 35% | Head/body signals и базовые events | Timeline synchronization, heatmap layers, game events contract, exports |
| S3-04 Design implementation | 0% | Дизайн отдельно от production web | Перенос approved design во frontend и responsive/e2e проверка |
| S3-05 CSS/publication hardening | 0% | Не подтверждено | Устранить мигание, cross-browser/mobile, accessibility, release check |

## Уже реализованные сквозные изменения

- Единая participant state machine и идемпотентный finish.
- Непрерывная фоновая работа gaze, blinks/PERCLOS, emotion, body pose, RT и BPM
  в пределах возможностей каждого модуля.
- Измерительная временная ось начинается при успешном запуске continuous
  pipeline после consent/pre-check, а не при загрузке страницы; восстановленная
  сессия сохраняет исходную эпоху.
- Typed `SessionFeature` и единый participant transport к `/ingest`.
- Разделение gaze `raw/corrected/display`, viewport calibration,
  head/iris features, confidence/OOD gate и target-blind prediction.
- Blink duration/amplitude/opening speed и PERCLOS.
- Central RBAC, project/org membership и server-issued participant token.
- S2-01 atomic ingest и HTTP/upload security.
- Chunked/serialized reload recovery, gaze/EAR restoration, camera teardown и
  final-ingest retry проверены browser E2E.
- Terminal checkpoint ожидает незавершённую фоновую запись и не может быть
  перезаписан устаревшим состоянием `running`.
- Новые invitation codes генерируются сервером из 128 бит энтропии; ingest
  token TTL сокращён до 15 минут.
- Participant получает только стимулы, указанные в его protocol definition;
  приватные metadata и `content_path` наружу не выдаются.
- Файлы проверяются по `realpath`, поэтому symlink внутри `UPLOADS_ROOT` не
  может вывести чтение за пределы корня.
- Participant entry pages используют `Referrer-Policy: no-referrer`, чтобы
  bearer invitation code из URL не уходил внешним origin через referrer.

## Незакрытые release blockers

| Приоритет | Риск | Почему блокирует production | Требуемое решение |
| --- | --- | --- | --- |
| P0 | Run резервируется только на итоговом `/ingest` | Несколько участников могут полностью пройти тест при одном оставшемся run; поздние результаты получат `410` | Ввести атомарный admission/start reservation с TTL и явной политикой abandoned session |
| P0 | Staff JWT хранится в `localStorage` | Любой XSS получает bearer token | Перевести staff auth на `HttpOnly; Secure; SameSite` cookie или BFF, добавить CSRF-защиту и строгий CSP |
| P1 | Invitation bearer остаётся в URL/IndexedDB для reload | Browser history, локальный профиль или XSS могут раскрыть код исследования | Обменивать code на server-side participant session, очищать URL и хранить credential в HttpOnly cookie |
| P0 | Нет обязательного CI/PR security gate | Локально зелёные тесты не защищают `develop/main` | CI: migrations, API+PostgreSQL, Playwright, dependency/secret/SAST scans и branch protection |
| P1 | In-memory rate limiter | Лимит обходится между несколькими API instances и сбрасывается при restart | Общий Redis/proxy limiter с единым client identity policy |
| P1 | Нет полного HTTP RBAC matrix E2E | Unit helper не доказывает, что каждый route подключил правильную operation/membership проверку | Staging E2E role x operation x own/foreign tenant |
| P1 | Demographics не имеют утверждённого data contract | UI собирает возраст/пол, но итоговый allowlist намеренно не передаёт их; для медданных нельзя молча расширять payload | Согласовать consent/legal basis, минимизацию и coarse/pseudonymous schema либо убрать поля из UI |
| P1 | Protocol может содержать внешний stimulus URL | Внешний origin видит IP/время запроса и может менять контент после публикации | Импортировать и хешировать stimulus на server-owned storage, запретить remote URL в published protocol и включить строгий CSP |
| P1 | Нет real-device gaze benchmark | Synthetic tests не измеряют реальную точность, head-motion robustness и missingness | Предрегистрация протокола, baseline-versus-new минимум 5 участников, разные камеры/свет/движения |
| P1 | Нет long-session/device matrix | Не подтверждены memory, IndexedDB quota, thermal throttling и browser lifecycle | 1–3 hour stress, reload/crash recovery, Chromium/Firefox/WebKit и mobile/edge-device matrix |
| P1 | Нет production observability/DR rehearsal | Ошибки ingest и потеря данных могут остаться незамеченными; backup не доказан восстановлением | Structured audit logs без secrets/PII, alerts, restore drill и runbook |

## Ближайший порядок

1. Утвердить admission/reservation lifecycle и staff cookie-auth, затем
   реализовать их до production deployment.
2. Провести review S2-01, поднять PR, запустить CI и только затем закрыть #31.
3. Завершить S1-01 route-level RBAC E2E и S1-03 long-session stress/staging
   acceptance, чтобы стабилизировать платформенный фундамент.
4. Реализовать S1-02 до S2-02: аналитика AOI без модели целей преждевременна.
5. Провести gaze benchmark S2-03 на реальных участниках; не заменять его unit
   tests.
6. Реализовать и проверить S2-04 до игровой мультимодальности.
7. Закрыть backend/CI handover до смены техлида.
8. Интегрировать audio, затем multimodal package.
9. Переносить дизайн в код только после стабилизации researcher web flows.

## Контрольный прогон

- API/unit/security с отдельной PostgreSQL 16: `117/117`, `0 failed`,
  включая rollback, concurrency, tenant membership и token mismatch.
- Participant Playwright/Chromium: `53 passed`, `6 skipped`, `0 failed`.
  Пропущены API-contract tests без внешнего API; серверные контракты отдельно
  прошли в API/PostgreSQL suite, но полный route-level RBAC E2E остаётся
  release blocker.
- Синтетические gaze/blink/attention тесты прошли; четыре локальных session
  fixtures, отсутствующие в repository, не запускались.
- `npm audit` для API production dependencies и autotests: 0 известных
  уязвимостей; `pip-audit` для researcher web: известных уязвимостей нет.
- Syntax check изменённых/новых JS/MJS, JSON parse и `git diff --check`
  прошли.

## Ограничения оценки

- GitHub CLI отсутствует; web-доступ к issue pages не сработал, а подключённый
  GitHub API вернул `422` при обращении к этому repository. Поэтому statuses
  #30-#36 не подтверждены и не изменены.
- Formal acceptance не может быть выставлен автором реализации за
  ответственного и тимлида/техлида.
- Реальные gaze quality thresholds требуют benchmark с участниками и
  зафиксированным оборудованием/условиями.
- Нельзя утверждать, что проверены все edge cases: аппаратные отказы,
  несколько API instances, большие payload/session duration и browser/device
  matrix требуют staging и нагрузочного контура.
