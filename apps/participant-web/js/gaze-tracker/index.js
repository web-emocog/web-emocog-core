/**
 * Модуль Gaze Tracker — точка входа
 * 
 * @module gaze-tracker
 */

export { default, default as GazeTracker } from './GazeTracker.js';
export { LANDMARKS, MIN_LANDMARKS, FEATURE_SIZE, DEFAULTS } from './constants.js';
export { extractFeatures, estimateConfidence } from './features.js';
export { ridgeRegression, dotProduct } from './ridge.js';
