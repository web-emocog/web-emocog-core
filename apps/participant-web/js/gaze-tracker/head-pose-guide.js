const IDEAL_REFERENCE = Object.freeze({
    centerX: 0.5,
    centerY: 0.5,
    width: 0.36,
    height: 0.54,
    yaw: 0,
    pitch: 0,
    roll: 0
});

const FIXED_GUIDE_MODES = new Set(['calibration', 'instruction', 'paused', 'locked']);
const POSE_KEYS = ['centerX', 'centerY', 'width', 'height', 'yaw', 'pitch', 'roll'];

let referencePose = null;
let lastPose = null;
let guideMode = 'hidden';

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function normalizeFrame(frame) {
    const bbox = frame?.face?.bbox;
    if (!frame?.face?.detected || !bbox) return null;
    const width = finite(bbox.width, 0);
    const height = finite(bbox.height, 0);
    if (!(width > 0) || !(height > 0)) return null;
    return {
        // The participant preview is mirrored, so the overlay must be mirrored too.
        centerX: 1 - finite(bbox.x, 0) - width / 2,
        centerY: finite(bbox.y, 0) + height / 2,
        width,
        height,
        yaw: finite(frame?.pose?.yaw),
        pitch: finite(frame?.pose?.pitch),
        roll: finite(frame?.pose?.roll)
    };
}

function smoothPose(current) {
    if (!current) return null;
    if (!lastPose) return { ...current };
    const next = {};
    for (const key of POSE_KEYS) {
        const alpha = ['yaw', 'pitch', 'roll'].includes(key) ? 0.34 : 0.24;
        next[key] = lastPose[key] + alpha * (current[key] - lastPose[key]);
    }
    return next;
}

function deviation(current, reference) {
    if (!current) return { status: 'missing', score: Infinity };
    const scaleDelta = Math.abs(current.height / Math.max(reference.height, 0.01) - 1);
    const centerDelta = Math.hypot(
        current.centerX - reference.centerX,
        current.centerY - reference.centerY
    );
    const angleDelta = Math.max(
        Math.abs(current.yaw - reference.yaw) / 18,
        Math.abs(current.pitch - reference.pitch) / 18,
        Math.abs(current.roll - reference.roll) / 14
    );
    const score = Math.max(centerDelta / 0.10, scaleDelta / 0.22, angleDelta);
    return { status: score <= 1 ? 'aligned' : (score <= 1.55 ? 'near' : 'away'), score };
}

function prepareCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || canvas.width || 160));
    const cssHeight = Math.max(1, Math.round(rect.height || canvas.height || 112));
    const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    const targetWidth = Math.round(cssWidth * pixelRatio);
    const targetHeight = Math.round(cssHeight * pixelRatio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    return { ctx, width: cssWidth, height: cssHeight };
}

