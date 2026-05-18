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

/**
 * Нормированный bbox: координаты и размеры в % от canvas (0..100).
 * Сравним между сессиями с разными разрешениями экрана.
 */
function getBoundingBoxNorm(points, canvasW, canvasH) {
    if (!(canvasW > 0) || !(canvasH > 0)) {
        return { leftPct: 0, topPct: 0, rightPct: 0, bottomPct: 0, widthPct: 0, heightPct: 0 };
    }
    const bb = getBoundingBox(points);
    if (bb.minX === null) {
        return { leftPct: 0, topPct: 0, rightPct: 0, bottomPct: 0, widthPct: 0, heightPct: 0 };
    }
    return {
        leftPct: round((bb.minX / canvasW) * 100, 2) || 0,
        topPct: round((bb.minY / canvasH) * 100, 2) || 0,
        rightPct: round((bb.maxX / canvasW) * 100, 2) || 0,
        bottomPct: round((bb.maxY / canvasH) * 100, 2) || 0,
        widthPct: round((bb.width / canvasW) * 100, 2) || 0,
        heightPct: round((bb.height / canvasH) * 100, 2) || 0
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

/**
 * Вычисляет метрики visuospatial drawing.
 *
 * Изменения после fullscreen + pen-down редизайна:
 *  - `pathLengthPx` теперь учитывает только сегменты между двумя соседними
 *    pen-down точками (если флаг penDown отсутствует во входе — поведение
 *    как раньше, считаем все сегменты, для совместимости).
 *  - Добавлены нормированные поля: `pathLengthDiagPct`, `boundingBoxNorm`.
 *    На разных разрешениях экрана они сравнимы между собой.
 *  - `idlePct` дополнительно считается через нормированный порог скорости
 *    (`config.idleSpeedThresholdNormPerSec`, % диагонали в секунду).
 *    Старый пиксельный `idlePct` оставлен как `idlePctLegacy` для обратной
 *    совместимости.
 *  - Добавлен `penDownPct` — % точек с зажатым пробелом.
 */
export function computeVisuospatialMetrics(points, config, canvasSize) {
    const sorted = (points || [])
        .filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.t))
        .sort((a, b) => a.t - b.t);

    const canvasW = (canvasSize && canvasSize.width) > 0 ? canvasSize.width : 0;
    const canvasH = (canvasSize && canvasSize.height) > 0 ? canvasSize.height : 0;
    const diagonalPx = Math.hypot(canvasW, canvasH);

    if (sorted.length === 0) {
        return {
            pointCount: 0,
            pathLengthPx: 0,
            pathLengthDiagPct: 0,
            drawingDurationMs: 0,
            coveragePct: 0,
            boundingBox: getBoundingBox([]),
            boundingBoxNorm: getBoundingBoxNorm([], canvasW, canvasH),
            idlePct: 0,
            idlePctLegacy: 0,
            onScreenPct: 0,
            penDownPct: 0
        };
    }

    // Если ни в одной точке нет penDown-флага — считаем все сегменты (legacy режим).
    const hasPenDownFlag = sorted.some(p => typeof p.penDown === 'boolean');

    let pathLength = 0;
    let idleMsLegacy = 0;
    let idleMs = 0;
    let activeMs = 0;
    let penDownCount = 0;

    const idleThreshNormPerSec = Number.isFinite(config?.idleSpeedThresholdNormPerSec)
        ? config.idleSpeedThresholdNormPerSec
        : 0.05;
    const idleThreshDiagPerMs = idleThreshNormPerSec / 1000; // доля диагонали за 1 ms

    for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        let dt = curr.t - prev.t;
        if (!Number.isFinite(dt) || dt <= 0) continue;
        if (dt > 250) dt = 250;

        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        const distance = Math.hypot(dx, dy);

        // pathLength считаем только по непрерывным pen-down сегментам.
        // Если флаг отсутствует — учитываем всё (legacy).
        const segmentDrawing = !hasPenDownFlag || (prev.penDown === true && curr.penDown === true);
        if (segmentDrawing) pathLength += distance;

        // Скорость для idle-метрик считается всегда (по всем сегментам).
        const speedPxPerSec = distance / (dt / 1000);
        if (speedPxPerSec < (config?.idleSpeedThresholdPxPerSec ?? 40)) {
            idleMsLegacy += dt;
        }
        if (diagonalPx > 0) {
            const speedDiagPerMs = (distance / diagonalPx) / dt;
            if (speedDiagPerMs < idleThreshDiagPerMs) {
                idleMs += dt;
            }
        } else {
            idleMs += dt; // нет диагонали — считаем всё idle (защита от деления на ноль)
        }
        activeMs += dt;
    }

    for (const p of sorted) {
        if (p.penDown === true) penDownCount++;
    }

    const drawingDurationMs = Math.max(0, sorted[sorted.length - 1].t - sorted[0].t);
    const onScreenCount = sorted.filter(point => point.onScreen !== false).length;
    const onScreenPct = sorted.length > 0 ? (onScreenCount / sorted.length) * 100 : 0;
    const penDownPct = sorted.length > 0 ? (penDownCount / sorted.length) * 100 : 0;

    const coveragePct = computeCoverage(
        sorted,
        canvasW,
        canvasH,
        config?.coverageGridWidth ?? 40,
        config?.coverageGridHeight ?? 30
    );

    const pathLengthDiagPct = diagonalPx > 0 ? (pathLength / diagonalPx) * 100 : 0;

    return {
        pointCount: sorted.length,
        pathLengthPx: round(pathLength, 1) || 0,
        pathLengthDiagPct: round(pathLengthDiagPct, 2) || 0,
        drawingDurationMs: round(drawingDurationMs, 1) || 0,
        coveragePct: round(coveragePct, 2) || 0,
        boundingBox: getBoundingBox(sorted),
        boundingBoxNorm: getBoundingBoxNorm(sorted, canvasW, canvasH),
        idlePct: activeMs > 0 ? round((idleMs / activeMs) * 100, 2) : 0,
        idlePctLegacy: activeMs > 0 ? round((idleMsLegacy / activeMs) * 100, 2) : 0,
        onScreenPct: round(onScreenPct, 2) || 0,
        penDownPct: round(penDownPct, 2) || 0
    };
}
