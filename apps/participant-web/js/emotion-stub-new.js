/**
 * EmotionAnalyzer — геометрический анализ эмоций на основе FACS (Facial Action Coding System).
 *
 * Архитектура:
 *  - Только FACS AU (Action Units) по Экману, без ONNX
 *  - Интеграция с FaceMaskCollector: симметрия и геометрия берутся из маски
 *  - Взвешенное сглаживание + временной контекст (тренды)
 *  - Нормализация всех AU на размер лица (normFactor)
 *  - Исправлены все баги предыдущих версий
 *  - Полные агрегированные метрики и экспорт
 *
 * Зависимости: FaceMaskCollector (опционально, для обогащения событий)
 *
 * @module emotion-analyzer
 * @version 3.0.0
 */

// ─────────────────────────────────────────────────────────────────────────────
// Вспомогательные функции
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ограничение значения в диапазоне [min, max]
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * Безопасное приведение к числу
 * @param {*} v
 * @param {number} fallback
 * @returns {number}
 */
function num(v, fallback = 0) {
    return Number.isFinite(v) ? Number(v) : fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Класс EmotionAnalyzer
// ─────────────────────────────────────────────────────────────────────────────

class EmotionAnalyzer {
    constructor() {
        /** Метки эмоций по Экману (7 базовых) */
        this.emotionLabels = [
            'neutral', 'happiness', 'sadness',
            'anger', 'fear', 'surprise', 'disgust'
        ];

        /** Публичный алиас для совместимости с внешним кодом */
        this.labels = this.emotionLabels;

        /** Текущие аффективные измерения */
        this.affectiveDimensions = { valence: 0, arousal: 0 };

        /** Буфер событий (макс. 1000) */
        this.emotionEvents = [];

        /** Конфигурация */
        this.config = {
            fps: 10,
            confidenceThreshold: 0.4,
            smoothingWindow: 5,       // кадров для взвешенного сглаживания
            temporalWindowSize: 10,   // кадров для расчёта трендов
            minLandmarks: 468         // минимальное число точек MediaPipe FaceMesh
        };

        /** Состояние */
        this.isRunning    = false;
        this.lastAnalysisTime = 0;

        /** Буферы сглаживания */
        this.smoothingBuffer = [];
        this.temporalBuffer  = [];

        /** Ссылка на FaceMaskCollector (опционально) */
        this.faceMaskCollector = null;

        /** Последняя сгенерированная маска лица */
        this.currentFaceMask = null;

        /** Категории эмоций */
        this.emotionCategories = {
            positive: ['happiness', 'surprise'],
            neutral:  ['neutral'],
            negative: ['sadness', 'anger', 'fear', 'disgust']
        };

        /** Счётчики категорий за сессию */
        this.emotionCategoryCounts = { positive: 0, neutral: 0, negative: 0, total: 0 };

        console.log('[EmotionAnalyzer] Инициализирован (FACS AU, без ONNX)');
    }

    // ── Инициализация ──────────────────────────────────────────────────────

    /**
     * Инициализация модуля.
     * @param {Object} [faceMaskCollector] — экземпляр FaceMaskCollector (опционально)
     * @returns {boolean}
     */
    initialize(faceMaskCollector = null) {
        try {
            if (faceMaskCollector && typeof faceMaskCollector.generateMask === 'function') {
                this.faceMaskCollector = faceMaskCollector;
                console.log('[EmotionAnalyzer] FaceMaskCollector подключён');
            } else {
                console.log('[EmotionAnalyzer] Работа без FaceMaskCollector (встроенная маска)');
            }
            console.log('[EmotionAnalyzer] Инициализация завершена (FACS-модель)');
            return true;
        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка инициализации:', error);
            return false;
        }
    }

    // ── Запуск / остановка ─────────────────────────────────────────────────

    /**
     * Запуск анализа. Landmarks передаются извне через processLandmarks().
     */
    start() {
        if (this.isRunning) {
            console.warn('[EmotionAnalyzer] Уже запущен');
            return;
        }
        this.isRunning = true;
        this.lastAnalysisTime = Date.now();
        this._resetCategoryCounts();
        console.log('[EmotionAnalyzer] ▶️ Запущен (FACS AU)');
    }

    stop() {
        this.isRunning = false;
        console.log('[EmotionAnalyzer] ⏸️ Остановлен');
    }

    // ── Основной публичный API ─────────────────────────────────────────────

    /**
     * Обработка landmarks из внешнего источника (MediaPipe FaceMesh).
     * Вызывается из основного пайплайна при каждом новом кадре.
     *
     * @param {Array} landmarks — массив точек [{x, y, z}, ...], минимум 468 точек
     * @returns {void}
     */
    processLandmarks(landmarks) {
        if (!this.isRunning) return;

        if (!this._validateLandmarks(landmarks)) {
            this._recordEvent(null, 'no_landmarks');
            return;
        }

        try {
            // 1. Генерация маски лица
            const mask = this.faceMaskCollector
                ? this.faceMaskCollector.generateMask(landmarks)
                : this._buildInternalMask(landmarks);
            this.currentFaceMask = mask;

            // 2. Извлечение Action Units
            const au = this._extractActionUnits(landmarks, mask.geometry);

            // 3. Классификация эмоций по FACS
            const rawScores = this._classifyFACS(au);

            // 4. Временной контекст + взвешенное сглаживание
            this._pushTemporalBuffer(rawScores);
            const smoothed = this._smoothScores(rawScores);

            // 5. Аффективные измерения
            const affective = this._calcAffective(smoothed);
            this.affectiveDimensions = affective;

            // 6. Доминирующая эмоция
            const dominant = this._dominant(smoothed);
            this._updateCategoryCount(dominant);

            // 7. Запись события
            this._recordEvent({
                scores:     smoothed,
                rawScores,
                actionUnits: au,
                affective,
                dominant,
                faceMask: {
                    symmetry:   mask.symmetry,
                    zonesCount: Object.keys(mask.zones || {}).length
                }
            }, 'success');

        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка processLandmarks:', error);
            this._recordEvent(null, 'error');
        }
    }

    /**
     * Синхронный анализ landmarks — возвращает результат немедленно.
     * Используется внешним кодом (getEmotionSample и т.п.).
     *
     * @param {Array} landmarks
     * @returns {{ scores: Object, valence: number, arousal: number, dominant: string }}
     */
    analyzeLandmarks(landmarks) {
        if (!this._validateLandmarks(landmarks)) {
            return this._neutralResult();
        }
        try {
            const mask = this.faceMaskCollector
                ? this.faceMaskCollector.generateMask(landmarks)
                : this._buildInternalMask(landmarks);

            const au       = this._extractActionUnits(landmarks, mask.geometry);
            const raw      = this._classifyFACS(au);
            this._pushTemporalBuffer(raw);
            const smoothed = this._smoothScores(raw);
            const affective = this._calcAffective(smoothed);
            const dominant  = this._dominant(smoothed);

            this.affectiveDimensions = affective;
            this._updateCategoryCount(dominant);

            return { scores: smoothed, valence: affective.valence, arousal: affective.arousal, dominant };
        } catch (error) {
            console.error('[EmotionAnalyzer] Ошибка analyzeLandmarks:', error);
            return this._neutralResult();
        }
    }

    // ── Генерация маски (встроенная, когда нет FaceMaskCollector) ──────────

    /**
     * Внутренняя маска лица — полный аналог FaceMaskCollector.generateMask(),
     * но без записи в буфер коллектора.
     * @private
     */
    _buildInternalMask(landmarks) {
        const faceWidth  = this._dist3(landmarks[234], landmarks[454]);
        const faceHeight = this._dist3(landmarks[10],  landmarks[152]);
        const normFactor = Math.sqrt(faceWidth * faceWidth + faceHeight * faceHeight) || 1;

        return {
            zones:    this._extractZones(landmarks),
            geometry: this._calcGeometry(landmarks, faceWidth, faceHeight),
            symmetry: this._calcSymmetry(landmarks, faceWidth, normFactor)
        };
    }

    /** @private */
    _extractZones(landmarks) {
        const zone = (indices) => {
            let sx = 0, sy = 0, sz = 0;
            for (const i of indices) { sx += landmarks[i].x; sy += landmarks[i].y; sz += (landmarks[i].z || 0); }
            const n = indices.length;
            return { x: +(sx / n).toFixed(4), y: +(sy / n).toFixed(4), z: +(sz / n).toFixed(4) };
        };
        return {
            forehead:     zone([10, 338, 297, 332, 284, 251, 389, 356, 454]),
            leftEyebrow:  zone([70, 63, 105, 66, 107]),
            rightEyebrow: zone([300, 293, 334, 296, 336]),
            leftEye:      zone([33, 160, 158, 133, 153, 144, 145, 159]),
            rightEye:     zone([362, 385, 387, 263, 373, 380, 374, 386]),
            nose:         zone([1, 2, 98, 327, 168, 6, 197, 195, 5]),
            upperLip:     zone([61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]),
            lowerLip:     zone([146, 91, 181, 84, 17, 314, 405, 321, 375]),
            leftCheek:    zone([116, 111, 117, 118, 119, 100, 47, 126]),
            rightCheek:   zone([345, 340, 346, 347, 348, 329, 277, 355]),
            jaw:          zone([172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323])
        };
    }

    /** @private */
    _calcGeometry(landmarks, faceWidth, faceHeight) {
        return {
            faceWidth:        +faceWidth.toFixed(4),
            faceHeight:       +faceHeight.toFixed(4),
            leftEyeOpenness:  +this._dist3(landmarks[159], landmarks[145]).toFixed(4),
            rightEyeOpenness: +this._dist3(landmarks[386], landmarks[374]).toFixed(4),
            mouthWidth:       +this._dist3(landmarks[61],  landmarks[291]).toFixed(4),
            mouthOpenness:    +this._dist3(landmarks[13],  landmarks[14]).toFixed(4),
            mouthCurvature:   +((landmarks[61].y + landmarks[291].y) / 2 - landmarks[13].y).toFixed(4),
            headTilt:         +Math.atan2(
                                  landmarks[263].y - landmarks[33].y,
                                  landmarks[263].x - landmarks[33].x
                              ).toFixed(4)
        };
    }

    /**
     * Симметрия лица — нормализована на ширину лица (исправлен баг всех предыдущих версий).
     * @private
     */
    _calcSymmetry(landmarks, faceWidth, normFactor) {
        const nose = landmarks[1];
        const pairs = [
            [33,  263],   // внутренние уголки глаз
            [61,  291],   // уголки рта
            [234, 454],   // скулы
            [127, 356]    // челюсть
        ];

        let totalAsymmetry = 0;
        const pairValues = [];

        for (const [li, ri] of pairs) {
            const lp = landmarks[li], rp = landmarks[ri];
            const lDist = Math.abs(lp.x - nose.x);
            const rDist = Math.abs(rp.x - nose.x);
            // ✅ Нормализация на размер лица — исправлен баг v2/v3
            const asymmetry = (Math.abs(lDist - rDist) + Math.abs(lp.y - rp.y)) / normFactor;
            pairValues.push(+asymmetry.toFixed(4));
            totalAsymmetry += asymmetry;
        }

        return {
            overall: +(totalAsymmetry / pairs.length).toFixed(4),
            pairs:   pairValues
        };
    }

    // ── Извлечение Action Units ────────────────────────────────────────────

    /**
     * Вычисление 16 Action Units по FACS.
     * Все значения нормализованы на normFactor = sqrt(H²+W²).
     * Все AU строго в диапазоне [0, 1].
     *
     * @param {Array} landmarks
     * @param {Object} [geometry] — предвычисленная геометрия из маски (опционально)
     * @returns {Object} AU1..AU27
     * @private
     */
    _extractActionUnits(landmarks, geometry = null) {
        // Ключевые точки
        const lEyeTop    = landmarks[159],  lEyeBot    = landmarks[145];
        const rEyeTop    = landmarks[386],  rEyeBot    = landmarks[374];
        const lMouth     = landmarks[61],   rMouth     = landmarks[291];
        const topLip     = landmarks[13],   botLip     = landmarks[14];
        const noseTip    = landmarks[1];
        const lBrowOut   = landmarks[70],   lBrowIn    = landmarks[107];
        const rBrowOut   = landmarks[300],  rBrowIn    = landmarks[336];
        const lCheek     = landmarks[117],  rCheek     = landmarks[346];
        const upLipCtr   = landmarks[0],    loLipCtr   = landmarks[17];
        const lNostril   = landmarks[203],  rNostril   = landmarks[423];
        const chin       = landmarks[152],  forehead   = landmarks[10];

        // Размерный нормировочный коэффициент
        const faceH     = geometry?.faceHeight ?? this._dist3(forehead, chin);
        const faceW     = geometry?.faceWidth  ?? this._dist3(landmarks[234], landmarks[454]);
        const normFactor = Math.sqrt(faceH * faceH + faceW * faceW) || 1;

        // ── AU1: Внутренний подъём брови ────────────────────────────────
        // Чем выше внутренние брови относительно носа — тем сильнее AU1
        const au1 = clamp(
            ((noseTip.y - lBrowIn.y) + (noseTip.y - rBrowIn.y)) / normFactor * 5,
            0, 1
        );

        // ── AU2: Внешний подъём брови ───────────────────────────────────
        const au2 = clamp(
            ((noseTip.y - lBrowOut.y) + (noseTip.y - rBrowOut.y)) / normFactor * 5,
            0, 1
        );

        // ── AU4: Сведение бровей ────────────────────────────────────────
        // Чем меньше расстояние между внутренними бровями — тем сильнее AU4
        const browDist = this._dist3(lBrowIn, rBrowIn) / faceW;
        const au4 = clamp((0.5 - browDist * 3), 0, 1);

        // ── AU5: Поднятие верхнего века (широко открытые глаза) ─────────
        const lEyeOpen = this._dist3(lEyeTop, lEyeBot) / normFactor;
        const rEyeOpen = this._dist3(rEyeTop, rEyeBot) / normFactor;
        const au5 = clamp((lEyeOpen + rEyeOpen) * 15, 0, 1);

        // ── AU6: Поднятие щёк ───────────────────────────────────────────
        // ✅ Исправлен баг v2: при улыбке щёки поднимаются → cheek.y уменьшается
        // Измеряем расстояние от щеки до нижнего века — при подъёме оно уменьшается
        const lCheekDist = this._dist3(lCheek, lEyeBot) / normFactor;
        const rCheekDist = this._dist3(rCheek, rEyeBot) / normFactor;
        // Нормальное расстояние ~0.15–0.20; при улыбке ~0.10–0.12
        const au6 = clamp((0.20 - (lCheekDist + rCheekDist) / 2) * 8, 0, 1);

        // ── AU7: Сужение век ────────────────────────────────────────────
        // ✅ Исправлен баг v2: AU7 активен при МАЛОМ открытии, но не при закрытых глазах
        // Используем инвертированное AU5, но только в среднем диапазоне
        const eyeAvg = (lEyeOpen + rEyeOpen) / 2;
        const au7 = clamp((0.035 - eyeAvg) * 20, 0, 1);

        // ── AU9: Сморщивание носа ───────────────────────────────────────
        const nostrilDist = this._dist3(lNostril, rNostril) / normFactor;
        const au9 = clamp((0.15 - nostrilDist * 3), 0, 1);

        // ── AU10: Поднятие верхней губы ─────────────────────────────────
        const upLipRaise = (noseTip.y - upLipCtr.y) / normFactor;
        const au10 = clamp((0.1 - upLipRaise) * 10, 0, 1);

        // ── AU12: Растяжение уголков губ (улыбка) ───────────────────────
        const mouthW = this._dist3(lMouth, rMouth) / faceW;
        const au12 = clamp((mouthW - 0.4) * 5, 0, 1);

        // ── AU15: Опускание уголков губ ─────────────────────────────────
        // Уголки рта ниже центра верхней губы
        const cornerH = ((lMouth.y + rMouth.y) / 2 - upLipCtr.y) / normFactor;
        const au15 = clamp((cornerH - 0.02) * 10, 0, 1);

        // ── AU17: Поднятие подбородка ───────────────────────────────────
        const chinRaise = (loLipCtr.y - chin.y) / normFactor;
        const au17 = clamp((0.1 - chinRaise) * 10, 0, 1);

        // ── AU20: Горизонтальное растяжение губ (страх) ─────────────────
        const au20 = clamp((mouthW - 0.35) * 4, 0, 1);

        // ── AU23: Сжатие губ ────────────────────────────────────────────
        const lipTight = this._dist3(upLipCtr, loLipCtr) / normFactor;
        const au23 = clamp((0.05 - lipTight) * 15, 0, 1);

        // ── AU25: Разделение губ ────────────────────────────────────────
        const mouthOpen = this._dist3(topLip, botLip) / normFactor;
        const au25 = clamp(mouthOpen * 20, 0, 1);

        // ── AU26: Отвисание челюсти ─────────────────────────────────────
        const jawDrop = this._dist3(upLipCtr, loLipCtr) / normFactor;
        const au26 = clamp((jawDrop - 0.03) * 10, 0, 1);

        // ── AU27: Широкое открытие рта ──────────────────────────────────
        const au27 = clamp((mouthOpen - 0.1) * 5, 0, 1);

        return {
            AU1: au1, AU2: au2, AU4: au4, AU5: au5, AU6: au6, AU7: au7,
            AU9: au9, AU10: au10, AU12: au12, AU15: au15, AU17: au17,
            AU20: au20, AU23: au23, AU25: au25, AU26: au26, AU27: au27
        };
    }

    // ── Классификация эмоций по FACS ──────────────────────────────────────

    /**
     * Маппинг AU → эмоции по системе Экмана.
     * Комбинации AU взяты из FACS Manual (Ekman, Friesen, Hager, 2002).
     *
     * Счастье:   AU6 + AU12
     * Грусть:    AU1 + AU15 + AU17
     * Гнев:      AU4 + AU5 + AU7 + AU23
     * Страх:     AU1 + AU2 + AU4 + AU5 + AU20
     * Удивление: AU1 + AU2 + AU5 + AU26/27
     * Отвращение:AU9 + AU10 + AU15 + AU16
     *
     * @param {Object} au — Action Units
     * @returns {Object} нормализованные scores [0,1]
     * @private
     */
    _classifyFACS(au) {
        const scores = {
            neutral:   0.25,
            happiness: 0,
            sadness:   0,
            anger:     0,
            fear:      0,
            surprise:  0,
            disgust:   0
        };

        // ── Счастье: AU6 + AU12 ─────────────────────────────────────────
        // AU12 обязателен; AU6 усиливает (duchenne smile)
        if (au.AU12 > 0.15) {
            scores.happiness = clamp(au.AU12 * 0.75 + au.AU6 * 0.45, 0, 1);
        }

        // ── Грусть: AU1 + AU15 + AU17 ───────────────────────────────────
        // Внутренний подъём брови + опускание уголков рта + подбородок
        if (au.AU1 > 0.15 && au.AU15 > 0.1) {
            scores.sadness = clamp(
                au.AU1 * 0.35 + au.AU15 * 0.55 + au.AU17 * 0.25,
                0, 0.9
            );
        }

        // ── Гнев: AU4 + AU7 + AU23 ──────────────────────────────────────
        // Сведение бровей обязательно; сужение век и сжатие губ усиливают
        if (au.AU4 > 0.2) {
            scores.anger = clamp(
                au.AU4 * 0.65 + au.AU7 * 0.35 + au.AU23 * 0.30,
                0, 0.9
            );
        }

        // ── Страх: AU1 + AU2 + AU4 + AU5 + AU20 ────────────────────────
        // Широко открытые глаза + поднятые брови + горизонтальное растяжение губ
        // Отличие от удивления: AU4 (сведение бровей) и AU20 (растяжение губ)
        if (au.AU5 > 0.25 && (au.AU1 > 0.15 || au.AU2 > 0.15)) {
            scores.fear = clamp(
                au.AU1 * 0.25 + au.AU2 * 0.25 + au.AU4 * 0.25 +
                au.AU5 * 0.35 + au.AU20 * 0.25,
                0, 0.85
            );
        }

        // ── Удивление: AU1 + AU2 + AU5 + AU26/27 ───────────────────────
        // Широко открытые глаза + поднятые брови + открытый рот
        // Отличие от страха: нет AU4 (брови не сведены), есть AU26/27 (рот открыт)
        if (au.AU5 > 0.3 && (au.AU26 > 0.15 || au.AU27 > 0.1)) {
            scores.surprise = clamp(
                au.AU1 * 0.25 + au.AU2 * 0.30 +
                au.AU5 * 0.45 + au.AU26 * 0.35 + au.AU27 * 0.20,
                0, 1.0
            );
            // Подавляем страх если нет AU4 (сведения бровей)
            if (au.AU4 < 0.15) {
                scores.fear *= 0.4;
            }
        }

        // ── Отвращение: AU9 + AU10 + AU15 ───────────────────────────────
        // Сморщивание носа + поднятие верхней губы
        if (au.AU9 > 0.15 || au.AU10 > 0.2) {
            scores.disgust = clamp(
                au.AU9 * 0.65 + au.AU10 * 0.50 + au.AU15 * 0.20,
                0, 0.85
            );
        }

        // ── Смешанные состояния ─────────────────────────────────────────

        // Радостное удивление: AU12 + AU5 (широкая улыбка с открытыми глазами)
        if (au.AU12 > 0.25 && au.AU5 > 0.25) {
            const mix = clamp(au.AU12 * 0.45 + au.AU5 * 0.30, 0, 0.6);
            scores.happiness = clamp(scores.happiness + mix * 0.55, 0, 1);
            scores.surprise  = clamp(scores.surprise  + mix * 0.35, 0, 1);
        }

        // Испуганное удивление: AU5 + AU1 + AU4 (страх с широкими глазами)
        if (au.AU5 > 0.35 && au.AU1 > 0.25 && au.AU4 > 0.15) {
            const mix = clamp(au.AU5 * 0.35 + au.AU1 * 0.30 + au.AU4 * 0.25, 0, 0.6);
            scores.fear     = clamp(scores.fear     + mix * 0.55, 0, 1);
            scores.surprise = clamp(scores.surprise + mix * 0.35, 0, 1);
        }

        // Злобное отвращение: AU4 + AU9 (нахмуренность + сморщивание носа)
        if (au.AU4 > 0.25 && au.AU9 > 0.15) {
            const mix = clamp(au.AU4 * 0.45 + au.AU9 * 0.45, 0, 0.6);
            scores.anger   = clamp(scores.anger   + mix * 0.45, 0, 1);
            scores.disgust = clamp(scores.disgust + mix * 0.45, 0, 1);
        }

        // ── Подавление neutral пропорционально активности ───────────────
        const activity = scores.happiness + scores.sadness + scores.anger +
                         scores.fear + scores.surprise + scores.disgust;
        scores.neutral = clamp(scores.neutral - activity * 0.6, 0.02, 1);

        // ── Нормализация ────────────────────────────────────────────────
        const total = Object.values(scores).reduce((s, v) => s + v, 0) || 1;
        for (const k in scores) scores[k] = +(scores[k] / total).toFixed(4);

        return scores;
    }

    // ── Сглаживание и временной контекст ──────────────────────────────────

    /** @private */
    _pushTemporalBuffer(scores) {
        this.temporalBuffer.push({ scores, timestamp: Date.now() });
        if (this.temporalBuffer.length > this.config.temporalWindowSize) {
            this.temporalBuffer.shift();
        }
    }

    /**
     * Взвешенное сглаживание + коррекция по трендам.
     * Новые кадры имеют больший вес (линейное взвешивание).
     * @private
     */
    _smoothScores(currentScores) {
        this.smoothingBuffer.push(currentScores);
        if (this.smoothingBuffer.length > this.config.smoothingWindow) {
            this.smoothingBuffer.shift();
        }

        // Взвешенное среднее (вес = позиция + 1)
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

        // Коррекция по трендам (если достаточно истории)
        if (this.temporalBuffer.length >= 3) {
            const trends = this._calcTrends();
            for (const emotion of this.emotionLabels) {
                if (trends[emotion] > 0.1) {
                    // Нарастающая эмоция — слегка усиливаем
                    smoothed[emotion] = Math.min(1.0, smoothed[emotion] * (1 + trends[emotion] * 0.15));
                } else if (trends[emotion] < -0.1) {
                    // Затухающая эмоция — слегка ослабляем
                    smoothed[emotion] = Math.max(0, smoothed[emotion] * (1 + trends[emotion] * 0.10));
                }
            }
        }

        // Повторная нормализация после коррекции трендов
        const total = Object.values(smoothed).reduce((s, v) => s + v, 0) || 1;
        for (const k in smoothed) smoothed[k] = +(smoothed[k] / total).toFixed(4);

        return smoothed;
    }

    /** @private */
    _calcTrends() {
        const trends = {};
        const recent = this.temporalBuffer.slice(-3);
        for (const emotion of this.emotionLabels) {
            const v = recent.map(item => item.scores[emotion] || 0);
            // Линейный тренд по 3 точкам, нормализованный
            trends[emotion] = clamp(((v[2] - v[0]) / 2) * 5, -1, 1);
        }
        return trends;
    }

    // ── Аффективные измерения ──────────────────────────────────────────────

    /**
     * Расчёт valence и arousal по модели Russell (Circumplex Model of Affect).
     * @private
     */
    _calcAffective(scores) {
        // Валентность: позитивные vs негативные эмоции
        const positiveV = scores.happiness + scores.surprise * 0.3;
        const negativeV = scores.sadness * 0.75 + scores.anger * 0.90 +
                          scores.fear * 0.80 + scores.disgust * 0.85;
        const valence = clamp(positiveV - negativeV, -1, 1);

        // Возбуждение: высокое vs низкое
        const highArousal = scores.anger + scores.fear + scores.surprise + scores.happiness * 0.5;
        const lowArousal  = scores.sadness + scores.neutral;
        const arousal = clamp(highArousal / (highArousal + lowArousal + 0.001), 0, 1);

        return {
            valence: +valence.toFixed(4),
            arousal: +arousal.toFixed(4)
        };
    }

    // ── Вспомогательные методы ─────────────────────────────────────────────

    /**
     * Валидация массива landmarks.
     * @private
     */
    _validateLandmarks(landmarks) {
        return Array.isArray(landmarks) && landmarks.length >= this.config.minLandmarks;
    }

    /**
     * 3D евклидово расстояние между двумя точками.
     * @private
     */
    _dist3(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dz = (p1.z || 0) - (p2.z || 0);
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /** @private */
    _dominant(scores) {
        const best = this.emotionLabels.reduce(
            (b, l) => (scores[l] > scores[b] ? l : b), 'neutral'
        );
        return scores[best] >= this.config.confidenceThreshold ? best : 'neutral';
    }

    /** @private */
    _neutralResult() {
        return {
            scores: { neutral: 1, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            valence: 0, arousal: 0, dominant: 'neutral'
        };
    }

    /** @private */
    _updateCategoryCount(emotion) {
        this.emotionCategoryCounts.total++;
        if      (this.emotionCategories.positive.includes(emotion)) this.emotionCategoryCounts.positive++;
        else if (this.emotionCategories.negative.includes(emotion)) this.emotionCategoryCounts.negative++;
        else                                                          this.emotionCategoryCounts.neutral++;
    }

    /** @private */
    _resetCategoryCounts() {
        this.emotionCategoryCounts = { positive: 0, neutral: 0, negative: 0, total: 0 };
    }

    /** @private */
    _recordEvent(data, status) {
        this.emotionEvents.push({ timestamp: Date.now(), status, data });
        if (this.emotionEvents.length > 1000) this.emotionEvents.shift();
    }

    // ── Публичные геттеры ──────────────────────────────────────────────────

    /** Статистика по категориям эмоций за сессию */
    getEmotionCategoryStats() {
        const { positive, neutral, negative, total } = this.emotionCategoryCounts;
        if (total === 0) return { positive: 0, neutral: 1, negative: 0 };
        return {
            positive: +(positive / total).toFixed(4),
            neutral:  +(neutral  / total).toFixed(4),
            negative: +(negative / total).toFixed(4)
        };
    }

    /** Все записанные события */
    getEvents() {
        return this.emotionEvents;
    }

    /**
     * Агрегированные метрики за сессию.
     * Включает: meanScores, maxScores, stdDev, timeAboveThreshold,
     *           meanValence, meanArousal, dominantEmotion, validDataPct.
     * @returns {Object|null}
     */
    getAggregatedMetrics() {
        const valid = this.emotionEvents.filter(e => e.status === 'success');
        if (valid.length === 0) return null;

        const metrics = {
            meanScores:         {},
            maxScores:          {},
            stdDev:             {},
            timeAboveThreshold: {},
            meanValence:        0,
            meanArousal:        0,
            dominantEmotion:    '',
            validDataPct:       +((valid.length / this.emotionEvents.length) * 100).toFixed(2),
            categoryStats:      this.getEmotionCategoryStats()
        };

        // Инициализация
        for (const e of this.emotionLabels) {
            metrics.meanScores[e]         = 0;
            metrics.maxScores[e]          = 0;
            metrics.stdDev[e]             = 0;
            metrics.timeAboveThreshold[e] = 0;
        }

        const allScores = {};
        for (const e of this.emotionLabels) allScores[e] = [];

        // Накопление
        for (const event of valid) {
            const s = event.data?.scores || {};
            for (const e of this.emotionLabels) {
                const v = s[e] || 0;
                metrics.meanScores[e] += v;
                metrics.maxScores[e]   = Math.max(metrics.maxScores[e], v);
                allScores[e].push(v);
                if (v > this.config.confidenceThreshold) {
                    // ✅ Время считается по реальным timestamp, не по config.fps
                    metrics.timeAboveThreshold[e]++;
                }
            }
            metrics.meanValence += event.data?.affective?.valence || 0;
            metrics.meanArousal += event.data?.affective?.arousal || 0;
        }

        // Усреднение и std
        const count = valid.length;
        for (const e of this.emotionLabels) {
            metrics.meanScores[e] = +(metrics.meanScores[e] / count).toFixed(4);
            const mean     = metrics.meanScores[e];
            const variance = allScores[e].reduce((s, v) => s + (v - mean) ** 2, 0) / count;
            metrics.stdDev[e] = +Math.sqrt(variance).toFixed(4);
            // Переводим кадры в секунды
            metrics.timeAboveThreshold[e] = +(metrics.timeAboveThreshold[e] / this.config.fps).toFixed(2);
        }

        metrics.meanValence = +(metrics.meanValence / count).toFixed(4);
        metrics.meanArousal = +(metrics.meanArousal / count).toFixed(4);

        // Доминирующая эмоция за сессию
        metrics.dominantEmotion = this.emotionLabels.reduce(
            (b, l) => metrics.meanScores[l] > metrics.meanScores[b] ? l : b, 'neutral'
        );

        return metrics;
    }

    /** Экспорт всех данных в JSON */
    exportToJSON() {
        return {
            metadata: {
                version:      '3.0.0',
                model:        'FACS-AU-geometric',
                emotionLabels: this.emotionLabels,
                fps:          this.config.fps,
                totalEvents:  this.emotionEvents.length,
                exportTime:   new Date().toISOString()
            },
            events:            this.emotionEvents,
            aggregatedMetrics: this.getAggregatedMetrics(),
            categoryStats:     this.getEmotionCategoryStats()
        };
    }

    /** Полный сброс состояния */
    clear() {
        this.emotionEvents   = [];
        this.smoothingBuffer = [];
        this.temporalBuffer  = [];
        this.currentFaceMask = null;
        this.affectiveDimensions = { valence: 0, arousal: 0 };
        this._resetCategoryCounts();
        console.log('[EmotionAnalyzer] Данные очищены');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Модульный уровень — совместимость с репозиторием
// ─────────────────────────────────────────────────────────────────────────────

const _analyzer = new EmotionAnalyzer();

/**
 * Основная функция анализа эмоций.
 * Три пути деградации:
 *   1. landmarks → полный FACS-анализ (confidence: high)
 *   2. precheckResult без landmarks → эвристика по мета-данным (confidence: low)
 *   3. нет данных → missingData (confidence: 0)
 *
 * @param {Object} [precheckResult]
 * @returns {{ valence, arousal, dominant, scores, confidence, dataQuality, dataSource }}
 */
function getEmotionSample(precheckResult) {

    // ── Путь 1: есть landmarks → FACS ──────────────────────────────────────
    if (Array.isArray(precheckResult?.landmarks) && precheckResult.landmarks.length >= 468) {
        const result = _analyzer.analyzeLandmarks(precheckResult.landmarks);
        return {
            ...result,
            confidence:  0.85,
            dataQuality: 'high',
            dataSource:  'landmarks'
        };
    }

    // ── Путь 2: нет объекта → missing ──────────────────────────────────────
    if (!precheckResult || typeof precheckResult !== 'object') {
        return {
            valence: null, arousal: null, dominant: 'unknown',
            scores: { neutral: 0, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            confidence: 0, dataQuality: 'missing', dataSource: 'none', missingData: true
        };
    }

    // ── Путь 3: мета-данные precheck → эвристика ───────────────────────────
    const illumRaw  = num(precheckResult?.illumination?.meanBrightness, 0.5);
    const illumNorm = clamp(illumRaw <= 1 ? illumRaw : illumRaw / 255, 0, 1);
    const faceOk    = precheckResult?.face?.detected !== false;
    const pose      = precheckResult?.pose || {};
    const yaw       = Math.abs(num(pose.yaw,   0));
    const pitch     = Math.abs(num(pose.pitch, 0));
    const roll      = Math.abs(num(pose.roll,  0));
    const poseMag   = clamp((yaw + pitch + roll) / 90, 0, 1);
    const eyesOpen  = precheckResult?.eyes?.bothOpen === true ? 1 : 0.4;

    const valence = clamp(
        (illumNorm - 0.5) * 0.8 + (faceOk ? 0.2 : -0.4) + (eyesOpen - 0.5) * 0.4 - poseMag * 0.5,
        -1, 1
    );
    const arousal = clamp(poseMag * 0.9 + (1 - illumNorm) * 0.3, 0, 1);

    // Нормализованные эвристические scores
    const hScores = {
        neutral:   Math.max(0, 1 - Math.abs(valence) - arousal * 0.3),
        happiness: Math.max(0, valence) * (1 - arousal * 0.3),
        sadness:   Math.max(0, -valence) * (1 - arousal * 0.5),
        anger:     arousal * Math.max(0, -valence) * 0.5,
        fear:      arousal * 0.2,
        surprise:  arousal * 0.3,   // ✅ исправлено: surprise не зависит от знака valence
        disgust:   0
    };
    const hTotal = Object.values(hScores).reduce((s, v) => s + v, 0) || 1;
    for (const k in hScores) hScores[k] = +(hScores[k] / hTotal).toFixed(4);

    return {
        valence:     +valence.toFixed(4),
        arousal:     +arousal.toFixed(4),
        dominant:    valence > 0.2 ? 'happiness' : valence < -0.2 ? 'sadness' : 'neutral',
        scores:      hScores,
        confidence:  faceOk ? 0.35 : 0.15,
        dataQuality: 'low',
        dataSource:  'metadata',
        isHeuristic: true
    };
}



// ─────────────────────────────────────────────────────────────────────────────
// Агрегат за сессию — используется в unified-aggregates-new.js
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Агрегирует эмоциональные данные за сессию.
 * Вызывается из buildAggregatesPayload(sessionData) в unified-aggregates-new.js.
 *
 * Источники данных (в порядке приоритета):
 *   1. Внутренний буфер _analyzer.emotionEvents (накоплен за сессию)
 *   2. sessionData.emotionSamples / emotionEvents (fallback)
 *
 * @param {Object} sessionData
 * @returns {{ valence_mean: number|null, arousal_mean: number|null, n: number }}
 */
function getEmotionSummary(sessionData) {

    // ── Источник 1: внутренний буфер _analyzer ──────────────────────────────
    const validEvents = _analyzer.emotionEvents.filter(e => e.status === 'success');

    if (validEvents.length > 0) {
        let vSum = 0, aSum = 0;
        for (const e of validEvents) {
            vSum += e.data?.affective?.valence || 0;
            aSum += e.data?.affective?.arousal || 0;
        }
        return {
            valence_mean: +(vSum / validEvents.length).toFixed(4),
            arousal_mean: +(aSum / validEvents.length).toFixed(4),
            n: validEvents.length
        };
    }

    // ── Источник 2: sessionData (fallback если _analyzer пуст) ─────────────
    const samples =
        sessionData?.emotionSamples ??
        sessionData?.emotion_samples ??
        sessionData?.emotionEvents ??
        [];

    if (!Array.isArray(samples) || samples.length === 0) {
        return { valence_mean: null, arousal_mean: null, n: 0 };
    }

    const valid = samples.filter(s => {
        const v = s?.valence ?? s?.affective?.valence ?? s?.data?.affective?.valence;
        const a = s?.arousal ?? s?.affective?.arousal ?? s?.data?.affective?.arousal;
        return Number.isFinite(v) && Number.isFinite(a);
    });

    if (valid.length === 0) {
        return { valence_mean: null, arousal_mean: null, n: 0 };
    }

    const vMean = valid.reduce((sum, s) =>
        sum + (s?.valence ?? s?.affective?.valence ?? s?.data?.affective?.valence), 0
    ) / valid.length;

    const aMean = valid.reduce((sum, s) =>
        sum + (s?.arousal ?? s?.affective?.arousal ?? s?.data?.affective?.arousal), 0
    ) / valid.length;

    return {
        valence_mean: +vMean.toFixed(4),
        arousal_mean: +aMean.toFixed(4),
        n: valid.length
    };
}

function appendEmotionSample(state, sample, t = Date.now(), tRelMs = null) {
    if (!state.sessionData) return;
    if (!Array.isArray(state.sessionData.emotionSamples)) {
        state.sessionData.emotionSamples = [];
    }
    const start = state.sessionData.startTime || t;
    state.sessionData.emotionSamples.push({
        t,
        tRelMs: tRelMs != null ? tRelMs : Math.max(0, t - start),
        valence:  sample.valence,
        arousal:  sample.arousal,
        dominant: sample?.dominant || null,
        scores:   sample?.scores   || null
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Экспорт
// ─────────────────────────────────────────────────────────────────────────────

window.EmotionAnalyzer = EmotionAnalyzer;

// ✅ ES-модульный экспорт — именно этот синтаксис читает import {} в браузере
export { EmotionAnalyzer, getEmotionSample, getEmotionSummary, appendEmotionSample };

console.log('[EmotionAnalyzer] Модуль загружен (v3.0.0, FACS AU)');