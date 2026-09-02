/**
 * Target-blind browser gaze estimator.
 *
 * Signal contract:
 * - raw: iris-only ridge prediction;
 * - corrected: optional held-out residual correction, used for analytics;
 * - display: adaptive low-pass output, used only by the overlay.
 *
 * Head pose/translation is never given the calibration target and is not part
 * of the ridge predictor. It is evaluated independently for confidence/OOD.
 *
 * @license Apache-2.0
 */
import { LANDMARKS, MIN_LANDMARKS, DEFAULTS } from './constants.js';
import { extractFeatureGroups, estimateConfidence } from './features.js';
import { ridgeRegression, dotProduct } from './ridge.js';
import {
    AdaptiveGazeFilter,
    fitDistribution,
    distributionDistance,
    evaluateGazeGate,
    scalePointBetweenViewports
} from './signal-processing.mjs';

const IRIS_STD_FLOORS = [
    0.03, 0.04, 0.03, 0.04,
    0.03, 0.04, 0.03, 0.04,
    0.008, 0.008, 0.008
];
const HEAD_STD_FLOORS = [0.025, 0.025, 0.018, 0.025, 0.025, 0.025, 0.02];

function averageVectors(vectors) {
    if (!vectors.length) return null;
    const width = Array.isArray(vectors[0]) ? vectors[0].length : 0;
    if (
        width === 0
        || !vectors.every(vector =>
            Array.isArray(vector)
            && vector.length === width
            && vector.every(Number.isFinite)
        )
    ) return null;
    const result = new Array(width).fill(0);
    for (const vector of vectors) {
        for (let i = 0; i < vector.length; i++) result[i] += vector[i];
    }
    for (let i = 0; i < result.length; i++) result[i] /= vectors.length;
    return result;
}

function featureStatistics(rawFeatures) {
    const count = rawFeatures.length;
    const width = rawFeatures[0]?.length - 1;
    if (
        count < 2
        || width !== IRIS_STD_FLOORS.length
        || !rawFeatures.every(row => (
            Array.isArray(row)
            && row.length === width + 1
            && row.every(Number.isFinite)
        ))
    ) return null;
    const mean = new Array(width).fill(0);
    const std = new Array(width).fill(0);
    for (let j = 0; j < width; j++) {
        mean[j] = rawFeatures.reduce((sum, row) => sum + row[j], 0) / count;
        const variance = rawFeatures.reduce(
            (sum, row) => sum + ((row[j] - mean[j]) ** 2),
            0
        ) / count;
        std[j] = Math.max(Math.sqrt(variance), IRIS_STD_FLOORS[j]);
    }
    return { mean, std };
}

function standardizeFeatureRow(row, mean, std) {
    if (
        !Array.isArray(row)
        || !Array.isArray(mean)
        || !Array.isArray(std)
        || row.length !== mean.length + 1
        || std.length !== mean.length
        || !row.every(Number.isFinite)
    ) return null;
    const standardized = new Array(row.length);
    for (let j = 0; j < mean.length; j++) {
        if (!Number.isFinite(mean[j]) || !Number.isFinite(std[j]) || std[j] <= 0) return null;
        standardized[j] = (row[j] - mean[j]) / std[j];
    }
    standardized[mean.length] = 1;
    return standardized;
}

function fitCalibrationRows(rows, lambda) {
    const stats = featureStatistics(rows.map(row => row.irisFeatures));
    if (!stats) return null;
    const matrix = rows.map(row => standardizeFeatureRow(row.irisFeatures, stats.mean, stats.std));
    if (!matrix.every(Boolean)) return null;
    const targetsX = rows.map(row => row.screenX);
    const targetsY = rows.map(row => row.screenY);
    const modelX = ridgeRegression(matrix, targetsX, lambda);
    const modelY = ridgeRegression(matrix, targetsY, lambda);
    if (!modelX?.every(Number.isFinite) || !modelY?.every(Number.isFinite)) return null;
    return { ...stats, matrix, targetsX, targetsY, modelX, modelY };
}

