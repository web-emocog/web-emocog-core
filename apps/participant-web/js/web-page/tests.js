import { state } from './state.js';
import { translations } from '../../translations.js';
import { updateFinalStepWithQC, nextStep } from './ui.js';
import { stopPreCheck } from './precheck.js';
import { startCameraFpsMonitor, stopCameraFpsMonitor, getAverageCameraFps } from './camera.js';
import { loadAndStartCognitiveTask } from './experimental_task.js';


const TARGET_LOOP_INTERVAL_MS = 33;
const SAME_FRAME_RETRY_MS = 8;

function getVideoTime(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return -1;
    const t = videoElement.currentTime;
    return Number.isFinite(t) ? t : -1;
}

export async function startCalibration() {
    console.log('Запуск калибровки на основе MediaPipe Face Landmarker...');
    
    // Сохраняем данные pre-check
    state.sessionData.precheck = {
        ...(state.runtime.precheckData || {}),
        timestamp: Date.now(),
        videoResolution: {
            width: document.getElementById('precheckVideo')?.videoWidth,
            height: document.getElementById('precheckVideo')?.videoHeight
        }
    };
    
    // === ИНИЦИАЛИЗАЦИЯ QC METRICS ===
    state.runtime.qcMetrics = new QCMetrics({
        screenWidth: window.screen.width,
        screenHeight: window.screen.height
    });
    state.runtime.qcMetrics.start(); 
    state.runtime.sessionStartTime = Date.now();
    console.log('[QC] QCMetrics инициализирован и запущен');
    
    // === ИНИЦИАЛИЗАЦИЯ GAZE TRACKER ===
    state.runtime.gazeTracker = new GazeTracker({
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        // Сбалансированный профиль: ниже инерция, но без заметного роста шума.
        smoothingFactor: 0.10,
        onGazeUpdate: (gazeData) => {
            // Передаём данные взгляда в единую точку входа
            if (window.handleGazeUpdate) {
                window.handleGazeUpdate(gazeData);
            }
        }
    });
    console.log('[GazeTracker] Инициализирован');
    
    // Скрываем pre-check интерфейс
    document.getElementById('precheckContainer').style.display = 'none';
    document.getElementById('startPrecheckBtn').style.display = 'none';
    document.getElementById('startCalibBtn').style.display = 'none';
    
    if (state.flags.isPrecheckRunning) {
        stopPreCheck();
    }
    
    // Показываем fullscreen калибровку
    const calibScreen = document.getElementById('fullscreenCalibration');
    const point = document.getElementById('fullscreenCalibPoint');
    const instructionText = document.getElementById('calibInstructionText');
    const progressText = document.getElementById('calibProgressText');
    
    // Скрываем контейнер и шапку
    document.querySelector('.container').style.display = 'none';
    document.querySelector('.top-bar').style.display = 'none';
    
    // Показываем fullscreen калибровку
    calibScreen.classList.add('active');
    point.style.display = 'block';
    
    instructionText.innerText = translations[state.currentLang].calib_click_instruction;

    // Усиленная калибровка по ВСЕМУ экрану: 5×5 сетка (25 точек) в snake-порядке.
    // Snake-маршрут уменьшает длинные скачки глаз и делает фиксацию стабильнее.
    const positions = [
        { x: 5, y: 5 }, { x: 27.5, y: 5 }, { x: 50, y: 5 }, { x: 72.5, y: 5 }, { x: 95, y: 5 },
        { x: 95, y: 27.5 }, { x: 72.5, y: 27.5 }, { x: 50, y: 27.5 }, { x: 27.5, y: 27.5 }, { x: 5, y: 27.5 },
        { x: 5, y: 50 }, { x: 27.5, y: 50 }, { x: 50, y: 50 }, { x: 72.5, y: 50 }, { x: 95, y: 50 },
        { x: 95, y: 72.5 }, { x: 72.5, y: 72.5 }, { x: 50, y: 72.5 }, { x: 27.5, y: 72.5 }, { x: 5, y: 72.5 },
        { x: 5, y: 95 }, { x: 27.5, y: 95 }, { x: 50, y: 95 }, { x: 72.5, y: 95 }, { x: 95, y: 95 }
    ];
    
    const video = document.getElementById('precheckVideo');
    let i = 0;
    const CLICKS_PER_POINT = 2; // 2 клика на каждую точку → 50 калибровочных точек (>> 17 фич)
    const calibrationBuildTag = 'calib-grid-5x5-v3-robustval';
    window.__gazeCalibrationDebug = {
        build: calibrationBuildTag,
        moduleUrl: import.meta.url,
        points: positions.length,
        clicksPerPoint: CLICKS_PER_POINT
    };
    console.info(
        `[GazeTracker] Calibration build=${calibrationBuildTag}, module=${import.meta.url}, ` +
        `points=${positions.length}, clicksPerPoint=${CLICKS_PER_POINT}`
    );
    let clicksOnCurrentPoint = 0;
    const screenDiag = Math.sqrt(window.innerWidth * window.innerWidth + window.innerHeight * window.innerHeight);
    let previousTarget = null;
    const pointFailureCounts = new Array(positions.length).fill(0);
    
    const updatePoint = () => {
        point.style.left = `${positions[i].x}%`;
        point.style.top = `${positions[i].y}%`;
        progressText.innerText = `${translations[state.currentLang].calib_progress} ${i + 1} ${translations[state.currentLang].point_of} ${positions.length} (${clicksOnCurrentPoint}/${CLICKS_PER_POINT})`;
    };

    // Обработчик клика на точку для калибровки
    // 2 клика на точку, адаптивная стабилизация и отбор стабильных кадров.
    const handleCalibClick = async () => {
        // Prevent double-clicks while collecting frames
        point.onclick = null;
        point.style.opacity = '0.5';
        try {
            // === GAZE CALIBRATION: собираем iris features с усреднением ===
            if (state.runtime.gazeTracker && state.runtime.localAnalyzer && video) {
                const currentPos = positions[i];
                const screenX = (currentPos.x / 100) * window.innerWidth;
                const screenY = (currentPos.y / 100) * window.innerHeight;
                const failedClicksForPoint = pointFailureCounts[i] || 0;
                const relaxedLevel = Math.min(2, failedClicksForPoint);
                
                // 1) Settling delay: учитываем сложность точки и длину предыдущего скачка.
                const xPct = currentPos.x;
                const yPct = currentPos.y;
                const isExtremeX = xPct <= 10 || xPct >= 90;
                const isExtremeY = yPct <= 10 || yPct >= 90;
                const isCorner = isExtremeX && isExtremeY;
                const isBottomBand = yPct >= 72.5;
                const isTopBand = yPct <= 27.5;
                const radialFromCenter = Math.min(1, Math.hypot(xPct - 50, yPct - 50) / 70.71); // 0..1
                const jumpRatio = previousTarget
                    ? Math.min(1, Math.hypot(screenX - previousTarget.x, screenY - previousTarget.y) / (screenDiag || 1))
                    : 0.6;
                let settlingDelay = 360
                    + radialFromCenter * 170
                    + jumpRatio * 220
                    + (isCorner ? 70 : 0);
                settlingDelay = Math.max(360, Math.min(850, Math.round(settlingDelay)));
                await new Promise(r => setTimeout(r, settlingDelay));
                
                // 2) Адаптивный сбор нескольких новых кадров + фильтрация нестабильных.
                const isEdge = isExtremeX || isExtremeY;
                const framesToCollect = Math.round(12 + radialFromCenter * 5 + (isEdge ? 2 : 0) + (isCorner ? 2 : 0)); // 12..21
                const frameDelay = isCorner ? 42 : isEdge ? 38 : 34;
                const minStableRatio = Math.max(0.45, 0.65 - relaxedLevel * 0.1);
                const minStableFrames = Math.max(6, Math.floor(framesToCollect * minStableRatio));
                const fallbackMinFrames = Math.max(5, minStableFrames - 2);
                const poseYawLimit = 12 + relaxedLevel * 4 + (isExtremeX ? 2 : 0);
                const poseRollLimit = 10 + relaxedLevel * 3 + (isExtremeX ? 1 : 0);
                const posePitchLimit = 12 + relaxedLevel * 5 + (isBottomBand ? 8 : (isTopBand ? 4 : 0));
                const collectedLandmarks = [];
                let lastSampledVideoTime = -1;
                let attempts = 0;
                let repeatedSameFrameCount = 0;
                
                while (attempts < 2 && collectedLandmarks.length < minStableFrames) {
                    const targetFramesThisAttempt = attempts === 0 ? framesToCollect : Math.ceil(framesToCollect * 0.7);

                    for (let f = 0; f < targetFramesThisAttempt; f++) {
                        const videoTime = getVideoTime(video);
                        if (videoTime >= 0) {
                            if (videoTime === lastSampledVideoTime) {
                                repeatedSameFrameCount++;
                                if (repeatedSameFrameCount <= 6) {
                                    await new Promise(r => setTimeout(r, SAME_FRAME_RETRY_MS));
                                    continue;
                                }
                                // После нескольких повторов не блокируемся:
                                // используем текущий кадр, чтобы не зависнуть на точке.
                            } else {
                                repeatedSameFrameCount = 0;
                                lastSampledVideoTime = videoTime;
                            }
                        }

                        try {
                            const result = await state.runtime.localAnalyzer.analyzeFrame(video);
                            const hasLandmarks = !!(result && result.landmarks);
                            const bothOpen = result?.eyes?.bothOpen;
                            const leftOpen = result?.eyes?.left?.isOpen;
                            const rightOpen = result?.eyes?.right?.isOpen;
                            const oneEyeOpen = leftOpen !== false || rightOpen !== false;
                            const eyesOk = (
                                !result?.eyes ||
                                bothOpen !== false ||
                                ((isBottomBand || relaxedLevel > 0) && oneEyeOpen)
                            );

                            const pose = result?.pose;
                            const hasPose = Number.isFinite(pose?.yaw) && Number.isFinite(pose?.pitch) && Number.isFinite(pose?.roll);
                            let poseOk = !pose || pose.status !== 'error';
                            if (poseOk && pose?.status === 'off_center') {
                                // На нижних/повторных кликах не блокируем точку только из-за off_center:
                                // head-position фичи уже учитываются моделью.
                                poseOk = isBottomBand || relaxedLevel > 0;
                            }
                            if (poseOk && hasPose) {
                                poseOk = Math.abs(pose.yaw) <= poseYawLimit &&
                                    Math.abs(pose.pitch) <= posePitchLimit &&
                                    Math.abs(pose.roll) <= poseRollLimit;
                            } else if (poseOk && pose?.status === 'tilted' && !hasPose) {
                                poseOk = false;
                            }

                            if (hasLandmarks && eyesOk && poseOk) {
                                collectedLandmarks.push(result.landmarks);
                            }
                        } catch (e) {
                            // Ignore individual frame errors
                        }
                        if (f < targetFramesThisAttempt - 1) {
                            await new Promise(r => setTimeout(r, frameDelay));
                        }
                    }

                    attempts++;
                    if (collectedLandmarks.length < minStableFrames) {
                        await new Promise(r => setTimeout(r, 120));
                    }
                }
                
                // 3) Добавляем точку только если качество набора достаточное.
                let accepted = false;
                const fallbackAllowed = failedClicksForPoint >= 2 && collectedLandmarks.length >= fallbackMinFrames;
                if (collectedLandmarks.length >= minStableFrames || fallbackAllowed) {
                    const added = state.runtime.gazeTracker.addAveragedCalibrationPoint(
                        collectedLandmarks, screenX, screenY
                    );
                    if (added) {
                        accepted = true;
                        pointFailureCounts[i] = 0;
                        previousTarget = { x: screenX, y: screenY };
                        if (fallbackAllowed && collectedLandmarks.length < minStableFrames) {
                            console.warn(
                                `[GazeTracker] Fallback acceptance for point ${i + 1}/${positions.length}: ` +
                                `${collectedLandmarks.length}/${minStableFrames} stable frames after ${failedClicksForPoint + 1} failed clicks`
                            );
                        }
                        console.log(`[GazeTracker] Калибровочная точка ${i + 1}/${positions.length} клик ${clicksOnCurrentPoint + 1}/${CLICKS_PER_POINT} (${screenX.toFixed(0)}, ${screenY.toFixed(0)}), ${collectedLandmarks.length} фреймов усреднено`);
                    }
                }

                if (!accepted) {
                    pointFailureCounts[i] = failedClicksForPoint + 1;
                    console.warn(
                        `[GazeTracker] Недостаточно стабильных кадров (${collectedLandmarks.length}/${minStableFrames}), ` +
                        `повторяем точку ${i + 1}, неудачных кликов подряд: ${pointFailureCounts[i]}`
                    );
                    instructionText.innerText = state.currentLang === 'ru'
                        ? `Точка ${i + 1}: кадр нестабилен, повторите клик и держите голову ровнее`
                        : `Point ${i + 1}: unstable frame set, click again and keep your head steadier`;
                    setTimeout(() => {
                        if (i < positions.length) {
                            instructionText.innerText = translations[state.currentLang].calib_click_instruction;
                        }
                    }, 1200);
                    point.style.opacity = '1';
                    point.onclick = handleCalibClick;
                    return;
                }
            }
        } catch (e) {
            console.error('[GazeTracker] Ошибка калибровки точки:', e);
            instructionText.innerText = state.currentLang === 'ru'
                ? 'Внутренняя ошибка калибровки, повторите клик'
                : 'Calibration internal error, click again';
            setTimeout(() => {
                if (i < positions.length) {
                    instructionText.innerText = translations[state.currentLang].calib_click_instruction;
                }
            }, 1200);
            point.style.opacity = '1';
            point.onclick = handleCalibClick;
            return;
        }
        
        clicksOnCurrentPoint++;
        
        if (clicksOnCurrentPoint >= CLICKS_PER_POINT) {
            // Все клики на текущей точке собраны — переходим к следующей
            clicksOnCurrentPoint = 0;
            i++;
        }
        
        if (i >= positions.length) {
            // Калибровка завершена
            
            // === GAZE: Обучаем модель ===
            if (state.runtime.gazeTracker) {
                const calibrated = state.runtime.gazeTracker.calibrate();
                if (calibrated) {
                    console.log('[GazeTracker] Модель обучена, статус:', state.runtime.gazeTracker.getStatus());
                } else {
                    console.warn('[GazeTracker] Калибровка не удалась');
                }
            }
            
            instructionText.innerText = translations[state.currentLang].calib_complete;
            progressText.innerText = '';
            point.style.display = 'none';
            
            setTimeout(() => {
                // После калибровки запускаем валидацию точности
                startGazeValidation();
            }, 1500);
            return;
        }
        
        // Restore point for next click
        point.style.opacity = '1';
        updatePoint();
        
        // Re-attach click handler
        point.onclick = handleCalibClick;
    };

    point.onclick = handleCalibClick;

    updatePoint();

}


