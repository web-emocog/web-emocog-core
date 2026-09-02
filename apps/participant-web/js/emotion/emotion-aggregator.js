/**
 * Emotion Aggregator — агрегированные метрики за сессию.
 *
 * timeAboveThreshold считается по реальным timestamp событий,
 * а не как count / fps.
 *
 * @module emotion-aggregator
 * @version 1.1.0
 */

import { EMOTION_CONFIG } from './emotion-config.js';

const EMOTION_LABELS = ['neutral', 'happiness', 'sadness', 'anger', 'fear', 'surprise', 'disgust'];

/**
 * Вычисляет агрегированные метрики по массиву событий.
 *
 * @param {Array}  events        — массив из emotionEvents (все статусы)
 * @param {number} totalEvents   — полное число событий для validDataPct
 * @param {Object} categoryStats — результат getEmotionCategoryStats()
 * @returns {Object|null}
 */
export function computeAggregatedMetrics(events, totalEvents, categoryStats) {
    const valid = events.filter(e => e.status === 'success');
    if (valid.length === 0) return null;

    const C   = EMOTION_CONFIG;
    // Максимальный допустимый интервал между событиями = 2 frame-длины
    const maxFrameMs = (2000 / C.fps);
    // Fallback-интервал для последнего события
    const defaultFrameMs = (1000 / C.fps);

    const metrics = {
        meanScores:         {},
        maxScores:          {},
        stdDev:             {},
        // timeAboveThreshold[emotion] = суммарное время (сек) когда score > порога
        timeAboveThreshold: {},
        meanValence:        0,
        meanArousal:        0,
        dominantEmotion:    '',
        validDataPct:       +((valid.length / Math.max(totalEvents, 1)) * 100).toFixed(2),
        categoryStats,
    };

    for (const e of EMOTION_LABELS) {
        metrics.meanScores[e]         = 0;
        metrics.maxScores[e]          = 0;
        metrics.stdDev[e]             = 0;
        metrics.timeAboveThreshold[e] = 0;
    }

    const allScores = {};
    for (const e of EMOTION_LABELS) allScores[e] = [];

    // ── Накопление ────────────────────────────────────────────────────────
    for (let i = 0; i < valid.length; i++) {
        const event   = valid[i];
        const s       = event.data?.scores || {};
        const nextTs  = valid[i + 1]?.timestamp ?? null;

        // Реальный интервал до следующего события, с защитой от пауз и отрицательных значений
        const rawFrameMs = nextTs != null
            ? nextTs - event.timestamp
            : defaultFrameMs;
        const frameMs = Math.max(0, Math.min(rawFrameMs, maxFrameMs));

        for (const e of EMOTION_LABELS) {
            const v = s[e] || 0;
            metrics.meanScores[e] += v;
            metrics.maxScores[e]   = Math.max(metrics.maxScores[e], v);
            allScores[e].push(v);

            if (v > C.confidenceThreshold) {
                metrics.timeAboveThreshold[e] += frameMs;
            }
        }

        metrics.meanValence += event.data?.affective?.valence || 0;
        metrics.meanArousal += event.data?.affective?.arousal || 0;
    }

    // ── Усреднение и std ──────────────────────────────────────────────────
    const count = valid.length;
    for (const e of EMOTION_LABELS) {
        metrics.meanScores[e] = +(metrics.meanScores[e] / count).toFixed(4);
        const mean     = metrics.meanScores[e];
        const variance = allScores[e].reduce((s, v) => s + (v - mean) ** 2, 0) / count;
        metrics.stdDev[e] = +Math.sqrt(variance).toFixed(4);
        // мс → секунды
        metrics.timeAboveThreshold[e] = +(metrics.timeAboveThreshold[e] / 1000).toFixed(3);
    }

    metrics.meanValence = +(metrics.meanValence / count).toFixed(4);
    metrics.meanArousal = +(metrics.meanArousal / count).toFixed(4);

    metrics.dominantEmotion = EMOTION_LABELS.reduce(
        (b, l) => metrics.meanScores[l] > metrics.meanScores[b] ? l : b,
        'neutral'
    );

    return metrics;
}