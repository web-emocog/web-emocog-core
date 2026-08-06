/**
 * Browser loader for the single canonical GazeTracker implementation.
 * There is intentionally no inline predictor fallback: two implementations
 * previously produced different smoothing and calibration semantics.
 */
(function loadCanonicalGazeTracker() {
    const loading = import('./gaze-tracker/index.js')
        .then(module => {
            window.GazeTracker = module.GazeTracker || module.default;
            return 'module';
        })
        .catch(error => {
            console.error('[GazeTracker] Canonical module failed to load:', error);
            window.GazeTracker = class UnavailableGazeTracker {
                constructor() {
                    throw new Error('GazeTracker module is unavailable');
                }
            };
            return 'unavailable';
        });
    window.GazeTrackerReady = loading;
})();
