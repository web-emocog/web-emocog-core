import { faceVisibilityFixture } from './face-visibility.mjs';

// Native inference fixture only; Worker lifecycle/analysis code remains the production implementation.
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const ImageSegmenter = { createFromOptions: async () => ({
    segmentForVideo() { return faceVisibilityFixture(); }, close() {}
}) };
export const FaceLandmarker = {};
export const PoseLandmarker = {};
