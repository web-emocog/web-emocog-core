# Issue 139: Открытая Шея Не Должна Блокировать Пречек

Источник: [GitHub issue 139](https://github.com/web-emocog/web-emocog-core/issues/139),
состояние open, комментариев 0 на момент чтения 28.10.2026. Изучены описание
и приложенный текстовый лог. Не открывался production protocol для прохождения,
не использовались реальные камера, микрофон или аккаунт исследователя.

Работа локальная, checkout `.worktrees/fps-workers-release`, ветка
`fix/audit-diagnostics-lifecycle`. Не выполнялись push, commit, PR, deploy
или изменение issue. Предыдущие локальные правки аудита сохранены.

## Причина И Воспроизведение

Прежняя `extractFaceRegion` брала bounding rectangle landmarks с padding 10%.
В этот прямоугольник попадала открытая шея. Затем `analyzeFaceRegionsVisibility`
при общей доле body_skin >= 0.08 выставляла hand_on_face, уменьшала score
и запрещала isComplete независимо от локальных глаз/щёк/лба. Пречек напрямую
использовал isComplete и поэтому не разрешал переход к калибровке.

Класс body_skin не является классом «рука»: в него входит и кожа шеи. При
замене одежды вместо открытой кожи или при изменении положения головы менялись
не только in-face признаки, но и пиксели ошибочного прямоугольника.

Описанная логика подтверждена также в **текущем develop на GitHub**:

- mask-analyzer.js blob `b18d31003f6018329006a05f022e9bbfec602187`;
- region-analyzer.js blob `3be6cd8994f120390ee6581e2adb383a94e06a88`.

Эти blobs совпадают с локальной базой до правок. Лог issue подтверждает загрузку
модульного FaceSegmenter, но не содержит исходной маски/региональных чисел.
Поэтому точный mask output конкретной камеры не объявляется восстановленным.

До исправления добавлен тест на геометрической маске (не лицо человека):
одинаковые landmarks и лицо, меняется только outside body_skin/clothes.
Прежний код даёт false вместо ожидаемого true. Регрессия сохранена в
`issue139-face-visibility.test.js` и исходном неуспешном прогоне.

## Исправление

1. Face support строится по упорядоченному FACE_LANDMARKS_FACE_OVAL из
   закреплённой MediaPipe. Индексы автоматически сверяются с vendor runtime.
   Анализируются центры пикселей внутри polygon, без padding шеи.
2. Forehead/cheeks/eyes/nose/mouth/chin rectangles также пересекаются с этим
   support: neck/background не попадает через углы локальных rectangles.
3. Global body_skin ratio остаётся диагностикой, не самостоятельным veto.
   Для hand hypothesis нужны локальные in-face признаки. Nose/mouth/chin
   сохраняют явные *_hand_occluded, как и глаза/щёки/лоб. Такие markers
   по-прежнему учитываются существующими live/final QC consumers.
4. Численные skin/hair/hand/asymmetry thresholds и temporal quality rules
   не изменены. Поза, расстояние, освещение, стабильность и success frame
   counter пречека не менялись. Исчезновение/невалидность mesh или маски
   не разрешает проход: face_region_unavailable/face_out_of_frame/no data.
5. Inline fallback больше не содержит отдельную устаревшую global-hand
   реализацию, а загружает те же mask/region анализаторы. При сбое чистых
   модулей нет fake pass; нативные маски закрываются также при ошибке анализа.
6. Метод явно обозначен `face_oval_regions.v1`, faceRegion sampling как
   `face_oval_pixels.v1`; unknown rectangle не выдаётся за локализованное лицо.
   Support хранится в WeakMap, не в enumerable result. Worker сохраняет
   прежний запрет возврата raw mask на UI.
7. Обновлены cache tags wrapper/index/class/analysis/helper/Worker entry.
   Versioned Worker client используется новым segmenter без изменения
   identity singleton state/UI modules. Не менялись модели, зависимости,
   API, DB, сохранённые сессии, ссылки и публикации протоколов.

После отдельного выпуска это клиентское исправление не требует заново
создавать протоколы/приглашения. Оно не обновляет уже исполняющийся JS во
вкладке автоматически: нужен переход на новую загруженную страницу.
Production rollout и warm-cache проверка на реальном сайте не выполнялись.

## Проверки

Новые проверки включают:

- открытая/закрытая шея и остальные outside classes при одном лице;
- reference raster против scanline support: повороты, зеркало и четыре
  разрешения маски; точное сравнение каждого пикселя и счётчиков;
- hand-class внутри восьми областей и whole-face hair/clothes/background;
- malformed/absent/out-of-frame/collapsed landmarks, испорченная/отсутствующая
  маска, отсутствие fake pass и ложного утверждения о руке без геометрии;
- parity module/inline и release маски при исключении;
- фактические indicator/button/pass_fail canonical precheck, blocked negative
  cases и восстановление после исчезновения occlusion;
- настоящее Worker messaging с production worker body и synthetic native
  inference fixture: face-local result и отсутствие raw mask в ответе.

Первый worker fixture в Firefox не подменил worker subresource через
page.route: вместо синтетической маски обрабатывался пустой кадр настоящей
моделью. Получено 17 passed/1 failed. Исправлен стенд: production worker body
остаётся тем же, только native module подменён статическим synthetic fixture
с разрешёнными абсолютными import URLs. Никакого Firefox bypass в product
runtime не добавлено. После этого двойной новый набор: **36 passed**,
Chromium/Firefox/WebKit, retries=0. Настоящие MediaPipe/Worker checks остаются
в полном прежнем `vision-workers.spec.ts`.

Финальный последовательный прогон на неизменном наборе исходников:

| Проверка | Результат |
| --- | --- |
| API/unit, Node24/macOS | 608 tests: **603 passed**, 5 skipped, 0 failed |
| Runtime/Worker/security/diagnostics, Chromium/Firefox/WebKit | **231 passed**, 0 failed, retries=0 |
| FPS/source/replay, три движка | **36 passed**, 0 failed, retries=0 |
| Linux/Node22: issue 139 + face regions + export/QC recovery | **11 passed**, 0 failed |
| TypeScript, syntax, git diff --check | passed |

SHA-256 исходников до/после прогона совпадают. Linux container использовал
существующий image без сети, с read-only root/checkout и disposable tmpfs,
без production/рабочей БД. Пять host skips требуют native conversion/nginx/
Linux tools; PostgreSQL integration suites не запускались. Это не меняет
число подтверждённых проверок самого нового issue 139: они не пропускались.

Команды из checkout:

```bash
cd apps/api && npm test
node --test tests/issue139-face-visibility.test.js tests/face-regions.test.js tests/session-export-recovery.test.js
cd ../autotests
npm run typecheck
npx playwright test --config=playwright.workers.config.ts tests/issue139-face-visibility.spec.ts --repeat-each=2
npm run test:frame-workers
npm run test:fps
```

Новый browser spec входит в существующий required worker regression config,
а не полагается на необязательный ручной запуск. Общий default config
исключает этот spec, чтобы не дублировать isolated server/engine matrix.

Дополнительно CPU smoke на synthetic 256x256 mask, Node24, 20 warmup + 200
измерений: median до 0.272 ms, после 0.355 ms; p95 0.343 -> 0.511 ms.
Это накладные расходы геометрии на данном стенде, не замер ML или webcam FPS
и не scientific accuracy. На старой маске isComplete=false, на новой=true.

## Ограничения И Приёмка

- Остальные ошибки модели сегментации, например misclassification пикселей
  внутри лица, этим геометрическим исправлением не объявляются решёнными.
- Нужен повтор с реальной камерой MateBook/Windows/Edge из issue: одинаковые
  свет/положение, открытая шея, закрытая только шея, затем рука поверх глаза
  или щеки, убранная рука. Последнее должно блокировать gate только пока
  перекрытие присутствует. Не компенсировать баг поворотом головы/снижением QC.
- Chromium tests не называются проверкой конкретной установленной версии Edge.
  Реальных кадров участника/камеры в этом этапе не было.
- Нет заявления о clinical accuracy/FPS, нет PostgreSQL/deployment acceptance.
  Не пересчитывать исторические результаты новым методом без исходных данных.
- Исходные 239 строк аудита остаются: 75 исправлено, 62 неактуально/не
  подтверждено, 102 открыто (8 частично). Issue 139 вне этой исходной таблицы.
