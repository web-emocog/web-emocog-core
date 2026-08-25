# Интеграция спринтов 1 и 2

Дата: 07.08.2026
Ветка: `develop`
Базовый commit: `5b29d18`
Frontend-источник: commit Ани `530d7c2` (`update-from-wec-alfa`)

## Итог

Собран единый release candidate по функциональности спринтов 1 и 2 без переноса
нового дизайна S1-04 в production web. Сохранены UX и визуальная структура ветки
Ани, но отключение авторизации из её ветки не перенесено. Добавлены отсутствующие
backend endpoints, конвертация документов, tenant/RBAC/security, AOI persistence,
session lifecycle и измерительные модули.

Кодовая часть спринтов 1 и 2 завершена в объёме, который можно проверить
автоматически. Безусловно называть сборку production-ready пока нельзя: остаются
инфраструктурные release gates и научная/аппаратная приёмка S2-03/S2-04.

## Сверка роудмепа

| Задача | Состояние кода | До формального закрытия |
| --- | --- | --- |
| S1-01 RBAC, contracts, developer workflow | Реализовано: typed contracts, cookie staff auth + CSRF, tenant memberships, role/operation matrix, server-issued participant token, workflow project -> protocol -> publish -> invitation -> session -> analytics/export | PR/CI, review ответственного и тимлида |
| S1-02 AOI/цели | Реализовано: rectangle/polygon CRUD, normalized/versioned block-scoped schema, protocol serialization/validation, builder UI, session/AOI analytics | Приёмка исследовательского UX на реальном протоколе |
| S1-03 session lifecycle | Реализовано: единая state machine, instruction-only pause, repeat queue, typed `/ingest`, reload/offline recovery, idempotent finish, camera/module teardown, единая итоговая выгрузка | Длинный staging/device stress и формальный review |
| S1-04 UX/UI | Спецификация и SVG готовы | Новый дизайн сознательно не внедрён по текущему требованию; production сохраняет UX Ани |
| S2-01 secure ingest | Реализовано: admission после consent до испытания, immutable invitation/session binding, token mismatch `409`, transaction/lock/rollback, idempotency, atomic `used_runs`, schema/PII/body/depth/array/CORS/rate/path controls, migrations и negative/concurrency tests | PR/CI и формальное закрытие issue; утвердить срок хранения abandoned admission |
| S2-02 AOI analytics/export | Реализовано: snapshots, session/group AOI metrics и heatmaps, QC/missingness, participant-equal aggregation, CSV/JSON export, dataset hash/provenance | Level 2 модель только после утверждения исследовательского метода |
| S2-03 gaze/blinks | Реализовано: raw/corrected/display, content viewport coordinates, head/iris separation, OOD/confidence gate, target-blind prediction, LOOCV/validation, blink dynamics и PERCLOS | Benchmark минимум на 5 участниках и 2 ноутбуках с baseline thresholds |
| S2-04 RT semantics | Реализовано: click/pointer-intent modes, movement threshold, dwell/debounce, tremor protection, typed events и tests | Benchmark на реальных мышах/touchpad и утверждение mode policy |

## Оценка commit Ани

Commit `530d7c2` существенно закрывает frontend-часть S1-02/S2-02:

- AOI builder, versioned analytics contracts и metric catalog;
- production analytics shell, session/group/AOI/heatmap views и export UI;
- preview fixture и Playwright analytics specification;
- frontend-вызов конвертации PDF/PPT/PPTX;
- клиентская проверка уникального названия протокола.

В исходном commit не было backend `/analytics/v1/*`, `/stimuli/convert`, DB
uniqueness и реального API E2E. Ветка также ослабляла auth guard, поэтому целиком
не сливалась. Нужные frontend-файлы интегрированы трёхсторонне поверх защищённой
ветки; текущие cookie auth, CSRF, навигация и tenant checks сохранены.

## Доработки интеграции

- Реализованы `/analytics/v1/filter-options`, snapshots, session/group metrics,
  AOI/heatmap, comparison readiness и CSV/JSON exports.
- Групповые показатели агрегируются с равным весом участника; confidence interval
  не выдумывается при недостаточном N.
- Export учитывает `summary|long|both`, содержит dictionary/provenance и защищён
  от spreadsheet-formula injection.
- Реализован безопасный `POST /stimuli/convert`: signature/size/page/time limits,
  LibreOffice + Poppler, transaction/cleanup и PDF/PPT/PPTX smoke tests.
