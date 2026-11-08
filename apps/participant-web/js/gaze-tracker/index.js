/**
 * Модуль Gaze Tracker — точка входа
 * 
 * @module gaze-tracker
 */

export { default, default as GazeTracker } from './GazeTracker.js?v=20261108-143l';
export { LANDMARKS, MIN_LANDMARKS, FEATURE_SIZE, DEFAULTS, FEATURE_METHOD, CALIBRATION_SAMPLING } from './constants.js?v=20261106-143';
export { extractFeatures, estimateConfidence } from './features.js?v=20261108-143l';
export { ridgeRegression, dotProduct } from './ridge.js?v=20261107-143';