// === GAZE VALIDATION: Валидация точности после калибровки ===
/**
 * Запускает этап валидации точности gaze
 * Показывает 9 точек, собирает данные взгляда, вычисляет accuracy/precision
 */
export function startGazeValidation() {
    const calibScreen = document.getElementById('fullscreenCalibration');
    const point = document.getElementById('fullscreenCalibPoint');
    const instructionText = document.getElementById('calibInstructionText');
    const progressText = document.getElementById('calibProgressText');
    
    // Показываем экран валидации (используем тот же fullscreen)
    calibScreen.classList.add('active');
    point.style.display = 'block';
    point.style.backgroundColor = '#10B981'; // Зелёная точка для валидации
    point.style.cursor = 'default'; // Не кликабельная
    point.onclick = null; // Убираем обработчик клика
    
    instructionText.innerText = translations[state.currentLang].validation_look_instruction;
    
    // 9 точек валидации (сетка 3×3, другие позиции чем калибровка)
    // v2.2.0: расширено с 5 до 9 точек, позиции 15%/50%/85% — 
    // ближе к краям для оценки угловой точности, но не совпадают с калибровочными
    const validationPositions = [
        { x: 15, y: 15 },   // верх-лево
        { x: 50, y: 15 },   // верх-центр
        { x: 85, y: 15 },   // верх-право
        { x: 15, y: 50 },   // центр-лево
        { x: 50, y: 50 },   // центр
        { x: 85, y: 50 },   // центр-право
        { x: 15, y: 85 },   // низ-лево
        { x: 50, y: 85 },   // низ-центр
        { x: 85, y: 85 }    // низ-право
    ];
    
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    
    let currentPoint = 0;
    state.runtime.validationPoints = []; // Сброс
    state.flags.isValidating = true;
    
    const SAMPLES_PER_POINT = 30; // ~1 секунда при 30 FPS
    const SAMPLE_INTERVAL = 33; // ~30 FPS
    let currentSamples = [];
    let sampleCount = 0;
    let samplingInterval = null;
    
    // === GAZE: single-flight prediction цикл на время валидации ===
    const video = document.getElementById('precheckVideo');
    let validationLoopLastVideoTime = -1;

    function stopValidationPredictionLoop() {
        state.runtime._validationLoopActive = false;
        if (state.runtime._validationGazeInterval) {
            clearTimeout(state.runtime._validationGazeInterval);
            state.runtime._validationGazeInterval = null;
        }
    }

    function scheduleValidationPrediction(delayMs = 0) {
        if (!state.runtime._validationLoopActive) return;
        state.runtime._validationGazeInterval = setTimeout(runValidationPredictionTick, delayMs);
    }

    async function runValidationPredictionTick() {
        if (!state.runtime._validationLoopActive) return;

        const tickStart = performance.now();
        try {
            const videoTime = getVideoTime(video);
            if (videoTime < 0 || videoTime === validationLoopLastVideoTime) {
                scheduleValidationPrediction(SAME_FRAME_RETRY_MS);
                return;
            }
            validationLoopLastVideoTime = videoTime;

            const result = await state.runtime.localAnalyzer.analyzeFrame(video);
            if (result) {
                // Сохраняем pose данные (как в startTrackingTest)
                if (result.pose) {
                    state.runtime.lastPoseData = {
                        yaw: result.pose.yaw ?? null,
                        pitch: result.pose.pitch ?? null,
                        roll: result.pose.roll ?? null
                    };
                } else {
                    state.runtime.lastPoseData = null;
                }

                if (result.landmarks) {
                    const gaze = state.runtime.gazeTracker.predict(result.landmarks);
                    if (gaze && window.handleGazeUpdate) {
                        window.handleGazeUpdate(gaze);
                    }
                }
            }
        } catch (e) {
            // Игнорируем ошибки отдельных кадров
        }

        const elapsed = performance.now() - tickStart;
        const nextDelay = Math.max(0, TARGET_LOOP_INTERVAL_MS - elapsed);
        scheduleValidationPrediction(nextDelay);
    }

    if (state.runtime.gazeTracker && state.runtime.gazeTracker.isCalibrated() 
        && state.runtime.localAnalyzer && video && video.srcObject) {
        state.runtime._validationLoopActive = true;
        scheduleValidationPrediction(0);
        console.log('[Validation] Gaze prediction запущен');
    }
    
    function showNextPoint() {
        if (currentPoint >= validationPositions.length) {
            // Останавливаем gaze prediction
            stopValidationPredictionLoop();
            finishValidation();
            return;
        }
        
        const pos = validationPositions[currentPoint];
        const targetX = (pos.x / 100) * screenW;
        const targetY = (pos.y / 100) * screenH;
        
        point.style.left = pos.x + '%';
        point.style.top = pos.y + '%';
        
        progressText.innerText = `${translations[state.currentLang].calib_progress} ${currentPoint + 1} ${translations[state.currentLang].point_of} ${validationPositions.length}`;
        
        // Сброс семплов
        currentSamples = [];
        sampleCount = 0;
        
        // Небольшая задержка перед началом сбора (чтобы глаза успели перейти)
        setTimeout(() => {
            // Начинаем сбор семплов
            samplingInterval = setInterval(() => {
                if (state.runtime.currentGaze.x !== null && state.runtime.currentGaze.y !== null) {
                    currentSamples.push({
                        gazeX: state.runtime.currentGaze.x,
                        gazeY: state.runtime.currentGaze.y,
                        targetX: targetX,
                        targetY: targetY,
                        t: Date.now()
                    });
                }
                sampleCount++;
                
                if (sampleCount >= SAMPLES_PER_POINT) {
                    clearInterval(samplingInterval);
                    
                    // Сохраняем результаты для этой точки
                    state.runtime.validationPoints.push({
                        pointIndex: currentPoint,
                        targetX: targetX,
                        targetY: targetY,
                        samples: currentSamples,
                        timestamp: Date.now()
                    });
                    
                    currentPoint++;
                    showNextPoint();
                }
            }, SAMPLE_INTERVAL);
        }, 500); // 500ms задержка перед сбором
    }

    function finishValidation() {
        state.flags.isValidating = false;
        
        // Очищаем ссылку на interval из state
        stopValidationPredictionLoop();
        state.runtime._validationGazeInterval = null;
        
        const rawValidationPoints = state.runtime.validationPoints;
        const rawMetrics = calculateValidationMetrics(rawValidationPoints);

        // Убираем наиболее шумные сэмплы внутри каждой validation-точки (саккады/микроблинки/переходы)
        // для более устойчивой оценки precision.
        const filteredValidation = filterValidationPointsForMetrics(rawValidationPoints, 0.8);
        const filteredValidationPoints = filteredValidation.points;
        const filteredMetrics = calculateValidationMetrics(filteredValidationPoints);

        let metrics = filteredMetrics;
        let qcValidationSamples = flattenValidationSamples(filteredValidationPoints);
        let postCalibrationCorrection = {
            fitted: false,
            applied: false,
            sampleFilter: filteredValidation.stats
        };

        // Пост-калибровочная коррекция по данным валидации (лечит системный bias, напр. стабильный сдвиг вправо)
        if (state.runtime.gazeTracker && typeof state.runtime.gazeTracker.clearPostCalibrationCorrection === 'function') {
            state.runtime.gazeTracker.clearPostCalibrationCorrection();
        }

        const fittedCorrection = fitValidationAffineCorrection(filteredValidationPoints, screenW, screenH);
        if (fittedCorrection) {
            const correctedPoints = applyValidationAffineCorrection(filteredValidationPoints, fittedCorrection);
            const correctedMetrics = calculateValidationMetrics(correctedPoints);
            const shouldApply = shouldApplyValidationCorrection(filteredMetrics, correctedMetrics);

            postCalibrationCorrection = {
                fitted: true,
                applied: shouldApply,
                source: fittedCorrection.source,
                sampleCount: fittedCorrection.sampleCount,
                matrixX: fittedCorrection.matrixX.map(v => Math.round(v * 1e6) / 1e6),
                matrixY: fittedCorrection.matrixY.map(v => Math.round(v * 1e6) / 1e6),
                rawMetrics: {
                    accuracyPct: rawMetrics.accuracyPct,
                    precisionPct: rawMetrics.precisionPct,
                    biasXPct: rawMetrics.biasXPct,
                    biasYPct: rawMetrics.biasYPct
                },
                filteredMetrics: {
                    accuracyPct: filteredMetrics.accuracyPct,
                    precisionPct: filteredMetrics.precisionPct,
                    biasXPct: filteredMetrics.biasXPct,
                    biasYPct: filteredMetrics.biasYPct
                },
                correctedMetrics: {
                    accuracyPct: correctedMetrics.accuracyPct,
                    precisionPct: correctedMetrics.precisionPct,
                    biasXPct: correctedMetrics.biasXPct,
                    biasYPct: correctedMetrics.biasYPct
                }
            };

            if (shouldApply) {
                if (typeof state.runtime.gazeTracker.setPostCalibrationCorrection === 'function') {
                    state.runtime.gazeTracker.setPostCalibrationCorrection(fittedCorrection);
                }
                metrics = correctedMetrics;
                qcValidationSamples = flattenValidationSamples(correctedPoints);
                console.log('[Validation] Применена post-calibration коррекция:', postCalibrationCorrection);
            } else {
                console.log('[Validation] Коррекция рассчитана, но не применена (улучшение недостаточное):', postCalibrationCorrection);
            }
        } else {
            console.log('[Validation] Affine-коррекция не рассчитана (недостаточно или некачественные данные)');
        }
        
        // Сохраняем в sessionData
        state.sessionData.gazeValidation = {
            timestamp: Date.now(),
            points: rawValidationPoints,
            metrics: metrics,
            rawMetrics: rawMetrics,
            filteredMetrics: filteredMetrics,
            postCalibrationCorrection
        };
        
        console.log('[Validation] Результаты:', metrics);
        
        // === Передаём данные валидации в QCMetrics для accuracy/precision checks ===
        if (state.runtime.qcMetrics) {
            state.runtime.qcMetrics.setValidationData(qcValidationSamples);
        }
        
        // Показываем результат на экране
        instructionText.innerHTML = `${translations[state.currentLang].validation_complete}<br><small>${translations[state.currentLang].validation_accuracy}: ${metrics.accuracyPx.toFixed(0)}${translations[state.currentLang].pixels} (${metrics.accuracyPct}%) | ${translations[state.currentLang].validation_precision}: ${metrics.precisionPx.toFixed(0)}${translations[state.currentLang].pixels} (${metrics.precisionPct}%)</small>`;
        progressText.innerText = '';
        point.style.display = 'none';
        
        // Восстанавливаем стиль точки для будущего использования
        point.style.backgroundColor = '#DC2626';
        point.style.cursor = 'pointer';
        
        // Переходим к тесту слежения
        setTimeout(() => {
            calibScreen.classList.remove('active');
            state.flags.isRecording = true;
            startTrackingTest();
        }, 2000);
    }
    
    // Запускаем первую точку
    showNextPoint();
}

