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
export { buildInternalMask, extractActionUnits } from './au-extractor.js?v=20261112-emotion1';
export { classifyFACS, calcAffective }           from './facs-classifier.js';
export { computeAggregatedMetrics }              from './emotion-aggregator.js';

// ── Класс анализатора ────────────────────────────────────────────────────────
export { EmotionAnalyzer } from './emotion-analyzer.js?v=20261112-emotion2';

// ── Публичный API (singleton + функции) ──────────────────────────────────────
export {
    _analyzer,
    getEmotionSample,
    getEmotionSummary,
    appendEmotionSample,
} from './public-api.js?v=20261112-emotion2';

// ── Регистрация на window (обратная совместимость) ────────────────────────────
// [FIX] Используем отдельные side-effect импорты только для window-регистрации,
// чтобы не дублировать реэкспортированные имена выше.
import { EmotionAnalyzer as _EmotionAnalyzer } from './emotion-analyzer.js?v=20261112-emotion2';
import { _analyzer as _singletonAnalyzer }     from './public-api.js?v=20261112-emotion2';

window.EmotionAnalyzer = _EmotionAnalyzer;
window.emotionAnalyzer = _singletonAnalyzer;
