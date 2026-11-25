import { faceVisibilityFixture } from './face-visibility.mjs';

// Native inference fixture only; Worker lifecycle/analysis code remains the production implementation.
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const ImageSegmenter = { createFromOptions: async () => ({
    segmentForVideo(_source, _time, callback) {
        const masks = faceVisibilityFixture();
        if (!callback) return masks;
        try { callback(masks); } finally { masks.categoryMask.close(); }
    }, close() {}
}) };
export const FaceLandmarker = {};
export const PoseLandmarker = {};
