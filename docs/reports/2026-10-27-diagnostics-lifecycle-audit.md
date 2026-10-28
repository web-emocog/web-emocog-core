# Продолжение Аудита: Диагностика И Lifecycle

Дата: 27.10.2026. Локальная ветка `fix/audit-diagnostics-lifecycle`, база
`origin/develop` / `f43713cd885d3dda2c2071984020341be2d83e4a`.
GitHub, Google Sheet, production и рабочая БД в этом этапе не изменялись.

## Подтверждённые Исправления

### Диагностика участника

- `Error` обходил string-redaction и попадал в console/export с message/stack.
  Теперь остаётся только allowlisted технический тип исключения.
- Timelines и runtime snapshot сохраняли переданный объект по ссылке, а bundle
  включал полные события сессии и сырые validation samples. Добавлены bounded
  sanitation, copy-by-value и минимальная проекция session events; известные
  credentials/IDs/answers/raw media исключаются. Внешний console sink также
  получает копию, чтобы не изменять ring.
- Нормализуются snake/camelCase чувствительных полей; email/Bearer/JWT,
  телефоноподобные строки, URL и пути очищаются. Бюджеты: до 6 уровней, 400
  посещённых узлов, 8000 символов строк/ключей на sanitation, 2000 записей ring
  и до 600 записей на timeline. Это ограничение диагностики, не payload сессии.
- Циклы, inherited channel names, hostile Proxy/accessors и сбой optional console
  не прерывают измерение. `clear()` очищает все диагностические каналы, сохраняя
  научные данные сессии нетронутыми. Неизмеренные calibration значения остаются
  `null`, а не превращаются в измеренный ноль.
- HUD записывал keyboard key/code и идентификаторы focus-элемента, включая
  поля ввода. Теперь focus содержит только coarse tag, а физические клавиши
  допускаются лишь в измерительных фазах и известных не-editable surfaces,
  вне input, IME и Ctrl/Meta/Alt. Неизвестные retargeted hosts пропускаются,
  поскольку closed shadow input нельзя проверить через activeElement;
  проверены open и closed roots. Shortcut HUD не потребляет RT-нажатия.
- `stop()` HUD теперь снимает owned document handlers/RAF и DOM, `dispose()`
  также снимает lifecycle handlers. Повторная загрузка заменяет предыдущий
  экземпляр; stale RAF/button не изменяет новую generation. Pagehide останавливает
  виджет; pageshow возобновляет его только при сохранённом opt-in.
- Snapshot polling снижен с display cadence до максимум 5 Hz, QC timeline до
  2 Hz. Это только диагностика: частоты face/gaze/pose/segment, пороги и формулы
  не менялись. Отсутствующий overlay больше не считается активным. Сбой
  collector выключает только HUD с отметкой `hud:collector_unavailable`.
- MediaPipe loader сообщает стабильный код `mediapipe_runtime_load_failed`, а
  не исходный Error. HTML с cache tags `debug-*.js?v=20261027-1`.

Сохраняется schema `wecog-debug-bundle-v1`, добавлен
`privacyVersion: technical_only.v2`. Double opt-in по-прежнему обязателен:
`WECOG_ALLOW_DEBUG === true` **и** storage/query opt-in. Production flag не
включался. Regex не распознаёт все произвольные ФИО/секреты в неизвестном
свободном тексте; перед передачей bundle нужна ручная проверка. Это не полная
анонимизация и не аудит всех client loggers.

### Legacy ProtocolRunner

Этот модуль не является каноническим `session-runtime` и не получает статус
полноценного participant runner: calibration/stimuli в нём остаются MVP stubs.

- Rest/baseline/recovery интервалы и DOM handlers принадлежат экрану и снимаются
  при повторном start, stop, загрузке и dispose. После удаления контейнера
  countdown останавливается. Stale callback/submit не добавляет ответы и не
  переключает новый экран; переход one-shot защищает от double-click.