/**
 * Вычисляет метрики валидации: accuracy, precision, bias.
 * 
 * v2.0: Метрики в % диагонали экрана вместо ненадёжных градусов.
 * px→° зависит от размера монитора, разрешения и дистанции до экрана —
 * невозможно точно вычислить без калибровки расстояния.
 * % диагонали — универсальная метрика, не зависящая от разрешения.
 */
export function calculateValidationMetrics(points) {
    if (!points || points.length === 0) {
        return {
            accuracyPx: Infinity,
            accuracyPct: Infinity,
            precisionPx: Infinity,
            precisionPct: Infinity,
            biasX: 0,
            biasY: 0,
            biasXPct: 0,
            biasYPct: 0,
            validSamples: 0,
            totalSamples: 0
        };
    }
    
    // Диагональ экрана в px — универсальный нормализатор
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const screenDiag = Math.sqrt(screenW * screenW + screenH * screenH);
    
    let allErrors = [];
    let allBiasX = [];
    let allBiasY = [];
    let totalSamples = 0;
    let validSamples = 0;
    
    points.forEach(pointData => {
        const samples = pointData.samples || [];
        totalSamples += samples.length;
        
        samples.forEach(s => {
            if (s.gazeX !== null && s.gazeY !== null) {
                validSamples++;
                const errorX = s.gazeX - s.targetX;
                const errorY = s.gazeY - s.targetY;
                const error = Math.sqrt(errorX * errorX + errorY * errorY);
                allErrors.push(error);
                allBiasX.push(errorX);
                allBiasY.push(errorY);
            }
        });
    });
    
    if (allErrors.length === 0) {
        return {
            accuracyPx: Infinity,
            accuracyPct: Infinity,
            precisionPx: Infinity,
            precisionPct: Infinity,
            biasX: 0,
            biasY: 0,
            biasXPct: 0,
            biasYPct: 0,
            validSamples: 0,
            totalSamples: totalSamples
        };
    }
    
    // Accuracy = средняя ошибка (mean error)
    const accuracyPx = allErrors.reduce((a, b) => a + b, 0) / allErrors.length;
    
    // Precision = стандартное отклонение ошибки
    const mean = accuracyPx;
    const squaredDiffs = allErrors.map(e => Math.pow(e - mean, 2));
    const precisionPx = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length);
    
    // Bias = систематическое смещение (средний вектор ошибки)
    const biasX = allBiasX.reduce((a, b) => a + b, 0) / allBiasX.length;
    const biasY = allBiasY.reduce((a, b) => a + b, 0) / allBiasY.length;
    
    // % от диагонали экрана — универсальная метрика
    const accuracyPct = (accuracyPx / screenDiag) * 100;
    const precisionPct = (precisionPx / screenDiag) * 100;
    const biasXPct = (biasX / screenW) * 100;
    const biasYPct = (biasY / screenH) * 100;
    
    return {
        accuracyPx: accuracyPx,
        accuracyPct: Math.round(accuracyPct * 10) / 10,   // % диагонали
        precisionPx: precisionPx,
        precisionPct: Math.round(precisionPct * 10) / 10,  // % диагонали
        biasX: biasX,
        biasY: biasY,
        biasXPct: Math.round(biasXPct * 10) / 10,          // % ширины
        biasYPct: Math.round(biasYPct * 10) / 10,          // % высоты
        validSamples: validSamples,
        totalSamples: totalSamples,
        validPct: totalSamples > 0 ? (validSamples / totalSamples * 100).toFixed(1) : '0.0',
        screenDiag: Math.round(screenDiag),
        screenSize: { width: screenW, height: screenH }
    };
}

