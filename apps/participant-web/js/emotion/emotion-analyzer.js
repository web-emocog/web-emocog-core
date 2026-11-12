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
import { buildInternalMask, extractActionUnits, validEmotionLandmarks } from './au-extractor.js?v=20261112-emotion1';
import { classifyFACS, calcAffective }           from './facs-classifier.js';
import { computeAggregatedMetrics }              from './emotion-aggregator.js';
import { participantDebugError } from '../session-runtime/participant-diagnostic.mjs?v=20261110-integration1';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function requireUnitValues(values, keys = Object.keys(values || {})) {
    if (!values || !keys.length
        || !keys.every(key => Number.isFinite(values[key]) && values[key] >= 0 && values[key] <= 1)) {
        throw new Error('Invalid emotion calculation');
    }
}

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

    }

    // ── Инициализация ──────────────────────────────────────────────────────

    initialize(faceMaskCollector = null) {
        try {
            if (faceMaskCollector && typeof faceMaskCollector.generateMask === 'function') {
                this.faceMaskCollector = faceMaskCollector;
            }
            return true;
        } catch (_) {
            participantDebugError('expression', 'initialization:failed');
            return false;
        }
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    /**
     * Начало новой сессии. Полностью сбрасывает буферы предыдущей.
     * @param {string} [sessionId]
     */
    startSession(sessionId = null, options = {}) {
        this.clear();
        this.requireExplicitBaseline = options.explicitNeutral === true;
        this.requiredNeutralFrames = options.requiredNeutralFrames;
        this.sessionId    = sessionId ?? `session_${Date.now()}`;
        this.sessionStart = Date.now();
        this.isRunning    = true;
    }

    /**
     * Завершение сессии. Данные сохраняются до следующего startSession().
     * @returns {{ sessionId, durationMs, eventCount }}
     */
    endSession() {
        this.isRunning = false;
        const durationMs = this.sessionStart ? Date.now() - this.sessionStart : 0;
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
        const result = this.analyzeLandmarks(landmarks);
        // The event aggregator only accepts success. Calibration and failures
        // remain visible in the event history without becoming neutral samples.
        this._recordEvent({
            ...result,
            baselineReady: result.calibrationReady,
            affective: { valence: result.valence, arousal: result.arousal },
        }, result.status);
    }

    /**
     * Синхронный анализ landmarks — возвращает результат немедленно.
     * @param {Array} landmarks
     * @returns {{ scores, valence, arousal, dominant, confidence }}
     */
    analyzeLandmarks(landmarks) {
        if (!this._validateLandmarks(landmarks)) {
            this._trackFrameValidity(false);
            return this._unavailableResult('invalid_landmarks');
        }

        // A failed calculation must not advance or contaminate the baseline.
        const baseline = this._auBaseline && { ...this._auBaseline };
        const baselineFrames = this._auBaselineFrames;
        const baselineReady = this._auBaselineReady;

        try {
            const mask      = this._getMask(landmarks);
            const geometry = mask?.geometry;
            if (!Number.isFinite(geometry?.faceWidth) || geometry.faceWidth <= 0
                || !Number.isFinite(geometry?.faceHeight) || geometry.faceHeight <= 0
                || !Number.isFinite(Math.sqrt(geometry.faceWidth ** 2 + geometry.faceHeight ** 2))) {
                throw new Error('Invalid face geometry');
            }
            const rawActionUnits = this._extractActionUnits(landmarks, mask.geometry);
            this._validateRawActionUnits(rawActionUnits);
            const auState = this._calibrateActionUnits(rawActionUnits);
            requireUnitValues(auState.actionUnits);
            if (!auState.ready) {
                this._trackFrameValidity(true);
                return { ...this._unavailableResult('calibrating'), rawActionUnits,
                    actionUnits: auState.actionUnits, geometry: { ...geometry }, ...this._featureDiagnostics() };
            }
            const raw = classifyFACS(auState.actionUnits);
            requireUnitValues(raw, this.emotionLabels);
            this._pushTemporalBuffer(raw);
            const modelScores = this._smoothScores(raw);
            requireUnitValues(modelScores, this.emotionLabels);
            const dominant = this._dominant(modelScores);
            const smoothed = this._publishScores(modelScores, dominant);
            requireUnitValues(smoothed, this.emotionLabels);
            const affective = calcAffective(smoothed);
            if (!Number.isFinite(affective.valence) || !Number.isFinite(affective.arousal)) {
                throw new Error('Invalid affective calculation');
            }
            const confidence = this._calcLandmarksConfidence(landmarks);
            if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1) {
                throw new Error('Invalid emotion confidence');
            }
            const faceMask = {
                symmetry: mask.symmetry,
                zonesCount: Object.keys(mask.zones || {}).length,
            };

            this.affectiveDimensions = affective;
            this.currentFaceMask = mask;
            this._updateCategoryCount(dominant);
            this._trackFrameValidity(true);

            return {
                status: 'success',
                degraded: false,
                scores:     smoothed,
                modelScores,
                rawScores: raw,
                rawActionUnits,
                geometry: { ...geometry },
                actionUnits: auState.actionUnits,
                valence:    affective.valence,
                arousal:    affective.arousal,
                dominant,
                confidence,
                calibrationReady: auState.ready,
                calibrationFrames: this._auBaselineFrames,
                faceMask,
                ...this._featureDiagnostics(),
            };
        } catch (_) {
            participantDebugError('expression', 'landmarks:analysis-failed');
            this._auBaseline = baseline;
            this._auBaselineFrames = baselineFrames;
            this._auBaselineReady = baselineReady;
            this._trackFrameValidity(false);
            return this._unavailableResult('analysis_error');
        }
    }

    // ── Публичные геттеры ──────────────────────────────────────────────────

    getCalibrationDiagnostics() {
        return { ready: this._auBaselineReady, frames: this._auBaselineFrames,
            requiredFrames: this.requiredNeutralFrames ?? this.config.baseline.minFrames,
            baseline: this._auBaseline ? { ...this._auBaseline } : null,
            deadzone: this.config.baseline.deadzone, gain: this.config.baseline.gain };
    }

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
        this.requiredNeutralFrames = null;
        this.requireExplicitBaseline = false;
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
    }

    // ── Приватные методы ───────────────────────────────────────────────────

    // Developer experiments override extraction only; the default stays unchanged.
    _extractActionUnits(landmarks, geometry) { return extractActionUnits(landmarks, geometry); }
    _validateRawActionUnits(values) { requireUnitValues(values); }
    _featureDiagnostics() { return {}; }

    _getMask(landmarks) {
        return this.faceMaskCollector
            ? this.faceMaskCollector.generateMask(landmarks)
            : buildInternalMask(landmarks);
    }

    _validateLandmarks(lm) {
        return validEmotionLandmarks(lm, this.config.minLandmarks);
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

    setNeutralBaseline(baseline, count) {
        const entries = Object.entries(baseline || {});
        if (!this.requireExplicitBaseline || !Number.isInteger(count) || count < 1 || entries.length !== 16
            || !entries.every(([key, value]) => /^AU\d+$/.test(key) && Number.isFinite(value))) {
            throw new Error('Invalid neutral baseline');
        }
        this._validateRawActionUnits(baseline);
        this._auBaseline = { ...baseline };
        this._auBaselineFrames = count;
        this._auBaselineReady = true;
        this.smoothingBuffer = []; this.temporalBuffer = [];
        this._stableDominant = 'neutral'; this._dominantCandidate = 'neutral'; this._dominantCandidateFrames = 0;
    }

    _calibrateActionUnits(rawActionUnits) {
        const cfg = this.config.baseline;
        const keys = Object.keys(rawActionUnits || {});
        if (this.requireExplicitBaseline && !this._auBaselineReady) {
            return { ready: false, actionUnits: Object.fromEntries(keys.map(key => [key, 0])) };
        }
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
        if (!this.requireExplicitBaseline && activity <= cfg.adaptiveMaxActivity) {
            keys.forEach(key => {
                this._auBaseline[key] += ((Number(rawActionUnits[key]) || 0) - this._auBaseline[key]) * cfg.adaptiveRate;
            });
        }
        return { ready: true, actionUnits: adjusted };
    }

    // A missing observation breaks temporal continuity, not personal calibration.
    resetExpressionHistory() {
        this.currentFaceMask = null;
        this.affectiveDimensions = { valence: null, arousal: null };
        this.smoothingBuffer = [];
        this.temporalBuffer = [];
        this._stableDominant = 'neutral';
        this._dominantCandidate = 'neutral';
        this._dominantCandidateFrames = 0;
    }

    _unavailableResult(status) {
        this.resetExpressionHistory();
        return {
            status,
            scores: Object.fromEntries(this.emotionLabels.map(label => [label, 0])),
            valence: null, arousal: null, dominant: 'unknown', confidence: 0,
            calibrationReady: this._auBaselineReady,
            calibrationFrames: this._auBaselineFrames,
            missingData: true, emotionInferred: false, degraded: true,
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