- Исправлен двойной advance перед final: авторские title/text final сохраняются,
  вместо пропуска финального блока и подстановки default экрана.
- Duration больше не обрезается 32-битным `|0`; целые неотрицательные авторские
  секунды сохраняются. Неверное значение явно показывает ошибку, а не сокращает
  блок скрыто. Научные таймеры канонического runtime не менялись.
- Invitation load имеет отмену при stop/replacement/pagehide, 15 s deadline
  включает body. Promise завершается даже при синтетическом fetch/body,
  игнорирующем AbortSignal. Late response не подменяет новую definition.
- После неуспешной загрузки нельзя запустить прошлый протокол вместо запрошенного;
  прежние данные не уничтожаются. Повторный load/start после успеха сохраняется.

## Проверки

Новые Node tests: `debug-runtime-privacy.test.js` и дополнение
`protocol-runner-security.test.js`. Новые browser tests:
`diagnostics-lifecycle.spec.ts`, включены в required `test:frame-workers` для
Chromium/Firefox/WebKit, retries=0. Используется synthetic HTML/ввод/события,
не камера или микрофон. Для этого файла trace/video/screenshots отключены.

Особые сценарии: 100 циклов stop/start и reload, BFCache-style events,
поздний RAF/таймер/ответ API, stale questionnaire submit, реальный browser typing
пароля, настоящий скачанный JSON, blocked storage, недоступный inspector,
ломающийся console sink, cyclic/oversized values и URL/token/error fixtures.
Playwright injected handlers инициализируются **до** учёта listeners приложения.
Тестовая instrumentation не попадает в продуктовый runtime.

Свежие результаты этапа, не перенесённые из старых отчётов:

| Проверка | Результат |
| --- | --- |
| Новые/расширенные Node regressions, macOS / Node 24 | 18 passed, 0 skipped |
| Те же regressions, Linux / Node 22, no-network read-only контейнер | 18 passed, 0 skipped |
| Полный API/unit набор, macOS / Node 24, окончательный код | 575 total; 570 passed, 5 skipped, 0 failed |
| Окончательные privacy/lifecycle browser tests, три движка, по два повтора | **78 passed, 0 failed**, retries=0 |
| Общая Worker/session/security/diagnostics matrix, три движка, retries=0 | **209 passed, 4 failed** |
| TypeScript и `git diff --check` | Passed |

Общую matrix **нельзя назвать зелёной**. Все четыре сбоя в Firefox:
прежний FPS-тест looped fixture (см. ниже), два случая validation oracle
`missing benchmark target=false/true` превысили 90 s, synthetic responsiveness
получил 5 ticks при gate >5. Пороги и timeout этих тестов не менялись.
Новые privacy/lifecycle tests в этой matrix прошли во всех движках. Ни один
из трёх исходных тестовых файлов этих четырёх отказов и scientific modules
в этой ветке не редактировался. Это не доказательство исправности остальных
FPS/validation/timing путей и не основание их закрывать.

Общая matrix начата до последнего уточнения closed-shadow surface guard и
console-copy; после них окончательный код отдельно прошёл 78 новых browser
проверок и полный API/unit набор. Полная matrix повторно не объявляется
пройденной. Пять пропущенных API tests требуют отсутствующих на host native
conversion/nginx инструментов; PostgreSQL integration suites этим запуском
не выполнялись. Отдельный Linux запуск здесь покрывает только 18 адресных
регрессий, не заменяет весь production image/DB/converter gate.

Два первоначальных fixture-ошибочных assertions новых browser tests исправлены:
счётчик включал handlers Playwright, а task response count включал последующее
registration событие. Ожидаемая защита от утечек/перехвата не ослаблялась.

Для воспроизведения новых проверок:

