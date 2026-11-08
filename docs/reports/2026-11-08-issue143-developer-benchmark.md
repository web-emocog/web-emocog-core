# Issue #143: отдельное сравнение gaze-кандидатов

Статус: подготовлен диагностический экран в текущей ветке. Не опубликован,
не меняет default predictor и не закрывает issue #143. Human v10 не подтвердил
победителя: top-hat меньше повторил один return-сдвиг полного patch, но хуже
на исходной посадке/по jitter и сильно ошибается на нижних целях.

## Что добавлено

В панели разработчика: **«Сравнение моделей взгляда»**. Документ:
`/apps/participant-web/tools/gaze-benchmark.html`. Код страницы и общий
контроллер: `apps/web/developer/gaze-benchmark*.mjs`.

Документ размещён в существующей sensor-enabled области participant tools,
но не является participant entrypoint. Это позволяет не ослаблять nginx
Permissions-Policy для остального сайта. Ссылка находится в developer panel;
проверка cookie-аккаунта выполняется через существующие auth-guard,
staff-session и fresh `/auth/me` перед камерой. Допущены только admin/developer.
Никакие project/organization data или tenant API не читаются; RBAC не расширен.
Static JS доступен как обычный asset, это не секрет и не серверная авторизация
операций. Локальные роли/флаги не являются разрешением. Смена аккаунта
останавливает запуск и очищает прежний результат.

Для внешней выборки нельзя автоматически выдавать всем developer. Отдельный
ограниченный доступ для тестировщиков требует отдельного согласованного решения;
сейчас анонимного bypass или публичной отправки данных нет.

## Зафиксированное сравнение

Четыре модели: baseline `same_eye_iris.v2`, полный eye-patch, Gradient All,
горизонтальный black top-hat. Это кандидаты, не четыре валидированные модели.
Factory подключается только явной диагностикой, экспериментальные method tags
по-прежнему запрещены participant ingest. Новых зависимостей/моделей/датасетов нет.

Один stream, analyzer и frame observer. Все варианты получают один завершённый
кадр и transient pixels его владельца. Общая калибровка — пересечение пригодных
full/gradient-all/top-hat captures, 25 целей × 2 клика; 9 correction + 5 независимых
benchmark целей используют прежние решения и rollback. На контрольных точках
нет обучения, подбора кандидата, target attraction или обновления по времени.
Raw/corrected раздельны; display не становится аналитическим сигналом.

Программу выбирают **до** включения камеры:

| ID | Контрольные серии | Что можно проверить |
| --- | --- | --- |
| `spatial.v1` | 9 целей | Ошибка, bias, разброс и missingness в короткой проверке |
| `posture.v1` | 5 совпадающих целей × исходная/чуть ниже/возврат | Чувствительность к инструкции изменить посадку, не измеренная физическая поза |
| `temporal.v1` | 9 целей до и после 240000 ms без целей | Изменение между концами интервала, не точность/начало дрейфа внутри |

Все модели заморожены между сериями. Тест не вставляет проверки в рабочий
непрерывный блок. Прежняя инструкция допускает моргание между целями/до клика.
Не требуются фиксация головы, подбородник или отказ от естественной посадки.

## Приватность и технический JSON

Камера только после отдельного согласия и кнопки. Никаких измерений на API,
автоматического upload, localStorage или IndexedDB. Существующая auth-обвязка
сохраняет только свою прежнюю staff identity/CSRF; измерения туда не попадают.
JSON скачивается вручную и передаётся согласованному получателю. Производные
измерения тоже могут быть чувствительными: это не обещание анонимности.

Экспорт `gaze_benchmark.v1`, revision `20261108-143m`:

- случайный run ID, versioned программа, completed/причина и фаза остановки;
- только coarse browser major/OS, viewport/scale/DPR, разрешение и сообщённая
  треком частота камеры (если есть), backend; без полного UA, device ID/label;
- counts кадров/ошибок/попыток; ограниченные calibration/correction/CV summaries;
- для каждой контрольной цели — raw/corrected ошибки, signed bias, RMS,
  within-target SD, пропуски/off-screen counts, reasons, агрегаты eye/head proxies;
- сравнения candidate–baseline **только на общих принятых кадрах**;
- времена fit/CV, regression и отдельных extractor; capture-to-analyzer age
  отдельно. Это не полная multimodal нагрузка и не display latency/FPS acceptance.

Никаких кадров, изображений глаз, landmarks, patch-векторов, весов, сырых gaze
рядов, аккаунтов/email/token/invitation URL или произвольных error messages.
Ошибка экспорта классифицируется allowlist-кодом, не исходным Error/stack.
Неуспешные и отменённые запуски тоже можно скачать, чтобы отказы не исчезали
из выборки; они не получают accuracy или completed=true. При смене аккаунта
прежний результат очищается, включая кнопку скачивания.
У failed run остаются bounded availability/cadence/predictor-error counts и
известная причина Worker fallback, если эти стадии уже запускались: нехватка
одного дескриптора не должна пропадать из диагностики неуспешных устройств.

Stop/Escape/pagehide/скрытие страницы/изменение измерительного viewport/камеры
выключают stream и освобождают модель/observer/признаки. Late camera/model results
принадлежат старому запуску и очищаются; инициализация модели сериализована.
Ожидания имеют deadline, весь developer-запуск ограничен 20 минутами. Точка —
один DOM-элемент без canvas trail/transition; инструкция скрыта во время целей.
Начальный import имеет deadline 30 s и явный fallback сообщения. Поздний import
не монтирует экран после отмены. Подтверждение первоначального auth отделено
от свежей проверки при Start; регрессионные тесты дожидаются именно готовности
экрана, прежде чем имитировать последующую смену cookie/роли.

