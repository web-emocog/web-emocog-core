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

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function num(v, fallback = 0) { return Number.isFinite(v) ? Number(v) : fallback; }

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
            dataQuality: 'high',
            dataSource:  'landmarks',
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

    // ── Путь 3: мета-данные precheck → эвристика ───────────────────────
    const H        = C.heuristic;
    const illumRaw = num(precheckResult?.illumination?.meanBrightness, 0.5);
    const illumNorm= clamp(illumRaw <= 1 ? illumRaw : illumRaw / 255, 0, 1);
    const faceOk   = precheckResult?.face?.detected !== false;
    const pose     = precheckResult?.pose || {};
    const poseMag  = clamp(
        (Math.abs(num(pose.yaw, 0)) + Math.abs(num(pose.pitch, 0)) + Math.abs(num(pose.roll, 0))) / H.poseMagDivisor,
        0, 1
    );
    const eyesOpen = precheckResult?.eyes?.bothOpen === true ? H.eyesOpenValue : H.eyesClosedValue;

    const valence = clamp(
        (illumNorm - 0.5) * H.illumValenceScale +
        (faceOk ? H.faceOkBonus : H.faceFailPenalty) +
        (eyesOpen - 0.5) * H.eyesValenceScale -
        poseMag * H.posePenaltyScale,
        -1, 1
    );
    const arousal = clamp(
        poseMag * H.poseArousalScale + (1 - illumNorm) * H.illumArousalScale,
        0, 1
    );

    const HS = H.hScores;
    const hScores = {
        neutral:   Math.max(0, 1 - Math.abs(valence) - arousal * HS.neutralArousalDamp),
        happiness: Math.max(0, valence)  * (1 - arousal * HS.happinessArousalDamp),
        sadness:   Math.max(0, -valence) * (1 - arousal * HS.sadnessArousalDamp),
        anger:     arousal * Math.max(0, -valence) * HS.angerScale,
        fear:      arousal * HS.fearBase,
        surprise:  arousal * HS.surpriseBase,
        disgust:   0,
    };
    const hTotal = Object.values(hScores).reduce((s, v) => s + v, 0) || 1;
    for (const k in hScores) hScores[k] = +(hScores[k] / hTotal).toFixed(4);

    return {
        valence:     +valence.toFixed(4),
        arousal:     +arousal.toFixed(4),
        dominant:    valence > 0.2 ? 'happiness' : valence < -0.2 ? 'sadness' : 'neutral',
        scores:      hScores,
        confidence:  faceOk ? C.confidence.metadataFaceOk : C.confidence.metadataNoFace,
        dataQuality: 'low',
        dataSource:  'metadata',
        isHeuristic: true,
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

    const start = state.sessionData.startTime || t;
    state.sessionData.emotionSamples.push({
        t,
        tRelMs:   tRelMs != null ? tRelMs : Math.max(0, t - start),
        valence,
        arousal,
        dominant: sample?.dominant || null,
        scores:   sample?.scores   || null,
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