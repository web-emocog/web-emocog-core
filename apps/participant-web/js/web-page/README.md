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

Включение:

- URL: `?debug=1`
- или `localStorage.setItem('wecog_debug', '1')`

Компоненты:

- `debug-runtime.js` — structured ring buffer, timelines, gaze/BPM diagnostics, `downloadDebugBundle()`
- `debug-hud.js` — realtime HUD + кнопка «Download debug bundle»

## Smoke checklist (после stabilization pass)

1. Открыть только `mvp_with_precheck_1-updated.html` (legacy редиректит).
2. Validation: affine / LOOCV / post-calibration — в HUD и debug bundle.
3. Tracking: QC overlay не залипает (current-frame gate + debounce hide).
4. BPM/rPPG работает только как фоновый сигнал всей сессии и не отображается отдельным тестом.
5. Visuospatial: gaze dot, линии при Space, canvas не 0×0.
6. Нет `module load failed` / canvas 0×0 в HUD.
7. Debug bundle скачивается.
8. HUD показывает realtime diagnostics.
