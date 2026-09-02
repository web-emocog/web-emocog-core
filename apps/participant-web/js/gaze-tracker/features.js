import { LANDMARKS, MIN_LANDMARKS } from './constants.js';

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

function eyeLocalCoordinates(iris, inner, outer, top, bottom) {
    const width = dist2d(inner, outer);
    const height = dist2d(top, bottom);
    if (Math.min(width, height) < 1e-6) return null;

    const horizontalCenter = midpoint(inner, outer);
    const verticalCenter = midpoint(top, bottom);
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
        ) / (height / 2),
        width,
        height,
        center: horizontalCenter
    };
}

export function extractFeatureGroups(landmarks) {
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

        const leftEye = eyeLocalCoordinates(leftIris, leftInner, leftOuter, leftTop, leftBottom);
        const rightEye = eyeLocalCoordinates(rightIris, rightInner, rightOuter, rightTop, rightBottom);
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
        const rollProxy = Math.atan2(rightCenter.y - leftCenter.y, rightCenter.x - leftCenter.x) / Math.PI;

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

export function extractFeatures(landmarks) {
    return extractFeatureGroups(landmarks)?.iris || null;
}

export function estimateConfidence(landmarks) {
    const groups = extractFeatureGroups(landmarks);
    if (!groups) return 0;
    const leftEAR = groups.eye.leftEAR;
    const rightEAR = groups.eye.rightEAR;
    if (leftEAR < 0.12 || rightEAR < 0.12) return 0.08;
    const eyeBalance = 1 - Math.min(1, Math.abs(leftEAR - rightEAR) / 0.15);
    const openness = Math.min(1, Math.min(leftEAR, rightEAR) / 0.24);
    return Math.max(0, Math.min(1, 0.45 + 0.3 * eyeBalance + 0.25 * openness));
}
