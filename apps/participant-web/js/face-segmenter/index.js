/**
 * Face Segmenter Module - Entry Point
 * 
 * Экспортирует все компоненты модуля для использования
 * 
 * @module face-segmenter
 */

// Основной класс
export { default, FaceSegmenter } from './FaceSegmenter.js';

// Константы
export { CLASS_INDICES, CLASS_NAMES, LANDMARK_INDICES, CLASS_COLORS } from './constants.js';

// Пороговые значения
export { DEFAULT_THRESHOLDS, getAreaThresholds } from './thresholds.js';

// Анализ масок
export { analyzeMasks, extractFaceRegion, extractConfidenceStats } from './mask-analyzer.js';

// Анализ областей
export { 
    defineFaceAreas, 
    analyzeAreaVisibility, 
    analyzeAreaPixels, 
    analyzeFaceRegionsVisibility
} from './region-analyzer.js';

// Проверка симметрии (отдельный модуль согласно архитектуре)
export { checkSymmetry, checkSymmetryExtended } from './symmetry-checker.js';

// Визуализация
export { createVisualizationMask, drawMaskOnCanvas, getColorLegend } from './visualization.js';
