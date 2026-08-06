# Sprint 1: session signals, gaze и authorization

Дата отчета: 2026-07-25.

## Результат

Реализован единый session runtime с непрерывным browser-side сбором gaze,
blinks/PERCLOS, emotions, body pose, RT и BPM. Participant upload переведен на
один typed transport к `/ingest`. Серверная авторизация сведена в один модуль
с operation matrix, project membership и server-issued participant token.

## Соответствие задачам

| Задача | Реализация | Статус к code review |
| --- | --- | --- |
| 1. Emotions всей сессии | Emotion sampling около 5 Hz в central frame pipeline, online accumulator и final summary | Код и synthetic E2E готовы; real-camera validation не проведена |
| 2. #32, #33, #34, typed `/ingest` | `session_feature.v1`, schema endpoint, один browser transport, legacy route не смонтирован | Код готов; issues не закрыты без GitHub/PR/CI |
| 3. Adaptive smoothing semantics | `raw -> corrected -> display`, скорость по corrected inputs, display без feedback | Код и unit tests готовы |
| 4. Content viewport | DOM target rect + `visualViewport`; browser chrome не вычитается, resize масштабируется | Код и unit tests готовы |
| 5. Head pose/OOD | Iris-only target-blind predictor, отдельные head features и distributions, confidence/OOD gate | Код готов; thresholds требуют real-device benchmark |
| 6. Validation | Correction set, LOOCV selection, независимый benchmark, baseline-versus-new | Структура готова; benchmark на участниках не проведён |
| 7. Blinks/PERCLOS | Count, duration, amplitude, opening speed, incomplete proxy, 30s/60s windows всей сессии | Synthetic E2E готов; hardware validation не проведена |
| 8. Поза и корпус | MediaPipe Pose Landmarker Lite, torso movement/lean/bursts/confidence | Код готов; device/performance matrix не проведена |
| 9. #30, #36, permissions | Единый `security/permissions.js`, маршруты переведены на operations и membership | Код готов; issues и route-level E2E остаются |
| 10. Ingest token | JWT 15 min, bound to session + invitation + protocol + project; mismatch 409 | Код и PostgreSQL integration готовы |
| 11. Tenant membership | `user_projects`, organization + project checks, platform-wide только admin | Helper/route code готов; полный HTTP tenant E2E остаётся |
| 12. Матрица и developer workflow | Role matrix, own/foreign rules, developer project-to-export workflow | Документ и unit matrix готовы; staging workflow остаётся |

## Внесенные правки

### Participant runtime

- Удален второй автономный gaze tracking loop из канонического пути.
- Один `SessionFramePipeline` анализирует каждый новый video frame.
- Emotions и body pose работают фоново с ограниченной частотой.
- Blink/EAR samples собираются на протяжении измерительной сессии.
- `attentionMetrics.global` охватывает все измеренные фазы с precheck, а
  отдельный `postCalibration` сохраняет выборку от `tracking_test`.
- Итоговый экран всегда получает blink, PERCLOS и emotion aggregates.
- Camera tracks и `video.srcObject` освобождаются перед финальной выгрузкой.
- Промежуточный автоматический download отсутствует.

### Gaze

- Predictor обучается только по iris features.
- Head rotation, translation и scale вынесены из predictor.
- Сохраняются raw, corrected и display signals.
- Heatmap и research analytics используют corrected signal.
- Overlay и gaze brush используют display signal.
- OOD/rejected кадры дают `display=null`.
- Calibration target вычисляется по реальному DOM rect в content viewport.
- Affine correction применяется только после held-out LOOCV gain.
- Финальный benchmark не участвует в fitting или выборе correction.

### API и security

- Канонические permissions и membership checks находятся в одном модуле.
- Добавлена таблица `user_projects`.
- Developer может создать/обновить проект только внутри собственной
  организации; удаление проекта запрещено.
- Legacy developer grant не повышает пользователя без одновременного
  organization + project membership.
