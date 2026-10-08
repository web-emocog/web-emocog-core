// Shared presentation/gate policy. These are the existing precheck distance limits.
export function getDistanceStatus(frame) {
    const face = frame?.face;
    const height = Number(face?.bbox?.height || 0);
    if (!face?.detected || !face.bbox) {
        return { available: false, failed: true, status: 'no_face', estimateCm: null };
    }
    if (!Number.isFinite(height) || height <= 0) {
        return { available: false, failed: true, status: 'unknown', estimateCm: null };
    }
    if (height < 0.17) return { available: true, failed: true, status: 'too_far', estimateCm: null };
    if (height > 0.52) return { available: true, failed: true, status: 'too_close', estimateCm: null };
    return { available: true, failed: false, status: 'ok', estimateCm: Math.round(52 / height) };
}

export function precheckPoseStatus(pose) {
    if (!pose) return 'pending';
    if (['error', 'no_face', 'partial_face', 'off_center', 'tilted', 'unstable'].includes(pose.status)) return 'failed';
    return pose.status === 'stable' ? 'passed' : 'pending';
}

export function precheckContourStatus(frame) {
    if (getDistanceStatus(frame).failed) return 'failed';
    return precheckPoseStatus(frame?.pose);
}
