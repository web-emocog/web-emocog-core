// Pixel buffers are transient and must never enter a checkpoint or ingest JSON.
const pixels = new WeakMap();

export function rememberFramePixels(frame, imageData) {
    if (frame && imageData) pixels.set(frame, imageData);
    return frame;
}

export function getFramePixels(frame) {
    return frame && pixels.get(frame);
}

export function createAnalysisCanvas() {
    return typeof document !== 'undefined'
        ? document.createElement('canvas')
        : new OffscreenCanvas(1, 1);
}
