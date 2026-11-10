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
import { LANDMARKS, MIN_LANDMARKS, DEFAULTS, FEATURE_METHOD, EXPERIMENTAL_FEATURE_METHOD, CALIBRATION_SAMPLING } from './constants.js?v=20261106-143';
import { extractFeatureGroups, extractCornerFeatureGroups, extractAblationFeatureGroups, confidenceFromFeatureGroups } from './features.js?v=20261108-143l';
import { ridgeRegression, ridgeRegressionDual, dotProduct } from './ridge.js?v=20261107-143';
import { EYE_PATCH_LENGTH, EYE_PATCH_METHOD, EYE_PATCH_SPEC, EYE_PATCH_CORE_LENGTH, EYE_PATCH_CORE_METHOD } from './eye-patch-features.mjs?v=20261107-143';
import { EYE_GRADIENT_METHOD, EYE_GRADIENT_ALL_METHOD, EYE_GRADIENT_LENGTH, EYE_GRADIENT_SPEC } from './eye-gradient-features.mjs?v=20261107-143g';
import { EYE_TOPHAT_METHOD, EYE_TOPHAT_LENGTH, EYE_TOPHAT_SPEC } from './eye-tophat-features.mjs?v=20261108-143l';
import {
    AdaptiveGazeFilter,
    fitDistribution,
    distributionDistance,
    evaluateGazeGate,
    MIN_GAZE_CONFIDENCE,
    scalePointBetweenViewports
} from './signal-processing.mjs?v=20261106-143';

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

