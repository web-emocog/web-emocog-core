// Ordered contour from the pinned FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.
export const FACE_OVAL_INDICES = Object.freeze([10,338,297,332,284,251,389,356,454,323,361,288,
    397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109]);
export const FACE_VISIBILITY_METHOD = 'face_oval_regions.v1';

const supports = new WeakMap();
export const rememberFaceSupport = (analysis, support) => supports.set(analysis, support);
export const getFaceSupport = analysis => supports.get(analysis);

export function createFaceSupport(landmarks, width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || !Array.isArray(landmarks) || landmarks.length < 468) return null;
    const points = FACE_OVAL_INDICES.map(id => landmarks[id]);
    if (points.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) return null;
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        area += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(area) < 1e-6) return null;
    const left = Math.max(0, Math.min(1, Math.min(...points.map(p => p.x))));
    const right = Math.max(0, Math.min(1, Math.max(...points.map(p => p.x))));
    const top = Math.max(0, Math.min(1, Math.min(...points.map(p => p.y))));
    const bottom = Math.max(0, Math.min(1, Math.max(...points.map(p => p.y))));
    if (right <= left || bottom <= top) return null;
    // Scan once per mask row, not once per pixel/region; pixel centres share one support.
    const rows = new Map();
    for (let y = Math.max(0, Math.ceil(top * height - .5)); y < Math.min(height, Math.ceil(bottom * height - .5)); y++) {
        const sy = (y + .5) / height, crossings = [];
        for (let i = 0; i < points.length; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            if ((a.y > sy) !== (b.y > sy)) crossings.push((a.x + (sy - a.y) * (b.x - a.x) / (b.y - a.y)) * width);
        }
        crossings.sort((a, b) => a - b);
        const spans = [];
        for (let i = 0; i + 1 < crossings.length; i += 2) {
            const start = Math.max(0, Math.ceil(crossings[i] - .5));
            const end = Math.min(width, Math.ceil(crossings[i + 1] - .5));
            if (end > start) spans.push([start, end]);
        }
        if (spans.length) rows.set(y, spans);
    }
    if (!rows.size) return null;
    return { rows, inFrame: points.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1),
        bounds: { x: left, y: top, width: right - left, height: bottom - top } };
}

export function isFacePixel(support, x, y) {
    const spans = support?.rows.get(y);
    if (spans) for (const [start, end] of spans) if (x >= start && x < end) return true;
    return false;
}
