# Issue 143: горизонтальная нормализация eye appearance, локальная v10

Ветка `feature/fix_issue_143`, после checkpoint `6c4a974`. Статус:
**экспериментальный кандидат, не production upgrade и не закрытие #143**.
Новые изменения не закоммичены/не отправлены. Первый human v10 разобран ниже;
он не подтверждает достаточную точность или готовность к production.

## Гипотеза и метод

V9 показала совместное изменение eye appearance и gaze bias при посадке ниже,
с приближением к исходному результату после возврата. Сырых images/features
нет, поэтому причину нельзя восстановить или переобучить модель по JSON.
Новая гипотеза: часть ошибки полного patch связана с широкими изменениями
яркости на границах век. Проверяется новое представление пикселей, не
компенсация bias по контрольным целям, не более строгий QC или smoothing.

`eye-tophat-features.mjs` — оригинальный Apache-2.0 код, без внешних весов,
зависимостей и датасетов. Использована стандартная операция black top-hat:
closing(image) − image; определение сверено с
[официальной документацией OpenCV](https://docs.opencv.org/4.13.0/d9/d61/tutorial_py_morphological_ops.html).
OpenCV не добавлен, код/картинки документации не копировались.
Прочитана первичная [страница MPIIGaze, Zhang et al.](https://arxiv.org/abs/1711.09017)
о влиянии appearance/resolution; ни dataset, ни GazeNet не загружались.
Это мотивация проверки, не перенос accuracy из публикаций на EmoCog.

Для каждого анатомического глаза:

1. Canthal corners задают camera-pixel оси, ориентацию и размер crop.
   Grid 32×20, ширина .8 и высота .5 canthal widths. Не используются target,
   история прогноза, iris/lid centers, текущая aperture или head→target fit.
2. По строке применяется grayscale dilation, затем erosion, radius=6
   (structuring element шириной 13 grid samples), из closing вычитается
   исходная строка. **Исходная** строка продолжается постоянными крайними
   значениями до обеих операций. Репликация уже обрезанной dilation могла
   бы искусственно заполнить тёмную область на краю, поэтому не применяется.
3. Pooling 2×2, per-eye mean/contrast normalization с прежним floor .04.
   Итого 320 признаков (160 на глаз). Flat output, недоступный crop или
   несовпавший pixel owner/frameSize возвращают missing, не старые features.
4. Прежняя dual ridge, λ `[.01,.1,1,10,100]`, feature floor .05,
   target-group calibration CV. Оба клика одной цели исключаются вместе,
   train-fold statistics не видят held-out цель. Control/benchmark targets
   не выбирают λ. Новый method tag: `eye_tophat_ridge.experimental.v1`.

Горизонтальная морфология не является доказанным отделением радужки от века
или 3D-нормализацией головы. Положение настоящего глаза должно сохраняться
в features; отдельный unit проверяет различимость Y при неизменных landmarks.
Нет target prior, подстановки screen center или coordinate clamping.

## Baseline-versus-new на искусственных изображениях

`node scripts/reference-data/issue143-row-patch-synthetic.mjs`:
25 training targets × 2 clicks, 16 иных targets × 6 predictions/condition,
8 off-screen truth cases на condition; 15 measurement conditions. Условные
повторы неизменного изображения не считаются независимыми наблюдениями.
Raw only. λ выбирается только calibration CV. До/после benchmark из других
пользовательских сессий не пересчитывается и не становится validation v10.

Контроли отделяют форму crop от нормализации: прежний full patch, dense raw
на новом crop, row-quantile contrast и black top-hat на том же новом crop.
Для top-hat выполняется **реальный GazeTracker с explicit opt-in**, а его
rounded predictions сверяются с отдельным offline dual-ridge fit.
Head/iris/confidence gates совпадают там, где оба descriptor доступны:
gate disagreements=0 во всех 15 conditions. Пропуски учитываются отдельно.

Средняя евклидова ошибка, CSS px:

| Искусственное условие | Прежний full patch | Новый black top-hat |
| --- | ---: | ---: |
| Normal | 19.12 | 23.71 |
| Lid ±.04 canthal widths | 678.51 | 45.49 |
| Lid +.08 | 1302.20 | 66.90 |
| Partial aperture .14 | 96.57 | 97.45 |
| Glare | 38.83 | 12.41 |
| Texture amplitude 20 | 116.44 | 159.25 |
| Near-closed image, intentionally open landmarks | 178.21 | 244.91 |
| True-gaze input jitter | 20.90 | 26.04 |
| Image-plane translation / roll / scale | 28.89 / 29.56 / 30.83 | 25.25 / 26.82 / 25.46 |

На lid ±.04 dense raw дал 1666.23 px, row contrast 671.73 px; одной замены
crop/resolution или вычитания quantile недостаточно. Эти условия уже
использованы для разработки и являются **exploration**, не независимой приёмкой.

Ограничения и отрицательные результаты:

- На обычном изображении ошибка выше исходной, на texture и near-closure
  заметно хуже. Эти regressions не скрыты и сохранены negative oracle.
  Near-closure fixture нарочно оставляет open landmarks: он проверяет
  дополнительную image failure, а не правильность реального blink gate.
- Within-target spread при input jitter: 11.22 → 13.29 px. Выигрыш при
  lid shift не является универсальным подавлением шума.
- В iris-absent fixture у top-hat 0/96 accepted, error=null, не 0 px;
  full patch выдаёт 96/96 с ошибкой 371.16 px. Это **missingness**, не
  доказанная detection rate на настоящих глазах/очках/освещении.
- В missing-pixels condition оба имеют 64/96 accepted. При остальных
  перечисленных условиях — 96/96, так что lid improvement не получается
  исключением плохих прогнозов.
- На normal off-screen truth: 8/8 снаружи у обоих. На lid shift остаются
  2/8 ложных внутри, на partial/near-closed — 4/8 у обоих. На texture
  top-hat даёт 3/8 внутри против 0/8 у full patch. Эти восемь fixtures
  не являются популяционной оценкой specificity и не разрешают rollout.
- Плоскостной image translation/roll/scale не моделирует физическую смену
  посадки. Реальная причина v9 и долгий drift не проверены этим benchmark.

В micro-run суммарное извлечение **всех четырёх** descriptors занимает
примерно .1–.3 ms/artificial capture в Node. Это не время одного extractor,
полный browser pipeline, real-camera FPS или display latency. В ручном
отчёте extraction, regression, fit и capture→analyzer-result разделены.

## Локальная v10 и приватность

`?models=tophat&pose=1` сохраняет A–B–A сценарий v9: natural → lowered →
returned, 5 одинаковых независимых целей на каждом этапе, одна калибровка
и прежний correction/rollback. Нажатие перед каждой серией, 60 s deadline,
те же stop/Escape/visibility/resize guards. Никакого четырёхминутного ожидания,
переобучения между сериями или вставки целей в опубликованный протокол.
`?models=tophat` без pose — короткая single-series spatial check.

Четыре модели: baseline / full patch / Gradient All / top-hat, не lateral.
Все усредняют **пересечение** full/all/tophat-usable calibration captures;
достаточных раздельных counts недостаточно. JSON отдельно отражает
availability descriptors и common calibration counts. Это новая методика
общего subset: не считать baseline идентичной старому production fit.

Pixel ownership только `getFramePixels(completedFrame)` при точном frameSize,
нет camera recapture или второго inference loop. Features временные в
WeakMap, ≤50 calibration rows, удаляются после fit/reset; при teardown
очищаются ссылки на текущий кадр/weights. JSON не содержит pixels, patches,
features, weights, landmarks или gaze series; нет API/ingest/checkpoint пути.
Никакое внешнее приложение не получало пользовательские JSON/изображения.

Constructor opt-in: `experimentalEyePatch: { region: 'tophat', ... }`.
Production default остаётся `same_eye_iris.v2`, опубликованный протокол
новый метод не выбирает, API/schema его method tag отвергают. Новая pure
module входит в import graph, но default predictor не извлекает top-hat.
Cache tags singleton/UI/consumers согласованно обновлены на `20261108-143l`.
Нет зависимости OpenCV, новых asset/weights, endpoint, migration или прав.

URL:
`http://127.0.0.1:4203/apps/autotests/manual/issue143-gaze.html?models=tophat&pose=1&rev=20261108-143l`.
Сервер из корня: `python3 apps/autotests/scripts/serve-static.py 4203`.
Камера только по кнопке. Выход `wecog-issue143-eye-tophat-v10.json`, версия
`issue143_eye_tophat.v10`. Реальная проверка должна сравнить одинаковые цели
и signed bias A1/B/A2, пропуски и нагрузку на общих кадрах. Она не заменяет
независимых участников/устройств и полного протокола до rollout.

Rollback — точечный revert v10 option/module/manual/tests с согласованными
cache tags. Не откатывать весь dirty worktree, не удалять checkpoint/sessions.

## Проверки этого этапа

- 86/86 целевых Node tests #143, включая 6 новых про morphology boundaries,
  Y information, pixel provenance, same gate/target blindness, common subset,
  lifecycle и negative image conditions; API отвергает новый method tag.
- WebKit Clock: 5/5 полных функциональных сценариев v7/v8/v9/v10 short/v10
  pose. Все sampling callbacks исполняются через `runFor`, не fastForward.
  Проверены frozen summaries, A–B–A, transient-only export, teardown и имя JSON.
- Browser regressions без полных Clock oracles: 49 passed, 2 skipped на
  Chromium/Firefox/WebKit. Skips — прежний synthetic-video vendored model
  smoke Firefox/WebKit, не точность или camera acceptance.
- Duplicate module/loop regressions: 30/30 на трёх движках.
- Полный последовательный API suite Node 24: 776 tests, 771 passed,
  5 skipped, 0 failed, 54 suites. Это не default parallel CI; отдельные
  PostgreSQL/native Linux/conversion/nginx gates этим не выполнены.
- Playwright TypeScript typecheck и `git diff --check` проходят.

Это не полный CI release gate, real-camera acceptance или подтверждённое
устранение issue. Данные v7–v9 не использованы для fit новой модели.

## Первый реальный v10: стабильность не равна точности

Получен завершённый A–B–A export `wecog-issue143-eye-tophat-v10.json`:
Safari/Worker, viewport 1728×916 CSS px, camera 640×480. Ошибок анализатора
0, 50 кликов приняты на 808 общих calibration captures для всех моделей.
Все 176/180/174 analyzed captures в natural/lowered/returned приняты
каждой моделью. Следовательно, сравнения внутри этапа выполнены на одних
кадрах; улучшение после возврата не объясняется дополнительным отбрасыванием.
Все correction `selected=false`: raw=corrected; пороги не ослаблены.

Средняя евклидова ошибка, CSS px, sample-weighted по принятым кадрам фазы:

| Вариант | Natural | Lowered | Returned |
| --- | ---: | ---: | ---: |
| Baseline | 223.50 | 261.58 | 282.76 |
| Full patch | 109.09 | 115.71 | 195.59 |
| Gradient All | 138.15 | 166.97 | 126.24 |
| Black top-hat | 153.22 | 151.94 | 144.15 |

На одинаковых пяти целях с равным весом каждой цели:

- Top-hat B−A1: Δmean error −7.50 px, Δbias X/Y −16.15/+20.34 px.
  A2−A1: −14.56 px, Δbias X/Y +24.46/+44.80 px. Это не нулевой drift:
  средняя ошибка может не расти при смещении предсказаний.
- Full patch A2−A1: Δmean error +85.98 px, Δbias X/Y +114.32/−2.39 px,
  ошибка выросла на всех пяти целях. Top-hat не повторил этот большой
  правосторонний сдвиг, но изначально имел более высокую ошибку.
- Внутрицелевой RMS spread full patch 18.79 → 24.62 → 23.94 px;
  top-hat 48.65 → 50.05 → 38.86 px. Новый вариант существенно менее точен
  по кратковременному разбросу, а не только по среднему смещению.

Пространственное ограничение top-hat особенно заметно внизу. В natural на
двух верхних целях mean error 55.4/81.8 px, на нижних — **309.9/253.8 px**;
вертикальные bias внизу −290.8/−250.1 px. Это неоднородная по экрану ошибка,
а не одинаковый X/Y offset. Описательное указание на сжатую вертикальную
область предсказаний не является диагностикой причины и не используется
для fit глобального scale/offset по этим контрольным целям.

Наблюдаемые head proxies также отличались от v9: средний `eyeMidY`
.56762 → .61386 → .56768, pitch proxy .08874 → .07916 → .07676. В v9
pitch proxy при снижении посадки, наоборот, возрастал. Ни один proxy не
является физическим углом; нельзя объявить изменение v9→v10 эффектом
нового descriptor. Корректное сравнение моделей — внутри одного v10 на
общих кадрах. Сценарий не рандомизирован и не проверяет длительный drift.

Calibration target-CV full patch 51.1 px, top-hat 73.5 px; независимая
5-target correction check (прежний cluster trim) 49.50/68.74 px соответственно.
Эти числа не смешиваются с untrimmed 5-target A–B–A таблицей. Простой выбор
одной из двух моделей по минимальной calibration CV выбрал бы full patch,
а не top-hat; нельзя задним числом выбрать его только для последней серии.

Availability descriptors по всему run: full/top-hat 4315/4315, Gradient All
4287/4315. Эти denominators включают подготовку/калибровку и отличаются
от контрольных окон. Capture→analyzer age mean 16.01 ms, max 30 ms;
все три extractors вместе mean .690 ms, max 5 ms. Fit/CV top-hat 1008 ms
против 419 ms full patch, регрессия примерно .0105 против .0073 ms/prediction.
Это отдельные timing scopes standalone analyzer, не FPS или latency
полного multimodal runtime.

**Решение:** сохранять top-hat как экспериментальный comparator, не
продвигать вместо full patch/default. В этом run он менее подвержен части
изменений, но проигрывает initial accuracy/jitter и имеет тяжёлую нижнюю
ошибку. Нельзя считать его готовым исправлением #143, переключаться между
моделями по текущим контрольным точкам либо маскировать проблему постоянным offset/QC отказом.
Следующий кандидат должен улучшать обе стороны — spatial accuracy и
устойчивость — на независимых данных. Новый human run без такого изменения
пока не нужен.

Read-only анализатор `scripts/reference-data/issue143-summarize-gradient.mjs`
добавляет v10 (`issue143_gradient_analysis.v4`) для короткой и A–B–A версии:
правильно использует `eye_tophat` вместо старого `eye_gradient`, проверяет
method tag, целевые координаты, counts и common intersections. V7/V8/V9
остаются совместимыми. Исходный JSON не скопирован в repo/fixtures, модель
по нему не обучалась. В этом этапе изменён только анализатор и его тесты,
не runtime. Добавлены два теста на v10 short/pose и запрет подмены метода
или контрольных целей. Полный API/browser suite повторно не запускался;
результаты выше относятся к подготовке v10.
После добавления анализа повторены целевые Node tests #143: **88 passed,
0 failed**, включая оба новых случая. `node --check` и `git diff --check`
прошли. Это не новые browser/scientific acceptance results.
