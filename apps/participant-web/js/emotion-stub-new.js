import { EmotionAnalyzer } from './emotions.js';

/**
 * Фаза 1.3: Face-emotions в браузере (valence / arousal).
 * Вариант B (заглушка): константа 0; в v1 планируется лёгкая модель (ONNX) по landmarks.
 * Запись в sessionData.emotionSamples и агрегация для attentionMetrics / buildAggregatesPayload.
 *
 * @module emotion-stub-new
 */

let lastValence = 0;
let lastArousal = 0;
const analyzer = new EmotionAnalyzer();

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function num(v, fallback = 0) {
    return Number.isFinite(v) ? Number(v) : fallback;
}

/**
 * Усиливает оценки по blend shapes MediaPipe (если есть).
 * @param {Record<string, number>} scores
 * @param {Record<string, number>|null|undefined} blend
 */
function mergeBlendShapesIntoScores(scores, blend) {
    if (!blend || typeof blend !== 'object') return scores;
    const b = (name) => num(blend[name], 0);
    const smile = (b('mouthSmileLeft') + b('mouthSmileRight')) / 2;
    const frown = (b('mouthFrownLeft') + b('mouthFrownRight')) / 2;
    const browDown = (b('browDownLeft') + b('browDownRight')) / 2;
    const browInnerUp = b('browInnerUp');
    const eyeWide = (b('eyeWideLeft') + b('eyeWideRight')) / 2;
    const jawOpen = b('jawOpen');

    scores.happiness += smile * 1.1;
    scores.sadness += frown * 0.95 + browInnerUp * 0.35;
    scores.anger += browDown * 0.85;
    scores.surprise += (eyeWide * 0.7 + jawOpen * 0.55);
    scores.fear += browInnerUp * 0.5 + eyeWide * 0.35;
    scores.disgust += (b('noseSneerLeft') + b('noseSneerRight')) / 2 * 0.9;

    scores.neutral = Math.max(0.05, scores.neutral - (smile + frown + browDown + jawOpen) * 0.08);
    return scores;
}

/**
 * Лёгкая эвристика эмоций по доступным precheck-сигналам.
 * Не заменяет ML-модель, но даёт осмысленные динамические показатели.
 *
 * @param {Object} [precheckResult]
 * @returns {{ valence: number, arousal: number }}
 */
