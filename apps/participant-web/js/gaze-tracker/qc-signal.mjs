// QC input is independent of whether a display point can be drawn. In
// particular, a finite accepted off-screen prediction is not missing data.
export const QC_GAZE_SIGNAL_METHOD = 'corrected_validity.v1';

export function qcGazeSignal(gaze, viewport) {
    if (gaze?.valid !== true
        || !Number.isFinite(gaze.correctedX) || !Number.isFinite(gaze.correctedY)
        || !Number.isFinite(viewport?.width) || viewport.width <= 0
        || !Number.isFinite(viewport?.height) || viewport.height <= 0) return null;
    const x = gaze.correctedX, y = gaze.correctedY;
    return { x, y, onScreen: gaze.onScreen !== false
        && x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height };
}