function targetGroups(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = `${Number(row.screenX).toFixed(2)}:${Number(row.screenY).toFixed(2)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    return [...groups.values()];
}

function selectRidgeLambda(rows, candidates, fallback) {
    const groups = targetGroups(rows);
    if (groups.length < 6) return { lambda: fallback, targetCvRmsPx: null, targetCount: groups.length };
    let best = null;
    for (const lambda of candidates) {
        if (!Number.isFinite(lambda) || lambda < 0) continue;
        let sumSquared = 0;
        let sampleCount = 0;
        let failed = false;
        for (const heldOut of groups) {
            const heldOutSet = new Set(heldOut);
            const train = rows.filter(row => !heldOutSet.has(row));
            const fitted = fitCalibrationRows(train, lambda);
            if (!fitted) {
                failed = true;
                break;
            }
            for (const row of heldOut) {
                const features = standardizeFeatureRow(row.irisFeatures, fitted.mean, fitted.std);
                if (!features) {
                    failed = true;
                    break;
                }
                const dx = dotProduct(features, fitted.modelX) - row.screenX;
                const dy = dotProduct(features, fitted.modelY) - row.screenY;
                sumSquared += dx * dx + dy * dy;
                sampleCount += 1;
            }
            if (failed) break;
        }
        if (failed || sampleCount === 0) continue;
        const rms = Math.sqrt(sumSquared / sampleCount);
        if (!best || rms < best.targetCvRmsPx) {
            best = { lambda, targetCvRmsPx: rms, targetCount: groups.length };
        }
    }
    return best || { lambda: fallback, targetCvRmsPx: null, targetCount: groups.length };
}

export default class GazeTracker {
    constructor(options = {}) {
        this._isCalibrated = false;
        this._isTracking = false;
        this._ridgeLambda = options.ridgeLambda ?? DEFAULTS.ridgeLambda;
        this._autoTuneRidge = options.ridgeLambda == null;
        this._calibrationData = [];
        this._modelX = null;
        this._modelY = null;
        this._featureMean = null;
        this._featureStd = null;
        this._irisDistribution = null;
        this._headDistribution = null;
        this._postCalibrationCorrection = null;
        this._calibrationViewport = null;
        this._viewport = {
            width: options.screenWidth || globalThis.window?.innerWidth || 1920,
            height: options.screenHeight || globalThis.window?.innerHeight || 1080
        };
        this._displayFilter = new AdaptiveGazeFilter({
            minCutoffHz: options.minCutoffHz ?? DEFAULTS.minCutoffHz,
            maxCutoffHz: options.maxCutoffHz ?? DEFAULTS.maxCutoffHz,
            velocityGain: options.velocityGain ?? DEFAULTS.velocityGain
        });
        this.LANDMARKS = LANDMARKS;
        this.onGazeUpdate = options.onGazeUpdate || null;
        this.onCalibrationComplete = options.onCalibrationComplete || null;
        this._stats = {
            totalPredictions: 0,
            acceptedPredictions: 0,
            rejectedPredictions: 0,
            calibrationPoints: 0,
            lastCalibrationTime: null,
            avgFeatureExtractionMs: 0,
            selectedRidgeLambda: this._ridgeLambda,
            calibrationTargetCvRmsPx: null
        };
    }

    addCalibrationPoint(landmarks, screenX, screenY) {
        const groups = extractFeatureGroups(landmarks);
        if (!groups || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
        this._calibrationData.push({
            irisFeatures: groups.iris,
            headFeatures: groups.head,
            screenX,
            screenY,
            timestamp: Date.now()
        });
        this._stats.calibrationPoints = this._calibrationData.length;
        return true;
    }

    addAveragedCalibrationPoint(landmarksArray, screenX, screenY) {
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
        const groups = (landmarksArray || [])
            .filter(landmarks => Array.isArray(landmarks) && landmarks.length >= MIN_LANDMARKS)
            .map(extractFeatureGroups)
            .filter(Boolean);
        if (!groups.length) return false;
        const irisFeatures = averageVectors(groups.map(group => group.iris));
        const headFeatures = averageVectors(groups.map(group => group.head));
        if (!irisFeatures || !headFeatures) return false;
        irisFeatures[irisFeatures.length - 1] = 1;
        this._calibrationData.push({
            irisFeatures,
            headFeatures,
            screenX,
            screenY,
            timestamp: Date.now()
        });
        this._stats.calibrationPoints = this._calibrationData.length;
        return true;
    }

    calibrate() {
        const count = this._calibrationData.length;
        if (count < DEFAULTS.minCalibrationPoints) return false;
        try {
            const rawFeatures = this._calibrationData.map(row => row.irisFeatures);
            const width = rawFeatures[0].length - 1;
            if (
                width !== IRIS_STD_FLOORS.length
                || !rawFeatures.every(row =>
                    Array.isArray(row)
                    && row.length === width + 1
                    && row.every(Number.isFinite)
                )
                || !this._calibrationData.every(row =>
                    Array.isArray(row.headFeatures)
                    && row.headFeatures.length === HEAD_STD_FLOORS.length
                    && row.headFeatures.every(Number.isFinite)
                    && Number.isFinite(row.screenX)
                    && Number.isFinite(row.screenY)
                )
            ) return false;
            const lambdaSelection = this._autoTuneRidge
                ? selectRidgeLambda(
                    this._calibrationData,
                    DEFAULTS.ridgeLambdaCandidates,
                    this._ridgeLambda
                )
                : {
                    lambda: this._ridgeLambda,
                    targetCvRmsPx: null,
                    targetCount: targetGroups(this._calibrationData).length
                };
            const fitted = fitCalibrationRows(this._calibrationData, lambdaSelection.lambda);
            if (!fitted) return false;
            const {
                mean: featureMean,
                std: featureStd,
                matrix,
                targetsX,
                targetsY,
                modelX,
                modelY
            } = fitted;
            const irisDistribution = fitDistribution(
                rawFeatures.map(row => row.slice(0, -1)),
                IRIS_STD_FLOORS
            );
            const headDistribution = fitDistribution(
                this._calibrationData.map(row => row.headFeatures),
                HEAD_STD_FLOORS
            );
            if (
                !modelX?.every(Number.isFinite)
                || !modelY?.every(Number.isFinite)
                || !irisDistribution
                || !headDistribution
            ) return false;
            this._featureMean = featureMean;
            this._featureStd = featureStd;
            this._modelX = modelX;
            this._modelY = modelY;
            this._ridgeLambda = lambdaSelection.lambda;
            this._irisDistribution = irisDistribution;
            this._headDistribution = headDistribution;
            this._isCalibrated = true;
            this._postCalibrationCorrection = null;
            this._calibrationViewport = { ...this._viewport };
            this.resetSmoothingState();
            this._stats.lastCalibrationTime = Date.now();
            this._stats.selectedRidgeLambda = lambdaSelection.lambda;
            this._stats.calibrationTargetCvRmsPx = Number.isFinite(lambdaSelection.targetCvRmsPx)
                ? Math.round(lambdaSelection.targetCvRmsPx * 10) / 10
                : null;

            const trainErrors = matrix.map((features, index) => ({
                x: dotProduct(features, this._modelX) - targetsX[index],
                y: dotProduct(features, this._modelY) - targetsY[index]
            }));
            const trainMAE = {
                x: trainErrors.reduce((sum, row) => sum + Math.abs(row.x), 0) / count,
                y: trainErrors.reduce((sum, row) => sum + Math.abs(row.y), 0) / count
            };
            this.onCalibrationComplete?.({
                points: count,
                timestamp: Date.now(),
                trainMAE,
                ridgeLambda: this._ridgeLambda,
                targetCvRmsPx: this._stats.calibrationTargetCvRmsPx,
                targetCvTargetCount: lambdaSelection.targetCount,
                predictor: 'iris_only_ridge',
                targetBlind: true
            });
            return true;
        } catch (error) {
            console.error('[GazeTracker] Calibration failed:', error);
            return false;
        }
    }

    setPostCalibrationCorrection(correction) {
        const offsetX = correction?.offsetX;
        const offsetY = correction?.offsetY;
        if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
            const maxOffsetX = this._viewport.width * 0.18;
            const maxOffsetY = this._viewport.height * 0.18;
            if (Math.abs(offsetX) > maxOffsetX || Math.abs(offsetY) > maxOffsetY) return false;
            this._postCalibrationCorrection = {
                kind: 'residual_bias',
                offsetX: Number(offsetX),
                offsetY: Number(offsetY),
                source: correction.source || 'validation_residual_bias_loocv',
                correctionId: correction.correctionId || null,
                viewport: { ...this._viewport },
                appliedAt: Date.now()
            };
            this.resetSmoothingState();
            return true;
        }
        return false;
    }

    clearPostCalibrationCorrection() {
        this._postCalibrationCorrection = null;
        this.resetSmoothingState();
    }

    predict(landmarks, context = {}) {
        if (!this._isCalibrated || !Array.isArray(landmarks) || landmarks.length < MIN_LANDMARKS) {
            return null;
        }
        const started = performance.now();
        const groups = extractFeatureGroups(landmarks);
        if (!groups) return null;
        const standardized = this._standardizeFeatures(groups.iris);
        if (!standardized) return null;
        const rawInCalibrationViewport = {
            x: dotProduct(standardized, this._modelX),
            y: dotProduct(standardized, this._modelY)
        };
        const raw = scalePointBetweenViewports(
            rawInCalibrationViewport,
            this._calibrationViewport,
            this._viewport
        );
        const corrected = this._applyCorrection(
            rawInCalibrationViewport.x,
            rawInCalibrationViewport.y
        );
        const irisDistance = distributionDistance(groups.iris.slice(0, -1), this._irisDistribution);
        const headDistance = distributionDistance(groups.head, this._headDistribution);
        let gate = evaluateGazeGate({
            baseConfidence: estimateConfidence(landmarks),
            irisDistance,
            headDistance
        });
        if (
            !raw
            || !Number.isFinite(raw.x)
            || !Number.isFinite(raw.y)
            || !Number.isFinite(corrected?.x)
            || !Number.isFinite(corrected?.y)
        ) {
            gate = {
                ...gate,
                accepted: false,
                confidence: 0,
                rejectionReason: 'non_finite_prediction'
            };
        }
        const monotonicTimestamp = Number.isFinite(context.timestamp)
            ? context.timestamp
            : performance.now();
        const timestamp = Number.isFinite(context.wallTimestamp)
            ? context.wallTimestamp
            : Date.now();
        const onScreen = Number.isFinite(corrected?.x) && Number.isFinite(corrected?.y)
            && corrected.x >= 0 && corrected.x <= this._viewport.width
            && corrected.y >= 0 && corrected.y <= this._viewport.height;

        let display = null;
        if (gate.accepted && onScreen) {
            display = this._displayFilter.update(corrected, monotonicTimestamp, this._viewport);
        } else {
            this._displayFilter.reset();
        }

        const result = {
            // Compatibility aliases: x/y always mean display and can be null.
            x: display ? Math.round(display.x) : null,
            y: display ? Math.round(display.y) : null,
            rawX: Number.isFinite(raw?.x) ? Math.round(raw.x) : null,
            rawY: Number.isFinite(raw?.y) ? Math.round(raw.y) : null,
            correctedX: Number.isFinite(corrected?.x) ? Math.round(corrected.x) : null,
            correctedY: Number.isFinite(corrected?.y) ? Math.round(corrected.y) : null,
            displayX: display ? Math.round(display.x) : null,
            displayY: display ? Math.round(display.y) : null,
            // Deprecated model aliases retained in exported sessions.
            modelX: Number.isFinite(raw?.x) ? Math.round(raw.x) : null,
            modelY: Number.isFinite(raw?.y) ? Math.round(raw.y) : null,
            valid: gate.accepted,
            targetBlind: true,
            onScreen: gate.accepted && onScreen,
            clipped: !onScreen,
            rejectionReason: gate.rejectionReason,
            confidence: gate.confidence,
            ood: gate.ood,
            head: {
                yawProxy: groups.head[0],
                pitchProxy: groups.head[1],
                rollProxy: groups.head[2],
                translationX: groups.head[3],
                translationY: groups.head[4],
                faceScale: groups.head[5]
            },
            smoothing: display ? {
                algorithm: 'velocity_adaptive_ema',
                alpha: display.alpha,
                velocityViewportPerSec: display.velocityViewportPerSec
            } : null,
            frameTimestamp: monotonicTimestamp,
            timestamp
        };
        this._stats.totalPredictions += 1;
        if (result.valid) this._stats.acceptedPredictions += 1;
        else this._stats.rejectedPredictions += 1;
        this._stats.avgFeatureExtractionMs = (
            this._stats.avgFeatureExtractionMs * (this._stats.totalPredictions - 1)
            + (performance.now() - started)
        ) / this._stats.totalPredictions;
        return result;
    }

    _standardizeFeatures(
        rawFeatures,
        featureMean = this._featureMean,
        featureStd = this._featureStd
    ) {
        return standardizeFeatureRow(rawFeatures, featureMean, featureStd);
    }

    _applyCorrection(x, y) {
        if (!this._calibrationViewport) return null;
        if (!this._postCalibrationCorrection) {
            return scalePointBetweenViewports(
                { x, y },
                this._calibrationViewport,
                this._viewport
            );
        }
        const correctionViewport = this._postCalibrationCorrection.viewport
            || this._calibrationViewport;
        const correctionInput = scalePointBetweenViewports(
            { x, y },
            this._calibrationViewport,
            correctionViewport
        );
        if (!correctionInput) return null;
        return scalePointBetweenViewports(
            {
                x: correctionInput.x + this._postCalibrationCorrection.offsetX,
                y: correctionInput.y + this._postCalibrationCorrection.offsetY
            },
            correctionViewport,
            this._viewport
        );
    }

    updateScreenSize(width, height) {
        const next = {
            width: Number.isFinite(width) && width > 0 ? width : globalThis.window?.innerWidth || 1,
            height: Number.isFinite(height) && height > 0 ? height : globalThis.window?.innerHeight || 1
        };
        if (
            Math.abs(next.width - this._viewport.width) < 0.5
            && Math.abs(next.height - this._viewport.height) < 0.5
        ) return;
        this._viewport = next;
        this.resetSmoothingState();
    }

    getStatus() {
        return {
            isCalibrated: this._isCalibrated,
            isTracking: this._isTracking,
            ...this._stats,
            avgFeatureExtractionMs: Math.round(this._stats.avgFeatureExtractionMs * 100) / 100,
            predictor: 'iris_only_ridge',
            targetBlind: true,
            confidenceGate: 'iris_head_ood',
            postCalibrationCorrection: this._postCalibrationCorrection
                ? { ...this._postCalibrationCorrection }
                : { enabled: false },
            screenSize: { ...this._viewport },
            calibrationScreenSize: this._calibrationViewport
                ? { ...this._calibrationViewport }
                : null
        };
    }

    resetSmoothingState() {
        this._displayFilter.reset();
    }

    clearCalibrationData() {
        this._calibrationData = [];
        this._stats.calibrationPoints = 0;
    }

    reset() {
        this._isCalibrated = false;
        this._calibrationData = [];
        this._modelX = null;
        this._modelY = null;
        this._featureMean = null;
        this._featureStd = null;
        this._irisDistribution = null;
        this._headDistribution = null;
        this._postCalibrationCorrection = null;
        this._calibrationViewport = null;
        this.resetSmoothingState();
    }

    isCalibrated() { return this._isCalibrated; }
    isTracking() { return this._isTracking; }
}