function flattenValidationSamples(points) {
    const samples = [];
    for (const pointData of points || []) {
        for (const sample of pointData?.samples || []) {
            if (!Number.isFinite(sample?.gazeX) || !Number.isFinite(sample?.gazeY)) continue;
            if (!Number.isFinite(sample?.targetX) || !Number.isFinite(sample?.targetY)) continue;
            samples.push({
                gazeX: sample.gazeX,
                gazeY: sample.gazeY,
                targetX: sample.targetX,
                targetY: sample.targetY,
                t: sample.t
            });
        }
    }
    return samples;
}

function filterValidationPointsForMetrics(points, keepRatio = 0.8) {
    const safeKeepRatio = Math.max(0.55, Math.min(0.95, keepRatio));
    let totalSamples = 0;
    let keptSamples = 0;
    const filteredPoints = (points || []).map(pointData => {
        const validSamples = (pointData?.samples || []).filter(sample =>
            Number.isFinite(sample?.gazeX) && Number.isFinite(sample?.gazeY)
        );
        totalSamples += validSamples.length;

        if (validSamples.length < 12) {
            keptSamples += validSamples.length;
            return {
                ...pointData,
                samples: validSamples
            };
        }

        const centerX = validSamples.reduce((acc, sample) => acc + sample.gazeX, 0) / validSamples.length;
        const centerY = validSamples.reduce((acc, sample) => acc + sample.gazeY, 0) / validSamples.length;
        const rankedByDistance = validSamples
            .map(sample => ({
                sample,
                dist: Math.hypot(sample.gazeX - centerX, sample.gazeY - centerY)
            }))
            .sort((a, b) => a.dist - b.dist);

        const keepCount = Math.max(10, Math.round(validSamples.length * safeKeepRatio));
        const filteredSamples = rankedByDistance.slice(0, keepCount).map(item => item.sample);
        keptSamples += filteredSamples.length;

        return {
            ...pointData,
            samples: filteredSamples
        };
    });

    return {
        points: filteredPoints,
        stats: {
            method: 'cluster_trim',
            keepRatio: safeKeepRatio,
            totalSamples,
            keptSamples,
            removedSamples: Math.max(0, totalSamples - keptSamples),
            keptPct: totalSamples > 0 ? Math.round((keptSamples / totalSamples) * 1000) / 10 : 0
        }
    };
}

