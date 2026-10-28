# Developer BPM: Отмена Запуска И Локальные Assets

Дата: 28.10.2026. Ветка `fix/audit-diagnostics-lifecycle`, база
`f43713cd885d3dda2c2071984020341be2d83e4a`. Адресный аудит строк **105**
(lifecycle) и **209** (legacy URL) исходной таблицы. Только локальная работа;
GitHub, production, рабочая БД, аккаунты и существующие результаты не менялись.
Другие незакоммиченные изменения checkout сохранены.

## Воспроизведение

На прежнем `bpm-test.js?v=20261027-1`: подменить getUserMedia контролируемым
promise, нажать Start, отправить pagehide, затем разрешить promise камеры.
Получен `#screen.placeholder.running` вместо остановленного теста. Поздний
stream не освобождался. Это browser-регрессия до исправления, не гипотеза
по наличию асинхронных функций.

Исходный Stop работал с уже присвоенными stream/RAF, но не отменял продолжение
`loadEngine -> initMediaPipe -> getUserMedia -> play -> loadeddata`. В начальной
стадии Stop был выключен, start guard проверял только running. Task MediaPipe
не закрывался, ожидание loadeddata оставляло listener/timer; RAF handle 0
не отменялся. На pagehide не было обработчика, только beforeunload.

Loader перебирал предположительные ancestor paths и `/main`, включая путь,
построенный из имени текущего HTML. Это могло создавать лишние запросы и
выбирать не ту копию библиотеки. Поддержка path prefix не требует угадывания.

Это standalone developer page. Найденное не является доказательством такого
же дефекта в каноническом participant runtime или production-инцидента.

## Что Изменено

- `diagnostic-run.mjs`: отдельный владелец попытки, отмена через AbortSignal,
  deadline и teardown. Поздний native result освобождается даже после Stop
  или timeout. Cleanup одного ресурса не блокирует освобождение остальных.
- Native model/camera stages сериализованы. Повторный Start не создаёт
  неограниченные parallel initialization/permission requests. Отменённые
  queued attempts не вызывают native factory. Поздний старый task закрывается
  до начала следующего native initialization. При перепроверке локального
  варианта Promise chain заменена удаляемыми waiters: 100 отмен не меняют
  ссылку на pending native work и не оставляют ожидающих callbacks.
- Старый callback не сбрасывает RAF нового запуска и не меняет его UI.
  Проверены handle 0, 100 полностью начатых циклов с owned RAF, metadata
  listeners и timers. Stop доступен и во время инициализации.
- Generic stages ограничены 30 s, auth body 15 s, play/metadata 10 s.
  Проверяется и monotonic deadline после синхронной работы, а не только
  срабатывание таймера. Ошибка readiness не выдаётся за готовую камеру.
- Отмена на pagehide/beforeunload/staff block. Модель закрывается, tracks
  останавливаются, video отвязывается, canvas очищается. Ошибка reporter
  finalize не мешает остановке, не финализируется повторно.
- Перед каждым новым запросом камеры повторно читается server `/auth/me`:
  нужны та же identity и текущая роль admin/developer. Cached admission
  недостаточен после logout/revocation/BFCache. Initial auth guard сохранён.
- Проверяется доступная browser Permissions-Policy API. При camera denial
  показывается точная причина без native запроса и без скачивания моделей.
  Серверные headers и роли не ослаблены.
- Один same-origin путь rPPG и URL WASM/model от `import.meta.url`; проверены
  repo root и префикс `/audit-prefix`. Probe остаётся bounded headers/body
  transport с caller signal. Dynamic import не считается напрямую abortable.
  Entry script и новый helper имеют cache tag `20261028-1`; модели/библиотеки
  и их версии не менялись. Полный warm-cache rollout module graph не выполнялся.
- Убран второй HTML click handler с независимым 4 s watchdog, который мог
  повторно включить Start. Module-load error теперь имеет безопасный текст
  и выключенный Start, без raw Error/URL. Все сообщения ошибок allowlisted,
  покадровый Error не отправляется в console.
- Canvas больше не меняет width/height, если размеры не изменились. UI log
  ограничен 200 строками, reporter 7200 retained samples; summary явно про
  retained данные. Это техническое ограничение, не замер ускорения inference.

## Корректность Developer Метрик

Дополнительно подтверждено при чтении файла: UI брал `respRateRaw` как запасной
вариант и не проверял respHeld/respConf, а accepted hold BPM передавался в
reporter как новая публикация. Исправлено только на developer page:

- используется существующий `publishedRespiration` канонического collector;
- raw, low-quality и held respiration не показываются как измеренная частота;
- held BPM может отображаться с прежней явной пометкой, но не помечается
  свежей публикацией в reporter;
- убран неиспользуемый `fps: 30` аргумент: RppgEngine не читал его значение.

