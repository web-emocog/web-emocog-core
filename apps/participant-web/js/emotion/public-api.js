/**
 * Public API — getEmotionSample, getEmotionSummary, appendEmotionSample.
 *
 * Singleton analyzer живёт здесь; между сессиями вызывайте
 * analyzer.startSession(sessionId) / analyzer.endSession().
 *
 * @module public-api
 * @version 1.1.0
 */

import { EMOTION_CONFIG }  from './emotion-config.js';
import { EmotionAnalyzer } from './emotion-analyzer.js';

/**
 * Singleton — один экземпляр на всё приложение.
 * _analyzer оставлен для обратной совместимости со старым кодом.
 * В новом коде используй именованный экспорт analyzer.
 */
export const analyzer  = new EmotionAnalyzer();
export const _analyzer = analyzer;   // алиас для обратной совместимости

// ── getEmotionSample ────────────────────────────────────────────────────────

/**
 * Основная функция анализа эмоций.
 *
 * Три пути деградации:
 *   1. landmarks (≥468) → полный FACS-анализ, динамический confidence
 *   2. precheckResult без landmarks → эвристика по мета-данным
 *   3. нет данных → missingData
 *
 * @param {Object} [precheckResult]
 * @returns {{ valence, arousal, dominant, scores, confidence, dataQuality, dataSource }}
 */
