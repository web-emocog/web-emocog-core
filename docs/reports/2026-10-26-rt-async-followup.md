# Асинхронный RT И Сохранность Данных

Дата: 26.10.2026. Ветка: `feature/frame-pipeline-workers`, база `89880ef`.
Все изменения локальные. Накопленные правки сохранены; GitHub, production,
учётные записи и исходная Google-таблица не изменялись.

## Закрытый Локальный Блок

**RT-ASYNC, P1, строка 36 таблицы:** `spawnSync` в ingest и health заменён
асинхронными ограниченными процессами. Один batch Python на сессию вместо
процесса на каждый блок. Очередь: 1 active + 8 waiting на API-процесс, deadline
60 секунд вместе с ожиданием. Отмена запроса удаляет ожидающее задание или
завершает активную POSIX process group; слот освобождается только после close.
Общий native runner получил bounded stdin и AbortSignal; media/conversion
сохраняют прежние environment/output/resource/process-group ограничения.

Python-формулы, configuration, selected metrics, roundings, QC thresholds,
`rt_features.v1` и single-job CLI сохранены. Batch adapter загружает одну
конфигурацию, но запускает прежние build_trials/compute_metrics для каждого
блока. Поиск response events индексирован вместо квадратичного Array.find;
сохраняются первый точный числовой trialIndex и positional fallback.
Отдельно исправлены ошибки исходной подготовки данных: пустой блок больше не
превращается в одну вымышленную пропущенную пробу, а блок без результатов не
заимствует строки другого блока. Unscoped legacy rows допустимы лишь для
единственного однозначного блока; неоднозначность даёт `no_events`, не ноль RT.
Это намеренное изменение ошибочного поведения, не смена научной формулы.
Добавлен optional `adapter_version: rt_event_adapter.v2` в RT features и
`source_payload.feature_inputs.rt_adapter_version` в proxy provenance; старые
результаты без поля не переписываются. Обновлён `schemas/rt_features.v1.json`.
Подготовка больших пакетов уступает event loop между группами блоков.
Развёрнутый stdin и каждый output stream ограничены 10 MiB; overflow не
сохраняется как успешный final. Это не ограничение размера stimulus-файлов.

## Сохранение И Безопасность

1. Общий read-only resolver проверяет scope/token/membership/replay до расчёта.
2. Python и очередь не удерживают соединение, транзакцию или advisory lock БД.
3. В commit-транзакции заново проверяются актуальные права, привязки,
   participant, protocol snapshot/hash, delivery sequence и idempotency.
4. Features/QC/proxy/session completion записываются одной транзакцией.
   Ошибка процесса не уничтожает checkpoint и не отмечает сессию завершённой.
5. Более новый checkpoint нельзя заменить устаревшим final, включая legacy
   пакет без sequence. Повтор уже принятого собственного finish остаётся ACK.
6. Исправлена несогласованность staff import: participant проверяется и
   первоначально привязывается в самой sessions, не только в proxy metrics.
7. Native stderr, traceback и пути не отражаются в ingest error. Health теперь
   single-flight/cache 30 s, probe 2 s, без абсолютных путей и suffix из stdout.

Нет новых зависимостей, моделей, миграций и raw-media transfers. Браузерный
signal pipeline, resolution, strides 3/6/6, scientific/QC thresholds не менялись.
Коды ответа, retry и ограничения документированы в
[`session-runtime-v1.md`](../api/session-runtime-v1.md).

## Синтетический Benchmark

macOS arm64, Node 24.22.1, 64 блока / 2048 проб, simple/choice/go-no-go/flanker.
Исторические compute и event_adapter взяты из HEAD `89880ef`; зависимости
registry общие. Сравниваются полные RT feature JSON, без допусков округления.
Это module-level benchmark, не production-нагрузочный тест.

| Прогон | Старый sync | Новый batch | Старый timer lag max | Новый timer lag max | Ускорение |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1601,65 ms | 43,65 ms | 1591,76 ms | 2,06 ms | 36,69x |
| 2 | 1594,08 ms | 43,55 ms | 1584,18 ms | 2,05 ms | 36,60x |
| 3 | 1595,83 ms | 44,02 ms | 1585,95 ms | 2,43 ms | 36,26x |

Во всех трёх случаях RT JSON для корректно привязанных данных численно
идентичен; отдельно появляется новый provenance версии адаптера. У старого вызова было
64 analyzer subprocess + отдельный availability probe, у нового один analyzer
subprocess; health предварительно прогрет. Это не обещание такого ускорения
на каждом сервере, payload или модуле видеообработки.

## Проверки

- macOS Node 24.22.1: **526 API-тестов, 521 passed, 5 skipped, 0 failed**.
- Linux Node 22, read-only checkout, disposable PostgreSQL 16, internal Docker
  network без внешнего доступа, 2 CPU / 1 GiB: **526 API-тестов, 522 passed,
  4 skipped, 0 failed**; **48 PostgreSQL-тестов, все passed**.
