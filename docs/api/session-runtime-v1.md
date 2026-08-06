# Session Runtime и API-контракты v1

## Назначение

`apps/participant-web/js/session-runtime/` управляет единой измерительной
сессией участника. После precheck и до начала калибровки запускается один
видеопайплайн, который непрерывно обслуживает gaze, blinks/PERCLOS, emotions,
body pose/movement, QC и BPM. Без калибровки координаты gaze не считаются
достоверными и не публикуются, остальные сигналы продолжают собираться. RT
фиксируется глобальными обработчиками ввода только внутри активного испытания.

Сырое видео не отправляется на API. В итоговый `SessionFeature` входят
агрегаты, типизированные события, состояние lifecycle и признаки качества.
Emotion и body pose используют online accumulators всей сессии; ограничение
размера диагностического массива не меняет итоговые средние.

## State machine

| Состояние | Назначение |
| --- | --- |
| `idle` | runtime ещё не запущен |
| `starting` | инициализация сессии |
| `instruction` | экран инструкции, пауза разрешена |
| `running` | выполняется испытание, пауза запрещена |
| `paused` | ручная пауза на инструкции |
| `quality_error` | длительное ухудшение условий измерения |
| `technical_error` | ошибка сети, камеры или модуля |
| `finishing` | остановка модулей и подготовка результата |
| `completed` | локальная сессия завершена |
| `failed` | невосстановимая ошибка завершения |

Пауза начинается и заканчивается только действием участника. Ошибка во время
испытания не ставит таймер задания на скрытую паузу: текущая попытка помечается
невалидной, сохраняется для аудита и после инструкции повторяется с новым
номером `attempt`.

## Контроль качества

Ошибки качества:

- лицо отсутствует не менее 1.5 секунды;
- плохое освещение сохраняется не менее 2.5 секунды;
- мешающая поза или нестабильность головы сохраняется не менее 2.5 секунды;
- подтверждённое FaceSegmenter перекрытие лица рукой длится не менее 2 секунд.

Краткие движения головы, короткие изменения света и
`low_skin_visibility` не бракуют блок. Ошибки MediaPipe/анализа после трёх
последовательных кадров, остановка camera track, отказ BPM и потеря сети
классифицируются как технические.

Перед испытаниями UI показывает условия проведения: нельзя проходить тест в
движущемся транспорте, в темноте, с сильной засветкой сзади, лёжа или с
закрытым лицом. Естественные краткие движения головы и небольшие изменения
света допустимы.

## Контракты

Канонические схемы:

- `packages/shared/contracts/session-feature.v1.schema.json`;
- `packages/shared/contracts/session-event.v1.schema.json`;
- `packages/shared/contracts/session-lifecycle.v1.schema.json`;
- `packages/shared/contracts/ingest-session-feature-response.v1.schema.json`;
- TypeScript-типы: `packages/shared/contracts/session-contracts.d.ts`.

API публикует схемы:

```text
GET /contracts
GET /contracts/session_feature.v1
GET /contracts/session_event.v1
GET /contracts/session_lifecycle.v1
GET /contracts/ingest_session_feature_response.v1
```

Алиасы с именами файлов, например
`/contracts/session-event.v1.schema.json`, также поддерживаются для JSON
Schema resolver и обратной совместимости.

Все записи `SessionFeature.events` имеют `schemaVersion=session_event.v1`,
`eventId`, категорию, severity, абсолютное и относительное время, фазу,
`blockId` и `trialId`. Старые дополнительные поля событий сохраняются для
обратной совместимости.

## Завершение и повторная отправка

`finishSession()`:

1. Использует один стабильный `finishAttemptId`.
2. Останавливает центральный видеопайплайн, RT listeners, QC и запасные loops.
3. Финализирует BPM/respiration, emotions, body pose, blink dynamics и PERCLOS,
   затем строит heatmap и attention aggregates.
4. Останавливает все camera tracks и очищает `video.srcObject`.
5. Показывает финальный экран.
6. Отправляет итоговый payload с заголовком
   `Idempotency-Key: <finishAttemptId>`.

До подтверждения `POST /ingest` завершённый checkpoint хранится в IndexedDB.
После перезагрузки отправка автоматически повторяется с тем же ключом. API
возвращает `200` без повторных записей для уже принятого ключа и `409` для
другого ключа завершённой сессии. Первая запись возвращает `201`.

Checkpoint-записи сериализованы: явный `await saveCheckpoint()` гарантирует,
что более ранняя запись завершится и последняя версия state будет сохранена.
Высокочастотные gaze/EAR samples дописываются в IndexedDB дельта-чанками
вместе с атомарным checkpoint, а не копируются целиком каждые 5 секунд. После
reload samples восстанавливаются, незавершённый блок помечается невалидным,
добавляется в очередь повтора, а участник возвращается к camera precheck и
персональной калибровке.