function featureStatistics(rawFeatures, floors) {
    const count = rawFeatures.length;
    const width = rawFeatures[0]?.length - 1;
    if (
        count < 2
        || width !== floors.length
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
        std[j] = Math.max(Math.sqrt(variance), floors[j]);
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

function fitCalibrationRows(rows, lambda, featureMethod, baseFloors = IRIS_STD_FLOORS, linearY = false, linearX = false) {
    let floors = baseFloors;
    if (featureMethod === EXPERIMENTAL_FEATURE_METHOD) {
        // Convert the previous per-feature floors to eye-width units using
        // training-only, target-independent aperture. A held-out fold does not
        // supply even this nuisance scale. No numerical OOD gate is relaxed.
        const apertures = rows.map(row => row.eyeAperture).sort((a, b) => a - b);
        if (!apertures.length || !apertures.every(value => Number.isFinite(value) && value > 0)) return null;
        const mid = Math.floor(apertures.length / 2);
        const s = apertures.length % 2 ? apertures[mid] : (apertures[mid - 1] + apertures[mid]) / 2;
        const scales = [1, s, 1, s, 1, s, 1, s, 1, s * s, s];
        floors = IRIS_STD_FLOORS.map((value, i) => value * scales[i]);
    }
    const stats = featureStatistics(rows.map(row => row.irisFeatures), floors);
    if (!stats) return null;
    const matrix = rows.map(row => standardizeFeatureRow(row.irisFeatures, stats.mean, stats.std));
    if (!matrix.every(Boolean)) return null;
    const targetsX = rows.map(row => row.screenX);
    const targetsY = rows.map(row => row.screenY);
    const lambdaX = typeof lambda === 'number' ? lambda : lambda.x;
    const lambdaY = typeof lambda === 'number' ? lambda : lambda.y;
    // Diagnostic per-axis bases preserve per-column train statistics. Zero-pad
    // omitted nonlinear terms so predict keeps one target-blind feature vector.
    const xMatrix = linearX ? matrix.map(row => [...row.slice(0, 8), 1]) : matrix;
    const ridge = [EYE_PATCH_METHOD, EYE_PATCH_CORE_METHOD, EYE_GRADIENT_METHOD, EYE_GRADIENT_ALL_METHOD, EYE_TOPHAT_METHOD].includes(featureMethod) ? ridgeRegressionDual : ridgeRegression;
    const xFit = ridge(xMatrix, targetsX, lambdaX);
    const modelX = linearX && xFit ? [...xFit.slice(0, 8), 0, 0, 0, xFit[8]] : xFit;
    const yMatrix = linearY ? matrix.map(row => [...row.slice(0, 8), 1]) : matrix;
    const yFit = ridge(yMatrix, targetsY, lambdaY);
    const modelY = linearY && yFit ? [...yFit.slice(0, 8), 0, 0, 0, yFit[8]] : yFit;
    if (!modelX?.every(Number.isFinite) || !modelY?.every(Number.isFinite)) return null;
    return { ...stats, floors, matrix, targetsX, targetsY, modelX, modelY };
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

function selectRidgeLambda(rows, candidates, fallback, featureMethod, floors, linearY = false, linearX = false) {
    const groups = targetGroups(rows);
    if (groups.length < 6) return { lambda: fallback, targetCvRmsPx: null, targetCount: groups.length };
    let best = null, bestX = null, bestY = null;
    const curve = [];
    for (const lambda of candidates) {
        if (!Number.isFinite(lambda) || lambda < 0) continue;
        let sumSquared = 0;
        let squaredX = 0, squaredY = 0;
        let sampleCount = 0;
        let failed = false;
        for (const heldOut of groups) {
            const heldOutSet = new Set(heldOut);
            const train = rows.filter(row => !heldOutSet.has(row));
            const fitted = fitCalibrationRows(train, lambda, featureMethod, floors, linearY, linearX);
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
                squaredX += dx * dx; squaredY += dy * dy;
                sampleCount += 1;
            }
            if (failed) break;
        }
        if (failed || sampleCount === 0) continue;
        const rms = Math.sqrt(sumSquared / sampleCount);
        const rmsX = Math.sqrt(squaredX / sampleCount), rmsY = Math.sqrt(squaredY / sampleCount);
        curve.push({ lambda, rmsXPx: rmsX, rmsYPx: rmsY, rmsPx: rms });
        if (!bestX || rmsX < bestX.rms) bestX = { lambda, rms: rmsX };
        if (!bestY || rmsY < bestY.rms) bestY = { lambda, rms: rmsY };
        if (!best || rms < best.targetCvRmsPx) {
            best = { lambda, targetCvRmsPx: rms, targetCount: groups.length,
                rmsXPx: rmsX, rmsYPx: rmsY };
        }
    }
    if (linearY && bestX && bestY) return { lambda: bestX.lambda, lambdaY: bestY.lambda,
        targetCvRmsPx: Math.hypot(bestX.rms, bestY.rms), targetCount: groups.length,
        rmsXPx: bestX.rms, rmsYPx: bestY.rms, curve };
    return best ? { ...best, curve } : { lambda: fallback, targetCvRmsPx: null, targetCount: groups.length };
}

function selectAxisBases(rows, candidates, fallback, featureMethod, floors) {
    // Model/regularization selection uses calibration target groups only. These
    // CV minima are selection diagnostics, not independent validation accuracy.
    const curve = ['quadratic', 'linear'].flatMap(basis => {
        const linear = basis === 'linear';
        const result = selectRidgeLambda(rows, candidates, fallback, featureMethod, floors, linear, linear);
        return (result.curve || []).map(row => ({ ...row, basis }));
    });
    const targetCount = targetGroups(rows).length;
    if (!curve.length) return { lambda: fallback, lambdaY: fallback, basisX: 'quadratic', basisY: 'quadratic',
        targetCvRmsPx: null, targetCount, curve };
    const x = curve.reduce((best, row) => row.rmsXPx < best.rmsXPx ? row : best);
    const y = curve.reduce((best, row) => row.rmsYPx < best.rmsYPx ? row : best);
    return { lambda: x.lambda, lambdaY: y.lambda, basisX: x.basis, basisY: y.basis,
        rmsXPx: x.rmsXPx, rmsYPx: y.rmsYPx, targetCvRmsPx: Math.hypot(x.rmsXPx, y.rmsYPx), targetCount, curve };
}

export default class GazeTracker {
    constructor(options = {}) {
        if (options.experimentalGeometry !== undefined && options.experimentalGeometry !== 'corner_width') {
            throw new RangeError('Unknown experimental gaze geometry');
        }
        this._featureMethod = options.experimentalGeometry === 'corner_width' ? EXPERIMENTAL_FEATURE_METHOD : FEATURE_METHOD;
        this._extractGroups = options.experimentalGeometry === 'corner_width' ? extractCornerFeatureGroups : extractFeatureGroups;
        this._featureFloors = IRIS_STD_FLOORS;
        this._ablation = null;
        this._eyePatch = null;
        if (options.experimentalModel !== undefined) {
            const config = options.experimentalModel;
            if (!config || options.experimentalGeometry !== undefined
                || !['normalized', 'camera_pixel'].includes(config.geometry)
                || !['quadratic', 'linear', 'axis_mixed', 'axis_auto'].includes(config.basis)
                || ![config.frameWidth, config.frameHeight].every(v => Number.isSafeInteger(v) && v > 0 && v <= 16384)) {
                throw new RangeError('Invalid explicit experimental gaze model');
            }
            this._ablation = Object.freeze({ geometry: config.geometry, basis: config.basis,
                frameWidth: config.frameWidth, frameHeight: config.frameHeight });
            this._featureMethod = `${config.geometry}_${config.basis}.experimental.v1`;
            this._featureFloors = config.basis === 'linear' ? IRIS_STD_FLOORS.slice(0, 8) : IRIS_STD_FLOORS;
            this._extractGroups = points => extractAblationFeatureGroups(points, this._ablation);
        }
        if (options.experimentalEyePatch !== undefined) {
            const config = options.experimentalEyePatch;
            if (!config || options.experimentalModel !== undefined || options.experimentalGeometry !== undefined
                || typeof config.readFeatures !== 'function'
                || !['full', 'core', 'gradient', 'gradient_all', 'tophat', 'masked', 'rows', 'nuisance'].includes(config.region ?? 'full')
                || ![config.frameWidth, config.frameHeight].every(v => Number.isSafeInteger(v) && v > 0 && v <= 16384)) {
                throw new RangeError('Invalid explicit experimental eye-patch model');
            }
            const region = config.region ?? 'full', gradient = region.startsWith('gradient'), tophat = region === 'tophat', masked = region === 'masked';
            const centers = gradient || masked;
            const inputCount = tophat ? EYE_TOPHAT_LENGTH : centers ? EYE_GRADIENT_LENGTH : region === 'core' ? EYE_PATCH_CORE_LENGTH : EYE_PATCH_LENGTH;
            const count = masked ? 2 : inputCount;
            this._eyePatch = Object.freeze({ geometry: masked ? 'eye_masked' : gradient ? 'eye_gradient' : 'eye_patch', basis: centers ? 'center_linear' : 'appearance_linear', region, featureCount: count,
                frameWidth: config.frameWidth, frameHeight: config.frameHeight, maxTrainingRows: 50,
                crop: masked ? Object.freeze({ columns: 16, rows: 10, widthInCanthalWidths: .8, heightInCanthalWidths: .5,
                    support: 'approximate_lid_mask', fit: 'row_demeaned_pooled_template' })
                    : tophat ? EYE_TOPHAT_SPEC : gradient ? Object.freeze({ ...EYE_GRADIENT_SPEC, support: region === 'gradient_all' ? 'all' : 'lateral' }) : EYE_PATCH_SPEC });
            this._featureMethod = region === 'rows' ? 'eye_patch_rows.experimental.v1'
                : region === 'nuisance' ? 'eye_patch_paired_nuisance.experimental.v1'
                : masked ? 'eye_masked_center.experimental.v1' : tophat ? EYE_TOPHAT_METHOD : region === 'gradient' ? EYE_GRADIENT_METHOD : region === 'gradient_all' ? EYE_GRADIENT_ALL_METHOD
                : region === 'core' ? EYE_PATCH_CORE_METHOD : EYE_PATCH_METHOD;
            this._featureFloors = new Array(count).fill(centers ? .03 : .05);
            const readFeatures = config.readFeatures;
            this._extractGroups = landmarks => {
                const baseline = extractFeatureGroups(landmarks), values = readFeatures(landmarks);
                if (!baseline || !Array.isArray(values) || values.length !== inputCount || !values.every(Number.isFinite)) return null;
                const iris = masked ? [(values[0] + values[2]) / 2, (values[1] + values[3]) / 2, 1] : [...values, 1];
                return { ...baseline, iris, gateIris: baseline.iris };
            };
        }
        this._calibrationFrames = { attempted: 0, accepted: 0, rejected: 0 };
        this._isCalibrated = false;
        this._isTracking = false;
        this._ridgeLambda = options.ridgeLambda ?? DEFAULTS.ridgeLambda;
        this._autoTuneRidge = options.ridgeLambda == null;
        this._calibrationData = [];
        this._calibrationCvDiagnostics = null;
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
        if (this._eyePatch && (this._isCalibrated || this._calibrationData.length >= 50)) return false;
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
        const groups = this._calibrationGroups(landmarks);
        if (!groups) return false;
        this._calibrationData.push({
            irisFeatures: groups.iris,
            ...(groups.gateIris ? { gateIris: groups.gateIris } : {}),
            headFeatures: groups.head,
            eyeAperture: (groups.eye.leftEAR + groups.eye.rightEAR) / 2,
            screenX,
            screenY,
            timestamp: Date.now()
        });
        this._stats.calibrationPoints = this._calibrationData.length;
        return true;
    }

    _calibrationGroups(landmarks) {
        const groups = this._extractGroups(landmarks);
        const accepted = groups && confidenceFromFeatureGroups(groups) >= MIN_GAZE_CONFIDENCE;
        this._calibrationFrames.attempted++;
        this._calibrationFrames[accepted ? 'accepted' : 'rejected']++;
        return accepted ? groups : null;
    }

    addAveragedCalibrationPoint(landmarksArray, screenX, screenY, { minFrames = 1 } = {}) {
        if (this._eyePatch && (this._isCalibrated || this._calibrationData.length >= 50)) return false;
        if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;
        if (!Number.isInteger(minFrames) || minFrames < 1) return false;
        if (!Array.isArray(landmarksArray)) return false;
        const groups = landmarksArray
            .map(landmarks => this._calibrationGroups(landmarks))
            .filter(Boolean);
        if (groups.length < minFrames) return false;
        const irisFeatures = averageVectors(groups.map(group => group.iris));
        const headFeatures = averageVectors(groups.map(group => group.head));
        if (!irisFeatures || !headFeatures) return false;
        irisFeatures[irisFeatures.length - 1] = 1;
        this._calibrationData.push({
            irisFeatures,
            ...(groups[0]?.gateIris ? { gateIris: averageVectors(groups.map(group => group.gateIris)) } : {}),
            headFeatures,
            eyeAperture: groups.reduce((sum, group) => sum + (group.eye.leftEAR + group.eye.rightEAR) / 2, 0) / groups.length,
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
                width !== this._featureFloors.length
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
            const mixed = this._ablation?.basis === 'axis_mixed';
            const axisAuto = this._ablation?.basis === 'axis_auto';
            const lambdaSelection = axisAuto
                ? selectAxisBases(this._calibrationData,
                    this._autoTuneRidge ? DEFAULTS.ridgeLambdaCandidates : [this._ridgeLambda],
                    this._ridgeLambda, this._featureMethod, this._featureFloors)
                : this._autoTuneRidge
                ? selectRidgeLambda(
                    this._calibrationData,
                    this._eyePatch ? [.01, .1, 1, 10, 100] : DEFAULTS.ridgeLambdaCandidates,
                    this._ridgeLambda,
                    this._featureMethod, this._featureFloors, mixed
                )
                : {
                    lambda: this._ridgeLambda,
                    targetCvRmsPx: null,
                    targetCount: targetGroups(this._calibrationData).length
                };
            const selectedLambdaY = lambdaSelection.lambdaY ?? lambdaSelection.lambda;
            const linearX = axisAuto && lambdaSelection.basisX === 'linear';
            const linearY = mixed || (axisAuto && lambdaSelection.basisY === 'linear');
            const fitted = fitCalibrationRows(this._calibrationData,
                mixed || axisAuto ? { x: lambdaSelection.lambda, y: selectedLambdaY } : lambdaSelection.lambda,
                this._featureMethod, this._featureFloors, linearY, linearX);
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
                this._calibrationData.map(row => (row.gateIris || row.irisFeatures).slice(0, -1)),
                this._ablation || this._eyePatch ? IRIS_STD_FLOORS : fitted.floors
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
            this._calibrationCvDiagnostics = {
                policy: axisAuto ? 'per_axis_basis_target_group_cv'
                    : mixed && this._autoTuneRidge ? 'per_axis_target_group_cv' : this._autoTuneRidge ? 'joint_xy_target_group_cv' : 'fixed',
                basisX: this._eyePatch ? this._eyePatch.basis : lambdaSelection.basisX ?? (this._ablation?.basis === 'linear' ? 'linear' : 'quadratic'),
                basisY: this._eyePatch ? this._eyePatch.basis : lambdaSelection.basisY ?? (mixed || this._ablation?.basis === 'linear' ? 'linear' : 'quadratic'),
                lambdaX: lambdaSelection.lambda, lambdaY: selectedLambdaY,
                rmsXPx: lambdaSelection.rmsXPx ?? null, rmsYPx: lambdaSelection.rmsYPx ?? null,
                curve: lambdaSelection.curve || [], independentTargetsUsed: 0
            };

            const trainErrors = matrix.map((features, index) => ({
                x: dotProduct(features, this._modelX) - targetsX[index],
                y: dotProduct(features, this._modelY) - targetsY[index]
            }));
            const trainMAE = {
                x: trainErrors.reduce((sum, row) => sum + Math.abs(row.x), 0) / count,
                y: trainErrors.reduce((sum, row) => sum + Math.abs(row.y), 0) / count
            };
            // Low-resolution eye appearance is sensitive too. Release its
            // training rows before a callback can throw or retain this tracker.
            if (this._eyePatch) this._calibrationData = [];
            this.onCalibrationComplete?.({
                points: count,
                timestamp: Date.now(),
                trainMAE,
                ridgeLambda: this._ridgeLambda,
                targetCvRmsPx: this._stats.calibrationTargetCvRmsPx,
                targetCvTargetCount: lambdaSelection.targetCount,
                predictor: this._eyePatch?.geometry === 'eye_masked' ? 'eye_masked_ridge'
                    : this._eyePatch?.geometry === 'eye_gradient' ? 'eye_gradient_ridge' : this._eyePatch ? 'eye_patch_ridge' : 'iris_only_ridge',
                featureMethod: this._featureMethod,
                calibrationSampling: CALIBRATION_SAMPLING,
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
        const groups = this._extractGroups(landmarks);
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
        const irisDistance = distributionDistance((groups.gateIris || groups.iris).slice(0, -1), this._irisDistribution);
        const headDistance = distributionDistance(groups.head, this._headDistribution);
        let gate = evaluateGazeGate({
            baseConfidence: confidenceFromFeatureGroups(groups),
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
            featureMethod: this._featureMethod,
            calibrationSampling: CALIBRATION_SAMPLING,
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
            predictor: this._eyePatch?.geometry === 'eye_masked' ? 'eye_masked_ridge'
                : this._eyePatch?.geometry === 'eye_gradient' ? 'eye_gradient_ridge' : this._eyePatch ? 'eye_patch_ridge' : 'iris_only_ridge',
            featureMethod: this._featureMethod,
            calibrationSampling: CALIBRATION_SAMPLING,
            calibrationFrames: { ...this._calibrationFrames },
            targetBlind: true,
            confidenceGate: 'iris_head_ood',
            ...(this._ablation ? { experimentalModel: { ...this._ablation }, gateInputMethod: FEATURE_METHOD } : {}),
            ...(this._eyePatch ? { experimentalModel: { ...this._eyePatch }, gateInputMethod: FEATURE_METHOD } : {}),
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

    // Local diagnostics only; no weights, calibration feature rows or targets.
    getCalibrationDiagnostics() {
        return this._calibrationCvDiagnostics ? { ...this._calibrationCvDiagnostics,
            curve: this._calibrationCvDiagnostics.curve.map(row => ({ ...row })) } : null;
    }

    clearCalibrationData() {
        this._calibrationData = [];
        this._calibrationCvDiagnostics = null;
        this._stats.calibrationPoints = 0;
        this._calibrationFrames = { attempted: 0, accepted: 0, rejected: 0 };
    }

    reset() {
        this._isCalibrated = false;
        this.clearCalibrationData();
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
