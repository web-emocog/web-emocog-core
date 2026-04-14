/**
 * PreCheck Analyzer Module - Entry Point
 * 
 * @module precheck-analyzer
 */

export { default, PrecheckAnalyzer } from './PrecheckAnalyzer.js';
export { LANDMARKS, MIN_LANDMARKS_FULL, MIN_LANDMARKS_BASIC } from './constants.js';
export { 
    ILLUMINATION_THRESHOLDS, FACE_THRESHOLDS, POSE_THRESHOLDS, 
    EYES_THRESHOLDS, HISTORY_SIZE, createThresholds 
} from './thresholds.js';
export { analyzeIllumination, analyzeContrast } from './illumination.js';
export { parseFaceResults, extractBlendShapes } from './face-parser.js';
export { analyzePose, checkStability, checkEyesCentering, addToHistory } from './pose-analyzer.js';
export { analyzeEyes, calculateEAR, getIrisPosition, estimateGazeDirection } from './eyes-analyzer.js';
export { analyzeMouth } from './mouth-analyzer.js';

// Рекомендации (отдельный модуль согласно архитектуре)
export { getRecommendations, checkReadiness, getMainRecommendation, PRIORITY, CATEGORY } from './recommendations.js';
