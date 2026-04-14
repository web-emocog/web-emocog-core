/**
 * QC Metrics Helpers
 * 
 * Вспомогательные функции
 * 
 * @module qc-metrics/helpers
 */

/**
 * Ограничение значения в диапазоне [0, 1]
 */
export function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

/**
 * Округление до 1 знака после запятой
 */
export function round1(v) {
    return Math.round(v * 10) / 10;
}

/**
 * Округление до 3 знаков после запятой
 */
export function round3(v) {
    return Math.round(v * 1000) / 1000;
}

/**
 * Медиана массива чисел
 */
export function median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Процентиль массива чисел
 */
export function percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Среднее значение массива
 */
export function average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Стандартное отклонение
 */
export function stdDev(arr) {
    if (arr.length === 0) return 0;
    const avg = average(arr);
    const sqDiffs = arr.map(v => Math.pow(v - avg, 2));
    return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / arr.length);
}
