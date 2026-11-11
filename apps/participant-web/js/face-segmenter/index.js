/**
 * Face Segmenter Module - Entry Point
 * 
 * Экспортирует все компоненты модуля для использования
 * 
 * @module face-segmenter
 */

// Основной класс
export { default, FaceSegmenter } from './FaceSegmenter.js?v=20261110-integration1';

// Константы
export { CLASS_INDICES, CLASS_NAMES, LANDMARK_INDICES, CLASS_COLORS } from './constants.js?v=20261025-1';

// Пороговые значения
export { DEFAULT_THRESHOLDS, getAreaThresholds } from './thresholds.js?v=20261110-integration1';

// Анализ масок
export { analyzeMasks, extractFaceRegion, extractConfidenceStats } from './mask-analyzer.js?v=20261104-4';

// Анализ областей
export { 
    defineFaceAreas, 
    analyzeAreaVisibility, 
    analyzeAreaPixels, 
    analyzeFaceRegionsVisibility
} from './region-analyzer.js?v=20261110-integration1';

// Проверка симметрии (отдельный модуль согласно архитектуре)
export { checkSymmetry, checkSymmetryExtended } from './symmetry-checker.js';

// Визуализация
export { createVisualizationMask, drawMaskOnCanvas, getColorLegend } from './visualization.js?v=20261104-4';
