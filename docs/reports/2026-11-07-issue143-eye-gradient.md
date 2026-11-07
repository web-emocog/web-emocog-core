# Issue 143: gradient-center eye signal и короткая v7

Статус: **local-only эксперимент, не production upgrade**. Ветка
`feature/fix_issue_143`, база `b16ce38462050ffa3f646d908a8b37ccf92d877b`.
Изменения не закоммичены/не отправлены. Issue не закрыт; реальная точность и
длительный drift требуют дальнейшей приёмки.

## Изменение модельной гипотезы

В v6 regression по всем eye pixels сильно реагировала на изменения век.
В v7 сначала локализуется центр тёмной области по направлениям градиентов,
а затем четыре center coordinates поступают в персональную ridge regression.
Это новый **вход модели**, не только QC, сглаживание или подбор λ.

Методологический источник: Timm & Barth,
[Accurate Eye Centre Localisation by Means of Gradients, VISAPP 2011](https://doi.org/10.5220/0003326101250130),
[author-hosted PDF](https://www.inb.uni-luebeck.de/fileadmin/files/PUBPDFS/TiBa11b.pdf).
Прочитаны и визуально проверены страницы с формулами, preprocessing и
ограничениями. Статья рассматривает eye-center localization; её результаты не
удостоверяют точность screen gaze данной реализации. Код оригинальный, не
перенос upstream implementation. PDF, BioID, код/веса других trackers в git и
runtime не добавлены; attribution есть в `docs/THIRD_PARTY_LICENSES.md`.

## Код и инварианты

- `eye-gradient-features.mjs` читает только pixels **того же** completed frame
  из `getFramePixels(frame)` при точном `frameSize`. Нет camera recapture,
  второго inference/observer loop или last-patch fallback.
- По анатомическим corners строятся выровненные 40×24 grids, 1×.6 eye widths.
  Центр не берётся из iris/lid landmarks. Lids/head остаются baseline gates.
- Binomial smoothing → strong central-difference gradients → dark-center
  weighted squared positive-dot objective. Направления нормируются; градиенты
  ниже mean+.5 SD не голосуют. Flat/1D stripe, недоступный crop и constrained
  border maximum не становятся измеренным центром.
- Два явно разделённых варианта: `eye_gradient_all_iris.experimental.v1`
  (all directions) и `eye_gradient_iris.experimental.v1` (lateral support,
  `abs(gx)>=.35`). Второй — ablation, не обещание лучшей robustness.
- Поиск stride-2, уточнение 5×5 и parabolic subpixel refinement. Возможны другие
  локальные максимумы. Маленький inverse-distance kernel содержит только
  геометрию grid, не информацию участника. Нулевые weighted candidates не
  вычисляются; input frames и научные наблюдения этим не пропускаются.
- В ridge идут четыре center coordinates относительно corners/eye width.
  Floors .03 и λ `[.01,.1,1,10,100]` — часть versioned экспериментального
  descriptor/fit, не понижение production QC thresholds. Target-group CV
  использует только calibration rows и исключает парные клики вместе.
- В локальном сравнении baseline/full-patch/all/lateral видят один inference.
  Все усредняют **пересечение** full/all/lateral-usable calibration captures.
  Baseline здесь контролируемый predictor на общем subset, не идентичная
  production-калибровка со всеми доступными ей frames. Ошибки и missingness
  сравниваются раздельно, включая common-accepted frames.
- Head не учит screen target. В `predict()` нет target, AOI, содержимого
  задания или времени для адаптации модели. Raw/corrected/display разделены;
  correction/rollback и независимые контрольные цели не выбирают basis/λ.

## Приватность, API и нагрузка

Новых dependencies, weights, datasets, endpoints, migrations и разрешённых
production method tags нет. Default `same_eye_iris.v2` сохранён; ingest policy
и schema отвергают оба новых experimental tags. Published-протокол не может
включить этот opt-in. Основной 40-trial block не изменён.

Grids и gradients временные. Локальный WeakMap хранит только derived features
текущих/click-capture frames, не сохраняет pixel owner на копии landmarks.
Максимум 50 training rows; после успешного fit rows удаляются до callback.
Stop/reset/error/visibility/camera/viewport teardown освобождают ссылки/веса.
В JSON нет images, feature vectors, weights, landmarks или временных рядов gaze;
нет API/ingest/IndexedDB/checkpoint пути. Это не физическое обнуление памяти JS.

Timing extraction, fit/CV, prediction и capture→analyzer-result разделены.
Поиск и регрессия пока выполняются на main thread диагностического standalone
analyzer. Это не полный multimodal pipeline; нагрузка на Safari с настоящей
камерой и end-to-end latency не приняты. В production новое вычисление не
включено. В отдельном Chromium 20 вызовов одного extractor на искусственном
изображении дали около 3.16 ms/call; это микроизмерение, не FPS/latency gate.

## Искусственный benchmark

`node scripts/reference-data/issue143-gradient-synthetic.mjs`:
25 training targets × 2 rows, 16 **других** targets × 8 predictions/condition/model,
viewport 1470×956, image 640×480. Raw only, без correction и обучения на held-out
условиях. Матрица из 18 conditions — exploration/negative testing, не independent
acceptance после последующего использования её результатов в разработке.

Средняя евклидова ошибка, CSS px:

| Искусственное условие | Baseline | Full patch | Gradient all | Gradient lateral |
| --- | ---: | ---: | ---: | ---: |
| Неизменная геометрия | 0 | 19.119 | 2.575 | 4.531 |
| Landmarks Y не различает цели | 187.019 | 19.119 | 2.575 | 4.531 |
| Lid pixels ±.04 widths | 0 | 678.514 | 3.770 | 6.299 |
| Lid pixels +.08 widths | 0 | 1302.205 | 8.141 | 10.447 |
| Partial aperture .14 | 0 | 96.565 | 19.914 | 20.709 |
| Glare | 0 | 38.826 | 46.532 | 49.913 |
| Low contrast + texture | 0 | 162.059 | 5.604 | 8.243 |
| Measurement jitter | 11.185 | 20.703 | 12.075 | 13.658 |

Что эти результаты **не** означают:

- Baseline идеальна в большинстве условий по устройству landmark fixture.
  Toy case с неинформативной Y демонстрирует дополнительную pixel information,
  но не доказывает, что это причина человеческих сессий 125/126.
- При почти закрытом изображении, несмотря на намеренно оставленные open
  landmarks, all-вариант даёт 100% missing; это **не нулевая ошибка**. Lateral
  ошибается на 129.959 px и даёт 50% accepted off-screen. Это известный failure,
  сохранённый отдельным negative unit test, не основание менять baseline gate.
- При отсутствии искусственной радужки оба gradient-варианта дают 100% missing.
  При удалении pixels у четверти captures — 25% missing, baseline при этом
  остаётся доступна. Изменение exclusions не выдаётся за улучшение accuracy.
- При glare оба gradient-варианта хуже полного patch в этом fixture. Нет
  универсальной победы, гарантий по очкам, светлой радужке, векам и маскировкам.
- Within-target RMS spread при jitter: baseline 11.461 px, full 11.137,
  all 12.445, lateral 14.157. Новый signal не универсальный jitter suppressor.
- 2D translation/roll/scale дают all mean error 2.575/2.575/2.712 px, но не
  являются физическим head motion и не доказывают real-world robustness.
- Gate disagreements=0 там, где descriptor доступен. Для восьми horizontal/
  vertical off-screen fixtures script раздельно сообщает accepted-offscreen,
  rejected/missing и false-onscreen, с nuisance текущего condition. Пропуски
  не маскируются одной красивой specificity долей.

Оптимизированный поиск сохранил округлённые error/spread/missing/offscreen
результаты исходного dense поиска во всех 18 conditions этой матрицы. Это не
глобальная гарантия одинакового maximum на иных изображениях. В итоговом Node
запуске все три extractors вместе занимают порядка 1–5 ms/capture в зависимости
от наличия радужки; warmup/нагрузка меняют время. Это не browser acceptance.

## Короткая локальная v7

URL:
`http://127.0.0.1:4203/apps/autotests/manual/issue143-gaze.html?models=gradient&rev=20261107-143i`.
Сервер из корня: `python3 apps/autotests/scripts/serve-static.py 4203`.
Если порт уже занят, сначала проверить, что он отдаёт текущую страницу; не
останавливать неизвестный процесс. Камера запрашивается только кнопкой.

25 calibration targets × 2 clicks, прежние 9 correction + 5 independent
benchmark targets, затем **одна** 9-target spatial check. Никаких дополнительных
нажатий/запрета естественно моргать. В v7 нет четырёхминутного интервала:
`intervalMs=0`, `after=[]`, `temporalScope=spatial_only_no_drift_measurement`.
Отсутствие after данных не является нулевым drift. Старые v3/v4/v5/v6 сохраняют
свой before/4-minute/after протокол. Контрольные targets не переобучают модели.

Первый human run ниже проверяет, даёт ли новая image-информация spatial
улучшение на Mac/Safari. Это не финальная scientific acceptance. Дальнейший
длительный и full-protocol benchmark не должен вставлять цели/паузы внутрь
опубликованного непрерывного блока. Старые human runs не становятся validation
новых descriptors и не используются для их fit.

## Первый реальный v7: результаты и решение

Пользователь предоставил `wecog-issue143-eye-gradient-v7.json` после короткой
локальной проверки в Safari. Экспорт прочитан только локально; сам файл, images,
features, weights и индивидуальные frame series в git/fixtures не добавлены.
Viewport 1728×916 CSS px, camera capture 640×480, backend Worker.

Все 50 calibration clicks приняты, 808 **общих** кадров (12–20 на клик), без
зафиксированных interrupted runs/invalid-eye/invalid-pose кадров при сборе
этих кликов. Это не независимое доказательство правильности фиксации взгляда
или отсутствия морганий на всём протяжении проверки.

Контрольная серия: девять заданных экранных целей, 433 unique analyzed captures.
Во всех сравнениях baseline/candidate **415 common-accepted captures**. Нет
заявленного выигрыша за счёт отбрасывания дополнительных кадров: missingness
4.16% у каждого варианта на этой серии. При этом image feature availability за
весь run (включая подготовку/калибровку) различается: full 5534/5782, all 5440/5782,
lateral 5352/5782; это другой denominator, не validation missingness.

Raw, без cluster trimming этой 9-target серии:

| Модель | Mean error, px | RMS error, px | Within-target RMS spread, px | Off-screen predictions / accepted |
| --- | ---: | ---: | ---: | ---: |
| Baseline, same-eye iris | 385.90 | 477.59 | 215.50 | 115 / 415 |
| Full eye patch | 163.54 | 194.17 | 87.23 | 14 / 415 |
| Gradient all | 134.61 | 164.42 | 89.41 | 3 / 415 |
| Gradient lateral | 221.55 | 273.34 | 199.72 | 35 / 415 |

Mean error — sample-weighted Euclidean error; при равном весе каждой цели:
388.12 / 161.93 / 133.57 / 225.23 px соответственно. Spread — корень из
sample-weighted суммы **внутрицелевых** variance X+Y, не SD ошибки расстояния
и не variance объединённых координат разных целей. Off-screen здесь означает
прогноз вне viewport при **экранной** цели; это не off-screen-truth specificity.

На common captures gradient-all уменьшил mean error на 251.29 px (65.1% от
baseline этого run), улучшил восемь из девяти целей. Однако на первой цели
(30%,22%) ошибка **выросла** с 174.83 до 279.14 px. Остались средний bias
+44.81 px по X и +76.63 px по Y, worst target mean 279.14 px и RMS spread
89.41 px. Поэтому ни пригодность небольших AOI, ни закрытие #143 не доказаны.
415 автокоррелированных кадров одного человека не считаются 415 независимыми
наблюдениями; significance/population confidence intervals не рассчитывались.

Пять независимых benchmark targets ранее в том же run дали raw mean error
335.77 / 133.36 / 97.77 / 152.90 px. Эти значения проходят прежний 80% cluster
trim и не смешиваются с untrimmed девятью целями выше. Выбранные calibration λ:
1 / 10 / 1 / 1; target-group calibration CV RMS: 217.3 / 57.6 / 109.0 / 165.6 px.
Меньший selected CV у full patch **не** означает меньшую независимую ошибку.

У всех четырёх моделей correction `selected=false`, raw=corrected. Это не
случайно отключённая коррекция: baseline/full/all/lateral LOOCV ухудшает
3/1/6/6 correction targets, а прежний `shouldApplyResidualBiasCorrection`
требует `worsenedTargetCount===0` вместе с прочими условиями. Для обоих gradient
вариантов также вырос LOOCV RMS. Независимый rollback поэтому не тестирует
неприменённый offset. Пороги не ослаблены, bias по контрольным целям не вычтен
post hoc. Не утверждается, что любой другой вид correction заведомо бесполезен.

Analyzer errors=0; capture→analyzer-result age mean 15.81 ms, max 32 ms.
Все три eye extractors вместе: mean .925 ms/capture, max 5 ms. Эти отдельные
timing scopes не складываются в гарантированную display latency и не являются
FPS gate полного multimodal flow. Измерен первый spatial run, не drift:
`intervalMs=0`, `after=[]`. Последовательное изменение bias между разными
целями не отделяется здесь от spatial dependence и не доказывает временной drift.

Решение: gradient-all — ведущая **экспериментальная гипотеза**, а не новый
production default. Lateral не продвигается как улучшение all; full patch
остаётся полезным comparator, включая его synthetic lid-shift failure. Для
продолжения нужны проверка воспроизводимости, остаточного смещения и качества
до/после непрерывного интервала с замороженными моделью/correction, а затем
отдельная full-protocol/real-device приёмка. Этот run теперь development
evidence: будущие подобранные по нему варианты должны иметь новые независимые
проверки. Не добавлять head→target regression или AOI attraction ради результата.

Воспроизводимый read-only расчёт (файл остаётся вне репозитория):

```sh
node scripts/reference-data/issue143-summarize-gradient.mjs /path/to/wecog-issue143-eye-gradient-v7.json
```

Анализатор принимает только полный v7 spatial-only export, проверяет численные
counts/common intersections, выдаёт whitelist агрегатов. Marginal means не
подменяют common-frame deltas при разных exclusions. Пустая after-серия имеет
null errors и `driftAssessment.available=false`, не нулевой drift. Тесты
используют только искусственные summaries, не пользовательский JSON. В этом
этапе predictor, defaults, correction/QC thresholds, API/schema/migrations и
браузерный harness не менялись.

После добавления анализатора повторены summary/gaze/capture/gradient/eye-patch
units: **36 passed, 0 failed** (из них четыре новых теста анализатора).
`node --check` для новых script/test и `git diff --check` проходят. Анализатор
также выполнен на предоставленном файле, агрегаты совпали с независимым
read-only расчётом. Полные API/browser suites после этой offline-only правки
не повторялись; их предшествующие результаты приведены ниже, не как новый запуск.

## Автоматические проверки и ограничения среды

Результаты последнего завершённого прогона, не старые числа v6:

- Signal/capture units: **23 passed**, включая шесть gradient cases, pixel
  provenance, изменённые iris/lid landmarks, negative near-closure, common
  calibration subset, cleanup и target/head-gate separation.
- Полный API последовательно:
  `node --test --test-concurrency=1 tests/*.test.js` — **751 tests, 746 passed,
  5 skipped, 0 failed**. PostgreSQL DB/native Linux/conversion/nginx gates
  без отдельной среды не выполнялись.
- Default parallel `npm test` в этой среде не зелёный: повторялись deadline
  failures в неизменённых `ci-postgres-startup.test.js` (5000 ms wrapper вокруг
  30 fake Node forks) и `staff-http.test.js` (15 ms до вызова fetch). Отдельный
  прогон этих файлов: **19 passed**. Deadlines/assertions/production auth и
  backup-controller не менялись. Это ограничение проверки, не замена CI.
- Duplicate-work: **30 passed**, Chromium/Firefox/WebKit; одинаковые canonical
  import tags, без второго camera/inference loop.
- Issue143 browser regressions без полных Clock oracles: **37 passed, 2 skipped**
  в трёх движках. Это новые gradient provenance/camera teardown/layout плюс
  прежние loader/QC/UI checks. Skips — real vendored-model synthetic-video
  smoke в Firefox/WebKit, не пропущенные gaze accuracy measurements.
- Полный короткий gradient Clock oracle в **WebKit: 1 passed (43.7 s)**,
  прежний timeout 120 s: все 50 calibration clicks, correction/independent
  benchmark, одна 9-target серия, common counts, отсутствие persistent writes/
  sensitive fields, teardown. Это functional pass на искусственном input,
  не webcam accuracy или scientific acceptance.
- TypeScript typecheck и `git diff --check` проходят.

Chromium v7 full clock oracle пока не прошёл 120 s wall-clock budget при всех
сохранённых virtual callbacks. Причина задержки воспроизводится и на baseline
без gradient signal: три 1000 ms виртуальных клика занимали по 8–9 s реального
времени, native zero-delay yields Clock — около 80 ms каждый; CPU gradient за
60 вызовов составляло около .1 s. Отдельные пустые native timer probes: Chromium
shell 53.36 ms, full Chromium 57.47 ms, Firefox 71.35 ms, WebKit .1 ms (20 yields,
visible pages). Первопричина различия runtimes не установлена. Никакие power
settings, браузерные защиты, application timers или scientific gates не менялись.

Clock oracle использует `runFor`, не `fastForward`; camera callbacks каждые
33 ms и все измерительные ticks сохранены. Только **генератор искусственного
input** переиспользует своё одно неизменное RGBA изображение между сменами
synthetic target; у каждого capture новый owner/timestamp, descriptor/predictor
исполняются заново. Это не fallback/кэш реальных eye features и не FPS evidence.
Числа WebKit/остальных browser checks приведены выше. После успешного WebKit
oracle изменено только имя v7 download на `wecog-issue143-eye-gradient-v7.json`
и добавлена проверка этого имени в oracle; сам download-assert ещё не повторён.
Предоставленный пользователем завершённый v7 с ожидаемым именем подтверждает
ручной download/export, но не заменяет повтор этого автоматического assertion.
Это не меняет descriptor/fit/capture/validation. Перед новым camera run тяжёлые
прогоны остановлены, чтобы не влиять на sampling реального участника.

## Rollout и rollback

Сейчас только task branch и explicit local opt-in; в main/deploy нет изменений.
Приёмка требует PR в develop, CI, human review, независимых устройств/участников
и полного протокола. Нельзя закрывать #143 или обещать достоверность AOI на
основании этих unit/synthetic проверок.

Rollback эксперимента: убрать v7 manual opt-in и gradient code согласованным
revert, сохранив production baseline, raw/corrected/display boundary, QC пороги,
независимую validation и сохранённые сессии. Продолжение — не подгонка к AOI,
не скрытая head→target regression и не дополнительные цели внутри блока.