```bash
cd apps/api
node --test tests/debug-runtime-privacy.test.js tests/protocol-runner-security.test.js
cd ../autotests
npm run typecheck
npx playwright test --config=playwright.workers.config.ts tests/diagnostics-lifecycle.spec.ts --repeat-each=2
npm run test:frame-workers
```

Остаточные Firefox сбои проверять **последовательно**, без сторонних timing
нагрузок, сохраняя первичное падение в отчёте. Отдельные прошедшие повторы не
аннулируют нестабильность полного прогона. При FPS проверить native metadata,
decoded/presented/callback counters и media clock независимо. При oracle timeout
разделить module load/clock.runFor/evaluate, не понижать 15 Hz/target coverage.
При responsiveness сохранить main vs worker values, ticks, elapsed и UI gaps,
а не просто менять >5 на >=5.

## Остаточный Риск FPS

При общей регрессии вновь воспроизведено завышение camera FPS файлового ролика
в Firefox: fixture 64x64, duration=1 s, rate=1, 10 FPS. Пять отдельных запусков
дали 26, 28, 31, 28, 30 FPS против прежнего gate 7..14. Порог не изменён.

Дополнительный технический probe: за 2,265 s observer насчитал 79 кадров
(35 FPS); `presentedFrames` дошёл до 84, тогда как `getVideoPlaybackQuality()`
показывал 25 кадров. Native callbacks содержали скачки `mediaTime` вперёд/назад
при монотонном decoded counter и обычном `video.currentTime`.

`video-frames.mjs` и тест этого ролика идентичны базе ветки; страница probe не
загружала HUD/participant app. Следовательно, это отдельная проблема прежнего
FPS-пути, а не основание объявить новые privacy/lifecycle исправления причиной
или произвольно ослабить gate. Автоматически заменять capture/presentation на
decoded count во всех браузерах опасно: MediaStream может иметь inert counter,
а decoded, delivered и processed FPS различны. Нужен отдельный matched-source
fix с provenance и проверкой native MediaStream/stop/reset/loop/seek/drop.
Физическая камера и universal >=25 analysis FPS этим этапом не проверены.

Обновление 28.10: файловый counter path исправлен отдельно; real-time catch-up
в validation fixtures устранён без изменения продуктовой валидации.
См. [продолжение с новыми результатами](2026-10-28-frame-cadence-followup.md).
Исторические четыре падения и численные результаты выше сохранены как были.

## Подсчёт Аудита

Единица подсчёта остаётся исходной строкой таблицы, не тестом или новым багом.
Исправлено ещё четыре строки: **46, 60, 187, 200**. Строка **61** снята как
неподтверждённый тип бага: catches относятся к optional diagnostics, не к
сохранению сессии, а blanket error logging раскрыл бы лишние данные.

| Категория | Сейчас | Было |
| --- | ---: | ---: |
| Исходных строк | 239 | 239 |
| Исправлено в коде/локально | **72** | 68 |
| Неактуально/не подтверждён заявленный тип бага | **62** | 61 |
| Открыто, включая частичные | **105** | 110 |
| Из открытых: частично исправлено | 9 | 9 |

Источник: `2026-10-26-backlog-status.json` / `auditTotals`. Это не утверждение о
134 исправленных багах: 62 строки сняты с исполнения по другим основаниям.
Новый FPS finding не добавлен искусственно в знаменатель 239.

## Выпуск И Ограничения

Нужны review/CI и staging. Локальная проверка не означает новый production
release; нет SQL migrations, новых dependencies или перерасчёта старых сессий.
Не отправлены никакие Git branches/PR и не затронуты локальные Observer/Dota
наработки. Прежние main/develop изменения не переписывались.

Rollback: вернуть согласованный HTML/debug script комплект и legacy runner из
предыдущего артефакта, не очищая IndexedDB, ответы или researcher workspace.
Открыты остальные lifecycle/logging/HTML/privacy строки, long-session/memory и
real-device/scientific validation. Не объявлять весь продукт production-ready.
