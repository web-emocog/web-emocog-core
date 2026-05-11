/**
 * Улучшенный EmotionAnalyzer с использованием FACS (Facial Action Coding System)
 * для более точного распознавания эмоций на основе геометрии лица.
 *
 * Фаза 1.3: Face-emotions в браузере (valence / arousal).
 * Запись в sessionData.emotionSamples и агрегация для attentionMetrics / buildAggregatesPayload.
 *
 * @module emotion-stub-new
 */

// ─────────────────────────────────────────────────────────────────────────────
// Класс EmotionAnalyzer (FACS-версия)
// ─────────────────────────────────────────────────────────────────────────────

class EmotionAnalyzer {
    constructor() {
        this.emotionLabels = [
            'neutral',
            'happiness',
            'sadness',
            'anger',
            'fear',
            'surprise',
            'disgust'
        ];

        // Публичный алиас для совместимости с внешним кодом репозитория
        this.labels = this.emotionLabels;

        // Аффективные измерения
        this.affectiveDimensions = {
            valence: 0,
            arousal: 0
        };

        // Буфер событий эмоций
        this.emotionEvents = [];

        // Конфигурация
        this.config = {
            fps: 10,
            confidenceThreshold: 0.4,
            smoothingWindow: 5,
            recordRawScores: true,
            useActionUnits: true,
            useTemporalContext: true,
            temporalWindowSize: 10
        };

        // Состояние
        this.isRunning = false;
        this.lastAnalysisTime = 0;
        this.smoothingBuffer = [];
        this.temporalBuffer = [];
        this.faceLandmarker = null;
        this.emotionSession = null;
        this.faceMask = null;

        // Категории эмоций
        this.emotionCategories = {
            positive: ['happiness', 'surprise'],
            neutral: ['neutral'],
            negative: ['sadness', 'anger', 'fear', 'disgust']
        };

        // Счётчики категорий
        this.emotionCategoryCounts = {
            positive: 0,
            neutral: 0,
            negative: 0,
            total: 0
        };

        this.useFACSModel();

        console.log('[EmotionAnalyzer] Инициализирован с улучшенным FACS-анализом');
    }

    // ── Инициализация ────────────────────────────────────────────────────────

    async initialize(faceLandmarker) {
        try {
            console.log('[EmotionAnalyzer] Начало инициализации...');
            this.faceLandmarker = faceLandmarker;
            this.useFACSModel(); // Всегда используем только FACS-модель
            console.log('[EmotionAnalyzer] Инициализация завершена');
            return true;
        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка инициализации:', error);
            return false;
        }
    }



    useFACSModel() {
        console.log('[EmotionAnalyzer] Используется улучшенная FACS-модель на основе Action Units');
        this.emotionSession = 'facs';
    }

    // ── Запуск / остановка ───────────────────────────────────────────────────

    start(videoElement) {
        if (this.isRunning) {
            console.warn('[EmotionAnalyzer] Уже запущен');
            return;
        }
        this.isRunning = true;
        this.videoElement = videoElement;
        this.lastAnalysisTime = Date.now();
        this.resetEmotionCategoryCounts();
        console.log('[EmotionAnalyzer] ▶️ Запущен (режим: внешние landmarks + FACS)');
    }

    stop() {
        this.isRunning = false;
        console.log('[EmotionAnalyzer] ⏸️ Остановлен');
    }

    // ── Публичный адаптер для внешнего кода репозитория ─────────────────────

