/**
 * QC Metrics Module - Entry Point
 * 
 * @module qc-metrics
 */

export { default, QCMetrics } from './QCMetrics.js';
export { DEFAULT_THRESHOLDS, VIDEO_ELEMENT_IDS, QC_WEIGHTS, createThresholds } from './constants.js';
export { clamp01, round1, round3, median, percentile, average, stdDev } from './helpers.js';
export { VideoFpsMonitor } from './fps-monitor.js';
export { 
    createGazeState, setGazeScreenState, addGazePoint, 
    inferOnScreenFromPoseAndGaze, accumulateGazeTime 
} from './gaze-tracking.js';
export { 
    createInstrumentCounters, computeFrameFlags, 
    updateInstrumentCounters, computePercentages 
} from './frame-analysis.js';
export { 
    createValidationState, setValidationData, 
    getValidationMetrics, isGazeInAOI 
} from './validation.js';
export { computeQcScore, getCurrentMetrics, getSummary } from './metrics-calculator.js';
