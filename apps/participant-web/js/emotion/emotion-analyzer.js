/**
 * EmotionAnalyzer — геометрический анализ эмоций на основе FACS.
 *
 * Lifecycle: initialize() → startSession(id) → processLandmarks() / analyzeLandmarks()
 *            → endSession() → getAggregatedMetrics() → clear()
 *
 * @module emotion-analyzer
 * @version 4.1.0
 */

import { EMOTION_CONFIG }                        from './emotion-config.js';
import { buildInternalMask, extractActionUnits } from './au-extractor.js';
import { classifyFACS, calcAffective }           from './facs-classifier.js';
import { computeAggregatedMetrics }              from './emotion-aggregator.js';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export class EmotionAnalyzer {
    constructor() {
        this.emotionLabels = ['neutral', 'happiness', 'sadness', 'anger', 'fear', 'surprise', 'disgust'];
        /** Публичный алиас для совместимости */
        this.labels = this.emotionLabels;

        this.config = { ...EMOTION_CONFIG };

        this.affectiveDimensions = { valence: 0, arousal: 0 };
        this.emotionEvents       = [];
        this.smoothingBuffer     = [];
        this.temporalBuffer      = [];
        this.currentFaceMask     = null;
        this.faceMaskCollector   = null;

        this.emotionCategories = {
            positive: ['happiness', 'surprise'],
            neutral:  ['neutral'],
            negative: ['sadness', 'anger', 'fear', 'disgust'],
        };
        this.emotionCategoryCounts = { positive: 0, neutral: 0, negative: 0, total: 0 };

        this.isRunning    = false;
        this.sessionId    = null;
        this.sessionStart = null;

        // Скользящее окно валидности кадров для динамического confidence
        this._recentFrames  = [];
        this._RECENT_WINDOW = 30;
        this._auBaseline = null;
        this._auBaselineFrames = 0;
        this._auBaselineReady = false;
        this._stableDominant = 'neutral';
        this._dominantCandidate = 'neutral';
        this._dominantCandidateFrames = 0;

        console.log('[EmotionAnalyzer] Инициализирован (FACS AU v4.1, без ONNX)');
    }

    // ── Инициализация ──────────────────────────────────────────────────────

    initialize(faceMaskCollector = null) {
        try {
            if (faceMaskCollector && typeof faceMaskCollector.generateMask === 'function') {
                this.faceMaskCollector = faceMaskCollector;
                console.log('[EmotionAnalyzer] FaceMaskCollector подключён');
            }
            return true;
        } catch (err) {
            console.error('[EmotionAnalyzer] Ошибка инициализации:', err);
            return false;
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    /**
     * Начало новой сессии. Полностью сбрасывает буферы предыдущей.
     * @param {string} [sessionId]
     */
    startSession(sessionId = null) {
        this.clear();
        this.sessionId    = sessionId ?? `session_${Date.now()}`;
        this.sessionStart = Date.now();
        this.isRunning    = true;
        console.log(`[EmotionAnalyzer] ▶️ Сессия начата: ${this.sessionId}`);
    }

    /**
     * Завершение сессии. Данные сохраняются до следующего startSession().
     * @returns {{ sessionId, durationMs, eventCount }}
     */
    endSession() {
        this.isRunning = false;
        const durationMs = this.sessionStart ? Date.now() - this.sessionStart : 0;
        console.log(
            `[EmotionAnalyzer] ⏹️ Сессия завершена: ${this.sessionId}` +
            ` (${durationMs}мс, ${this.emotionEvents.length} событий)`
        );
        return { sessionId: this.sessionId, durationMs, eventCount: this.emotionEvents.length };
    }

    /** @deprecated Используйте startSession() */
    start() { this.startSession(); }

    /** @deprecated Используйте endSession() */
    stop()  { this.endSession(); }

    // ── Основной публичный API ─────────────────────────────────────────────

    /**
     * Обработка landmarks из основного пайплайна (поток кадров).
     * [FIX] confidence теперь вычисляется и сохраняется в событие.
     * @param {Array} landmarks
     */
    processLandmarks(landmarks) {
        if (!this.isRunning) return;

        const isValid = this._validateLandmarks(landmarks);
        this._trackFrameValidity(isValid);

        if (!isValid) {
            this._recordEvent(null, 'no_landmarks');
            return;
        }

        try {
            const mask      = this._getMask(landmarks);
            this.currentFaceMask = mask;

            const rawActionUnits = extractActionUnits(landmarks, mask.geometry);
            const auState = this._calibrateActionUnits(rawActionUnits);
            const au = auState.actionUnits;
            const rawScores = classifyFACS(au);
            this._pushTemporalBuffer(rawScores);
            const modelScores = this._smoothScores(rawScores);
            const dominant = this._dominant(modelScores);
            const smoothed = this._publishScores(modelScores, dominant);
            const affective = calcAffective(smoothed);
            this.affectiveDimensions = affective;

            this._updateCategoryCount(dominant);

            // [FIX] confidence вычисляется здесь и сохраняется в событие
            const confidence = this._calcLandmarksConfidence(landmarks);

            this._recordEvent({
                scores:     smoothed,
                modelScores,
                rawScores,
                actionUnits: au,
                rawActionUnits,
                baselineReady: auState.ready,
                affective,
                dominant,
                confidence,
                faceMask: {
                    symmetry:   mask.symmetry,
                    zonesCount: Object.keys(mask.zones || {}).length,
                },
            }, 'success');

        } catch (err) {
            console.error('[EmotionAnalyzer] Ошибка processLandmarks:', err);
            this._recordEvent(null, 'error');
        }
    }

    /**
     * Синхронный анализ landmarks — возвращает результат немедленно.
     * @param {Array} landmarks
     * @returns {{ scores, valence, arousal, dominant, confidence }}
     */
    analyzeLandmarks(landmarks) {
        if (!this._validateLandmarks(landmarks)) return this._neutralResult();

        try {
            const mask      = this._getMask(landmarks);
            const rawActionUnits = extractActionUnits(landmarks, mask.geometry);
            const auState = this._calibrateActionUnits(rawActionUnits);
            const raw = classifyFACS(auState.actionUnits);
            this._pushTemporalBuffer(raw);
            const modelScores = this._smoothScores(raw);
            const dominant = this._dominant(modelScores);
            const smoothed = this._publishScores(modelScores, dominant);
            const affective = calcAffective(smoothed);

            this.affectiveDimensions = affective;
            this._updateCategoryCount(dominant);
            this._trackFrameValidity(true);

            return {
                scores:     smoothed,
                modelScores,
                valence:    affective.valence,
                arousal:    affective.arousal,
                dominant,
                confidence: this._calcLandmarksConfidence(landmarks),
                calibrationReady: auState.ready,
                calibrationFrames: this._auBaselineFrames,
            };
        } catch (err) {
            console.error('[EmotionAnalyzer] Ошибка analyzeLandmarks:', err);
            return this._neutralResult();
        }
    }

    // ── Публичные геттеры ──────────────────────────────────────────────────

    getEmotionCategoryStats() {
        const { positive, neutral, negative, total } = this.emotionCategoryCounts;
        if (total === 0) return { positive: 0, neutral: 1, negative: 0 };
        return {
            positive: +(positive / total).toFixed(4),
            neutral:  +(neutral  / total).toFixed(4),
            negative: +(negative / total).toFixed(4),
        };
    }

    getEvents() { return this.emotionEvents; }

    getAggregatedMetrics() {
        return computeAggregatedMetrics(
            this.emotionEvents,
            this.emotionEvents.length,
            this.getEmotionCategoryStats()
        );
    }

    exportToJSON() {
        return {
            metadata: {
                version:       '4.1.0',
                model:         'FACS-AU-geometric',
                sessionId:     this.sessionId,
                emotionLabels: this.emotionLabels,
                fps:           this.config.fps,
                totalEvents:   this.emotionEvents.length,
                exportTime:    new Date().toISOString(),
            },
            events:            this.emotionEvents,
            aggregatedMetrics: this.getAggregatedMetrics(),
            categoryStats:     this.getEmotionCategoryStats(),
        };
    }

    /** Полный сброс состояния (вызывается автоматически в startSession) */
    clear() {
        this.emotionEvents       = [];
        this.smoothingBuffer     = [];
        this.temporalBuffer      = [];
        this.currentFaceMask     = null;
        this._recentFrames       = [];
        this._auBaseline         = null;
        this._auBaselineFrames   = 0;
        this._auBaselineReady    = false;
        this._stableDominant = 'neutral';
        this._dominantCandidate = 'neutral';
        this._dominantCandidateFrames = 0;
        this.affectiveDimensions = { valence: 0, arousal: 0 };
        this._resetCategoryCounts();
        console.log('[EmotionAnalyzer] Данные очищены');
    }

    // ── Приватные методы ───────────────────────────────────────────────────

    _getMask(landmarks) {
        return this.faceMaskCollector
            ? this.faceMaskCollector.generateMask(landmarks)
            : buildInternalMask(landmarks);
    }

    _validateLandmarks(lm) {
        return Array.isArray(lm) && lm.length >= this.config.minLandmarks;
    }

    _dominant(scores) {
        const ranked = this.emotionLabels
            .map(label => [label, Number(scores[label]) || 0])
            .sort((a, b) => b[1] - a[1]);
        const [best, second] = ranked;
        let candidate = best[0];
        if (
            !this._auBaselineReady
            || best[0] === 'neutral'
            || best[1] < this.config.dominantMinScore
            || (best[1] - second[1]) < this.config.dominantMinMargin
        ) {
            candidate = 'neutral';
        }

        if (candidate === 'neutral') {
            this._stableDominant = 'neutral';
            this._dominantCandidate = 'neutral';
            this._dominantCandidateFrames = 0;
            return 'neutral';
        }
        if (candidate === this._stableDominant) {
            this._dominantCandidate = candidate;
            this._dominantCandidateFrames = 0;
            return this._stableDominant;
        }
        if (candidate !== this._dominantCandidate) {
            this._dominantCandidate = candidate;
            this._dominantCandidateFrames = 1;
        } else {
            this._dominantCandidateFrames += 1;
        }
        if (this._dominantCandidateFrames >= this.config.dominantHoldFrames) {
            this._stableDominant = candidate;
            this._dominantCandidateFrames = 0;
        }
        return this._stableDominant;
    }

    _publishScores(scores, dominant) {
        if (dominant !== 'neutral') return { ...scores };
        const floor = clamp(this.config.neutralPublishedFloor, 0.5, 1);
        const nonNeutral = this.emotionLabels.filter(label => label !== 'neutral');
        const nonNeutralTotal = nonNeutral.reduce(
            (sum, label) => sum + Math.max(0, Number(scores[label]) || 0),
            0
        );
        const published = { neutral: floor };
        for (const label of nonNeutral) {
            published[label] = nonNeutralTotal > 0
                ? (Math.max(0, Number(scores[label]) || 0) / nonNeutralTotal) * (1 - floor)
                : 0;
        }
        return Object.fromEntries(
            Object.entries(published).map(([label, value]) => [label, +value.toFixed(4)])
        );
    }

    _calibrateActionUnits(rawActionUnits) {
        const cfg = this.config.baseline;
        const keys = Object.keys(rawActionUnits || {});
        if (!this._auBaseline) {
            this._auBaseline = Object.fromEntries(keys.map(key => [key, Number(rawActionUnits[key]) || 0]));
            this._auBaselineFrames = 1;
        } else if (!this._auBaselineReady) {
            this._auBaselineFrames += 1;
            const n = this._auBaselineFrames;
            keys.forEach(key => {
                const value = Number(rawActionUnits[key]) || 0;
                this._auBaseline[key] += (value - this._auBaseline[key]) / n;
            });
            this._auBaselineReady = n >= cfg.minFrames;
        }

        if (!this._auBaselineReady) {
            return {
                ready: false,
                actionUnits: Object.fromEntries(keys.map(key => [key, 0])),
            };
        }

        const adjusted = Object.fromEntries(keys.map(key => {
            const delta = (Number(rawActionUnits[key]) || 0) - (this._auBaseline[key] || 0) - cfg.deadzone;
            return [key, clamp(delta * cfg.gain, 0, 1)];
        }));
        const activity = Object.values(adjusted).reduce((sum, value) => sum + value, 0) / Math.max(1, keys.length);
        if (activity <= cfg.adaptiveMaxActivity) {
            keys.forEach(key => {
                this._auBaseline[key] += ((Number(rawActionUnits[key]) || 0) - this._auBaseline[key]) * cfg.adaptiveRate;
            });
        }
        return { ready: true, actionUnits: adjusted };
    }

    _neutralResult() {
        return {
            scores: { neutral: 1, happiness: 0, sadness: 0, anger: 0, fear: 0, surprise: 0, disgust: 0 },
            valence: 0, arousal: 0, dominant: 'neutral', confidence: 0,
        };
    }

    _updateCategoryCount(emotion) {
        this.emotionCategoryCounts.total++;
        if      (this.emotionCategories.positive.includes(emotion)) this.emotionCategoryCounts.positive++;
        else if (this.emotionCategories.negative.includes(emotion)) this.emotionCategoryCounts.negative++;
        else                                                          this.emotionCategoryCounts.neutral++;
    }

    _resetCategoryCounts() {
        this.emotionCategoryCounts = { positive: 0, neutral: 0, negative: 0, total: 0 };
    }

    _recordEvent(data, status) {
        this.emotionEvents.push({ timestamp: Date.now(), status, data });
        if (this.emotionEvents.length > this.config.maxEvents) {
            this.emotionEvents.shift();
        }
    }

    // ── Сглаживание и тренды ──────────────────────────────────────────────

    _pushTemporalBuffer(scores) {
        this.temporalBuffer.push({ scores, timestamp: Date.now() });
        if (this.temporalBuffer.length > this.config.temporalWindowSize) {
            this.temporalBuffer.shift();
        }
    }

    _smoothScores(currentScores) {
        const S = this.config.smoothing;
        this.smoothingBuffer.push(currentScores);
        if (this.smoothingBuffer.length > this.config.smoothingWindow) {
            this.smoothingBuffer.shift();
        }

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

        if (this.temporalBuffer.length >= 3) {
            const trends = this._calcTrends();
            for (const emotion of this.emotionLabels) {
                if (trends[emotion] > S.trendThreshUp) {
                    smoothed[emotion] = Math.min(1.0, smoothed[emotion] * (1 + trends[emotion] * S.trendBoostFactor));
                } else if (trends[emotion] < S.trendThreshDown) {
                    smoothed[emotion] = Math.max(0, smoothed[emotion] * (1 + trends[emotion] * S.trendDampFactor));
                }
            }
        }

        const total = Object.values(smoothed).reduce((s, v) => s + v, 0) || 1;
        for (const k in smoothed) smoothed[k] = +(smoothed[k] / total).toFixed(4);

        return smoothed;
    }

    _calcTrends() {
        const S      = this.config.smoothing;
        const recent = this.temporalBuffer.slice(-3);
        const trends = {};
        for (const emotion of this.emotionLabels) {
            const v = recent.map(item => item.scores[emotion] || 0);
            trends[emotion] = clamp(((v[2] - v[0]) / 2) * S.trendNormScale, -1, 1);
        }
        return trends;
    }

    // ── Динамический confidence ───────────────────────────────────────────

    _trackFrameValidity(isValid) {
        this._recentFrames.push({ valid: isValid, ts: Date.now() });
        if (this._recentFrames.length > this._RECENT_WINDOW) {
            this._recentFrames.shift();
        }
    }

    /**
     * Вычисляет динамический confidence для landmarks-пути.
     * Учитывает долю валидных кадров и стабильность трекинга (std valence).
     * @param {Array} landmarks
     * @returns {number} confidence в [0, 1]
     */
    _calcLandmarksConfidence(landmarks) {
        const C = this.config.confidence;

        const validFraction = this._recentFrames.length > 0
            ? this._recentFrames.filter(f => f.valid).length / this._recentFrames.length
            : 1.0;

        const recentValid = this.emotionEvents.filter(e => e.status === 'success').slice(-10);
        let trackingStability = 1.0;
        if (recentValid.length >= 3) {
            const valences = recentValid.map(e => e.data?.affective?.valence || 0);
            const mean = valences.reduce((s, v) => s + v, 0) / valences.length;
            const std  = Math.sqrt(valences.reduce((s, v) => s + (v - mean) ** 2, 0) / valences.length);
            trackingStability = clamp(1 - std * 2, 0, 1);
        }

        const confidence = clamp(
            C.landmarksBase +
            trackingStability * C.landmarksStabilityW +
            validFraction     * C.landmarksValidFramesW,
            0, 1
        );
        return +(this._auBaselineReady ? confidence : Math.min(0.35, confidence)).toFixed(3);
    }
}