export function getEmotionSample(precheckResult) {
    const C = EMOTION_CONFIG;

    // ── Путь 1: landmarks → FACS ────────────────────────────────────────
    if (Array.isArray(precheckResult?.landmarks) && precheckResult.landmarks.length >= C.minLandmarks) {
        const result = analyzer.analyzeLandmarks(precheckResult.landmarks);
        const valence = Number.isFinite(result.valence) ? result.valence : 0;
        const arousal = Number.isFinite(result.arousal) ? result.arousal : 0;
        return {
            ...result,
            valence,
            arousal,
            dataQuality: result.calibrationReady === false ? 'calibrating' : 'high',
            dataSource:  'landmarks',
            degraded: result.calibrationReady === false,
        };
    }

    // ── Путь 2: нет объекта → missing ──────────────────────────────────
    if (!precheckResult || typeof precheckResult !== 'object') {
        return {
            valence: null, arousal: null, dominant: 'unknown',
            scores: { neutral: 0, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            confidence:  C.confidence.missing,
            dataQuality: 'missing',
            dataSource:  'none',
            missingData: true,
        };
    }

    // Camera metadata can describe signal quality, but it cannot identify an
    // emotion. Fail closed instead of turning brightness/head motion into a
    // fabricated affect label.
    const faceOk   = precheckResult?.face?.detected !== false;
    return {
        valence:     0,
        arousal:     0,
        dominant:    'unknown',
        scores:      { neutral: 1, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
        confidence:  faceOk ? C.confidence.metadataFaceOk : C.confidence.metadataNoFace,
        dataQuality: 'low',
        dataSource:  'metadata',
        isHeuristic: true,
        emotionInferred: false,
        degraded: true,
    };
}

// ── getEmotionSummary ───────────────────────────────────────────────────────

/**
 * Агрегирует эмоциональные данные за сессию.
 *
 * Source priority (fixed for participant runtime — no silent switching):
 *   1. sessionData.emotionSamples  ← appendEmotionSample (tracking + cognitive)
 *   2. sessionData.emotion_samples (alias)
 *   3. sessionData.emotionEvents     (legacy fallback only if 1–2 empty)
 *
 * analyzer.emotionEvents is intentionally NOT used here (processLandmarks / tests only).
 *
 * @param {Object} sessionData
 * @returns {{ valence_mean: number|null, arousal_mean: number|null, n: number }}
 */
export function getEmotionSummary(sessionData) {
    const accumulator = sessionData?.emotionAccumulator;
    if (
        Number.isFinite(accumulator?.n)
        && accumulator.n > 0
        && Number.isFinite(accumulator.valenceSum)
        && Number.isFinite(accumulator.arousalSum)
    ) {
        return {
            valence_mean: +(accumulator.valenceSum / accumulator.n).toFixed(4),
            arousal_mean: +(accumulator.arousalSum / accumulator.n).toFixed(4),
            n: accumulator.n
        };
    }
    const primary =
        sessionData?.emotionSamples ??
        sessionData?.emotion_samples ??
        null;

    const samples = Array.isArray(primary) && primary.length > 0
        ? primary
        : (Array.isArray(sessionData?.emotionEvents) ? sessionData.emotionEvents : []);

    if (!samples.length) {
        return { valence_mean: null, arousal_mean: null, n: 0 };
    }

    const valid = samples.filter(s => {
        if (s?.degraded === true) return false;
        const v = s?.valence ?? s?.affective?.valence ?? s?.data?.affective?.valence;
        const a = s?.arousal ?? s?.affective?.arousal ?? s?.data?.affective?.arousal;
        return Number.isFinite(v) && Number.isFinite(a);
    });

    if (valid.length === 0) return { valence_mean: null, arousal_mean: null, n: 0 };

    const vMean = valid.reduce((sum, s) =>
        sum + (s?.valence ?? s?.affective?.valence ?? s?.data?.affective?.valence), 0
    ) / valid.length;

    const aMean = valid.reduce((sum, s) =>
        sum + (s?.arousal ?? s?.affective?.arousal ?? s?.data?.affective?.arousal), 0
    ) / valid.length;

    return {
        valence_mean: +vMean.toFixed(4),
        arousal_mean: +aMean.toFixed(4),
        n: valid.length,
    };
}

// ── appendEmotionSample ─────────────────────────────────────────────────────

/**
 * Добавляет сэмпл эмоций в sessionData.emotionSamples.
 * Cap: хранятся только последние maxEmotionSamples записей.
 */
export function appendEmotionSample(state, sample, t = Date.now(), tRelMs = null) {
    if (!state?.sessionData || !sample) return;
    if (sample.degraded === true) return;

    const valence = sample.valence;
    const arousal = sample.arousal;
    if (!Number.isFinite(valence) || !Number.isFinite(arousal)) return;

    if (!Array.isArray(state.sessionData.emotionSamples)) {
        state.sessionData.emotionSamples = [];
    }
    if (!state.sessionData.emotionAccumulator) {
        state.sessionData.emotionAccumulator = {
            n: 0,
            valenceSum: 0,
            arousalSum: 0,
            startedAt: t,
            updatedAt: t
        };
    }
    state.sessionData.emotionAccumulator.n += 1;
    state.sessionData.emotionAccumulator.valenceSum += valence;
    state.sessionData.emotionAccumulator.arousalSum += arousal;
    state.sessionData.emotionAccumulator.updatedAt = t;

    const start = state.sessionData.startTime || t;
    const clockStamp = state.runtime?.sessionClock?.now?.() || null;
    state.sessionData.emotionSamples.push({
        t,
        timeOriginMs: clockStamp?.timeOriginMs ?? null,
        monotonicMs: clockStamp?.monotonicMs ?? t,
        sessionTimeMs: clockStamp?.sessionTimeMs ?? Math.max(0, t - start),
        tRelMs:   tRelMs != null ? tRelMs : Math.max(0, t - start),
        valence,
        arousal,
        dominant: sample?.dominant || null,
        scores:   sample?.scores   || null,
        confidence: Number.isFinite(sample?.confidence) ? sample.confidence : null,
        dataQuality: sample?.dataQuality || null,
        dataSource: sample?.dataSource || null,
        degraded: false,
    });

    const cap = EMOTION_CONFIG.maxEmotionSamples;
    if (state.sessionData.emotionSamples.length > cap) {
        state.sessionData.emotionSamples.shift();
    }
}

/** Сброс singleton analyzer buffers (не трогает sessionData.emotionSamples). */
export function resetEmotionAnalyzerState() {
    analyzer.clear();
}
