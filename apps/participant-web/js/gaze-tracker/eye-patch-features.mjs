// Original experimental implementation; no third-party tracker code or weights.
// Eye pixels stay transient/local and must never enter reports or checkpoints.
import { getFramePixels } from '../session-runtime/frame-pixels.mjs';

export const EYE_PATCH_METHOD = 'eye_patch_ridge.experimental.v1';
export const EYE_PATCH_LENGTH = 120;
export const EYE_PATCH_CORE_METHOD = 'eye_patch_core_ridge.experimental.v1';
export const EYE_PATCH_CORE_LENGTH = 24;
export const EYE_PATCH_SPEC = Object.freeze({ columns: 10, rows: 6,
    widthInCanthalWidths: 1.25, heightInCanthalWidths: .75,
    normalization: 'per_eye_mean_contrast_floor_0.04', sampling: 'four_bilinear_subsamples' });

function luminance(data, width, x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const gray = (px, py) => {
        const at = 4 * (py * width + px);
        return (.299 * data[at] + .587 * data[at + 1] + .114 * data[at + 2]) / 255;
    };
    return (1 - fy) * ((1 - fx) * gray(ix, iy) + fx * gray(ix + 1, iy))
        + fy * ((1 - fx) * gray(ix, iy + 1) + fx * gray(ix + 1, iy + 1));
}

export function extractEyePatchFeatures(pixels, landmarks, { region = 'full' } = {}) {
    const { width, height, data } = pixels || {};
    if (![width, height].every(v => Number.isSafeInteger(v) && v > 1 && v <= 16384)
        || !(data instanceof Uint8ClampedArray || data instanceof Uint8Array)
        || data.length !== width * height * 4 || !Array.isArray(landmarks) || landmarks.length < 478
        || !['full', 'core'].includes(region)) return null;
    const features = [];
    // Anatomical left then right. Image orientation, not mirrored preview.
    // Crop is corner-anchored and scaled in camera pixels, never lid height.
    for (const [inner, outer] of [[362, 263], [133, 33]]) {
        const a = landmarks[inner], b = landmarks[outer];
        if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return null;
        let ux = (b.x - a.x) * width, uy = (b.y - a.y) * height;
        const size = Math.hypot(ux, uy); if (size < 1) return null;
        ux /= size; uy /= size; if (ux < 0) { ux = -ux; uy = -uy; }
        const vx = -uy, vy = ux;
        const cx = (a.x + b.x) * width / 2, cy = (a.y + b.y) * height / 2;
        const patch = [];
        for (let row = 0; row < EYE_PATCH_SPEC.rows; row++) for (let col = 0; col < EYE_PATCH_SPEC.columns; col++) {
            // A separate, explicitly versioned ablation: central 6x2 support,
            // normalized on that support only. Less peripheral lid information,
            // but also less gaze information; not universally lid-invariant.
            if (region === 'core' && (row < 2 || row > 3 || col < 2 || col > 7)) continue;
            let value = 0;
            for (const ox of [.25, .75]) for (const oy of [.25, .75]) {
                const dx = ((col + ox) / EYE_PATCH_SPEC.columns - .5) * size * EYE_PATCH_SPEC.widthInCanthalWidths;
                const dy = ((row + oy) / EYE_PATCH_SPEC.rows - .5) * size * EYE_PATCH_SPEC.heightInCanthalWidths;
                const x = cx + dx * ux + dy * vx, y = cy + dx * uy + dy * vy;
                // No padding/clamping an unavailable eye into a plausible patch.
                if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return null;
                value += luminance(data, width, x, y) / 4;
            }
            patch.push(value);
        }
        const mean = patch.reduce((s, v) => s + v, 0) / patch.length;
        const sd = Math.sqrt(patch.reduce((s, v) => s + (v - mean) ** 2, 0) / patch.length);
        if (!Number.isFinite(sd) || sd < 1e-6) return null; // Degenerate, not an accuracy/QC threshold.
        for (const value of patch) features.push((value - mean) / Math.max(sd, .04));
    }
    return features;
}

export function eyePatchFeaturesForFrame(frame, options) {
    const pixels = getFramePixels(frame);
    // Require provenance from this completed frame; never recapture live video
    // or retain/reuse the last successful patch after a missing/mismatched one.
    if (!pixels || pixels.width !== frame?.frameSize?.width || pixels.height !== frame?.frameSize?.height) return null;
    return extractEyePatchFeatures(pixels, frame.landmarks, options);
}