function solveLinear3x3(A, b) {
    const M = [
        [A[0][0], A[0][1], A[0][2], b[0]],
        [A[1][0], A[1][1], A[1][2], b[1]],
        [A[2][0], A[2][1], A[2][2], b[2]]
    ];

    for (let col = 0; col < 3; col++) {
        let pivotRow = col;
        let pivotAbs = Math.abs(M[col][col]);
        for (let row = col + 1; row < 3; row++) {
            const candidateAbs = Math.abs(M[row][col]);
            if (candidateAbs > pivotAbs) {
                pivotAbs = candidateAbs;
                pivotRow = row;
            }
        }
        if (pivotAbs < 1e-9) return null;

        if (pivotRow !== col) {
            const tmp = M[col];
            M[col] = M[pivotRow];
            M[pivotRow] = tmp;
        }

        const pivot = M[col][col];
        for (let j = col; j < 4; j++) M[col][j] /= pivot;

        for (let row = 0; row < 3; row++) {
            if (row === col) continue;
            const factor = M[row][col];
            if (Math.abs(factor) < 1e-12) continue;
            for (let j = col; j < 4; j++) {
                M[row][j] -= factor * M[col][j];
            }
        }
    }

    return [M[0][3], M[1][3], M[2][3]];
}

function isAffineCorrectionSane(correction, screenW, screenH) {
    const { matrixX, matrixY } = correction;
    if (!Array.isArray(matrixX) || !Array.isArray(matrixY)) return false;
    if (matrixX.length !== 3 || matrixY.length !== 3) return false;
    if (!matrixX.every(Number.isFinite) || !matrixY.every(Number.isFinite)) return false;

    const scaleX = Math.hypot(matrixX[0], matrixY[0]);
    const scaleY = Math.hypot(matrixX[1], matrixY[1]);
    const det = matrixX[0] * matrixY[1] - matrixX[1] * matrixY[0];
    if (scaleX < 0.4 || scaleX > 1.9) return false;
    if (scaleY < 0.4 || scaleY > 1.9) return false;
    if (Math.abs(det) < 0.2 || Math.abs(det) > 3.5) return false;

    const probes = [
        [0, 0],
        [screenW, 0],
        [0, screenH],
        [screenW, screenH],
        [screenW * 0.5, screenH * 0.5]
    ];
    for (const [x, y] of probes) {
        const tx = matrixX[0] * x + matrixX[1] * y + matrixX[2];
        const ty = matrixY[0] * x + matrixY[1] * y + matrixY[2];
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
        if (tx < -screenW * 0.4 || tx > screenW * 1.4) return false;
        if (ty < -screenH * 0.4 || ty > screenH * 1.4) return false;
    }
    return true;
}

