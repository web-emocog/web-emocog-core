import { LANDMARKS, MIN_LANDMARKS } from './constants.js';

function dist2d(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function hasFiniteCoordinates(point) {
    return point
        && Number.isFinite(point.x)
        && Number.isFinite(point.y);
}

export function extractFeatureGroups(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length < MIN_LANDMARKS) return null;
    try {
        const leftIris = landmarks[LANDMARKS.LEFT_IRIS_CENTER];
        const rightIris = landmarks[LANDMARKS.RIGHT_IRIS_CENTER];
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

        const leftWidth = dist2d(leftInner, leftOuter);
        const rightWidth = dist2d(rightInner, rightOuter);
        const leftHeight = dist2d(leftTop, leftBottom);
        const rightHeight = dist2d(rightTop, rightBottom);
        if (Math.min(leftWidth, rightWidth, leftHeight, rightHeight) < 1e-6) return null;

        const leftCenter = midpoint(leftInner, leftOuter);
        const rightCenter = midpoint(rightInner, rightOuter);
        const leftNormX = (leftIris.x - leftCenter.x) / (leftWidth / 2);
        const leftNormY = (leftIris.y - midpoint(leftTop, leftBottom).y) / (leftHeight / 2);
        const rightNormX = (rightIris.x - rightCenter.x) / (rightWidth / 2);
        const rightNormY = (rightIris.y - midpoint(rightTop, rightBottom).y) / (rightHeight / 2);
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
