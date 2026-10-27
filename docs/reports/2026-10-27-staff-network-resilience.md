# NETWORK-STAFF: Отказоустойчивость Кабинета

Дата: 27.10.2026. Локальная ветка `feature/frame-pipeline-workers`, основа
`89880ef5c0b98530e1d87fe6b13596e077d08f46`. Предыдущие изменения сохранены.
Без commit/push, выпуска, закрытия GitHub issues и изменения рабочих аккаунтов.

## Итог И Границы

Локально реализован большой блок NETWORK-STAFF: строки исходной таблицы
99,101,103,106,109,112,114,118,128,135. Это исправление сетевого слоя, не
доказательство исправления всех багов файлов или готовности всего продукта.
Универсальный FPS и научная точность физиологических оценок остаются открытыми.

В JSON остаются все 239 строк: исправлено локально 14 (было 4), частично 10
(было 7). Исходный Google Sheet и прежняя XLSX-сводка не перезаписаны.
Строки participant 52,62,65 отмечены частичными, не закрыты полностью.

## Что Изменено

- Новый `apps/web/http-client.js` / `WecogHttp`: единый ограниченный transport
  с reader callback. Deadline включает установление соединения и чтение/разбор
  тела; зависший adapter, игнорирующий abort, тоже не оставляет caller pending.
- Обычные запросы: 30 с; upload/media/export: 600 с; auth probe/CSRF refresh:
  15 с; logout: 10 с. Это клиентские бюджеты, не увеличение серверных лимитов.
- `page` принадлежит экрану: отменяется при смене hash/project. `workspace`
  принадлежит owner/project/API: общая библиотека переживает SPA-переходы.
  `document` нужен auth/password/списку проектов и не зависит от выбранного
  проекта. Все три защищены owner/API context и отменяются на pagehide.
- До fetch, после headers и после body проверяется контекст. Удаляются timer и
  caller AbortSignal listener; не применяются поздние ответы. Сохраняются
  существующие generation guards галереи и аналитики.
- Все непосредственные fetch-consumers в `apps/web` переведены на helper:
  researcher core/bridge, стимулы, аналитика/экспорт/PDF font, developer pages,
  вход и landing auth probe. Глобальные Response/body readers не подменяются.
- Developer pages теперь тоже загружают account-storage/staff-session до guard.
  Чужой cookie-аккаунт блокирует старую вкладку и её запросы. Login намеренно
  не привязан к предыдущему staff user, чтобы можно было сменить аккаунт.
- Только подтверждённые auth 401/403 отправляют на вход. Offline/503/timeout и
  некорректный auth payload скрывают защищённый UI, предлагают повтор и не
  стирают локальные флаги/черновики. Cached role сам по себе не даёт доступ.
- У входа одна pending-операция; пароль передаётся без изменения. Доверенный
  адрес входа не блокируется сохранённым локальным API override.
- Неподтверждённый logout не изображается успешным выходом. Пароль может
  сохраняться при переходе между разделами того же аккаунта, как и раньше.
- Удалена опасная подстановка первого доступного протокола при ошибке создания
  developer-приглашения. Ошибка нужного ID остаётся ошибкой; POST для другого
  протокола не отправляется. Public code сохраняется в созданной ссылке.
- Participant bypass `/auth/me` и оба legacy local `experiment.json` используют
  существующий `fetchWithDeadline` с чтением тела. Их полный task lifecycle/
  caller cancellation здесь не переписан.

## Безопасность И Неизвестный Результат

Нет общего автоматического retry мутаций. Существующий единственный повтор
после явного pre-route `csrf_token_invalid` сохранён: refresh только для того же
staff user; отменённая/просроченная запись не отправляется после позднего refresh.
Два caller разделяют refresh, но отмена одного не отменяет другого. Временный
503 при refresh не превращается в ложную постоянную блокировку аккаунта.

У timeout/network/cancel после отправки мутации есть
`mutationMayHaveCommitted`: сервер мог успеть сохранить изменение. Сообщение
предлагает проверить результат перед ручным повтором; rollback не обещается.
HTTP status/code сохраняются. В сетевые исключения не включаются URL, payload,
credentials или внешний abort reason. Новых payload-логов нет.

URL: HTTP(S), без username/password, только origin страницы и разрешённый
resolver-ом API (включая trusted login base без storage override). Redirect
запрещён, чтобы не переносить staff headers по переадресации. Серверные
authorization/CSRF/tenant checks остаются обязательными и не менялись.

Контракты API, SQL/migrations, cookie attributes, модели, FPS/QC thresholds и
формулы метрик не изменены в этом продолжении. Ограничение времени ожидания
не доказывает ограничение памяти JSON parser и не является заменой server limits.

## Свежие Проверки

| Проверка | Результат |
| --- | --- |
| Targeted staff HTTP/session Node | 23/23 |
| Полный API, macOS / Node 24 | 550 всего: 545 pass, 5 skip, 0 fail |
| Полный API, Linux / Node 22 Docker | 550 всего: 546 pass, 4 skip, 0 fail |
| Disposable PostgreSQL 16 integration | 49/49 |
| Native staff HTTP: Chromium/Firefox/WebKit | 48/48 |
| Кабинет: пароли/публикация/стимулы/PDF, три движка | 144 pass, 3 explicit skip, 0 fail |
| Отдельный real-cookie UI + API + PostgreSQL, три движка | 3/3; закрывает три skips предыдущей строки |
| Отдельная серия смены аккаунтов | 24/24 после исправления scopes |
| Participant runtime/Worker regression, три движка | 174/174 |
| Production analytics regression, Chromium | 7/7 |
| TypeScript `--noEmit`, inline/module syntax, diff checks | Pass |

