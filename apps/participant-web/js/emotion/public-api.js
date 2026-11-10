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

// Opt-in, local developer observation of existing calculations. No second inference.
const diagnosticListeners = new Set();
export function observeEmotionSamples(listener) {
    diagnosticListeners.add(listener);
    return () => diagnosticListeners.delete(listener);
}

function isSuccessfulSample(sample) {
    return sample?.status === 'success'
        && sample.calibrationReady === true
        && sample.degraded !== true && sample.missingData !== true
        && sample.staleHold !== true && sample.emotionInferred !== false
        && Number.isFinite(sample.valence) && sample.valence >= -1 && sample.valence <= 1
        && Number.isFinite(sample.arousal) && sample.arousal >= 0 && sample.arousal <= 1
        && Number.isFinite(sample.confidence) && sample.confidence > 0 && sample.confidence <= 1
        && analyzer.labels.every(label => Number.isFinite(sample.scores?.[label])
            && sample.scores[label] >= 0 && sample.scores[label] <= 1);
}

function unavailableSample(status, dataSource) {
    return {
        status,
        valence: null, arousal: null, dominant: 'unknown',
        scores: Object.fromEntries(analyzer.labels.map(label => [label, 0])),
        confidence: 0,
        calibrationReady: false,
        dataQuality: status === 'calibrating' ? 'calibrating' : 'missing',
        dataSource,
        emotionInferred: false,
        degraded: true,
        missingData: true,
    };
}

// ── getEmotionSample ────────────────────────────────────────────────────────

/**
 * Основная функция анализа эмоций.
 *
 * Три пути деградации:
 *   1. пригодные landmarks после калибровки → FACS-анализ
 *   2. калибровка, некорректные landmarks или ошибка → пропуск
 *   3. нет landmarks → пропуск (metadata не определяет эмоцию)
 *
 * @param {Object} [precheckResult]
 * @returns {{ valence, arousal, dominant, scores, confidence, dataQuality, dataSource }}
 */
export function getEmotionSample(precheckResult) {
    const sample = calculateEmotionSample(precheckResult);
    for (const listener of diagnosticListeners) {
        try { listener(structuredClone(sample), analyzer.getCalibrationDiagnostics()); }
        catch (_) { /* Diagnostic UI must never break signal collection. */ }
    }
    return sample;
}

function calculateEmotionSample(precheckResult) {
    // ── Путь 1: landmarks → FACS ────────────────────────────────────────
    if (precheckResult?.landmarks != null) {
        const result = analyzer.analyzeLandmarks(precheckResult.landmarks);
        if (!isSuccessfulSample(result)) {
            return {
                ...unavailableSample(result.status === 'success' ? 'analysis_error' : result.status, 'landmarks'),
                calibrationReady: result.calibrationReady === true,
                calibrationFrames: result.calibrationFrames,
                rawActionUnits: result.rawActionUnits ?? null,
                actionUnits: result.status === 'calibrating' ? null : (result.actionUnits ?? null),
                geometry: result.geometry ?? null,
            };
        }
        return {
            ...result,
            dataQuality: 'high',
            dataSource:  'landmarks',
            emotionInferred: true,
            degraded: false,
        };
    }

    // ── Путь 2: нет объекта → missing ──────────────────────────────────
    if (!precheckResult || typeof precheckResult !== 'object') {
        return unavailableSample('missing_data', 'none');
    }

    // Camera metadata can describe signal quality, but it cannot identify an
    // emotion. Fail closed instead of turning brightness/head motion into a
    // fabricated affect label.
    return unavailableSample('missing_landmarks', 'metadata');
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
        // Preserve legacy finite observations, but never reinterpret an explicit
        // failure or unfinished calibration as a neutral observation.
        for (const value of [s, s?.data]) {
            if (value?.degraded === true || value?.missingData === true || value?.staleHold === true
                || value?.emotionInferred === false || value?.calibrationReady === false
                || value?.baselineReady === false || value?.confidence === 0
                || (value?.status != null && value.status !== 'success')
                || ['calibrating', 'missing', 'low', 'invalid'].includes(value?.dataQuality)) return false;
        }
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
    // Live ingestion requires positive evidence of success. The legacy read
    // fallback in getEmotionSummary does not grant permission to append data.
    if (!state?.sessionData || !isSuccessfulSample(sample)) return;

    const valence = sample.valence;
    const arousal = sample.arousal;

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
        status: 'success',
        calibrationReady: true,
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
