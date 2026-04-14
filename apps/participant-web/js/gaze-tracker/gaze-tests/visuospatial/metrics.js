function round(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const k = 10 ** digits;
    return Math.round(value * k) / k;
}

function getBoundingBox(points) {
    if (!Array.isArray(points) || points.length === 0) {
        return {
            minX: null,
            minY: null,
            maxX: null,
            maxY: null,
            width: 0,
            height: 0
        };
    }

    const xs = points.map(p => p.x).filter(Number.isFinite);
    const ys = points.map(p => p.y).filter(Number.isFinite);
    if (xs.length === 0 || ys.length === 0) {
        return {
            minX: null,
            minY: null,
            maxX: null,
            maxY: null,
            width: 0,
            height: 0
        };
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    return {
        minX: round(minX, 1),
        minY: round(minY, 1),
        maxX: round(maxX, 1),
        maxY: round(maxY, 1),
        width: round(Math.max(0, maxX - minX), 1) || 0,
        height: round(Math.max(0, maxY - minY), 1) || 0
    };
}

function computeCoverage(points, width, height, gridW, gridH) {
    if (width <= 0 || height <= 0 || !Array.isArray(points) || points.length === 0) return 0;

    const occupied = new Set();
    for (const point of points) {
        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
        const nx = Math.max(0, Math.min(1, point.x / width));
        const ny = Math.max(0, Math.min(1, point.y / height));
        const xIdx = Math.min(gridW - 1, Math.max(0, Math.floor(nx * gridW)));
        const yIdx = Math.min(gridH - 1, Math.max(0, Math.floor(ny * gridH)));
        occupied.add(`${xIdx}:${yIdx}`);
    }

    const total = gridW * gridH;
    if (total <= 0) return 0;
    return (occupied.size / total) * 100;
}

export function computeVisuospatialMetrics(points, config, canvasSize) {
    const sorted = (points || [])
        .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.t))
        .sort((a, b) => a.t - b.t);

    if (sorted.length === 0) {
        return {
            pointCount: 0,
            pathLengthPx: 0,
            drawingDurationMs: 0,
            coveragePct: 0,
            boundingBox: getBoundingBox([]),
            idlePct: 0,
            onScreenPct: 0
        };
    }

    let pathLength = 0;
    let idleMs = 0;
    let activeMs = 0;

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        let dt = curr.t - prev.t;
        if (!Number.isFinite(dt) || dt <= 0) continue;
        if (dt > 250) dt = 250;

        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const distance = Math.hypot(dx, dy);
        pathLength += distance;

        const speed = distance / (dt / 1000);
        if (speed < config.idleSpeedThresholdPxPerSec) {
            idleMs += dt;
        }
        activeMs += dt;
    }

    const drawingDurationMs = Math.max(0, sorted[sorted.length - 1].t - sorted[0].t);
    const onScreenCount = sorted.filter(point => point.onScreen !== false).length;
    const onScreenPct = sorted.length > 0 ? (onScreenCount / sorted.length) * 100 : 0;

    const coveragePct = computeCoverage(
        sorted,
        canvasSize.width,
        canvasSize.height,
        config.coverageGridWidth,
        config.coverageGridHeight
    );

    return {
        pointCount: sorted.length,
        pathLengthPx: round(pathLength, 1) || 0,
        drawingDurationMs: round(drawingDurationMs, 1) || 0,
        coveragePct: round(coveragePct, 2) || 0,
        boundingBox: getBoundingBox(sorted),
        idlePct: activeMs > 0 ? round((idleMs / activeMs) * 100, 2) : 0,
        onScreenPct: round(onScreenPct, 2) || 0
    };
}
