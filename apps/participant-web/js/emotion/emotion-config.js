/**
 * EMOTION_CONFIG — единственное место для всех числовых коэффициентов.
 * Меняйте только здесь; код модулей не содержит жёстко зашитых чисел.
 *
 * @module emotion-config
 * @version 1.1.0
 */

export const EMOTION_CONFIG = {

    // ── Общие параметры анализатора ──────────────────────────────────────
    fps:                    10,
    confidenceThreshold:    0.40,
    smoothingWindow:        4,
    temporalWindowSize:     10,
    minLandmarks:           468,
    dominantMinScore:       0.50,
    dominantMinMargin:      0.09,
    dominantHoldFrames:     2,
    neutralPublishedFloor:  0.65,

    // Person-specific neutral baseline prevents static facial geometry from
    // being interpreted as a persistent expression (notably happiness).
    baseline: {
        minFrames:          18,
        deadzone:           0.012,
        gain:               4.0,
        adaptiveRate:       0.006,
        adaptiveMaxActivity:0.08,
    },

    // ── Лимиты памяти ────────────────────────────────────────────────────
    maxEvents:              1000,
    // 5 Hz runtime sampling: keeps one hour without truncating the summary.
    maxEmotionSamples:      18000,

    // ── AU-экстрактор ────────────────────────────────────────────────────
    au: {
        browRaiseScale:     5,
        browFurrowThresh:   0.5,
        browFurrowSlope:    3,
        eyeOpenScale:       15,
        cheekNormalDist:    0.20,
        cheekRaiseSlope:    8,
        lidTightThresh:     0.035,
        lidTightSlope:      20,
        noseWrinkleThresh:  0.15,
        noseWrinkleSlope:   3,
        upperLipThresh:     0.1,
        upperLipSlope:      10,
        smileThresh:        0.4,
        smileSlope:         5,
        lipCornerDepThresh: 0.02,
        lipCornerDepSlope:  10,
        chinRaiseThresh:    0.1,
        chinRaiseSlope:     10,
        lipStretchThresh:   0.35,
        lipStretchSlope:    4,
        lipTightThresh:     0.05,
        lipTightSlope:      15,
        lipPartScale:       20,
        jawDropThresh:      0.03,
        jawDropSlope:       10,
        mouthStretchThresh: 0.1,
        mouthStretchSlope:  5,
    },

    // ── FACS-классификатор ────────────────────────────────────────────────
    facs: {
        neutralBase:        0.25,
        neutralSuppress:    0.6,
        neutralMin:         0.02,

        happiness: {
            au12Thresh:     0.15,
            au12Weight:     0.75,
            au6Weight:      0.45,
        },
        sadness: {
            au1Thresh:      0.15,
            au15Thresh:     0.10,
            au1Weight:      0.35,
            au15Weight:     0.55,
            au17Weight:     0.25,
            maxScore:       0.9,
        },
        anger: {
            au4Thresh:      0.20,
            au4Weight:      0.65,
            au7Weight:      0.35,
            au23Weight:     0.30,
            maxScore:       0.9,
        },
        fear: {
            au5Thresh:      0.25,
            au1Thresh:      0.15,
            au2Thresh:      0.15,
            au1Weight:      0.25,
            au2Weight:      0.25,
            au4Weight:      0.25,
            au5Weight:      0.35,
            au20Weight:     0.25,
            maxScore:       0.85,
        },
        surprise: {
            au5Thresh:      0.30,
            au26Thresh:     0.15,
            au27Thresh:     0.10,
            au1Weight:      0.25,
            au2Weight:      0.30,
            au5Weight:      0.45,
            au26Weight:     0.35,
            au27Weight:     0.20,
            fearSuppressAu4Thresh:  0.15,
            fearSuppressFactor:     0.4,
        },
        disgust: {
            au9Thresh:      0.15,
            au10Thresh:     0.20,
            au9Weight:      0.65,
            au10Weight:     0.50,
            au15Weight:     0.20,
            maxScore:       0.85,
        },
        mixed: {
            joyfulSurprise: {
                au12Thresh:     0.25,
                au5Thresh:      0.25,
                au12Weight:     0.45,
                au5Weight:      0.30,
                maxMix:         0.6,
                happinessShare: 0.55,
                surpriseShare:  0.35,
            },
            fearfulSurprise: {
                au5Thresh:      0.35,
                au1Thresh:      0.25,
                au4Thresh:      0.15,
                au5Weight:      0.35,
                au1Weight:      0.30,
                au4Weight:      0.25,
                maxMix:         0.6,
                fearShare:      0.55,
                surpriseShare:  0.35,
            },
            angryDisgust: {
                au4Thresh:      0.25,
                au9Thresh:      0.15,
                au4Weight:      0.45,
                au9Weight:      0.45,
                maxMix:         0.6,
                angerShare:     0.45,
                disgustShare:   0.45,
            },
        },
    },

    // ── Аффективные измерения ─────────────────────────────────────────────
    affective: {
        valence: {
            surprisePositiveWeight: 0.30,
            sadnessWeight:          0.75,
            angerWeight:            0.90,
            fearWeight:             0.80,
            disgustWeight:          0.85,
        },
        arousal: {
            happinessWeight:        0.50,
            epsilon:                0.001,
        },
    },

    // ── Тренды / сглаживание ─────────────────────────────────────────────
    smoothing: {
        trendBoostFactor:   0.15,
        trendDampFactor:    0.10,
        trendThreshUp:      0.1,
        trendThreshDown:   -0.1,
        trendNormScale:     5,
    },

    // ── Динамический confidence ───────────────────────────────────────────
    confidence: {
        landmarksBase:          0.70,
        landmarksStabilityW:    0.20,
        landmarksValidFramesW:  0.10,
        metadataFaceOk:         0.35,
        metadataNoFace:         0.15,
        missing:                0.00,
    },

    // ── Эвристика (metadata path) ─────────────────────────────────────────
    heuristic: {
        illumValenceScale:      0.8,
        faceOkBonus:            0.2,
        faceFailPenalty:       -0.4,
        eyesOpenValue:          1.0,
        eyesClosedValue:        0.4,
        eyesValenceScale:       0.4,
        posePenaltyScale:       0.5,
        poseArousalScale:       0.9,
        illumArousalScale:      0.3,
        poseMagDivisor:         90,
        // [FIX] Коэффициенты нормализации hScores (были жёстко зашиты в public-api.js)
        hScores: {
            neutralArousalDamp:   0.3,   // neutral: 1 - |valence| - arousal * X
            happinessArousalDamp: 0.3,   // happiness * (1 - arousal * X)
            sadnessArousalDamp:   0.5,   // sadness   * (1 - arousal * X)
            angerScale:           0.5,   // anger = arousal * (-valence) * X
            fearBase:             0.2,   // fear  = arousal * X
            surpriseBase:         0.3,   // surprise = arousal * X
        },
    },
};