function fitValidationAffineCorrection(points, screenW, screenH) {
    const samples = flattenValidationSamples(points);
    if (samples.length < 24) return null;

    let m00 = 0, m01 = 0, m02 = 0;
    let m11 = 0, m12 = 0, m22 = 0;
    let vx0 = 0, vx1 = 0, vx2 = 0;
    let vy0 = 0, vy1 = 0, vy2 = 0;

    for (const s of samples) {
        const x = s.gazeX;
        const y = s.gazeY;
        const tx = s.targetX;
        const ty = s.targetY;

        m00 += x * x;
        m01 += x * y;
        m02 += x;
        m11 += y * y;
        m12 += y;
        m22 += 1;

        vx0 += x * tx;
        vx1 += y * tx;
        vx2 += tx;
        vy0 += x * ty;
        vy1 += y * ty;
        vy2 += ty;
    }

    const ridge = 1e-3;
    const A = [
        [m00 + ridge, m01, m02],
        [m01, m11 + ridge, m12],
        [m02, m12, m22 + ridge]
    ];

    const matrixX = solveLinear3x3(A, [vx0, vx1, vx2]);
    const matrixY = solveLinear3x3(A, [vy0, vy1, vy2]);
    if (!matrixX || !matrixY) return null;

    const correction = {
        matrixX,
        matrixY,
        source: 'validation_affine',
        sampleCount: samples.length
    };

    if (!isAffineCorrectionSane(correction, screenW, screenH)) return null;
    return correction;
}

function applyValidationAffineCorrection(points, correction) {
    const { matrixX, matrixY } = correction;
    return (points || []).map(pointData => ({
        ...pointData,
        samples: (pointData?.samples || []).map(sample => {
            if (!Number.isFinite(sample?.gazeX) || !Number.isFinite(sample?.gazeY)) return sample;
            const correctedX = matrixX[0] * sample.gazeX + matrixX[1] * sample.gazeY + matrixX[2];
            const correctedY = matrixY[0] * sample.gazeX + matrixY[1] * sample.gazeY + matrixY[2];
            return {
                ...sample,
                gazeX: Math.round(correctedX),
                gazeY: Math.round(correctedY)
            };
        })
    }));
}

