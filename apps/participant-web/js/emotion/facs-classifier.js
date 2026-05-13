/**
 * FACS Classifier — маппинг AU → эмоции по Экману + расчёт valence/arousal.
 *
 * Все коэффициенты берутся из EMOTION_CONFIG.facs / EMOTION_CONFIG.affective.
 *
 * @module facs-classifier
 * @version 1.0.0
 */

import { EMOTION_CONFIG } from './emotion-config.js';

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * Классифицирует эмоции по Action Units.
 * Возвращает нормализованные scores [0, 1], сумма ≈ 1.
 *
 * @param {Object} au — результат extractActionUnits()
 * @returns {Object} { neutral, happiness, sadness, anger, fear, surprise, disgust }
 */
export function classifyFACS(au) {
    const F = EMOTION_CONFIG.facs;

    const scores = {
        neutral:   F.neutralBase,
        happiness: 0,
        sadness:   0,
        anger:     0,
        fear:      0,
        surprise:  0,
        disgust:   0,
    };

    // Счастье: AU6 + AU12
    if (au.AU12 > F.happiness.au12Thresh) {
        scores.happiness = clamp(
            au.AU12 * F.happiness.au12Weight + au.AU6 * F.happiness.au6Weight,
            0, 1
        );
    }

    // Грусть: AU1 + AU15 + AU17
    if (au.AU1 > F.sadness.au1Thresh && au.AU15 > F.sadness.au15Thresh) {
        scores.sadness = clamp(
            au.AU1  * F.sadness.au1Weight  +
            au.AU15 * F.sadness.au15Weight +
            au.AU17 * F.sadness.au17Weight,
            0, F.sadness.maxScore
        );
    }

    // Гнев: AU4 + AU7 + AU23
    if (au.AU4 > F.anger.au4Thresh) {
        scores.anger = clamp(
            au.AU4  * F.anger.au4Weight  +
            au.AU7  * F.anger.au7Weight  +
            au.AU23 * F.anger.au23Weight,
            0, F.anger.maxScore
        );
    }

    // Страх: AU1 + AU2 + AU4 + AU5 + AU20
    if (au.AU5 > F.fear.au5Thresh && (au.AU1 > F.fear.au1Thresh || au.AU2 > F.fear.au2Thresh)) {
        scores.fear = clamp(
            au.AU1  * F.fear.au1Weight  +
            au.AU2  * F.fear.au2Weight  +
            au.AU4  * F.fear.au4Weight  +
            au.AU5  * F.fear.au5Weight  +
            au.AU20 * F.fear.au20Weight,
            0, F.fear.maxScore
        );
    }

    // Удивление: AU1 + AU2 + AU5 + AU26/27
    if (au.AU5 > F.surprise.au5Thresh && (au.AU26 > F.surprise.au26Thresh || au.AU27 > F.surprise.au27Thresh)) {
        scores.surprise = clamp(
            au.AU1  * F.surprise.au1Weight  +
            au.AU2  * F.surprise.au2Weight  +
            au.AU5  * F.surprise.au5Weight  +
            au.AU26 * F.surprise.au26Weight +
            au.AU27 * F.surprise.au27Weight,
            0, 1.0
        );
        // Подавляем страх если нет сведения бровей (AU4)
        if (au.AU4 < F.surprise.fearSuppressAu4Thresh) {
            scores.fear *= F.surprise.fearSuppressFactor;
        }
    }

    // Отвращение: AU9 + AU10 + AU15
    if (au.AU9 > F.disgust.au9Thresh || au.AU10 > F.disgust.au10Thresh) {
        scores.disgust = clamp(
            au.AU9  * F.disgust.au9Weight  +
            au.AU10 * F.disgust.au10Weight +
            au.AU15 * F.disgust.au15Weight,
            0, F.disgust.maxScore
        );
    }

    // ── Смешанные состояния ───────────────────────────────────────────────
    const M = F.mixed;

    // Радостное удивление
    if (au.AU12 > M.joyfulSurprise.au12Thresh && au.AU5 > M.joyfulSurprise.au5Thresh) {
        const mix = clamp(au.AU12 * M.joyfulSurprise.au12Weight + au.AU5 * M.joyfulSurprise.au5Weight, 0, M.joyfulSurprise.maxMix);
        scores.happiness = clamp(scores.happiness + mix * M.joyfulSurprise.happinessShare, 0, 1);
        scores.surprise  = clamp(scores.surprise  + mix * M.joyfulSurprise.surpriseShare,  0, 1);
    }

    // Испуганное удивление
    if (au.AU5 > M.fearfulSurprise.au5Thresh && au.AU1 > M.fearfulSurprise.au1Thresh && au.AU4 > M.fearfulSurprise.au4Thresh) {
        const mix = clamp(
            au.AU5 * M.fearfulSurprise.au5Weight +
            au.AU1 * M.fearfulSurprise.au1Weight +
            au.AU4 * M.fearfulSurprise.au4Weight,
            0, M.fearfulSurprise.maxMix
        );
        scores.fear     = clamp(scores.fear     + mix * M.fearfulSurprise.fearShare,     0, 1);
        scores.surprise = clamp(scores.surprise + mix * M.fearfulSurprise.surpriseShare, 0, 1);
    }

    // Злобное отвращение
    if (au.AU4 > M.angryDisgust.au4Thresh && au.AU9 > M.angryDisgust.au9Thresh) {
        const mix = clamp(au.AU4 * M.angryDisgust.au4Weight + au.AU9 * M.angryDisgust.au9Weight, 0, M.angryDisgust.maxMix);
        scores.anger   = clamp(scores.anger   + mix * M.angryDisgust.angerShare,   0, 1);
        scores.disgust = clamp(scores.disgust + mix * M.angryDisgust.disgustShare, 0, 1);
    }

    // Подавление neutral пропорционально активности
    const activity = scores.happiness + scores.sadness + scores.anger +
                     scores.fear + scores.surprise + scores.disgust;
    scores.neutral = clamp(scores.neutral - activity * F.neutralSuppress, F.neutralMin, 1);

    // Нормализация → сумма = 1
    const total = Object.values(scores).reduce((s, v) => s + v, 0) || 1;
    for (const k in scores) scores[k] = +(scores[k] / total).toFixed(4);

    return scores;
}

/**
 * Расчёт valence и arousal по модели Russell (Circumplex Model of Affect).
 *
 * @param {Object} scores — нормализованные scores из classifyFACS()
 * @returns {{ valence: number, arousal: number }}
 */
export function calcAffective(scores) {
    const A = EMOTION_CONFIG.affective;

    const positiveV = scores.happiness + scores.surprise * A.valence.surprisePositiveWeight;
    const negativeV = scores.sadness  * A.valence.sadnessWeight  +
                      scores.anger    * A.valence.angerWeight    +
                      scores.fear     * A.valence.fearWeight     +
                      scores.disgust  * A.valence.disgustWeight;
    const valence = clamp(positiveV - negativeV, -1, 1);

    const highArousal = scores.anger + scores.fear + scores.surprise +
                        scores.happiness * A.arousal.happinessWeight;
    const lowArousal  = scores.sadness + scores.neutral;
    const arousal = clamp(highArousal / (highArousal + lowArousal + A.arousal.epsilon), 0, 1);

    return {
        valence: +valence.toFixed(4),
        arousal: +arousal.toFixed(4),
    };
}