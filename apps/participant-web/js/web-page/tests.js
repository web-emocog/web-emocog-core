import { state } from './state.js';
import { translations } from '../../translations.js';
import { updateFinalStepWithQC } from './ui.js';
import { stopPreCheck } from './precheck.js';
import { startCameraFpsMonitor, stopCameraFpsMonitor, getAverageCameraFps } from './camera.js';

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

    // 9 точек калибровки по всему экрану (сетка 3x3)
    const positions = [
        { x: '10%', y: '10%' },   // верх-лево
        { x: '50%', y: '10%' },   // верх-центр
        { x: '90%', y: '10%' },   // верх-право
        { x: '10%', y: '50%' },   // центр-лево
        { x: '50%', y: '50%' },   // центр
        { x: '90%', y: '50%' },   // центр-право
        { x: '10%', y: '90%' },   // низ-лево
        { x: '50%', y: '90%' },   // низ-центр
        { x: '90%', y: '90%' }    // низ-право
    ];
    
    let i = 0;
    let clickCount = 0;
    
    const updatePoint = () => {
        point.style.left = positions[i].x;
        point.style.top = positions[i].y;
        progressText.innerText = `${translations[state.currentLang].calib_progress} ${i + 1} ${translations[state.currentLang].point_of} ${positions.length}`;
    };

    // Обработчик клика на точку для калибровки
    point.onclick = () => {
        clickCount++;
        
        // Нужно 2 клика на каждую позицию для лучшей калибровки
        if (clickCount >= 2) {
            clickCount = 0;
            i++;
            
            if (i >= positions.length) {
                // Калибровка завершена
                point.onclick = null;
                
                instructionText.innerText = translations[state.currentLang].calib_complete;
                progressText.innerText = '';
                point.style.display = 'none';
                
                setTimeout(() => {
                    // После калибровки запускаем валидацию точности
                    startGazeValidation();
                }, 1500);
                return;
            }
            
            updatePoint();
        }
    };

    updatePoint();

}


// === GAZE VALIDATION: Валидация точности после калибровки ===
/**
 * Запускает этап валидации точности gaze
 * Показывает 5 точек, собирает данные взгляда, вычисляет accuracy/precision
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
    
    // 5 точек валидации (другие позиции чем калибровка)
    const validationPositions = [
        { x: 25, y: 25 },   // верх-лево
        { x: 75, y: 25 },   // верх-право
        { x: 50, y: 50 },   // центр
        { x: 25, y: 75 },   // низ-лево
        { x: 75, y: 75 }    // низ-право
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
    
    function showNextPoint() {
        if (currentPoint >= validationPositions.length) {
            // Валидация завершена
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
        
        // Вычисляем метрики
        const metrics = calculateValidationMetrics(state.runtime.validationPoints);
        
        // Сохраняем в sessionData
        state.sessionData.gazeValidation = {
            timestamp: Date.now(),
            points: state.runtime.validationPoints,
            metrics: metrics
        };
        
        console.log('[Validation] Результаты:', metrics);
        
        // Показываем результат на экране
        instructionText.innerHTML = `${translations[state.currentLang].validation_complete}<br><small>${translations[state.currentLang].validation_accuracy}: ${metrics.accuracyPx.toFixed(0)}${translations[state.currentLang].pixels} | ${translations[state.currentLang].validation_precision}: ${metrics.precisionPx.toFixed(0)}${translations[state.currentLang].pixels}</small>`;
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
 * Вычисляет метрики валидации: accuracy, precision, bias
 */