function shouldApplyValidationCorrection(rawMetrics, correctedMetrics) {
    const rawAcc = rawMetrics?.accuracyPx;
    const rawPrec = rawMetrics?.precisionPx;
    const corrAcc = correctedMetrics?.accuracyPx;
    const corrPrec = correctedMetrics?.precisionPx;
    if (![rawAcc, rawPrec, corrAcc, corrPrec].every(Number.isFinite)) return false;

    const improvedAccuracyPx = rawAcc - corrAcc;
    const improvedPrecisionPx = rawPrec - corrPrec;
    const improvedAccuracyPct = rawMetrics.accuracyPct - correctedMetrics.accuracyPct;
    const improvedPrecisionPct = rawMetrics.precisionPct - correctedMetrics.precisionPct;

    const significant = improvedAccuracyPx >= 12 ||
        improvedPrecisionPx >= 12 ||
        improvedAccuracyPct >= 0.6 ||
        improvedPrecisionPct >= 0.6;

    const noSeriousRegression = correctedMetrics.accuracyPct <= rawMetrics.accuracyPct + 0.2 &&
        correctedMetrics.precisionPct <= rawMetrics.precisionPct + 0.2;

    const crossesCommonGate = rawMetrics.precisionPct > 6 &&
        correctedMetrics.precisionPct <= 6 &&
        correctedMetrics.accuracyPct <= 12;

    return (significant && noSeriousRegression) || crossesCommonGate;
}

// --- ТЕСТ СЛЕЖЕНИЯ ЗА ФИГУРАМИ ---
export function startTrackingTest() {
    const testArea = document.getElementById('trackingTestArea');
    const shape = document.getElementById('testShape');
    const progressText = document.getElementById('testProgressText');
    const progressFill = document.getElementById('testProgressFill');
    const customDot = document.getElementById('customGazeDot');
    
    // Показываем область теста
    testArea.classList.add('active');
    
    // Размеры экрана для траекторий
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    
    // Траектории движения фигур
    const trajectories = [
        // 1. Круг — горизонтальная линия слева направо
        { shape: 'circle', duration: 4000, path: (t) => ({ 
            x: 50 + (screenW - 100) * t, 
            y: screenH / 2 
        })},
        // 2. Квадрат — вертикальная линия сверху вниз
        { shape: 'square', duration: 4000, path: (t) => ({ 
            x: screenW / 2, 
            y: 50 + (screenH - 100) * t 
        })},
        // 3. Треугольник — диагональ
        { shape: 'triangle', duration: 4000, path: (t) => ({ 
            x: 50 + (screenW - 100) * t, 
            y: 50 + (screenH - 100) * t 
        })},
        // 4. Круг — круговое движение
        { shape: 'circle', duration: 5000, path: (t) => ({ 
            x: screenW / 2 + Math.cos(t * 2 * Math.PI) * (screenW / 4), 
            y: screenH / 2 + Math.sin(t * 2 * Math.PI) * (screenH / 4) 
        })},
        // 5. Квадрат — зигзаг
        { shape: 'square', duration: 5000, path: (t) => ({ 
            x: 50 + (screenW - 100) * t, 
            y: screenH / 2 + Math.sin(t * 4 * Math.PI) * (screenH / 4)
        })}
    ];
    
    let currentTrajectory = 0;
    const testStartTime = Date.now();
    
    const video = document.getElementById('precheckVideo');
    
    // === CAMERA FPS MONITOR ===
    if (video && video.srcObject) {
        startCameraFpsMonitor(video);
        console.log('[TrackingTest] CameraFPSMonitor запущен');
    }
    
    // === SINGLE-FLIGHT ЦИКЛ АНАЛИЗА ===
    // - analyzeFrame + gaze predict: каждый новый кадр;
    // - segmentFrame: реже и вне критического пути;
    // - никаких параллельных analyzeFrame вызовов.
    let segmenterThrottleCounter = 0;
    let segmenterInFlight = false;
    let lastSegmenterResult = null;
    let trackingLoopLastVideoTime = -1;
    
    function stopTrackingAnalysisLoop() {
        state.runtime._analysisLoopActive = false;
        if (state.runtime.analysisInterval) {
            clearTimeout(state.runtime.analysisInterval);
            state.runtime.analysisInterval = null;
        }
    }

    function scheduleTrackingAnalysisTick(delayMs = 0) {
        if (!state.runtime._analysisLoopActive) return;
        state.runtime.analysisInterval = setTimeout(runTrackingAnalysisTick, delayMs);
    }

    async function runTrackingAnalysisTick() {
        if (!state.runtime._analysisLoopActive) return;

        const tickStart = performance.now();
        try {
            const videoTime = getVideoTime(video);
            if (videoTime < 0 || videoTime === trackingLoopLastVideoTime) {
                scheduleTrackingAnalysisTick(SAME_FRAME_RETRY_MS);
                return;
            }
            trackingLoopLastVideoTime = videoTime;

            // 1) analyzeFrame — один раз на новый кадр
            const precheckResult = await state.runtime.localAnalyzer.analyzeFrame(video);

            // 2) Pose данные для QC gaze inference
            if (precheckResult && precheckResult.pose) {
                state.runtime.lastPoseData = {
                    yaw: precheckResult.pose.yaw ?? null,
                    pitch: precheckResult.pose.pitch ?? null,
                    roll: precheckResult.pose.roll ?? null
                };
            } else {
                state.runtime.lastPoseData = null;
            }

            // 3) Gaze prediction в критическом пути (каждый кадр)
            if (state.runtime.gazeTracker && state.runtime.gazeTracker.isCalibrated()
                && precheckResult && precheckResult.landmarks) {
                const gaze = state.runtime.gazeTracker.predict(precheckResult.landmarks);
                if (gaze && window.handleGazeUpdate) {
                    window.handleGazeUpdate(gaze);
                }
            }

            // 4) Тяжелый segmenter запускаем реже и не блокируем gaze path
            segmenterThrottleCounter++;
            if (segmenterThrottleCounter >= 3) {
                segmenterThrottleCounter = 0;
                if (!segmenterInFlight && state.runtime.faceSegmenter && precheckResult && precheckResult.landmarks) {
                    segmenterInFlight = true;
                    state.runtime.faceSegmenter.segmentFrame(video, precheckResult.landmarks)
                        .then((segmenterResult) => {
                            lastSegmenterResult = segmenterResult;
                        })
                        .catch((segmenterError) => {
                            console.warn('[TrackingTest] Ошибка сегментации:', segmenterError);
                        })
                        .finally(() => {
                            segmenterInFlight = false;
                        });
                }
            }

            // 5) QC processFrame каждый кадр c последним доступным segmenter result
            if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
                state.runtime.qcMetrics.processFrame(precheckResult, lastSegmenterResult);
            }
        } catch (e) {
            console.warn('[TrackingTest] Ошибка анализа:', e);
        }

        const elapsed = performance.now() - tickStart;
        const nextDelay = Math.max(0, TARGET_LOOP_INTERVAL_MS - elapsed);
        scheduleTrackingAnalysisTick(nextDelay);
    }

    if (video && video.srcObject && state.runtime.localAnalyzer) {
        state.runtime._analysisLoopActive = true;
        scheduleTrackingAnalysisTick(0);
        console.log('[TrackingTest] Single-flight цикл анализа запущен (gaze + QC)');
    }
    
    function runTrajectory() {
        if (currentTrajectory >= trajectories.length) {
            // Останавливаем анализ
            stopTrackingAnalysisLoop();
            stopCameraFpsMonitor();
            console.log(`[TrackingTest] CameraFPSMonitor остановлен. Средний FPS: ${getAverageCameraFps()}`);
            finishTrackingTest();
            return;
        }
        
        const traj = trajectories[currentTrajectory];
        shape.className = 'test-shape ' + traj.shape;
        
        const startTime = performance.now();
        
        function animate() {
            const elapsed = performance.now() - startTime;
            const t = Math.min(elapsed / traj.duration, 1);
            
            const pos = traj.path(t);
            shape.style.left = pos.x + 'px';
            shape.style.top = pos.y + 'px';
            
            // Записываем позицию фигуры И координаты взгляда
            state.sessionData.trackingTest.push({
                trajectory: currentTrajectory,
                shape: traj.shape,
                shapeX: Math.round(pos.x),
                shapeY: Math.round(pos.y),
                gazeX: state.runtime.currentGaze.x,
                gazeY: state.runtime.currentGaze.y,
                t: Date.now() - testStartTime
            });
            
            // Данные взгляда передаются в QC через handleGazeUpdate (app.js)
            // analysisInterval → GazeTracker.predict → handleGazeUpdate → addGazePoint
            
            // Обновляем прогресс
            const totalProgress = ((currentTrajectory + t) / trajectories.length) * 100;
            progressFill.style.width = totalProgress + '%';
            
            if (t < 1) {
                requestAnimationFrame(animate);
            } else {
                currentTrajectory++;
                setTimeout(runTrajectory, 500);
            }
        }
        
        animate();
    }
    
    runTrajectory();
}