- Staff session обязана иметь project scope.
- Participant получает короткоживущий ingest token по приглашению.
- `/ingest` проверяет session/invitation/protocol/project tuple.
- Повторный finish с тем же idempotency key возвращает существующий результат.

## Технические включения

- JSON Schema и TypeScript declarations для `SessionFeature`,
  `SessionEvent` и lifecycle.
- `GET /contracts` и schema endpoints.
- `velocity_adaptive_ema`.
- Iris/head calibration distributions и OOD metrics.
- MediaPipe Pose Landmarker Lite.
- PostgreSQL migration `1699000000011_project_membership`.
- PostgreSQL migrations `1699000000012_atomic_ingest_security` и
  `1699000000013_staff_token_version`.
- API unit/contract tests и Playwright session tests.
- Server-generated 128-bit invitation codes и 15-minute ingest tokens.
- Chunked/serialized IndexedDB checkpoint writes, gaze/EAR restoration и
  reload recovery.

## Решения спорных вопросов

### Browser chrome

Панель вкладок и адресная строка не входят в координаты DOM. Ручное вычитание
их высоты создало бы вертикальную ошибку. Используются `getBoundingClientRect`
и `visualViewport`.

### Head movement

Поза головы полезна для confidence/OOD, но ее включение в малую
персонализированную ridge-модель усиливало смещение точки при естественном
движении. Поэтому target prediction является iris-only, а head channel только
оценивает применимость калибровки.

### Smoothing

Corrected signal не изменяется фильтром и остается исследовательским сигналом.
Display filter используется только для визуальной обратной связи. Это
исключает повторную обработку сглаженного маршрута.

### Body pose

Body movement сохраняется как research-only поведенческий признак. Ошибка Pose
Landmarker не бракует выполняемый тест, потому что модуль пока не является
обязательным QC gate.

### Clinical interpretation

PERCLOS, emotion, webcam gaze и posture не используются как диагноз. В
результатах должны сохраняться качество, confidence и missingness.

## Миграция и запуск

```bash
cd apps/api
cp .env.example .env
npm ci
npm run migrate:up
npm test
npm start

cd ../../
python3 -m http.server 8080
```

В `.env` необходимо задать:

```text
DATABASE_URL=postgres://...
JWT_SECRET=<long-random-secret>
INGEST_TOKEN_EXPIRES_IN=15m
```

Participant URL:

```text
http://localhost:8080/apps/participant-web/run_new.html?code=<CODE>
```

Browser tests:

```bash
cd apps/autotests
npm ci
npx playwright install chromium
npx playwright test tests/session-runtime.spec.ts
```

## Deployment notes

1. Применить migration до выкладки API.
2. Проверить, что существующим staff назначены корректные `user_projects`.
3. Создавать platform-admin только операционной командой
   `npm run admin:bootstrap`; HTTP email-bypass отсутствует.
4. Обновить API и participant static в одном release, поскольку старый
   participant не получает ingest token.
5. Проверить CSP для уже self-hosted MediaPipe runtime/WASM/models; CDN
   fallback в canonical participant flow отсутствует.
6. После staging smoke test включить production traffic.

## Критерии приемки

1. Работа принята ответственным по задаче.
2. Калибровка и benchmark используют content viewport coordinates.
3. Независимый benchmark не входит в correction fit.
4. Raw, corrected и display signals различимы в export.
5. Выход iris/head за calibration distribution не рисует ложную точку.
6. Blink count/dynamics, PERCLOS, emotion и body pose охватывают всю
   измерительную сессию.
7. Повторный finish не создает вторую запись.
8. Participant token mismatch возвращает `409`.
9. Foreign-tenant staff не может читать или изменять project data.
10. Camera tracks остановлены на финальном экране.
11. API unit/contract и Playwright session tests проходят.
12. GitHub Issues закрываются только после review, CI и сопоставления с их
    фактическими acceptance criteria.
13. Работа принята тимлидом/техлидом.

Кодовые пункты не означают формальную приёмку. На дату отчёта GitHub issues,
PR/CI, hardware gaze benchmark, полный HTTP tenant workflow и подписи пунктов
1/13 не выполнены.