export function calculateValidationMetrics(points) {
    if (!points || points.length === 0) {
        return {
            accuracyPx: Infinity,
            accuracyDeg: Infinity,
            precisionPx: Infinity,
            precisionDeg: Infinity,
            biasX: 0,
            biasY: 0,
            validSamples: 0,
            totalSamples: 0
        };
    }
    
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
            accuracyDeg: Infinity,
            precisionPx: Infinity,
            precisionDeg: Infinity,
            biasX: 0,
            biasY: 0,
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
    
    // Конвертация в градусы (приблизительно, при типичном расстоянии ~60см)
    // 1 градус ≈ 35 пикселей при 60см и типичном мониторе
    const PX_PER_DEGREE = 35;
    
    return {
        accuracyPx: accuracyPx,
        accuracyDeg: accuracyPx / PX_PER_DEGREE,
        precisionPx: precisionPx,
        precisionDeg: precisionPx / PX_PER_DEGREE,
        biasX: biasX,
        biasY: biasY,
        validSamples: validSamples,
        totalSamples: totalSamples,
        validPct: totalSamples > 0 ? (validSamples / totalSamples * 100).toFixed(1) : '0.0'
    };
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
    
    // === QC: Запускаем фоновый анализ лица во время теста ===
    let qcAnalysisInterval = null;
    const video = document.getElementById('precheckVideo');
    
    // === CAMERA FPS MONITOR: Запускаем измерение реального FPS камеры ===
    if (video && video.srcObject) {
        // Создаём и запускаем монитор FPS камеры
        startCameraFpsMonitor(video);
        console.log('[TrackingTest] CameraFPSMonitor запущен');
    }
    
    // Если видео ещё доступно, запускаем периодический анализ для QC
    if (video && video.srcObject && state.runtime.localAnalyzer) {
        qcAnalysisInterval = setInterval(async () => {
            try {
                const precheckResult = await state.runtime.localAnalyzer.analyzeFrame(video);
                let segmenterResult = null;
                if (faceSegmenter) {
                    segmenterResult = await faceSegmenter.segmentFrame(video, precheckResult.landmarks);
                }
                // Передаём результаты в QCMetrics для подсчёта face/pose/illumination
                if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
                    state.runtime.qcMetrics.processFrame(precheckResult, segmenterResult);
                }
            } catch (e) {
                // Игнорируем ошибки анализа во время теста
            }
        }, 100); // ~10 FPS для QC анализа
    }
    
    function runTrajectory() {
        if (currentTrajectory >= trajectories.length) {
            // Останавливаем QC анализ
            if (qcAnalysisInterval) {
                clearInterval(qcAnalysisInterval);
                qcAnalysisInterval = null;
            }
            // Останавливаем CameraFPSMonitor
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
            
            // === QC METRICS: передаём данные взгляда ===
            if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
                // Новая сигнатура: addGazePoint(gazeData, poseData)
                // gazeData = { x, y } - координаты взгляда
                // poseData = { yaw, pitch } - углы головы (опционально)
                const gazeData = state.runtime.currentGaze.x !== null ? { x: state.runtime.currentGaze.x, y: state.runtime.currentGaze.y } : null;
                
                // Получаем данные позы из последнего precheck анализа (если есть)
                let poseData = null;
                if (state.runtime.precheckData && state.runtime.precheckData.pose) {
                    poseData = {
                        yaw: state.runtime.precheckData.pose.yaw || 0,
                        pitch: state.runtime.precheckData.pose.pitch || 0
                    };
                }
                
                state.runtime.qcMetrics.addGazePoint(gazeData, poseData);
            }
            // === END QC METRICS ===
            
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
    const testArea = document.getElementById('trackingTestArea');
    const progressText = document.getElementById('testProgressText');
    const customDot = document.getElementById('customGazeDot');
    
    progressText.innerText = translations[state.currentLang].test_complete;
    
    setTimeout(() => {
        testArea.classList.remove('active');
        customDot.style.display = 'none';
        
        // Сначала завершаем сессию, потом показываем UI
        finishSession();
    }, 1500);
}

export async function finishSession() {
    state.flags.isRecording = false;
    
    document.getElementById('customGazeDot').style.display = 'none';
    
    // === QC METRICS: получаем итоговый отчёт ===
    if (state.runtime.qcMetrics) {
        try {
            if (state.runtime.qcMetrics.flush) {
                // Таймаут на flush чтобы не зависнуть
                await Promise.race([
                    state.runtime.qcMetrics.flush(),
                    new Promise((_, reject) => setTimeout(() => reject('flush timeout'), 2000))
                ]).catch(e => console.warn('[QC] Flush timeout or error:', e));
            }
            const qcSummary = state.runtime.qcMetrics.getSummary();
            state.sessionData.qcSummary = qcSummary;
            console.log('[QC] Summary:', qcSummary);
            
            // Обновляем UI на основе QC результата
            updateFinalStepWithQC(qcSummary);
        } catch (e) {
            console.warn('[finishSession] Ошибка QC metrics:', e);
        }
    }
    
    // Убираем класс active со step5 до вызова nextStep,
    // чтобы stopPreCheckOnLeave() не вызывался повторно
    document.getElementById('step5').classList.remove('active');
    
    // Показываем интерфейс
    document.querySelector('.container').style.display = 'block';
    document.querySelector('.top-bar').style.display = 'flex';
    
    // Переходим на финальный шаг
    nextStep(6);
    
    console.log('[finishSession] Сессия завершена, показан step6');
}
