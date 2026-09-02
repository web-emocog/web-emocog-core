/**
 * index.js — точка входа модуля emotion.
 *
 * Реэкспортирует всё публичное API и регистрирует EmotionAnalyzer на window
 * для обратной совместимости.
 *
 * @module emotion/index
 * @version 1.1.0
 */

// ── Конфиг ───────────────────────────────────────────────────────────────────
export { EMOTION_CONFIG } from './emotion-config.js';

// ── Низкоуровневые модули (для тестов и расширений) ──────────────────────────
export { buildInternalMask, extractActionUnits } from './au-extractor.js';
export { classifyFACS, calcAffective }           from './facs-classifier.js';
export { computeAggregatedMetrics }              from './emotion-aggregator.js';

// ── Класс анализатора ────────────────────────────────────────────────────────
export { EmotionAnalyzer } from './emotion-analyzer.js';

// ── Публичный API (singleton + функции) ──────────────────────────────────────
export {
    _analyzer,
    getEmotionSample,
    getEmotionSummary,
    appendEmotionSample,
} from './public-api.js';

// ── Регистрация на window (обратная совместимость) ────────────────────────────
// [FIX] Используем отдельные side-effect импорты только для window-регистрации,
// чтобы не дублировать реэкспортированные имена выше.
import { EmotionAnalyzer as _EmotionAnalyzer } from './emotion-analyzer.js';
import { _analyzer as _singletonAnalyzer }     from './public-api.js';

window.EmotionAnalyzer = _EmotionAnalyzer;
window.emotionAnalyzer = _singletonAnalyzer;

console.log('[emotion/index] Модуль загружен (v4.1.0, FACS AU)');