## Как проводить пилот

1. Проверить экран на нескольких авторизованных устройствах. Для каждого
   прохода выбрать одну программу, браузер и размер окна не менять в процессе.
2. До массового сбора зафиксировать revision/программы и план сравнения. Разделять
   настройку алгоритма и независимую приёмочную выборку; не выбирать победителя
   по тем же контрольным целям, на которых затем сообщается улучшение.
3. Собирать completed **и** incomplete JSON. Согласованный оператор отдельно
   контролирует повторы одного человека/устройства: случайный run ID этого не
   определяет. Не считать тысячи кадров тысячами независимых участников.
4. Сравнивать одинаковые программы/revision и условия, отдельно браузеры/камеры.
   Проверять не только среднюю ошибку: края/нижние цели, signed shifts, jitter,
   пропуски, общие subsets, отказы, нагрузку и ухудшения отдельных людей.
5. Для дальнейшей real-device acceptance нужны независимые данные и отдельный
   off-screen/ground-truth протокол. В этом тесте `offScreenSpecificityMeasured=false`;
   отсутствие целей в интервале не подтверждает правильность gaze в интервале.
   Итоговая точность AOI и полноценная длительная сессия остаются открытыми.

Размер приёмочной выборки ещё не определён: сначала пилот по разнообразию
людей/устройств, затем план и объём по наблюдаемому межличностному разбросу,
а не обещание достаточности произвольного числа проходов.

Офлайн-разбор одного complete JSON (Node 24):

```bash
node scripts/reference-data/issue143-summarize-gradient.mjs /path/to/wecog-gaze-....json
```

Reader поддерживает все три программы, отделяет matched-target changes от
common-frame deltas. Для developer JSON дополнительно выводит ошибки и jitter
в процентах диагонали viewport, **не в градусах угла зрения**. Это делает масштабы
сопоставимее, но не уравнивает физические экраны/дистанцию. Не смешивать marginal
ошибки разных accepted subsets; failed JSON нельзя анализировать как complete.

## Проверки и rollout

Регрессии: `gaze-benchmark.test.js`, `issue143-gradient-summary.test.js`,
`gaze-benchmark.spec.ts`, полный clock oracle в `issue143-gaze.spec.ts`.
Access/lifecycle тест добавлен в обязательный `test:staff-regression`.
Historical localhost harness использует тот же контроллер; его loopback guard
сохранён, `apps/autotests` не включается в production image.

В самом developer benchmark API, SQL, схемы ingest и nginx не менялись.
Общие baseline/QC/contract исправления всей feature-ветки описаны отдельно
в `2026-11-06-issue143-gaze.md`. Для rollout после review используется обычный
release; перенос в `main` и deployment здесь не выполняются.
Rollback диагностического экрана — убрать карточку/страницу/модули; production
predictor и сохранённые исследования от них не зависят.

Инструкция тестировщикам: [`../research/issue143-gaze-benchmark-testers.md`](../research/issue143-gaze-benchmark-testers.md).
Пока работают только существующие `developer/admin`: без публичной ссылки или
новой роли. Комплект из трёх JSON связывается коротким кодом в одном сообщении;
общий series ID и автоматическая упаковка в текущий UI не добавлены.

Фактически выполнено (Node 24, локальный loopback, сенсоры подменены):

- `issue143-*.test.js` + `gaze-benchmark.test.js`: **93 passed, 0 failed**.
- `gaze-benchmark.spec.ts` через staff-regression config: **36 passed** — три
  браузера, включая отсутствие cookie, отказ роли, fresh identity, sensor policy,
  late stream, serial model init, import failure и desktop/mobile layout.
  После дополнительного document-level visibility guard повторный targeted
  прогон Start/Stop/hidden/late stream: **3 passed** (все три движка).
- Полный WebKit clock oracle новой страницы: **3 passed**, spatial/posture/temporal;
  исполняются все callbacks и реальные extractor/regression на искусственных
  pixels, без camera permission и без `fastForward` во время samples.
- Дополнительный исторический v7/v9/v10 clock regression: 4 passed; v8 первоначально
  превысил 120 s wall-time, затем отдельно прошёл за 2.2 min с бюджетом 240 s.
  Увеличен только wall-time функционального harness; кадры/33 ms timers и
  научные/FPS gates не пропускались и не ослаблялись.
- Остальная `issue143-gaze.spec.ts`, три движка: **49 passed, 2 skipped**
  (прежний vendored-model smoke только Chromium; это не webcam accuracy).
- `duplicate-work.spec.ts`, три движка: **30 passed**.
- Typecheck и `git diff --check`: passed. Desktop/mobile screenshots с
  искусственным UI просмотрены; биометрических изображений в них нет.

Полный API suite в первом прогоне: 783 tests, **778 passed, 5 skipped**. В повторе
одновременно с браузерами — 777 passed / 1 failed / 5 skipped: существующий
`ci-postgres-startup.test.js` получил `status=null` после своего `spawnSync`
deadline 5000 ms (заняло 5292 ms). Это тест с fake Docker CLI, не PostgreSQL
production и не новый gaze-код; файл не менялся. Изолированно **7 passed**,
тот сценарий занял 4086 ms. Факт промежуточного падения не скрывается.
Итоговый полный прогон без параллельных браузеров: **783 tests, 778 passed,
0 failed, 5 skipped**; тот же startup fixture прошёл за 4072 ms. Его исходный
deadline и код не изменялись.

Отдельная PostgreSQL integration DB, Linux/container web-image smoke и real-device
большая выборка здесь не проверены. Синтетические оракулы не являются accuracy
или production FPS acceptance; issue #143 остаётся открытым.
