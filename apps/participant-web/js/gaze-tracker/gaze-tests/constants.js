export const TEST_HUB_VERSION = '1.0.0';

export const TEST_IDS = Object.freeze({
    RT: 'rt_gonogo',
    TRACKING: 'tracking_shapes',
    VPC: 'vpc_felidae',
    VISUOSPATIAL: 'visuospatial_drawing'
});

export const TEST_PHASES = Object.freeze({
    HUB: 'test_hub',
    VPC_FIXATION: 'vpc_fixation',
    VPC_FAMILIAR: 'vpc_familiarization',
    VPC_PAIR: 'vpc_pair',
    VPC_ITI: 'vpc_iti',
    VISUOSPATIAL_INSTRUCTION: 'visuospatial_instruction',
    VISUOSPATIAL_DRAWING: 'visuospatial_drawing'
});

export const ANALYSIS_LOOP = Object.freeze({
    targetIntervalMs: 33,
    sameFrameRetryMs: 8,
    segmenterStride: 3
});

export const VPC_CONFIG = Object.freeze({
    fixationMs: 800,
    familiarizationMs: 2500,
    isiMs: 500,
    pairMs: 3500,
    itiMs: 700,
    imageLoadTimeoutMs: 12000,
    trialsCount: 12
});

export const VISUOSPATIAL_CONFIG = Object.freeze({
    maxDurationMs: 60000,
    drawTickMs: 33,
    idleSpeedThresholdPxPerSec: 40,
    coverageGridWidth: 40,
    coverageGridHeight: 30
});