- Playwright Chromium/Firefox/WebKit: **159 passed** (runtime/Workers/security);
  аналитика Chromium: **7 passed**. Synthetic browser tests не доказывают FPS
  на реальной камере. Python unittest callback (simple/choice/go-no-go) и
  прежний single-job CLI smoke проходят, stdout остаётся валидным JSON.
- Golden mixed-task: batch Python равен отдельным single-job вызовам;
  platform projections равны одиночным computeBlockRtFeatures. Проверены
  simple/choice/go-no-go/flanker/Stroop/PVT/CPT, omissions, outliers и custom keys.
- Empty/response-only input не создаёт trial; main не попадает в practice,
  foreign block не присваивается текущему; legacy single-block сохраняется,
  multi-block ambiguity остаётся отсутствием данных. Provenance сохраняется
  вместе с feature JSON и proxy source.
- Queue FIFO/busy/deadline/cancel; stdin/output byte caps, secret-free env,
  process-group teardown, interrupted generation и повтор после input overflow.
- Во время намеренно зависшего RT: health/ready проходят, `idle in transaction`
  отсутствует, checkpoint той же сессии сохраняется до освобождения Python.
- Corrupt output возвращает safe 503/Retry-After без sealing/утраты checkpoint;
  повтор проходит. Membership revocation, смена participant и mutable staff
  protocol во время расчёта останавливают запись. Immutable invitation snapshot
  дополнительно защищён существующим DB trigger; его не отключали.
- Десять параллельных final: один busy, принятые повторы идемпотентны;
  session_features/QC/proxy по одному, used_runs=1.
- Старый final, опередивший свежий checkpoint: 409, checkpoint остаётся;
  актуальный final принимается. Разрыв HTTP во время Python не пишет final,
  повтор после восстановления проходит. Forced late SQL failure откатывается.

Синтетические executable fixtures разрешены только в tmpfs одноразового test
контейнера; production volumes/exec/security options не менялись. Первые
прогоны выявили noexec тестового tmpfs и неверный тест изменения immutable
snapshot; тестовая среда/сценарий исправлены, защитные механизмы не ослаблялись.

## FPS: Не Закрыто

Повторены отдельные 60-секундные MCD real-time прогоны 640x480 с полной прежней
мультимодальной нагрузкой. Эксперимент: передать в face inference уже прочитанный
ImageData того же кадра вместо ImageBitmap. Только first-party instrumentation
приватного replay harness; vendor, рабочий pipeline и модель не менялись.

| Движок | Предыдущий чистый baseline | ImageData experiment | Face inference mean | Строгий критерий |
| --- | ---: | ---: | ---: | --- |
| Chromium 143 | 24,38 FPS | 24,46 FPS | 38,89 ms | Не пройден |
| Firefox 144 | 21,97-22,06 FPS | 22,59 FPS | 42,07 ms | Не пройден |

Оба experiment fail из-за mean FPS и sustained drop; UI p95 соответственно
2/9 ms, segmentation mean 155,8/20,2 ms. Эксперимент **не принят в production**:
изменение формата входа не устранило bottleneck, одного прогона недостаточно
даже для утверждения небольшого выигрыша. WebKit в этом проходе не измерялся
повторно; предыдущие 29,88 FPS остаются историческим результатом.

Локальный запуск эксперимента: прежняя команда из
[`reference-video-benchmark.md`](../research/reference-video-benchmark.md)
плюс `WECOG_REFERENCE_FACE_INPUT=imageData`. Отдельный suffix `facePixels`
не перезаписывает baseline. `bitmap` остаётся default; произвольные значения
отклоняются. Raw face/physiology reports остаются вне Git. Accuracy по MCD не
объявляется измеренной; собственные 25 FPS либо клиническая точность не обещаны.

## Остаточные Риски И Выпуск

- RT-ASYNC реализован и проверен локально, но issue не закрыт без PR/CI/review.
- CPU/memory ограничения Python действуют на Linux; POSIX group teardown —
  на Linux/macOS. Windows descendant teardown не подтверждён.
- Очередь не durable/distributed. При рестарте ожидающий final восстанавливается
  клиентским pending packet и idempotent retry; acknowledged checkpoint остаётся
  в БД. При нескольких API instances лимит применяется к каждому процессу.
- Missing Python сохраняет прежний explicit analyzer_unavailable, не валидные
  нули. Требуется ops-контроль health. Ошибки текущего расчёта дают retryable 503.
- `final_delivery_stale` требует сверки актуального состояния; автоматическое
  слияние конфликтующих научных данных не внедрено. Нельзя повторять старый пакет
  бесконечно или отбрасывать новые пробы ради прохождения.
- FPS Chromium/Firefox, posture axis v2 и независимая физиологическая валидация
  остаются открытыми. Этот проход не является аудитом каждого HTML sink.
- Rollout: отдельный PR в develop, CI + human review, staging с реальными
  разрешёнными протоколами, затем согласованный release. Изменений БД нет.
  Rollback кодом возвращает старые пути/проблему блокировки; accepted данные
  не переписываются. Не откатывать весь dirty worktree ради этого изменения.
