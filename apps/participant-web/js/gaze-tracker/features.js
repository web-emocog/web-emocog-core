import { LANDMARKS, MIN_LANDMARKS } from './constants.js?v=20261106-143';

function dist2d(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function meanPoint(landmarks, indices) {
    const points = indices.map(index => landmarks[index]);
    if (!points.every(hasFiniteCoordinates)) return null;
    return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    };
}

function hasFiniteCoordinates(point) {
    return point
        && Number.isFinite(point.x)
        && Number.isFinite(point.y);
}

function eyeLocalCoordinates(iris, inner, outer, top, bottom, cornerAnchored) {
    const width = dist2d(inner, outer);
    const height = dist2d(top, bottom);
    if (Math.min(width, height) < 1e-6) return null;

    const horizontalCenter = midpoint(inner, outer);
    const verticalCenter = cornerAnchored ? horizontalCenter : midpoint(top, bottom);
    let horizontalX = (outer.x - inner.x) / width;
    let horizontalY = (outer.y - inner.y) / width;
    if (horizontalX < 0) {
        horizontalX *= -1;
        horizontalY *= -1;
    }
    let verticalX = -horizontalY;
    let verticalY = horizontalX;
    if (verticalY < 0) {
        verticalX *= -1;
        verticalY *= -1;
    }

    return {
        x: (
            (iris.x - horizontalCenter.x) * horizontalX
            + (iris.y - horizontalCenter.y) * horizontalY
        ) / (width / 2),
        y: (
            (iris.x - verticalCenter.x) * verticalX
            + (iris.y - verticalCenter.y) * verticalY
        ) / ((cornerAnchored ? width : height) / 2),
        width,
        height,
        center: horizontalCenter
    };
}

function extractGroups(landmarks, cornerAnchored) {
    if (!Array.isArray(landmarks) || landmarks.length < MIN_LANDMARKS) return null;
    try {
        // Averaging all five MediaPipe iris landmarks is less sensitive to
        // one-landmark jitter than using only landmark 468/473.
        const leftIris = meanPoint(landmarks, LANDMARKS.LEFT_IRIS);
        const rightIris = meanPoint(landmarks, LANDMARKS.RIGHT_IRIS);
        const leftInner = landmarks[LANDMARKS.LEFT_EYE_INNER];
        const leftOuter = landmarks[LANDMARKS.LEFT_EYE_OUTER];
        const leftTop = landmarks[LANDMARKS.LEFT_EYE_TOP];
        const leftBottom = landmarks[LANDMARKS.LEFT_EYE_BOTTOM];
        const rightInner = landmarks[LANDMARKS.RIGHT_EYE_INNER];
        const rightOuter = landmarks[LANDMARKS.RIGHT_EYE_OUTER];
        const rightTop = landmarks[LANDMARKS.RIGHT_EYE_TOP];
        const rightBottom = landmarks[LANDMARKS.RIGHT_EYE_BOTTOM];
        const nose = landmarks[LANDMARKS.NOSE_TIP];
        const leftEar = landmarks[LANDMARKS.LEFT_EAR];
        const rightEar = landmarks[LANDMARKS.RIGHT_EAR];
        const forehead = landmarks[LANDMARKS.FOREHEAD];
        const chin = landmarks[LANDMARKS.CHIN];
        if (![leftIris, rightIris, leftInner, leftOuter, leftTop, leftBottom,
            rightInner, rightOuter, rightTop, rightBottom, nose, leftEar,
            rightEar, forehead, chin].every(hasFiniteCoordinates)) return null;

        const leftEye = eyeLocalCoordinates(leftIris, leftInner, leftOuter, leftTop, leftBottom, cornerAnchored);
        const rightEye = eyeLocalCoordinates(rightIris, rightInner, rightOuter, rightTop, rightBottom, cornerAnchored);
        if (!leftEye || !rightEye) return null;

        const leftWidth = leftEye.width;
        const rightWidth = rightEye.width;
        const leftHeight = leftEye.height;
        const rightHeight = rightEye.height;
        const leftCenter = leftEye.center;
        const rightCenter = rightEye.center;
        const leftNormX = leftEye.x;
        const leftNormY = leftEye.y;
        const rightNormX = rightEye.x;
        const rightNormY = rightEye.y;
        const avgIrisX = (leftNormX + rightNormX) / 2;
        const avgIrisY = (leftNormY + rightNormY) / 2;

        const eyeMid = midpoint(leftCenter, rightCenter);
        const dLeft = dist2d(nose, leftEar);
        const dRight = dist2d(nose, rightEar);
        const dForehead = dist2d(nose, forehead);
        const dChin = dist2d(nose, chin);
        const eyeDistance = dist2d(leftCenter, rightCenter);
        const faceScale = dist2d(leftEar, rightEar);
        const yawProxy = (dLeft - dRight) / Math.max(1e-6, dLeft + dRight);
        const pitchProxy = (dForehead - dChin) / Math.max(1e-6, dForehead + dChin);
        // Anatomical LEFT is on image-right in unmirrored MediaPipe coordinates.
        // The opposite vector is near +/-pi for a level face, so minute motion
        // across horizontal used to produce a spurious ~2-unit OOD jump.
        const rollProxy = Math.atan2(leftCenter.y - rightCenter.y, leftCenter.x - rightCenter.x) / Math.PI;

        const iris = [
            leftNormX,
            leftNormY,
            rightNormX,
            rightNormY,
            avgIrisX,
            avgIrisY,
            leftNormX - rightNormX,
            leftNormY - rightNormY,
            avgIrisX * avgIrisX,
            avgIrisY * avgIrisY,
            avgIrisX * avgIrisY,
            1
        ];
        const head = [
            yawProxy,
            pitchProxy,
            rollProxy,
            eyeMid.x,
            eyeMid.y,
            faceScale,
            eyeDistance
        ];
        if (!iris.every(Number.isFinite) || !head.every(Number.isFinite)) return null;

        return {
            iris,
            head,
            eye: {
                leftEAR: leftHeight / leftWidth,
                rightEAR: rightHeight / rightWidth
            }
        };
    } catch (_) {
        return null;
    }
}

