export const FACE_MODEL_CONFIG = Object.freeze({
    numFaces: 1, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true
});

export async function createFaceModel(create, options, isCurrent = () => true, cpuOnly = false) {
    for (const delegate of cpuOnly ? ['CPU'] : ['GPU', 'CPU']) {
        if (!isCurrent()) return null;
        try {
            const model = await create({ ...FACE_MODEL_CONFIG, ...options,
                baseOptions: { ...options.baseOptions, delegate } });
            if (!isCurrent()) { model.close(); return null; }
            return { model, delegate, fallbackReason: delegate === 'CPU' && !cpuOnly ? 'face_gpu_initialization_failed' : null };
        } catch (error) {
            if (!isCurrent()) return null;
            if (delegate === 'CPU') throw error;
        }
    }
    return null;
}
