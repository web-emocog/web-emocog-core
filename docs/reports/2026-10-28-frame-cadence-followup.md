# Продолжение Аудита: Частота Кадров И Детерминированные Проверки

Дата: 28.10.2026. Только локальная ветка `fix/audit-diagnostics-lifecycle`,
база `f43713cd885d3dda2c2071984020341be2d83e4a`. Предыдущие privacy/lifecycle
правки сохранены. GitHub/production/Google Sheet и рабочая БД не менялись.

## Исходное Воспроизведение

В предыдущем общем прогоне: 209 passed, четыре Firefox failure. Новый
последовательный запуск **до новых правок** дал три pass и один failure за
22,9 s: FPS fixture 10 FPS определялся как 15 FPS, Worker дал main=0/worker=33
timer ticks, оба validation oracle прошли. Это не отменяет прежнюю
нестабильность общего набора, но не доказывает три новых product bugs.

Причина подтверждённого FPS дефекта: observer безусловно доверял дельтам
`requestVideoFrameCallback().presentedFrames`, в том числе для loop/replay
файла. Скачки этого счётчика в Firefox завышали измерение. Это не ошибка
самого протокола и не измерение ускорения ML/inference.

## Реализация

`session-runtime/video-frames.mjs`:

- Native **MediaStream** сохраняет прежний callback/presented-frame путь.
  `getVideoPlaybackQuality()` к камере не применяется: у live sources он может
  быть inert. Не добавлены pixels readback, второй ML/RAF loop или новые модели.
- Для файлового playback с native callback driver используется
  `getVideoPlaybackQuality().totalVideoFrames`, с начальным snapshot счётчика,
  чтобы не включать кадры до начала окна.
- Историческое имя метода `decoded-frame-counter` сохраняется, но важно:
  этот playback counter включает **показанные и dropped** кадры. Это source
  cadence, **не** displayed FPS и не analysis FPS. Drops/displayed сохраняются
  отдельно в `playbackQuality`.
- При reset счётчика окно помечается incomplete; displayed/dropped становятся
  `null`, не выдуманным нулём. Decreasing/огромный counter не даёт cumulative
  burst после seek/reload. Числа должны быть safe nonnegative integers.
- При недоступном/невалидном/зависшем playback counter работает явный
  `video-callback-count`: одно уведомление равно одному наблюдаемому callback,
  без доверия некорректному `presentedFrames`. Это **нижняя оценка**: пропущенные
  callbacks не восстанавливаются. Сохраняется `fallbackReason`.
- Result `measureVideoFps` получил `measurementVersion: video_cadence.v2`,
  `fallbackReason` и `playbackQuality`; прежние fps/frames/duration/method на месте.
  Некорректное duration отклоняется до регистрации callback. Порог 2^31-1 ms
  связан с представимостью browser timeout, не с длительностью протокола.
- `VideoFpsMonitor` сохраняет новый fallback method в provenance вместо
  превращения его в `external-publication`. Ingest round-trip проверен unit-тестом.

Первый вариант, вычитавший drops из основного file FPS, был отклонён проверкой:
Chromium показывал около 5 displayed FPS при 10 source FPS. Вместо ослабления
gate разделены две величины. Не трактовать source FPS=10 как доказательство
показа/анализа десяти кадров. Прежние границы частоты и QC thresholds не снижены.

## Тестовый Долг

Validation oracle раньше устанавливал fake Clock после загрузки страницы и
автоматически возобновлял real-time sync после `runFor`. На загруженном стенде
возврат к реальному времени мог повторно запускать synthetic timer и мешал
последующему чтению результата.

Теперь Clock устанавливается **до** загрузки, останавливается после готовности
страницы и **до** начала точек. `runFor(46000)` по-прежнему исполняет каждый
33/67 ms callback. Добавлена проверка ровно `floor(46000/67)=686` synthetic
captures. Ни sampling cadence, ни 14 точек/независимый benchmark, ни критерии
пустой/застывшей точки, accuracy или coverage не ослаблены. Product validation
код не менялся. Этот oracle тестирует flow, не научную точность взгляда.

Worker responsiveness остаётся реальным wall-clock test, без fake timers и
retry. Требуется visible page; до assertions сохраняются elapsed/max-gap/ticks
для main и worker. Analyzer/timer cleanup в `finally`. Gate worker ticks >5,
улучшение относительно main и равенство полученных признаков сохранены.
Прошедший synthetic test не является real-device RT/latency benchmark.

## Допуск Файлового Replay

После восстановления общего runtime-набора дополнительный FPS suite дал
35 pass / 1 failure: иногда Firefox принимал cached кадр 0,5 s при текущей
позиции около нуля, затем приходил PTS=0. В иных повторах clip завершался без
единого callback. Это отдельная проблема подготовки короткого файла.

Проверены и отвергнуты две гипотезы: reload декодера всё ещё дал два failure
из пяти повторов, одна лишь видимость видео дала четыре failure из десяти.
Reload-изменение откатили; видимый fixture оставлен как контролируемое условие,
но не объявлен решением ошибки.

`prepareFiniteVideo` теперь для Firefox ожидает один compositor callback
подготовительного seek **до** начала playback/измерений. Его metadata не является
sample. Deadline 10 s и handle cleanup есть и при ошибке seek, и при позднем
ответе. Неизменённый `nextMediaTimestamp` по-прежнему отклоняет повтор/возврат
PTS после начала измерения; порядок не исправляется выдуманными timestamps.