export function finishTrackingTest() {
    // === Останавливаем analysis interval (если ещё работает) ===
    state.runtime._analysisLoopActive = false;
    if (state.runtime.analysisInterval) {
        clearTimeout(state.runtime.analysisInterval);
        state.runtime.analysisInterval = null;
        console.log('[TrackingTest] Analysis interval остановлен');
    }
    
    // === Останавливаем CameraFPSMonitor (если ещё работает) ===
    stopCameraFpsMonitor();
    
    const testArea = document.getElementById('trackingTestArea');
    const progressText = document.getElementById('testProgressText');
    const customDot = document.getElementById('customGazeDot');
    
    progressText.innerText = translations[state.currentLang].test_complete;
    
    setTimeout(() => {
        testArea.classList.remove('active');

        document.querySelector('.container').style.display = 'block'; 
        document.querySelector('.top-bar').style.display = 'flex';
        
        // Запускаем загрузку JSON
        loadAndStartCognitiveTask();

        testArea.classList.remove('active');

        customDot.style.display = 'none';
        

        
        // Сначала завершаем сессию, потом показываем UI
        finishSession();
    }, 1500);
}

export async function finishSession() {
    state.flags.isRecording = false;
    
    document.getElementById('customGazeDot').style.display = 'none';
    
    // === Очищаем validation gaze interval (если ещё работает) ===
    state.runtime._validationLoopActive = false;
    if (state.runtime._validationGazeInterval) {
        clearTimeout(state.runtime._validationGazeInterval);
        state.runtime._validationGazeInterval = null;
    }

    // === Очищаем single-flight analysis loop (если ещё работает) ===
    state.runtime._analysisLoopActive = false;
    if (state.runtime.analysisInterval) {
        clearTimeout(state.runtime.analysisInterval);
        state.runtime.analysisInterval = null;
    }
    
    // === GAZE TRACKER: сброс ===
    if (state.runtime.gazeTracker) {
        state.runtime.gazeTracker.reset();
        console.log('[GazeTracker] Сброшен');
    }
    
    // === Сброс данных позы ===
    state.runtime.lastPoseData = null;
    
    // === QC METRICS: получаем итоговый отчёт ===
    if (state.runtime.qcMetrics) {
        try {
            const qcSummary = state.runtime.qcMetrics.getSummary();
            state.sessionData.qcSummary = qcSummary;
            console.log('[QC] Summary:', qcSummary);
            
            // Обновляем UI на основе QC результата
            updateFinalStepWithQC(qcSummary);
            
            // Останавливаем QCMetrics
            state.runtime.qcMetrics.stop();
            console.log('[QC] QCMetrics остановлен');
        } catch (e) {
            console.warn('[finishSession] Ошибка QC metrics:', e);
        }
    }
    
    // === CAMERA: останавливаем поток ===
    if (state.runtime.cameraStream) {
        state.runtime.cameraStream.getTracks().forEach(track => track.stop());
        state.runtime.cameraStream = null;
        console.log('[Camera] Поток камеры остановлен');
    }
    
    // Останавливаем видео элемент
    const video = document.getElementById('precheckVideo');
    if (video) {
        video.srcObject = null;
    }
    
    // Убираем класс active со step5 до вызова nextStep,
    // чтобы stopPreCheckOnLeave() не вызывался повторно
    document.getElementById('step5').classList.remove('active');
    
    // Показываем интерфейс
    document.querySelector('.container').style.display = 'block';
    document.querySelector('.top-bar').style.display = 'flex';
    
    // Переходим на финальный шаг
    nextStep(7);
    
    console.log('[finishSession] Сессия завершена, показан step7');
}