Порог 0.20, диапазоны и остальные научные gates не изменены. Старые данные,
формулы rPPG, participant collector, worker pipeline и API contracts не
пересчитывались и не редактировались. Новые находки не добавлены искусственно
к числу закрытых строк исходных 239.

## Проверки

До финального общего прогона: **9 unit passed**, затем **126 browser checks
passed**, retries=0, два повтора Chromium/Firefox/WebKit. Это 21 case на
движок; 100-cycle case требует реальный owned RAF, а не только CSS class
предварительного видео. В каждом повторе есть настоящее init/close локального
MediaPipe с подменённым источником камеры и без анализа кадров человека.

После последнего изменения очереди фоновый двойной прогон, оставшийся на время
прерывания работы, дал 124 passed / 2 failed за 37,3 минуты. Firefox:
`browserContext.newPage` timeout до выполнения приложения (тест длился около
35 минут) и timeout отдельного native task case. Непрерывность стенда в этот
период не гарантирована; точная причина второго отказа не установлена. Эти
результаты не скрыты и не объявлены исправленными изменением лимитов.

После возобновления, без изменения кода/gates/retry: оба Firefox case по три
повтора дали **6 passed**, затем полный двойной набор дал **126 passed**
во всех трёх движках. Временно предотвращён только idle sleep на время команды;
это настройка стенда, не исправление продукта и не workaround в runtime.

Финальный последовательный прогон после возобновления:

| Проверка | Результат |
| --- | --- |
| API/unit, Node 24/macOS | 602 tests: **597 passed**, 5 skipped, 0 failed |
| Linux/Node 22, новые lifecycle unit | **9 passed**, 0 failed |
| Staff regression, Chromium/Firefox/WebKit | **273 passed**, 3 skipped, 0 failed; retries=0 |
| Developer BPM внутри staff suite | **63 passed**, включая три настоящих init/close model cases |
| HTML data boundaries, три движка | **33 passed**, 0 failed; retries=0 |
| Analytics production, Chromium | **7 passed**, 0 failed |
| TypeScript, JS syntax, git diff --check | passed |

Исходники зафиксированы SHA-256 до запуска и сверены после. Linux container
использовал существующий образ `wecog-api:audit-followup-20261025`, `--network
none`, read-only root/checkout, no-new-privileges и disposable noexec tmpfs.
Рабочие контейнеры/БД не запускались; тестовый container удалён после проверки.

Пять unit skips относятся к native converter/nginx/Linux tools на macOS host;
PostgreSQL integration suites также не выполнялись. Три staff skips являются
прежним API-fixture deletion case по одному на движок, не новыми BPM tests.
Новый набор не получил retries/skips и не заменяет production/native DB gates.

Команды:

```bash
cd apps/api && npm test
node --test tests/diagnostic-run.test.js
cd ../autotests
npm run typecheck
npx playwright test --config=playwright.staff-regression.config.ts tests/developer-bpm-lifecycle.spec.ts --repeat-each=2
npm run test:staff-regression
npm run test:html-security
npx playwright test --config=playwright.analytics.config.ts
```

Новые cases добавлены в staff config, уже вызываемый release-gates matrix.
Нет новых retry/skip. Сетевые обращения тестов ограничены локальными серверами
и синтетическим auth; внешние origins блокируются. getUserMedia/video
подменены: физические камера и микрофон не запрашивались. Native task test
проверяет только загрузку/инициализацию/close, не FPS и не точность модели.

## Ограничения

- Браузер не даёт отменить уже запущенные getUserMedia/MediaPipe/dynamic import
  так же, как fetch. Отмена логическая, late resources освобождаются при
  получении. Нативный permission prompt не гарантированно закрывается Stop.
- Timer не прерывает синхронный WASM/JS на main thread; просроченный результат
  отвергается после возврата. Это не перенос standalone diagnostic в Worker
  и не обещание отзывчивости/FPS при любой аппаратной нагрузке.
- Текущие nginx policies запрещают camera для `/apps/web/`; это не изменено.
  Для физического developer camera test нужна разрешённая диагностическая
  среда. Participant camera policy остаётся отдельной. Не обходить запрет
  query-параметром и не включать камеру для всего staff workspace.
- Не проверялись physical-camera permissions/очки/блики или точность ЧСС и
  дыхания. Нужны независимый ground truth и real-device acceptance.
- PostgreSQL/deploy/production security gates этим UI-блоком не заменяются.
  Полный heap profile и длительный 40-minute human run не выполнялись.

## Счётчик Аудита

Строки **105** и **209** переведены в «Исправлено локально». В исходных
239 строках: **75 исправлены**, **62 неактуальны/не подтверждены**,
**102 остаются**, включая **8 частично исправленных**. Остальные lifecycle,
legacy, FPS и scientific validation задачи этим шагом не закрываются.
GitHub issues и исходный Google Sheet не редактировались.