Первый вариант общего paused-drain прошёл Firefox, но ожидал несуществующий
paused callback в WebKit. Поэтому это явная Firefox-only compatibility policy;
у остальных движков прежний seek-zero путь. Подготовка маркируется как
`seek_zero_compositor_ack.v1` или `seek_zero.v1` в source-only и full replay.
Unit tests отдельно проверяют оба варианта и cancellation, включая handle=0.
Это изменение private reference harness, не participant calibration/camera.

В `replay_performance.v2` дополнительно разделены source и presented counters:
`sourceFrames/sourceWallFps` не подставляются в `presentedFrames/presentedWallFps`.
При подтверждённом playback-quality окне presentations исключают drops;
при неполном или несовместимом окне они `null`. Нельзя принять отсутствующие
данные за measured zero или успешный source gate. Analysis wall FPS и критерии
25 FPS/10 ms UI/250 ms gap не изменены; неполная source evidence означает
`not_measured`, а не pass. Старые отчёты не пересчитывались.

## Проверки

Свежие результаты после окончательного последовательного прогона:

- API/unit: **588 total, 583 passed, 5 skipped, 0 failed**.
- Targeted file FPS: три повтора в каждом движке, 9 passed с прежним gate 7..14.
- Validation/frozen prediction/worker: по два повтора трёх движков, 24 passed,
  retries=0; oracle callbacks не пропущены.
- Общий runtime/Worker/security/diagnostics набор: **213 passed, 0 failed**,
  retries=0, около 3 минут вместо исторических 10,5 минут с failures. Это
  ускорение/стабильность автотеста, **не** измерение ускорения продуктового ML.
- Linux/Node 22 адресные FPS/reference regressions: **34 passed**, сеть отключена,
  root и checkout read-only, fixtures только в disposable noexec tmpfs. Первые
  два filesystem failure из-за read-only `/tmp` исправлены настройкой стенда,
  не ослаблением тестов.
- Финальный FPS/source/replay набор: **72 passed, 0 failed**, два полных повтора
  Chromium/Firefox/WebKit, retries=0. Включает native synthetic stream,
  file restart, strict PTS, source/displayed counters, QC provenance и recovery.
- TypeScript и `git diff --check`: passed.

Добавлены native synthetic MediaStream без камеры, file restart/cancel accounting,
fallback на реальном HTMLVideoElement. Unit: dropped/duplicate/inflated metadata,
source reset, invalid/inert counter, остановка, невалидная длительность,
неприменение playback counter к MediaStream и serializable provenance.
Все данные синтетические; камера/микрофон и личные видео не использованы.
Общий набор 213 выполнен до последнего уточнения private reference preparation/
provenance; последующий полный FPS-набор, API/unit и Linux проверки выполнены
на окончательном коде. Product runtime FPS modules с момента 213 не менялись.
Исходные неуспешные прогоны сохранены в описании, а не заменены итоговой цифрой.

Команды:

```bash
cd apps/api
npm test
node --test tests/video-fps.test.js
cd ../autotests
npm run typecheck
npm run test:frame-workers
npm run test:fps
```

Пять host skips требуют native conversion/nginx tools; PostgreSQL integration
suites не запускались. Linux subset не заменяет полный production image/DB gate.

## Подсчёт И Ограничения

Исходная таблица остаётся: **239 строк, 72 исправлены, 62 неактуальны/
не подтверждены, 105 открыты (9 частично)**. Этот шаг исправляет новую
FPS-находку и усиливает тесты; новые находки не добавлены искусственно к 239
и не выдаются за закрытые строки старой таблицы.

**Universal >=25 analysis FPS не закрыт.** Файловый FPS counter fix не ускоряет
inference. Нужны camera/real-device/длительный replay с лицом и строгий
performance gate, а также независимая scientific validation. До референсных
измерений не заявлять точность ЧСС/дыхания/взгляда на людях.

Этот этап не запускал PostgreSQL integration/native converter/deployment gates.
Локальный Docker daemon был остановлен; запущен Docker Desktop. Изолированные
контейнеры не имели сети и после unit tests удалены; рабочая БД не запускалась.
Production rollout не выполнялся. JS/mjs сейчас имеют cache до 1 h; перед
публикацией нужна согласованная инвалидация module graph и проверка warm-cache
перехода, без дублирования singleton module identities. Один query-tag только
на HTML entrypoint этого не гарантирует. Не применять очистку IndexedDB/данных
участника как способ обновления JS cache.

## Первичные Основания

- [rVFC metadata и пропуск callbacks](https://wicg.github.io/video-rvfc/).
- [VideoPlaybackQuality включает dropped и сбрасывается при reload](https://developer.mozilla.org/en-US/docs/Web/API/VideoPlaybackQuality/totalVideoFrames).
- [Mozilla: старые кадры rVFC при повторном воспроизведении](https://bugzilla.mozilla.org/show_bug.cgi?id=1935253).
- [Playwright Clock: install до navigation, pauseAt и runFor](https://playwright.dev/docs/api/class-clock).

Известный Mozilla report согласуется с классом наблюдения, но не доказывает
идентичность причины конкретной нынешней сборки Firefox. Точное локальное
воспроизведение и междвижковая регрессия важнее предположения о vendor fix.
