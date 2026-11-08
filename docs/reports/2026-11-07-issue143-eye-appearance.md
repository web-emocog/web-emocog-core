# Issue 143: локальный eye-appearance прототип, 7 ноября 2026

Статус: исследовательский прототип, **не production upgrade и не исправленный
drift**. Ветка `feature/fix_issue_143`, база `b16ce38462050ffa3f646d908a8b37ccf92d877b`.
Нет commit/push/deploy, миграций или закрытия issue на этом этапе.

Следующий этап: [gradient-center signal и короткая v7](2026-11-07-issue143-eye-gradient.md).
Результаты v6 ниже исторические и не пересчитаны под новый descriptor.

## Зачем ещё один сигнал

Предыдущие варианты меняли геометрию, basis и регуляризацию одной и той же
iris-landmark информации. Они не могут восстановить отсутствующий вертикальный
сигнал или неизвестный input drift. Новая проверяемая гипотеза: информация в
изображении глаза может дополнять landmarks. Это не установленная причина
сессий 125/126 и не заключение о поведении участника.

Методологический источник: Papoutsaki et al.,
[WebGazer, IJCAI 2016, §3.2–3.3](https://ijcai.org/proceedings/2016/540).
В статье используются eye-image features и ridge regression. Здесь своя
реализация, другой preprocessing и явная калибровка. Код, веса и датасеты
WebGazer/TurkerGaze не подключены; обучение по курсору, AOI, содержимому стимула
или будущим контрольным целям **не переносится** в исследовательскую сессию.
Attribution и отсутствие новых assets отражены в `docs/THIRD_PARTY_LICENSES.md`.

## Реализация и границы

- `eye-patch-features.mjs` читает RGBA **того же завершённого кадра** через
  `getFramePixels(frame)`, с точным совпадением `frameSize`. Нет нового camera
  capture/MediaPipe loop, recapture live video или last-patch fallback.
- Crop выровнен по углам глаза в camera pixels, 1.25×.75 eye widths. На глаз
  приходится 10×6 cells с четырьмя bilinear subsamples. Собственная mean/contrast
  normalization использует floor .04; crop не зависит от высоты век.
- Full: 120 features, `eye_patch_ridge.experimental.v1`. Core: центральные 6×2
  cells на глаз, 24 features, отдельная нормализация и
  `eye_patch_core_ridge.experimental.v1`. Это две гипотезы, не автоматический
  выбор лучшей по контрольным результатам.
- Dual ridge с unpenalized intercept эквивалентен прежнему primal solver;
  production iris solver не заменён. Standardization/floor .05 рассчитываются
  внутри каждого train fold. λ `[.01,.1,1,10,100]` выбирается только по
  leave-one-calibration-target-out: оба клика одной цели исключаются вместе.
  Этот CV minimum — selection diagnostic, не независимая accuracy.
- Локальная v6 сравнивает baseline, axis-auto, full и core на одном inference.
  Для калибровки все четыре усредняют **пересечение** full/core-usable captures,
  не разные поднаборы одного окна. При нехватке общих frames повторяется клик,
  а минимум и eye/pose gates не ослабляются. В отчёте есть отдельные full/core/
  common counts и `calibrationFramePolicy`.
- Head, eye confidence и iris-OOD остаются baseline gates. Head не становится
  скрытым predictor, display не подставляется в raw/corrected. Независимая
  correction/rollback и before/after validation не выбирают модель/λ.
- Missing/mismatched/flat image или crop вне кадра дают missing, не искусственно
  дополненный patch. При prediction считаются общие accepted frames, отдельные
  missing/off-screen доли и ошибки, включая accepted off-screen predictions.

Baseline в v6 — прежний predictor на **общем** calibration subset. Это контроль
для сравнения моделей, не идентичная production-калибровка со всеми доступными
ей frames. Дополнительные exclusions могут изменить и baseline fit; отдельная
приёмка полного production flow остаётся обязательной.

## Приватность и нагрузка

Опция `experimentalEyePatch` включается только явным constructor opt-in из
loopback manual harness, не параметром опубликованного протокола. В штатном
participant flow default остаётся `same_eye_iris.v2`; API отвергает оба
experimental method tags. Доступ к камере — только кнопкой, не при загрузке.

Eye features тоже чувствительны: локальные WeakMap и bounded collector хранят
их временно, без сохранения исходного RGBA на landmark copy. Максимум 50
training rows; после успешного fit они удаляются **до callback**. Веса остаются
только в памяти до stop/reset. При отмене, ошибке, смене viewport/camera,
скрытии страницы и завершении очищаются ссылки и останавливается stream.
Это не обещание физического обнуления памяти JS/браузера.

В JSON нет eye images, feature vectors, weights, landmarks или рядов gaze:
только counts, calibration CV и агрегаты. Нет API/ingest/checkpoint/IndexedDB
пути для прототипа. Данные людей из Downloads не копировались в fixtures;
новый renderer создаёт только искусственные изображения, не похожие на запись
конкретного участника, и не сохраняет их.

В v6 раздельно измеряются extraction full+core, synchronous fit+CV, regression
runtime и capture→analyzer-result age (до extraction). Эти интервалы не являются
display latency или FPS acceptance полного multimodal pipeline. Synchronous CV
может блокировать UI; dual solver уменьшает размер системы, но не доказывает
приемлемую нагрузку Safari с камерой. В production дополнительный fit не включён.

## Воспроизводимый отрицательный benchmark

Команда: `node scripts/reference-data/issue143-appearance-synthetic.mjs`.
25 calibration targets × 2 rows; 16 других targets × 8 predictions на condition
и model. Viewport 1470×956, искусственное изображение 640×480. Только raw,
без correction, подгонки по held-out данным или автоматического pass.

Средняя евклидова ошибка, CSS px (округлено до .001):

| Искусственное условие | Baseline | Axis-auto | Full | Core |
| --- | ---: | ---: | ---: | ---: |
| Без изменения | 0 | 0 | 19.119 | 48.994 |
| Landmarks Y не различает цели | 187.019 | 187.000 | 19.119 | 48.994 |
| Brightness +15, contrast ×.8 | 0 | 0 | 17.876 | 49.461 |
| Lid pixels ±.04 eye widths | 0 | 0 | 678.514 | 48.994 |
| Lid pixels +.08 eye widths | 0 | 0 | 1302.205 | 247.352 |
| Measurement jitter | 11.185 | 11.185 | 20.703 | 50.660 |
| 2D image translation | 0 | 0 | 28.891 | 49.693 |
| 2D image roll | 0 | 0 | 29.561 | 49.574 |
| 2D image scale | 0 | 0 | 30.834 | 49.238 |

Малый lid shift делает 75% full predictions off-screen; большой — 100% full
и 25% core, **без изменения baseline gate**. Это реальный отрицательный исход
этого искусственного теста, не фильтр, который нужно ослабить. Core не решает
проблему полностью и проигрывает full по точности в неизменном условии.

При удалении pixels у 25% captures full/core дают 25% missing, baseline/axis —
0%. Ошибки оставшихся 19.119/48.994 нельзя считать улучшением на всех captures.
В jitter case within-target RMS spread: baseline/axis 11.461 px, full 11.137,
core 11.142; небольшое уменьшение spread при большей ошибке не означает лучшую
точность. В остальных детерминированных repeats spread=0 по устройству fixture.

Gate disagreements=0 там, где candidate получил features. Четыре горизонтальных
off-screen fixtures дают specificity=1 у всех вариантов; вертикальная specificity
и реальная webcam specificity этим не установлены. 2D translation/roll/scale не
являются физическим 3D head motion. Lid renderer не моделирует биологию век,
очки, блики, texture и совместные ошибки MediaPipe. В Node extraction занимает
порядка .01–.03 ms, calibration всех четырёх — около .57–.62 s в данном запуске;
это не browser latency/performance gate и не стабильные аппаратные константы.

Повторный `issue143-synthetic.mjs b16ce38462050ffa3f646d908a8b37ccf92d877b`
сохранил прежние geometry результаты: current geometry-shift error 0 против
188.112 px у старого baseline; lid-only error current 130.250 px. Нулевые числа
упрощённой геометрии не доказывают реальную точность исправленной модели.

## Проверки реализации

Команды из корня (Node 24.22.1, текущие lockfile):

```bash
node --test apps/api/tests/issue143-eye-patch.test.js apps/api/tests/issue143-calibration-capture.test.js
node scripts/reference-data/issue143-appearance-synthetic.mjs
node scripts/reference-data/issue143-synthetic.mjs b16ce38462050ffa3f646d908a8b37ccf92d877b
cd apps/api
npm test
cd ../autotests
npm run typecheck
npx playwright test --config=playwright.issue143.config.ts
npx playwright test tests/duplicate-work.spec.ts --config=playwright.fps.config.ts
npx playwright test tests/session-runtime.spec.ts --grep 'a frozen prediction|15 Hz validation|calibration marker moves|acknowledging calibration' --timeout=120000 --trace=off --reporter=list
cd ../..
git diff --check
```

- Eye-patch + capture unit regressions: **17 passed**. Новые negative cases
  проверили mismatched frame owner/size, crop/flat image, target blindness,
  baseline gate, 50-row bound/cleanup, dual/primal equivalence и несовпадающие
  calibration subsets. Две новые проверки сначала дали ожидаемый red, после
  исправлений прошли.
- Полный API: **745 tests, 740 passed, 5 skipped, 0 failed**. Один промежуточный
  run упал в неизменённом `debug-runtime-privacy.test.js` на подстроке `999`;
  отдельный повтор его 12 tests и полный повтор прошли. Сравнение проверяет
  подстроку всего JSON, включая timestamps: точный исходный JSON отказа не
  сохранён, поэтому совпадение времени — гипотеза, не доказанная причина.
  Тест/production sanitizer не менялись.
  PostgreSQL integration без отдельной test DB и native Linux/converter/nginx
  smoke на этой macOS-среде не выполнялись; это не полный release gate.
- Duplicate-work: **30 passed**, Chromium/Firefox/WebKit, canonical query URLs,
  одна camera/analysis ownership. Это не FPS gate с живым лицом.
- Основной calibration/validation flow: **10 passed**, Chromium/Firefox,
  frozen/15 Hz/missing target и marker/instruction. Thresholds не менялись.
- Итоговый issue143 browser suite: **38 passed, 10 skipped**, Chromium/Firefox/
  WebKit. В Chromium полностью прошли v3/v4/v5/v6 clock oracles: 50 кликов,
  correction, before/after, 4 виртуальные минуты и teardown. В v6 дополнительно
  проверены общие calibration frames, timing fields, отсутствие sensitive
  feature/weight fields в JSON и ноль обращений к browser persistent storage.
  Missing-pixel ownership и отсутствие автоматического camera start проверены
  во всех трёх движках. Skips относятся только к Chromium-only synthetic-video
  smoke и полным clock oracles в Firefox/WebKit. Это не real-camera accuracy,
  Safari FPS или независимая scientific acceptance.
- TypeScript typecheck, JS syntax checks и `git diff --check` прошли. Browser-only
  dynamic import paths нового теста исправлены без отключения TypeScript checks.
- Повторены v4 factorial и v5 axis synthetic benchmarks. Их численные results
  совпали с сохранёнными предыдущими запусками после исключения runtime fields;
  новый opt-in не изменил эти контрольные regressions. Это не независимая
  проверка точности на людях.

## Решение, следующий этап и rollout

Full **не продвигается**: отрицательный lid-shift outcome слишком велик. Core
тоже не выбран production-моделью: он теряет информацию и ломается при большей
окклюзии. Synthetic вход показывает наличие информации в pixels, но не качество
на человеческих глазах и не устранение длительного drift.

Следующий модельный этап должен отдельно проверять устойчивость к частичному
закрытию/выравниванию глаза, а не подгонять gaze к AOI, вводить head→target fit
или выбирать коэффициенты по четырём присланным human runs. Более тяжёлая
appearance-модель требует отдельной проверки лицензии/версии/hash весов,
браузерного backend и сопоставимого independent benchmark. Других моделей,
weights или dependencies сейчас не добавлено.

Новый длинный human run этого наивного full-patch сейчас не требуется. Перед
реальной приёмкой следующего кандидата нужны заранее определённые критерии,
короткий matched-frame check и затем согласованный длительный/full-protocol
benchmark с baseline, очками/светом/движением, latency, missingness и точностью
по зонам. Непрерывный 40-trial block не изменён и не получает новых целей.

Локально v6 доступна по `?models=appearance`, но не является рекомендацией
запускать новый сбор. Слияние только в develop после review/CI; перенос main
делает пользователь отдельно. Rollback эксперимента — убрать manual opt-in
и экспериментальные методы/тесты согласованным revert, не менять QC-пороги,
не затрагивать сохранённые сессии и не отключать независимую validation.