export function extractFeatureGroups(landmarks) {
    return extractGroups(landmarks, false);
}

// Diagnostic candidate only: do not promote on synthetic invariance alone.
// Lids still determine openness/confidence, but not the iris coordinate frame.
export function extractCornerFeatureGroups(landmarks) {
    return extractGroups(landmarks, true);
}

// Diagnostic factorial comparison only. Pixels use CAPTURE dimensions, never
// CSS viewport/DPR, guessed camera intrinsics, or calibration target positions.
// Keep baseline eye-confidence/head/OOD inputs identical: this experiment is
// about the regression inputs, not about accepting an easier subset of frames.
export function extractAblationFeatureGroups(landmarks, { geometry, basis, frameWidth, frameHeight }) {
    const baseline = extractFeatureGroups(landmarks);
    if (!baseline || !['normalized', 'camera_pixel'].includes(geometry)
        || !['quadratic', 'linear', 'axis_mixed', 'axis_auto'].includes(basis)) return null;
    let coordinates = baseline;
    if (geometry === 'camera_pixel') {
        if (![frameWidth, frameHeight].every(v => Number.isSafeInteger(v) && v > 0 && v <= 16384)) return null;
        // A common scalar (frameWidth) cancels in local ratios. x and y must
        // share that scalar; x*width,y*height is equivalent without the large
        // global coordinates. The epsilon then stays in the original units.
        const aspect = frameHeight / frameWidth;
        coordinates = extractGroups(landmarks.map(p => ({ x: p?.x, y: p?.y * aspect })), false);
        if (!coordinates) return null;
    }
    const iris = basis === 'linear' ? [...coordinates.iris.slice(0, 8), 1] : coordinates.iris;
    return { iris, gateIris: baseline.iris, head: baseline.head, eye: baseline.eye };
}

export function extractFeatures(landmarks) {
    return extractFeatureGroups(landmarks)?.iris || null;
}

export function estimateConfidence(landmarks) {
    return confidenceFromFeatureGroups(extractFeatureGroups(landmarks));
}

export function confidenceFromFeatureGroups(groups) {
    const leftEAR = groups?.eye?.leftEAR;
    const rightEAR = groups?.eye?.rightEAR;
    if (!Number.isFinite(leftEAR) || !Number.isFinite(rightEAR) || leftEAR < 0 || rightEAR < 0) return 0;
    if (leftEAR < 0.12 || rightEAR < 0.12) return 0.08;
    const eyeBalance = 1 - Math.min(1, Math.abs(leftEAR - rightEAR) / 0.15);
    const openness = Math.min(1, Math.min(leftEAR, rightEAR) / 0.24);
    return Math.max(0, Math.min(1, 0.45 + 0.3 * eyeBalance + 0.25 * openness));
}
