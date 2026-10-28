# Participant web-page modules

## Official entrypoint

**`mvp_with_precheck_1-updated.html`** — единственный поддерживаемый entrypoint:

- `js/web-page/app-updated.js`
- `js/web-page/tests-updated.js`
- `js/web-page/precheck-updated.js`
- `js/web-page/ui-updated.js`
- `js/session-runtime/continuous-bpm.js` (фоновый rPPG, без отдельного теста)
- `js/gaze-tracker/gaze-tests/*` (Test Hub)

`mvp_with_precheck_1.html` — **deprecated** (автоматический redirect на `-updated`).

`run_new.html` и `invite.html` уже ведут на `-updated`.

## Debug mode

Разрешён только в явно диагностической сборке с
`window.WECOG_ALLOW_DEBUG === true`. В обычной сборке один URL-флаг не включает
сбор данных. Дополнительно требуется opt-in:

- URL: `?debug=1`
- или `localStorage.setItem('wecog_debug', '1')`

Компоненты:

- `debug-runtime.js` — structured ring buffer, timelines, gaze/BPM diagnostics, `downloadDebugBundle()`
- `debug-hud.js` — realtime HUD + кнопка «Download debug bundle»

Bundle сохраняет schema `wecog-debug-bundle-v1`, с новым маркером
`privacyVersion: technical_only.v2`. Экспортируются ограниченные технические
счётчики/метрики и типы событий. Ответы анкет, Error message/stack, токены,
идентификаторы и raw arrays исключаются; URLs/пути очищаются. Произвольный
свободный текст нельзя считать гарантированно анонимным: перед передачей bundle
нужна ручная проверка. Формат не предназначен для экспорта научных результатов.

Клавиши записываются только в фазах RT/рисования как `physicalCode`, без
текстового `key`. Поля ввода, contenteditable, shadow inputs, IME и Ctrl/Meta/Alt
исключены. Не все редкие клавиши входят в технический whitelist; это **не**
ограничение настоящих response bindings. Горячая клавиша HUD не перехватывает
измерительные нажатия. Неизвестные/retargeted component hosts пропускаются:
closed shadow inputs нельзя надёжно проверить через `activeElement`.
Polling снимка HUD ограничен 5 Hz, QC timeline до 2 Hz;
это не частота вычисления сигналов. Виджет не изменяет научные пороги/модели.

`WECOG_DEBUG.clear()` очищает ring, timelines и диагностические снимки, но не
ответы/данные сессии. `WECOG_DEBUG_HUD.stop()` снимает RAF и клавиатурные/focus
обработчики; `dispose()` также снимает lifecycle handlers. Повторная загрузка
скриптов заменяет предыдущие экземпляры. Pagehide останавливает HUD, pageshow
может возобновить его при сохранённом opt-in. При ошибке collector выключается
только HUD с технической отметкой, основной session runtime продолжает работу.

Регрессионные проверки (synthetic, без камеры/микрофона):

```bash
cd apps/api
node --test tests/debug-runtime-privacy.test.js tests/protocol-runner-security.test.js
cd ../autotests
npx playwright test --config=playwright.workers.config.ts tests/diagnostics-lifecycle.spec.ts
```

## Smoke checklist (после stabilization pass)

1. Открыть только `mvp_with_precheck_1-updated.html` (legacy редиректит).
2. Validation: affine / LOOCV / post-calibration — в HUD и debug bundle.
3. Tracking: QC overlay не залипает (current-frame gate + debounce hide).
4. BPM/rPPG работает только как фоновый сигнал всей сессии и не отображается отдельным тестом.
5. Visuospatial: gaze dot, линии при Space, canvas не 0×0.
6. Нет `module load failed` / canvas 0×0 в HUD.
7. Debug bundle скачивается.
8. HUD показывает realtime diagnostics.