Terminal save/clear дополнительно ожидает уже запущенную periodic checkpoint
операцию. Поэтому медленная фоновая запись состояния `running` не может
завершиться после `completed` и восстановить устаревшую незавершённую сессию.

Промежуточные и fallback-файлы автоматически не скачиваются. Локальная
выгрузка остаётся явным действием участника на финальном экране.

## Typed transport и ingest token

Единственный сетевой transport participant-клиента находится в
`apps/participant-web/js/session-runtime/ingest-transport.mjs`. Он принимает
только `session_feature.v1`; `web-page/data-sender.js` является совместимым
facade и не содержит собственного `fetch('/ingest')`.

Участник перед первой итоговой отправкой обменивает код приглашения и
`session_id`:

```text
POST /invitations/by-code/:code/ingest-token
```

Полученный server-issued JWT связан с session, invitation, protocol и project.
Token mismatch на `/ingest` возвращает `409`, отсутствующий или истекший token
возвращает `401`. Staff ingest разрешен только для project-scoped сессии,
ранее созданной через `/sessions/start`.

Полная матрица операций и tenant scope описана в
`docs/api/authorization-matrix-v1.md`.

## Непрерывные сигналы

| Module | Период | Итог |
| --- | --- | --- |
| gaze | каждый новый face frame | raw/corrected/display, confidence, OOD, head |
| blinks | каждый новый face frame | count, duration, amplitude, opening speed |
| PERCLOS | вся сессия | rolling windows 30s/60s |
| emotion | около 5 Hz | valence/arousal/confidence summary |
| body pose | около 5 Hz | torso movement, bursts, lean, confidence |
| BPM/respiration | непрерывный rPPG | run и session summaries |
| RT | input events в trial | typed input events и protocol RT features |

Сырые video frames не включаются в payload.

## Интеграция нового теста

Перед показом инструкции:

```js
runtime.enterInstruction({ blockId, blockType });
```

Перед первым стимулом:

```js
const attempt = runtime.beginBlock({ blockId, blockType });
```

После последнего стимула:

```js
const decision = runtime.completeBlock({ success: true });
if (decision.repeatRequired) {
  await runtime.promptRepeat(blockId);
  // Запустить тот же блок заново. attempt увеличится автоматически.
}
```

Не создавайте второй `analyzeFrame` loop, если
`runtime.isAnalysisRunning()` возвращает `true`.

## Локальный запуск

```bash
# API
cd apps/api
cp .env.example .env
npm ci
npm run migrate:up
npm start

# статика, из корня репозитория
python3 -m http.server 8080
```

Участник:

```text
http://localhost:8080/apps/participant-web/run_new.html?code=<КОД>
```

Прямой локальный экран для UI/smoke-проверки:

```text
http://localhost:8080/apps/participant-web/mvp_with_precheck_1-updated.html
```

Production-доступ без приглашения не разрешён; bypass действует только на
`localhost` и `127.0.0.1`.

MediaPipe runtime, WASM и модели Face/Pose размещены на application origin.
CDN fallback в каноническом participant flow отсутствует.
Participant entry pages задают `Referrer-Policy: no-referrer`, поскольку код
приглашения является bearer credential и находится в URL.

## Тесты

```bash
cd apps/api
npm test

cd ../autotests
npm ci
npx playwright install chromium
npx playwright test tests/smoke.spec.ts tests/session-runtime.spec.ts
```

Unit/contract-набор проверяет повторный finish, конфликт ключей, восстановление
после reload, потерю сети, ошибки модулей, debounce качества и JSON Schema.
Playwright проверяет запрет паузы во время испытания, повтор невалидного блока,
reload/offline/module failures, непрерывные blink dynamics/PERCLOS и emotion,
остановку камеры, повтор финальной отправки и стабильный `Idempotency-Key`.

## Незакрытые production gates

- gaze thresholds требуют baseline-versus-new benchmark минимум на пяти
  участниках и нескольких типах камер/освещения;
- полный role x operation x own/foreign tenant workflow должен пройти как
  HTTP E2E на staging, а не только через permission/unit tests;
- многочасовые сессии требуют browser memory/IndexedDB quota stress-теста:
  chunked checkpoint исключает повторное копирование, но активные raw arrays
  и восстановление после reload по-прежнему занимают память;
- multi-instance API требует распределённого rate limiter;
- admission атомарно резервирует run после согласия и до испытания; требуется
  утвердить retention/monitoring abandoned session. Автоматическое освобождение
  отключено, чтобы reload и запоздалый ingest не создавали oversubscription;
- staff web должен перейти с bearer JWT в `localStorage` на защищённую
  HttpOnly/SameSite session;
- обязательны CI, review ответственного, staging smoke и формальная приёмка.