function drawContour(ctx, pose, width, height, options) {
    const cx = pose.centerX * width;
    const cy = pose.centerY * height;
    const rx = Math.max(14, pose.width * width * 0.5);
    const ry = Math.max(20, pose.height * height * 0.5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((-pose.roll * Math.PI) / 180);
    ctx.strokeStyle = options.color;
    ctx.lineWidth = options.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(options.dashed ? [6, 6] : []);

    // A restrained head silhouette communicates translation, scale and roll.
    ctx.beginPath();
    ctx.moveTo(-rx * 0.55, -ry * 0.92);
    ctx.bezierCurveTo(-rx, -ry * 0.64, -rx, ry * 0.48, -rx * 0.46, ry * 0.9);
    ctx.bezierCurveTo(-rx * 0.16, ry * 1.05, rx * 0.16, ry * 1.05, rx * 0.46, ry * 0.9);
    ctx.bezierCurveTo(rx, ry * 0.48, rx, -ry * 0.64, rx * 0.55, -ry * 0.92);
    ctx.bezierCurveTo(rx * 0.2, -ry * 1.04, -rx * 0.2, -ry * 1.04, -rx * 0.55, -ry * 0.92);
    ctx.stroke();
    ctx.restore();
}

function statusColor(current, reference) {
    const currentDeviation = deviation(current, reference);
    if (currentDeviation.status === 'aligned') return '#22d3ee';
    if (currentDeviation.status === 'near') return '#f59e0b';
    return '#ef4444';
}

function drawFixedGuide(canvas, current) {
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const reference = referencePose || IDEAL_REFERENCE;
    drawContour(ctx, reference, width, height, {
        color: 'rgba(74, 222, 128, 0.78)',
        lineWidth: 1.5,
        dashed: true
    });
    if (current) {
        drawContour(ctx, current, width, height, {
            color: statusColor(current, reference),
            lineWidth: 2.25,
            dashed: false
        });
    }
}

function drawPrecheckOverlay(canvas, current) {
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;
    const { ctx, width, height } = prepared;
    const reference = referencePose || IDEAL_REFERENCE;
    drawContour(ctx, reference, width, height, {
        color: 'rgba(74, 222, 128, 0.72)',
        lineWidth: 2,
        dashed: true
    });
    if (current) {
        drawContour(ctx, current, width, height, {
            color: statusColor(current, reference),
            lineWidth: 3,
            dashed: false
        });
    }
}

function clearPrecheckOverlay() {
    const canvas = document.getElementById('overlayCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

function ensureCalibrationGuide() {
    let root = document.getElementById('calibrationHeadPoseGuide');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'calibrationHeadPoseGuide';
    root.className = 'calibration-head-pose-guide';
    root.dataset.corner = 'bottom-right';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<canvas id="calibrationHeadPoseCanvas"></canvas>';
    document.body.appendChild(root);
    return root;
}

function renderCurrentMode() {
    const root = ensureCalibrationGuide();
    const fixedVisible = FIXED_GUIDE_MODES.has(guideMode) && Boolean(referencePose);
    root.classList.toggle('active', fixedVisible);
    if (fixedVisible) {
        drawFixedGuide(document.getElementById('calibrationHeadPoseCanvas'), lastPose);
    }
    if (guideMode === 'precheck') {
        drawPrecheckOverlay(document.getElementById('overlayCanvas'), lastPose);
    } else {
        clearPrecheckOverlay();
    }
}

export function updateHeadPoseGuide(frame) {
    const normalized = normalizeFrame(frame);
    lastPose = normalized ? smoothPose(normalized) : null;
    renderCurrentMode();
    return getHeadPoseGuideSnapshot();
}

export function captureHeadPoseReference(frame) {
    const normalized = normalizeFrame(frame);
    if (!normalized) return null;
    referencePose = { ...normalized };
    lastPose = { ...normalized };
    renderCurrentMode();
    return { ...referencePose };
}

export function resetHeadPoseReference() {
    referencePose = null;
    lastPose = null;
    guideMode = 'hidden';
    clearPrecheckOverlay();
    document.getElementById('calibrationHeadPoseGuide')?.classList.remove('active');
}

export function setHeadPoseGuideMode(mode = 'hidden') {
    guideMode = String(mode || 'hidden');
    renderCurrentMode();
}

// Backward-compatible calibration API used by the current page shell and tests.
export function showCalibrationHeadPoseGuide(visible = true) {
    setHeadPoseGuideMode(visible ? 'calibration' : 'hidden');
}

export function setCalibrationGuideTarget(xPercent, yPercent) {
    const root = ensureCalibrationGuide();
    const horizontal = Number(xPercent) < 50 ? 'right' : 'left';
    const vertical = Number(yPercent) < 50 ? 'bottom' : 'top';
    root.dataset.corner = `${vertical}-${horizontal}`;
}

export function getHeadPoseGuideSnapshot() {
    return {
        mode: guideMode,
        reference: referencePose ? { ...referencePose } : null,
        current: lastPose ? { ...lastPose } : null,
        deviation: deviation(lastPose, referencePose || IDEAL_REFERENCE)
    };
}
