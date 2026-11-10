/**
 * Browser loader for the single canonical GazeTracker implementation.
 * There is intentionally no inline predictor fallback: two implementations
 * previously produced different smoothing and calibration semantics.
 */
(function loadCanonicalGazeTracker() {
    const loading = import('./gaze-tracker/index.js?v=20261109-issues2')
        .then(module => {
            const Tracker = module.GazeTracker || module.default;
            if (typeof Tracker !== 'function') throw new Error('gaze_export_missing');
            window.GazeTracker = Tracker;
            return 'module';
        })
        .catch(() => {
            void import('./session-runtime/participant-diagnostic.mjs?v=20261109-issues2').then(
                diagnostic => diagnostic.participantDebugError('gaze', 'module:unavailable'),
                () => { /* Diagnostics are optional. */ }
            );
            window.GazeTracker = class UnavailableGazeTracker {
                constructor() {
                    throw new Error('GazeTracker module is unavailable');
                }
            };
            return 'unavailable';
        });
    window.GazeTrackerReady = loading;
})();