- Добавлены server-side AOI validation и уникальность имени протокола в проекте.
- Закрыта горизонтальная эскалация PI через пользователя с memberships в чужом
  tenant; password/global-role patch выполняется под lock в transaction.
- Legacy session scope учитывает `protocol.project_id`, если `session.project_id`
  отсутствует.
- Публичная регистрация участника не создаёт staff-сессию и не открывает кабинет
  исследователя.
- Invitation run резервируется атомарно при обмене кода на ingest token после
  согласия и до длительного испытания. Повторный обмен для той же session
  идемпотентен, чужой invitation даёт `409`, новая session при исчерпанном лимите
  получает `410`, а ранее admitted session может восстановиться после reload.
- Abandoned admission намеренно не освобождается автоматически: принятая
  участником попытка учитывается в `used_runs`, чтобы позднее восстановление не
  создавало oversubscription и неоднозначную повторную выдачу места.
- API-derived project/protocol/session/stimulus values экранируются перед выводом
  в researcher/developer views; дополнительно закрыты persistent-XSS sinks в
  импортируемых протоколах, именах файлов, аккаунтах и списке экспериментов.
- Development CORS явно разрешает только локальные origin проекта; production
  использует configured allowlist.
- Обновлены версии frontend assets для исключения stale browser cache.

## Проверки

- API unit/security/contracts: `150/150`, ошибок нет.
- PostgreSQL integration: `14/14`, включая malformed admission без побочных
  записей, transaction rollback, parallel
  `max_runs`, token mismatch, cookie/CSRF, analytics tenant isolation и
  mixed-tenant account takeover.
- Все 14 миграций прошли на чистой БД по схеме `up -> down -> up`.
- Researcher + participant Chromium E2E: `15/15`, включая admission после
  consent, удаление invitation из URL и reload ранее admitted session.
- Production analytics Chromium E2E: `4/4`.
- Реальный HTTP API contract: `5 passed`, `1 skipped`; пропущен только сценарий,
  требующий переданного извне privileged staff token, а его privileged path
  покрыт PostgreSQL integration test.
- PDF/PPTX converter smoke: по одной странице, результат распознан как JPEG;
  boundary/signature/limit/cleanup tests входят в API suite.
- JS/MJS syntax: `229` файлов; JSON parse: `31` файл.
- Autotests TypeScript: локальный закреплённый `typescript@5.9.3`,
  `npm run typecheck` проходит.
- `git diff --check` и поиск merge conflict markers прошли.
- `npm audit --omit=dev` для API и `npm audit` для autotests: `0`
  vulnerabilities. Обнаруженный при проверке CVE в test-only `js-yaml` устранён
  обновлением lockfile до `4.3.1`, после чего Playwright повторён.

## Остаточные release blockers

1. Для нескольких API instances заменить process-local limiter общим proxy/Redis
   limiter и локальные stimulus files durable object storage.
2. Настроить обязательные CI/branch-protection gates: migration, PostgreSQL,
   Playwright, dependency/secret/SAST scans.
3. Провести backup/restore drill, нагрузочный тест, мониторинг/alerts и incident
   runbook на production-подобной инфраструктуре.
4. Обменивать invitation code из URL на server-side HttpOnly participant session;
   сейчас referrer закрыт и URL очищается, но browser history/локальный профиль
   остаются частью threat model.
5. Выполнить real-device scientific acceptance gaze и RT; synthetic tests не
   доказывают точность камеры или устойчивость к конкретному hardware.
6. Провести независимый DOM-XSS/CSP аудит legacy researcher UI. Найденные при
   этой интеграции API/import/localStorage sinks экранированы, но отдельный
   security review остаётся обязательным release gate.
7. Утвердить retention/monitoring для admitted, но не завершённых session. Их
   `used_runs` не освобождается автоматически из-за риска oversubscription.
8. Получить review и формальную приёмку ответственного/тимлида; закрыть GitHub
   Issues только после PR и зелёного CI.

## Решение по релизу

Версия является функционально интегрированным кандидатом спринтов 1 и 2, а не
финальным production approval. Она пригодна для локальной и staging-проверки.
Production deployment допускается после закрытия инфраструктурных gates 1-3 и
security review; научные заявления по gaze/RT допускаются только после пункта 5.