    /**
     * Адаптер: принимает массив landmarks (или один объект с полем landmarks),
     * возвращает { scores, valence, arousal, dominant } — формат, ожидаемый
     * функцией getEmotionSample() и остальным кодом репозитория.
     *
     * @param {Array} landmarks
     * @returns {{ scores: Object, valence: number, arousal: number, dominant: string }}
     */
    analyzeLandmarks(landmarks) {
        if (!landmarks || !Array.isArray(landmarks) || landmarks.length === 0) {
            return this._neutralResult();
        }

        try {
            const { actionUnits } = this.extractFacialFeatures(landmarks);
            const scores = this.analyzeEmotionWithFACS(landmarks, actionUnits);

            this.addToTemporalBuffer(scores);
            const smoothed = this.smoothEmotionScores(scores);
            const affective = this.calculateAffectiveDimensions(smoothed);
            const dominant = this.getDominantEmotion(smoothed);

            this.affectiveDimensions = affective;
            this.updateEmotionCategoryCount(dominant);

            return {
                scores: smoothed,
                valence: affective.valence,
                arousal: affective.arousal,
                dominant
            };
        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка analyzeLandmarks:', error);
            return this._neutralResult();
        }
    }

    /** @private */
    _neutralResult() {
        return {
            scores: { neutral: 1, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            valence: 0,
            arousal: 0,
            dominant: 'neutral'
        };
    }

    // ── Обработка landmarks (внутренний pipeline) ────────────────────────────

    processLandmarks(landmarks) {
        if (!this.isRunning || !landmarks || !Array.isArray(landmarks) || landmarks.length === 0) {
            this.recordEmotionEvent(null, 'no_landmarks');
            return;
        }

        try {
            const { faceMask, actionUnits } = this.extractFacialFeatures(landmarks);
            this.faceMask = faceMask;

            const emotionScores = this.analyzeEmotionWithFACS(landmarks, actionUnits);
            this.addToTemporalBuffer(emotionScores);
            const smoothedScores = this.smoothEmotionScores(emotionScores);
            const affectiveDimensions = this.calculateAffectiveDimensions(smoothedScores);
            this.affectiveDimensions = affectiveDimensions;
            const dominantEmotion = this.getDominantEmotion(smoothedScores);
            this.updateEmotionCategoryCount(dominantEmotion);

            this.recordEmotionEvent({
                scores: smoothedScores,
                actionUnits,
                affective: affectiveDimensions,
                dominant: dominantEmotion,
                faceMask: {
                    symmetry: faceMask.symmetry,
                    zonesCount: Object.keys(faceMask.zones).length
                }
            }, 'success');
        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка обработки landmarks:', error);
            this.recordEmotionEvent(null, 'error');
        }
    }

    // ── Извлечение признаков ─────────────────────────────────────────────────

    extractFacialFeatures(landmarks) {
        const faceMask = this.generateFaceMask(landmarks);
        const actionUnits = this.extractActionUnits(landmarks);
        return { faceMask, actionUnits };
    }

    /**
     * Генерация упрощённой маски лица (используется внутри processLandmarks).
     * Полная маска строится в FaceMaskCollector; здесь нужна только для
     * передачи symmetry в событие.
     */
    generateFaceMask(landmarks) {
        const noseTip = landmarks[1];
        const pairs = [[33, 263], [61, 291], [234, 454], [127, 356]];
        let totalAsymmetry = 0;

        for (const [l, r] of pairs) {
            const lp = landmarks[l];
            const rp = landmarks[r];
            const lDist = Math.abs(lp.x - noseTip.x);
            const rDist = Math.abs(rp.x - noseTip.x);
            totalAsymmetry += Math.abs(lDist - rDist) + Math.abs(lp.y - rp.y);
        }

        return {
            symmetry: { overall: +(totalAsymmetry / pairs.length).toFixed(4) },
            zones: { count: 11 } // FaceMaskCollector считает зоны детально
        };
    }

    extractActionUnits(landmarks) {
        const leftEyeTop        = landmarks[159];
        const leftEyeBottom     = landmarks[145];
        const rightEyeTop       = landmarks[386];
        const rightEyeBottom    = landmarks[374];
        const leftMouth         = landmarks[61];
        const rightMouth        = landmarks[291];
        const topLip            = landmarks[13];
        const bottomLip         = landmarks[14];
        const noseTip           = landmarks[1];
        const leftEyebrowOuter  = landmarks[70];
        const leftEyebrowInner  = landmarks[107];
        const rightEyebrowOuter = landmarks[300];
        const rightEyebrowInner = landmarks[336];
        const leftCheek         = landmarks[117];
        const rightCheek        = landmarks[346];
        const upperLipCenter    = landmarks[0];
        const lowerLipCenter    = landmarks[17];
        const leftNostril       = landmarks[203];
        const rightNostril      = landmarks[423];
        const chin              = landmarks[152];
        const foreheadCenter    = landmarks[10];

        const faceHeight  = this.calculateDistance(foreheadCenter, chin);
        const faceWidth   = this.calculateDistance(landmarks[234], landmarks[454]);
        const normFactor  = Math.sqrt(faceHeight * faceHeight + faceWidth * faceWidth);

        // AU1: Внутренний подъём брови
        const leftBrowRaise  = (noseTip.y - leftEyebrowInner.y)  / normFactor;
        const rightBrowRaise = (noseTip.y - rightEyebrowInner.y) / normFactor;
        const au1 = Math.min(1.0, (leftBrowRaise + rightBrowRaise) * 5);

        // AU2: Внешний подъём брови
        const leftOuterBrowRaise  = (noseTip.y - leftEyebrowOuter.y)  / normFactor;
        const rightOuterBrowRaise = (noseTip.y - rightEyebrowOuter.y) / normFactor;
        const au2 = Math.min(1.0, (leftOuterBrowRaise + rightOuterBrowRaise) * 5);

        // AU4: Сведение бровей
        const browDistance           = this.calculateDistance(leftEyebrowInner, rightEyebrowInner);
        const normalizedBrowDistance = browDistance / faceWidth;
        const au4 = Math.min(1.0, Math.max(0, 0.5 - normalizedBrowDistance * 3));

        // AU5: Поднятие верхнего века
        const leftEyeOpenness  = this.calculateDistance(leftEyeTop, leftEyeBottom)   / normFactor;
        const rightEyeOpenness = this.calculateDistance(rightEyeTop, rightEyeBottom) / normFactor;
        const au5 = Math.min(1.0, (leftEyeOpenness + rightEyeOpenness) * 15);

        // AU6: Поднятие щёк
        const leftCheekRaise  = (leftCheek.y  - leftEyeBottom.y)  / normFactor;
        const rightCheekRaise = (rightCheek.y - rightEyeBottom.y) / normFactor;
        const au6 = Math.min(1.0, Math.max(0, 0.2 - (leftCheekRaise + rightCheekRaise) * 2));

        // AU7: Сужение век
        const au7 = Math.min(1.0, Math.max(0, 0.05 - (leftEyeOpenness + rightEyeOpenness) * 0.5) * 10);

        // AU9: Сморщивание носа
        const nostrilDistance = this.calculateDistance(leftNostril, rightNostril) / normFactor;
        const au9 = Math.min(1.0, Math.max(0, 0.15 - nostrilDistance * 3));

        // AU10: Поднятие верхней губы
        const upperLipRaise = (noseTip.y - upperLipCenter.y) / normFactor;
        const au10 = Math.min(1.0, Math.max(0, 0.1 - upperLipRaise) * 10);

        // AU12: Растяжение уголков губ (улыбка)
        const mouthWidth = this.calculateDistance(leftMouth, rightMouth) / faceWidth;
        const au12 = Math.min(1.0, Math.max(0, mouthWidth - 0.4) * 5);

        // AU15: Опускание уголков губ
        const mouthCornerHeight = ((leftMouth.y + rightMouth.y) / 2 - upperLipCenter.y) / normFactor;
        const au15 = Math.min(1.0, Math.max(0, mouthCornerHeight - 0.02) * 10);

        // AU17: Поднятие подбородка
        const chinRaise = (lowerLipCenter.y - chin.y) / normFactor;
        const au17 = Math.min(1.0, Math.max(0, 0.1 - chinRaise) * 10);

        // AU20: Растяжение губ по горизонтали
        const au20 = Math.min(1.0, Math.max(0, mouthWidth - 0.35) * 4);

        // AU23: Сжатие губ
        const lipTightness = this.calculateDistance(upperLipCenter, lowerLipCenter) / normFactor;
        const au23 = Math.min(1.0, Math.max(0, 0.05 - lipTightness) * 15);

        // AU25: Разделение губ
        const mouthOpen = this.calculateDistance(topLip, bottomLip) / normFactor;
        const au25 = Math.min(1.0, mouthOpen * 20);

        // AU26: Отвисание челюсти
        const jawDrop = this.calculateDistance(upperLipCenter, lowerLipCenter) / normFactor;
        const au26 = Math.min(1.0, Math.max(0, jawDrop - 0.03) * 10);

        // AU27: Широкое открытие рта
        const au27 = Math.min(1.0, Math.max(0, mouthOpen - 0.1) * 5);

        return { AU1: au1, AU2: au2, AU4: au4, AU5: au5, AU6: au6, AU7: au7,
                 AU9: au9, AU10: au10, AU12: au12, AU15: au15, AU17: au17,
                 AU20: au20, AU23: au23, AU25: au25, AU26: au26, AU27: au27 };
    }

    // ── Классификация эмоций ─────────────────────────────────────────────────

    analyzeEmotionWithFACS(landmarks, actionUnits) {
        const scores = {
            neutral:   0.3,
            happiness: 0,
            sadness:   0,
            anger:     0,
            fear:      0,
            surprise:  0,
            disgust:   0
        };

        // Счастье: AU6 + AU12
        if (actionUnits.AU12 > 0.2) {
            scores.happiness = Math.min(1.0, actionUnits.AU12 * 0.8 + actionUnits.AU6 * 0.4);
            scores.neutral   = Math.max(0, scores.neutral - scores.happiness * 0.7);
        }

        // Грусть: AU1 + AU15 + AU17
        if (actionUnits.AU1 > 0.2 && actionUnits.AU15 > 0.1) {
            scores.sadness = Math.min(0.9, actionUnits.AU1 * 0.3 + actionUnits.AU15 * 0.6 + actionUnits.AU17 * 0.3);
            scores.neutral = Math.max(0, scores.neutral - scores.sadness * 0.6);
        }

        // Гнев: AU4 + AU7 + AU23
        if (actionUnits.AU4 > 0.2) {
            scores.anger   = Math.min(0.9, actionUnits.AU4 * 0.7 + actionUnits.AU7 * 0.4 + actionUnits.AU23 * 0.3);
            scores.neutral = Math.max(0, scores.neutral - scores.anger * 0.7);
        }

        // Страх: AU1/AU2 + AU5 + AU20
        if (actionUnits.AU5 > 0.3 && (actionUnits.AU1 > 0.2 || actionUnits.AU2 > 0.2)) {
            scores.fear    = Math.min(0.8, actionUnits.AU1 * 0.3 + actionUnits.AU2 * 0.3 +
                                          actionUnits.AU4 * 0.2 + actionUnits.AU5 * 0.4 + actionUnits.AU20 * 0.2);
            scores.neutral = Math.max(0, scores.neutral - scores.fear * 0.6);
        }

        // Удивление: AU1/AU2 + AU5 + AU26
        if (actionUnits.AU5 > 0.4 && actionUnits.AU26 > 0.2) {
            scores.surprise = Math.min(1.0, actionUnits.AU1 * 0.3 + actionUnits.AU2 * 0.3 +
                                           actionUnits.AU5 * 0.5 + actionUnits.AU26 * 0.5);
            scores.neutral  = Math.max(0, scores.neutral - scores.surprise * 0.8);
        }

        // Отвращение: AU9 + AU10 + AU15
        if (actionUnits.AU9 > 0.2 || actionUnits.AU10 > 0.3) {
            scores.disgust = Math.min(0.8, actionUnits.AU9 * 0.7 + actionUnits.AU10 * 0.5 + actionUnits.AU15 * 0.2);
            scores.neutral = Math.max(0, scores.neutral - scores.disgust * 0.7);
        }

        // Смешанные состояния
        if (actionUnits.AU12 > 0.3 && actionUnits.AU5 > 0.3) {
            const mix = Math.min(0.7, actionUnits.AU12 * 0.5 + actionUnits.AU5 * 0.3);
            scores.happiness += mix * 0.6;
            scores.surprise  += mix * 0.4;
            scores.neutral    = Math.max(0, scores.neutral - mix * 0.5);
        }

        if (actionUnits.AU5 > 0.4 && actionUnits.AU1 > 0.3 && actionUnits.AU4 > 0.2) {
            const mix = Math.min(0.7, actionUnits.AU5 * 0.4 + actionUnits.AU1 * 0.3 + actionUnits.AU4 * 0.3);
            scores.fear     += mix * 0.5;
            scores.surprise += mix * 0.5;
            scores.neutral   = Math.max(0, scores.neutral - mix * 0.5);
        }

        if (actionUnits.AU4 > 0.3 && actionUnits.AU9 > 0.2) {
            const mix = Math.min(0.7, actionUnits.AU4 * 0.5 + actionUnits.AU9 * 0.5);
            scores.anger   += mix * 0.5;
            scores.disgust += mix * 0.5;
            scores.neutral  = Math.max(0, scores.neutral - mix * 0.5);
        }

        // Нормализация
        const total = Object.values(scores).reduce((sum, v) => sum + v, 0);
        if (total > 0) {
            for (const emotion in scores) scores[emotion] /= total;
        }

        return scores;
    }

    // ── Временной контекст и сглаживание ────────────────────────────────────

    addToTemporalBuffer(scores) {
        this.temporalBuffer.push({ scores, timestamp: Date.now() });
        if (this.temporalBuffer.length > this.config.temporalWindowSize) {
            this.temporalBuffer.shift();
        }
    }

    smoothEmotionScores(currentScores) {
        this.smoothingBuffer.push(currentScores);
        if (this.smoothingBuffer.length > this.config.smoothingWindow) {
            this.smoothingBuffer.shift();
        }

        if (this.config.useTemporalContext && this.temporalBuffer.length >= 3) {
            const trends  = this.calculateEmotionTrends();
            const smoothed = this.basicSmoothing();

            for (const emotion of this.emotionLabels) {
                if (trends[emotion] > 0.1) {
                    smoothed[emotion] = Math.min(1.0, smoothed[emotion] * (1 + trends[emotion] * 0.2));
                } else if (trends[emotion] < -0.1) {
                    smoothed[emotion] = Math.max(0, smoothed[emotion] * (1 + trends[emotion] * 0.1));
                }
            }

            const total = Object.values(smoothed).reduce((s, v) => s + v, 0);
            if (total > 0) for (const e in smoothed) smoothed[e] /= total;

            return smoothed;
        }

        return this.basicSmoothing();
    }

    basicSmoothing() {
        const smoothed = {};
        for (const emotion of this.emotionLabels) {
            let weightedSum = 0, weightSum = 0;
            for (let i = 0; i < this.smoothingBuffer.length; i++) {
                const w = i + 1;
                weightedSum += (this.smoothingBuffer[i][emotion] || 0) * w;
                weightSum   += w;
            }
            smoothed[emotion] = weightSum > 0 ? weightedSum / weightSum : 0;
        }
        return smoothed;
    }

    calculateEmotionTrends() {
        const trends = {};
        if (this.temporalBuffer.length < 3) {
            for (const e of this.emotionLabels) trends[e] = 0;
            return trends;
        }
        const recent = this.temporalBuffer.slice(-3);
        for (const emotion of this.emotionLabels) {
            const values = recent.map(item => item.scores[emotion] || 0);
            trends[emotion] = Math.max(-1, Math.min(1, ((values[2] - values[0]) / 2) * 5));
        }
        return trends;
    }

    // ── Аффективные измерения ────────────────────────────────────────────────

    calculateAffectiveDimensions(scores) {
        const positiveValence = scores.happiness + scores.surprise * 0.3;
        const negativeValence = scores.sadness * 0.7 + scores.anger * 0.9 +
                                scores.fear * 0.8 + scores.disgust * 0.9;
        const valence = Math.max(-1, Math.min(1, positiveValence - negativeValence));

        const highArousal = scores.anger + scores.fear + scores.surprise + scores.happiness * 0.5;
        const lowArousal  = scores.sadness + scores.neutral;
        const arousal     = Math.max(0, Math.min(1,
            highArousal / (highArousal + lowArousal + 0.001)
        ));

        return { valence, arousal };
    }

    // ── Вспомогательные методы ───────────────────────────────────────────────

    getDominantEmotion(scores) {
        return this.emotionLabels.reduce(
            (best, label) => (scores[label] > scores[best] ? label : best),
            'neutral'
        );
    }

    updateEmotionCategoryCount(emotion) {
        this.emotionCategoryCounts.total++;
        if (this.emotionCategories.positive.includes(emotion)) {
            this.emotionCategoryCounts.positive++;
        } else if (this.emotionCategories.negative.includes(emotion)) {
            this.emotionCategoryCounts.negative++;
        } else {
            this.emotionCategoryCounts.neutral++;
        }
    }

    resetEmotionCategoryCounts() {
        this.emotionCategoryCounts = { positive: 0, neutral: 0, negative: 0, total: 0 };
    }

    recordEmotionEvent(data, status) {
        this.emotionEvents.push({ timestamp: Date.now(), status, data });
        if (this.emotionEvents.length > 1000) this.emotionEvents.shift();
    }

    calculateDistance(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = (p1.z || 0) - (p2.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    getEmotionCategoryStats() {
        const { positive, neutral, negative, total } = this.emotionCategoryCounts;
        if (total === 0) return { positive: 0, neutral: 1, negative: 0 };
        return {
            positive: positive / total,
            neutral:  neutral  / total,
            negative: negative / total
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Модульный уровень (совместимость с репозиторием)
// ─────────────────────────────────────────────────────────────────────────────

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
    const smile      = (b('mouthSmileLeft') + b('mouthSmileRight')) / 2;
    const frown      = (b('mouthFrownLeft') + b('mouthFrownRight')) / 2;
    const browDown   = (b('browDownLeft')   + b('browDownRight'))   / 2;
    const browInnerUp = b('browInnerUp');
    const eyeWide    = (b('eyeWideLeft')    + b('eyeWideRight'))    / 2;
    const jawOpen    = b('jawOpen');

    scores.happiness += smile * 1.1;
    scores.sadness   += frown * 0.95 + browInnerUp * 0.35;
    scores.anger     += browDown * 0.85;
    scores.surprise  += eyeWide * 0.7 + jawOpen * 0.55;
    scores.fear      += browInnerUp * 0.5 + eyeWide * 0.35;
    scores.disgust   += (b('noseSneerLeft') + b('noseSneerRight')) / 2 * 0.9;
    scores.neutral    = Math.max(0.05, scores.neutral - (smile + frown + browDown + jawOpen) * 0.08);

    return scores;
}

/**
 * Основная функция-экспорт: анализ эмоций по данным precheck.
 * Использует FACS-анализ (landmarks) + опциональные blend shapes.
 *
 * @param {Object} [precheckResult]
 * @returns {{ valence: number, arousal: number, dominant: string, scores: Object, confidence: number, dataQuality: string }}
 */
export function getEmotionSample(precheckResult) {
    // ── Путь 1: есть landmarks → полный FACS-анализ ──────────────────────────
    if (Array.isArray(precheckResult?.landmarks) && precheckResult.landmarks.length > 0) {
        let modeled = analyzer.analyzeLandmarks(precheckResult.landmarks);

        // Опционально уточняем blend shapes
        if (precheckResult.blendShapes && modeled.scores) {
            const s = { ...modeled.scores };
            mergeBlendShapesIntoScores(s, precheckResult.blendShapes);

            const total = Object.values(s).reduce((a, v) => a + v, 0) || 1;
            for (const k of Object.keys(s)) s[k] /= total;

            const dominant = analyzer.labels.reduce(
                (best, label) => (s[label] > s[best] ? label : best), 'neutral'
            );
            const positive = (s.happiness || 0) + (s.surprise || 0) * 0.5;
            const negative = (s.sadness || 0) + (s.anger || 0) + (s.fear || 0) + (s.disgust || 0);
            const valence  = clamp(positive - negative, -1, 1);

            const highArousal = (s.anger || 0) + (s.fear || 0) + (s.surprise || 0);
            const lowArousal  = (s.sadness || 0) + (s.neutral || 0);
            const arousal     = clamp(highArousal / (highArousal + lowArousal + 0.001), 0, 1);

            modeled = { scores: s, valence, arousal, dominant };
        }

        lastValence = modeled.valence;
        lastArousal = modeled.arousal;
        
        // Добавляем метаданные о качестве
        return {
            ...modeled,
            confidence: 0.95,
            dataQuality: 'high',
            dataSource: 'landmarks'
        };
    }

    // ── Путь 2: нет данных → возвращаем признак отсутствия данных ────────────
    if (!precheckResult || typeof precheckResult !== 'object') {
        return {
            valence: null,
            arousal: null,
            dominant: 'unknown',
            scores: { neutral: 0, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            confidence: 0,
            dataQuality: 'missing',
            dataSource: 'none',
            missingData: true
        };
    }

    // ── Путь 3: нет landmarks, но есть мета-данные precheck → эвристика ──────
    const illumRaw  = num(precheckResult?.illumination?.meanBrightness, 0.5);
    const illumNorm = clamp(illumRaw <= 1 ? illumRaw : illumRaw / 255, 0, 1);
    const faceOk    = precheckResult?.face?.detected !== false;
    const pose      = precheckResult?.pose || {};

    const yaw   = Math.abs(num(pose.yaw,   0));
    const pitch = Math.abs(num(pose.pitch, 0));
    const roll  = Math.abs(num(pose.roll,  0));
    const poseMagnitude = Math.min(1, (yaw + pitch + roll) / 90);

    const eyes     = precheckResult?.eyes || {};
    const eyesOpen = eyes?.bothOpen === true ? 1 : 0.4;

    const valenceRaw =
        (illumNorm - 0.5) * 0.8 +
        (faceOk ? 0.2 : -0.4) +
        (eyesOpen - 0.5) * 0.4 -
        poseMagnitude * 0.5;

    const arousalRaw =
        poseMagnitude * 0.9 +
        (1 - illumNorm) * 0.3;

    const valence = clamp(valenceRaw, -1, 1);
    const arousal = clamp(arousalRaw,  0, 1);

    lastValence = valence;
    lastArousal = arousal;

    // Определяем уровень доверия к эвристическим данным
    const confidence = faceOk ? 0.4 : 0.2;

    return {
        valence,
        arousal,
        dominant: valence > 0.2 ? 'happiness' : valence < -0.2 ? 'sadness' : 'neutral',
        scores: {
            neutral:   Math.max(0, 1 - Math.abs(valence) - arousal * 0.3),
            happiness: Math.max(0, valence) * (1 - arousal * 0.3),
            sadness:   Math.max(0, -valence) * (1 - arousal * 0.5),
            anger:     arousal * Math.max(0, -valence) * 0.5,
            fear:      arousal * 0.2,
            surprise:  arousal * Math.max(0, valence) * 0.3,
            disgust:   0
        },
        confidence,
        dataQuality: 'low',
        dataSource: 'metadata',
        isHeuristic: true
    };
}

export { EmotionAnalyzer };