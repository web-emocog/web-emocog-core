// RGBA readback fixes Firefox/Mac workers. Simultaneous face/pose/segment GPU
// tasks still regress Chromium/Mac on the loaded replay, so keep its measured
// CPU path. The model, strides and QC thresholds remain identical.
export function segmentationDelegate(scope = globalThis) {
    const ua = String(scope.navigator?.userAgent || '');
    return typeof scope.document === 'undefined' && ua.includes('Mac') && /Chrome|Chromium|Edg\//.test(ua)
        ? 'CPU' : 'GPU';
}