export function getEmotionSample(precheckResult) {
    if (Array.isArray(precheckResult?.landmarks) && precheckResult.landmarks.length > 0) {
        let modeled = analyzer.analyzeLandmarks(precheckResult.landmarks);
        if (precheckResult.blendShapes && modeled.scores) {
            const s = { ...modeled.scores };
            mergeBlendShapesIntoScores(s, precheckResult.blendShapes);
            const total = Object.values(s).reduce((a, v) => a + v, 0) || 1;
            Object.keys(s).forEach((k) => {
                s[k] = s[k] / total;
            });
            const labels = analyzer.labels;
            const dominant = labels.reduce((best, label) => (s[label] > s[best] ? label : best), 'neutral');
            const positive = (s.happiness || 0) + (s.surprise || 0) * 0.5;
            const negative =
                (s.sadness || 0) + (s.anger || 0) + (s.fear || 0) + (s.disgust || 0);
            const valence = clamp(positive - negative, -1, 1);
            const highArousal = (s.anger || 0) + (s.fear || 0) + (s.surprise || 0);
            const lowArousal = (s.sadness || 0) + (s.neutral || 0);
            const arousal = clamp(highArousal / (highArousal + lowArousal + 0.001), 0, 1);
            modeled = { scores: s, valence, arousal, dominant };
        }
        lastValence = modeled.valence;
        lastArousal = modeled.arousal;
        return {
            valence: modeled.valence,
            arousal: modeled.arousal,
            dominant: modeled.dominant,
            scores: modeled.scores
        };
    }

    if (!precheckResult || typeof precheckResult !== 'object') {
        return {
            valence: lastValence,
            arousal: lastArousal,
            dominant: 'neutral',
            scores: { neutral: 1, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 }
        };
    }

    const illumRaw = num(precheckResult?.illumination?.meanBrightness, 0.5);
    const illumNorm = clamp(illumRaw <= 1 ? illumRaw : illumRaw / 255, 0, 1);
    const faceOk = precheckResult?.face?.detected !== false;
    const pose = precheckResult?.pose || {};

    // Стабильность позы: меньше поворотов -> выше valence.
    const yaw = Math.abs(num(pose.yaw, 0));
    const pitch = Math.abs(num(pose.pitch, 0));
    const roll = Math.abs(num(pose.roll, 0));
    const poseMagnitude = Math.min(1, (yaw + pitch + roll) / 90);

    const eyes = precheckResult?.eyes || {};
    const eyesOpen = eyes?.bothOpen === true ? 1 : 0.4;

    // Эвристики:
    // - valence растет при хорошем свете, видимом лице и стабильной позе
    // - arousal растет при большей динамике позы
    const valenceRaw =
        (illumNorm - 0.5) * 0.8 +
        (faceOk ? 0.2 : -0.4) +
        (eyesOpen - 0.5) * 0.4 -
        poseMagnitude * 0.5;

    const arousalRaw =
        poseMagnitude * 0.9 +
        (1 - illumNorm) * 0.2 +
        (faceOk ? 0.05 : 0.15);

    // EMA-сглаживание, чтобы метрика не "дрожала" (чуть быстрее реагируем).
    const alpha = 0.38;
    const valence = clamp(lastValence * (1 - alpha) + clamp(valenceRaw, -1, 1) * alpha, -1, 1);
    const arousal = clamp(lastArousal * (1 - alpha) + clamp(arousalRaw, 0, 1) * alpha, 0, 1);

    lastValence = valence;
    lastArousal = arousal;

    let dominant = 'neutral';
    if (valence > 0.2) dominant = 'happiness';
    else if (valence < -0.2) dominant = arousal > 0.45 ? 'fear' : 'sadness';
    else if (arousal > 0.55) dominant = 'surprise';

    return {
        valence,
        arousal,
        dominant,
        scores: {
            neutral: Math.max(0.2, 1 - Math.abs(valence) - arousal * 0.3),
            happiness: valence > 0 ? valence * 0.5 : 0,
            sadness: valence < 0 && dominant === 'sadness' ? -valence * 0.45 : 0,
            anger: 0,
            fear: valence < 0 && dominant === 'fear' ? arousal * 0.4 : 0,
            surprise: dominant === 'surprise' ? arousal * 0.5 : 0,
            disgust: 0
        }
    };
}

/**
 * Добавляет сэмпл в sessionData.emotionSamples (создаёт массив при необходимости).
 *
 * @param {Object} state - state из state.js
 * @param {{ valence: number, arousal: number }} sample
 * @param {number} [t] - timestamp (Date.now())
 * @param {number} [tRelMs] - время относительно старта сессии
 */
export function appendEmotionSample(state, sample, t = Date.now(), tRelMs = null) {
    if (!state.sessionData) return;
    if (!Array.isArray(state.sessionData.emotionSamples)) {
        state.sessionData.emotionSamples = [];
    }
    const start = state.sessionData.startTime || t;
    state.sessionData.emotionSamples.push({
        t,
        tRelMs: tRelMs != null ? tRelMs : Math.max(0, t - start),
        valence: sample.valence,
        arousal: sample.arousal,
        dominant: sample?.dominant || null,
        scores: sample?.scores || null
    });
}

/**
 * Считает средние valence/arousal по сессии для агрегатов (Фаза 1.4).
 *
 * @param {Object} sessionData
 * @returns {{ valence_mean: number | null, arousal_mean: number | null, n: number }}
 */
export function getEmotionSummary(sessionData) {
    const arr = sessionData?.emotionSamples;
    if (!Array.isArray(arr) || arr.length === 0) {
        return { valence_mean: null, arousal_mean: null, n: 0 };
    }
    let vSum = 0;
    let aSum = 0;
    for (const s of arr) {
        vSum += Number(s.valence) || 0;
        aSum += Number(s.arousal) || 0;
    }
    const n = arr.length;
    return {
        valence_mean: n ? vSum / n : null,
        arousal_mean: n ? aSum / n : null,
        n
    };
}