Пять macOS skips: два real converter smoke, Linux-only media wrapper и два
real nginx tests. В Linux media wrapper выполняется; converter/nginx smoke
остаются отдельными gates. PostgreSQL suites не запускаются без отдельной БД;
выше указан их отдельный фактический прогон. Три UI skips требуют настоящего
изолированного cookie API: этот отдельный прогон тоже выполнен, все три pass.
Это не меняет исторический счётчик первого запуска и не маскирует skips как pass.

Real-cookie стенд: новая tmpfs PostgreSQL 16, readonly Node 22 API-контейнер,
два синтетических researcher с общей project membership, static 4195, API только
`127.0.0.1:4196`. Проверены публикация, API export с совпадающими snapshot/hash,
общий изменённый draft второго исследователя, неизменность старого immutable
snapshot и повторная публикация v2 с сохранением public link. После прогонов
удалены контейнеры/сеть; рабочий API/БД не использовались.

Нативные HTTP-тесты используют настоящий loopback server, не только fetch mocks:
stalled headers/body, server-visible abort, неизвестный multipart POST без
повтора, account/project/route change, pagehide, redirect, offline/auth ошибки,
одновременный login и неверный protocol ID. Тело скачивания 128 KiB сверяется
побайтно; multipart-файл 8 MiB проверяется по имени, размеру, project field и
SHA-256 в каждом движке. Это не проверка максимального production upload.
Малые deadline в сценариях ускоряют воспроизведение; стандартные бюджеты
проверяются отдельно. Syntax scan: 12 HTML, 24 inline scripts, 9 JS modules.

### Найденные Во Время Проверки Проблемы

Первый стенд использовал браузерно запрещённый порт 4190; заменён на 4194 без
ослабления браузерных настроек. Затем CORS fixture не разрешал существующий
`X-Auth-Transport`; исправлен только fixture. Финальный HTTP-прогон: 48 pass.

Первый широкий UI-прогон: 138 pass, 6 fail, 3 skip. Из них четыре WebKit PDF
ошибки вызваны не изолированными auth probes предпросмотра: тесты теперь явно
отдают synthetic unauthenticated response, не обращаясь к рабочему localhost API.
Два сбоя галереи потребовали отдельной серии: 15 pass / 9 fail в 24 повторах.
Причина была в слишком широкой отмене workspace cache при SPA navigation;
разделение scopes дало 24/24 и затем 144/144 широкой регрессии без retries.
Защита смены owner/project сохранена и проверяется отдельно.

Первый real-cookie стенд остановлен до тестов: internal Docker network не дала
host-браузеру доступа через port mapping. Повтор на отдельной bridge-сети с
публикацией только loopback и readiness `/ready` прошёл 3/3. Это ошибка стенда,
не основание менять CORS/защиту production; исходный стенд очищен.

## Воспроизведение И Выпуск

Из `apps/api`: `node --test tests/*.test.js`. Integration: отдельная disposable
PostgreSQL, затем `npm run test:postgres`; не задавать рабочую DATABASE_URL.

Из `apps/autotests`:

```bash
npx tsc --noEmit
npx playwright test --config=playwright.staff-http.config.ts
npx playwright test --config=playwright.staff-regression.config.ts
RUN_WORKER_REGRESSION=1 npx playwright test --config=playwright.workers.config.ts
```

Staff tests поднимают свои static servers 4194/4195, не переиспользуют 4173.
Native HTTP tests поднимают API на случайном loopback-порту и блокируют внешние
origins. Данные synthetic; камеры/микрофона и рабочих логинов нет. Docker API
tests используют tmpfs БД, внутреннюю сеть, readonly checkout и cleanup;
real-cookie UI использует описанный выше отдельный loopback bridge-стенд.

До выпуска нужны human review/CI и staging smoke: реальный upload/export,
slow network/offline, две вкладки разных аккаунтов, published invitation и
возврат в кабинет после смены пароля. Classic HTML dependency versions обновлены
согласованно (`20261027-1`). Participant ES-module graph не переименован одним
entrypoint: перед выпуском нужна согласованная проверка cache invalidation
всего графа, без дублирования module identity. Старые payload не пересчитываются.

Rollback: вернуть цельный согласованный комплект frontend HTML/transport и
consumers из предыдущего проверенного артефакта, а не только удалить helper.
SQL rollback не нужен: новых миграций нет. Не сбрасывать workspace/черновики.

Остаются открытыми full legacy lifecycle/caller signal, большие длительные
network/memory/quota stress, полная инвентаризация UI generation guards и
проверка production proxies/cache. Dynamic `import()` в BPM диагностике всё ещё
управляется браузером; bounded probe не означает отменяемый module import.

Механика abort/body и redirect проверена по первичным источникам:
[Fetch Standard](https://fetch.spec.whatwg.org/#fetch-api),
[AbortController.abort](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort).
