import { state, CONSTANTS, BACKEND_CONFIG } from './state.js';
import { translations } from '../../translations.js';
import { measureCameraFPS } from './camera.js';

export async function startPreCheck() {
    console.log('Запуск pre-check камеры...');

    if (state.flags.isPrecheckRunning) {
        stopPreCheck();
        return;
    }

    const startPrecheckBtn = document.getElementById('startPrecheckBtn');
    const startCalibBtn = document.getElementById('startCalibBtn');
    const statusMessage = document.getElementById('statusMessage');
    const precheckStatus = document.querySelector('.precheck-status');
    
    startPrecheckBtn.style.display = 'none';
    startCalibBtn.style.display = 'block';
    startCalibBtn.disabled = true;
    
    statusMessage.textContent = translations[state.currentLang].precheck_requesting;
    precheckStatus.className = 'precheck-status waiting-bg';

    try {
        // Запрос доступа к камере с ЯВНЫМ указанием высокого frameRate
        state.runtime.cameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30, min: 15 }  // Запрашиваем 30 FPS, минимум 15
            }
        });
        
        const video = document.getElementById('precheckVideo');
        video.srcObject = state.runtime.cameraStream;
        
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                console.log(`Разрешение видео: ${video.videoWidth}x${video.videoHeight}`);
                
                // Получаем реальные настройки камеры
                const videoTrack = state.runtime.cameraStream.getVideoTracks()[0];
                if (videoTrack) {
                    const settings = videoTrack.getSettings();
                    console.log('[Camera] Реальные настройки:', settings);
                    console.log(`[Camera] Реальный frameRate: ${settings.frameRate || 'unknown'}`);
                    
                    // Сохраняем в sessionData
                    state.sessionData.tech.camera = {
                        width: settings.width,
                        height: settings.height,
                        frameRate: settings.frameRate,
                        deviceId: settings.deviceId,
                        facingMode: settings.facingMode
                    };
                }
                
                // размеры canvas для overlay
                const canvas = document.getElementById('overlayCanvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                
                resolve();
            };
        });
        
        // Измеряем реальный FPS камеры (2 секунды)
        console.log('[Camera] Измеряем реальный FPS камеры...');
        const cameraFpsResult = await measureCameraFPS(video, 2000);
        console.log(`[Camera] Измеренный FPS: ${cameraFpsResult.fps} (${cameraFpsResult.frames} кадров за ${cameraFpsResult.duration.toFixed(2)}s)`);
        
        // Сохраняем измеренный FPS
        state.sessionData.tech.cameraFPS = cameraFpsResult.fps;
        state.sessionData.tech.cameraFPSDetails = cameraFpsResult;
        
        // Предупреждение если FPS слишком низкий для BPM детекции
        if (cameraFpsResult.fps < 15) {
            console.warn(`[Camera] ⚠️ FPS камеры (${cameraFpsResult.fps}) слишком низкий для детекции BPM! Нужно минимум 15 FPS.`);
        }
        
        statusMessage.textContent = translations[state.currentLang].precheck_checking;
        
        // Запускаем анализ
        startContinuousAnalysis();

    } catch (error) {
        console.error('Ошибка камеры:', error);
        statusMessage.textContent = translations[state.currentLang].precheck_camera_error + error.message;
        precheckStatus.className = 'precheck-status error-bg';
        
        startPrecheckBtn.style.display = 'block';
        startCalibBtn.style.display = 'none';
        
    }
}

export function stopPreCheck() {
    state.flags.isPrecheckRunning = false;
    if (state.runtime.analysisFrameId) {
        clearTimeout(state.runtime.analysisFrameId);
        state.runtime.analysisFrameId = null;
    }
    // Освобождаем ресурсы локального анализатора
    if (state.runtime.localAnalyzer) {
        state.runtime.localAnalyzer.reset();
    }
}

export function startContinuousAnalysis() {
    state.flags.isPrecheckRunning = true;
    state.runtime.successFrames = 0;
    state.runtime.precheckFramesHistory = []; // Сбрасываем историю
    
    const video = document.getElementById('precheckVideo');

    async function analyzeFrame() {
        if (!state.flags.isPrecheckRunning) return;
        
        try {
            // Используем ЛОКАЛЬНЫЙ анализатор вместо бэкенда
            const results = await runLocalPrecheckAnalysis(video);
            
            // Обновляем индикаторы с реальными данными
            updateIndicators(results);
            
            state.runtime.precheckData = results;
            
            // Проверяем все индикаторы
            checkAllIndicators();
        } catch (error) {
            console.error('Ошибка анализа кадра:', error);
        }
        
        // Интервал анализа 
        if (state.flags.isPrecheckRunning) {
            state.runtime.analysisFrameId = setTimeout(analyzeFrame, BACKEND_CONFIG.SEND_INTERVAL);
        }
    }

    // Запускаем цикл анализа
    analyzeFrame();
}

export function updateIndicators(data) {
    updateIlluminationIndicator(data.illumination);
    updateFaceIndicator(data.face);
    updatePoseIndicator(data.pose);
    updateVisibilityIndicator(data.visibility);

    if (data.face && data.face.detected && data.face.bbox) {
        drawFaceOverlay(data.face);
    }
}

export function checkAllIndicators() {
    const cameraPreview = document.getElementById('cameraPreview');
    const startCalibBtn = document.getElementById('startCalibBtn');
    const statusMessage = document.getElementById('statusMessage');
    const precheckStatus = document.querySelector('.precheck-status');
    
    // проверка: все passed или есть failed
    let allPassed = true;
    let hasFailed = false;
    
    Object.values(state.indicatorsStatus).forEach(status => {
        if (status === 'failed') {
            hasFailed = true;
            allPassed = false;
        } else if (status !== 'passed') {
            allPassed = false;
        }
    });
    
    // Обновляем рамку
    cameraPreview.className = 'camera-preview'; 
    
    if (hasFailed) {
        cameraPreview.classList.add('red-border');
    } else if (allPassed) {
        cameraPreview.classList.add('green-border');
    }
    
    if (allPassed) {
        state.runtime.successFrames++;
    } else {
        state.runtime.successFrames = 0;
    }
    
    const isConsistentSuccess = state.runtime.successFrames >= CONSTANTS.REQUIRED_SUCCESS_FRAMES;
    
    // статусное сообщение
    let statusHTML = '';
    
    if (allPassed && isConsistentSuccess) {
        // Все проверки пройдены стабильно
        statusHTML = translations[state.currentLang].status_all_good;
        statusMessage.className = 'status-message';
        precheckStatus.className = 'precheck-status success-bg';
        startCalibBtn.disabled = false;
    } else if (hasFailed) {
        // Есть проблемы — показываем подсказки
        const tips = collectTips();
        if (tips.length > 0) {
            statusHTML = `
                <div class="status-header">${translations[state.currentLang].status_needs_fix}</div>
                <ul class="tips-list">
                    ${tips.map(tip => `<li class="tip-item">${tip}</li>`).join('')}
                </ul>
            `;
        } else {
            statusHTML = `<div class="status-header">${translations[state.currentLang].status_needs_fix}</div>`;
        }
        statusMessage.className = 'status-message';
        precheckStatus.className = 'precheck-status error-bg';
        startCalibBtn.disabled = true;
    } else {
        // Ожидание стабильности
        statusHTML = translations[state.currentLang].status_checking;
        statusMessage.className = 'status-message';
        precheckStatus.className = 'precheck-status waiting-bg';
        startCalibBtn.disabled = true;
    }
    
    statusMessage.innerHTML = statusHTML;
    
    startCalibBtn.style.display = 'block';
}

export function resetIndicatorsToWaiting() {
    const indicators = document.querySelectorAll('.indicator');
    indicators.forEach(ind => {
        ind.classList.remove('passed', 'failed');
    });
    
    document.getElementById('LightProgress').style.width = '0%';
    document.getElementById('FaceProgress').style.width = '0%';
    document.getElementById('PoseProgress').style.width = '0%';
    document.getElementById('VisibilityProgress').style.width = '0%';
    
    document.getElementById('LightStatus').textContent = translations[state.currentLang].status_waiting;
    document.getElementById('FaceStatus').textContent = translations[state.currentLang].status_waiting;
    document.getElementById('PoseStatus').textContent = translations[state.currentLang].status_waiting;
    document.getElementById('VisibilityStatus').textContent = translations[state.currentLang].status_waiting;

    const cameraPreview = document.getElementById('cameraPreview');
    cameraPreview.className = 'camera-preview';
    
    const canvas = document.getElementById('overlayCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    state.indicatorsStatus = {
        illumination: null,
        face: null,
        pose: null,
        visibility: null
    };
    
    state.runtime.successFrames = 0;
    
    const guideText = document.querySelector('.guide-text');
    if (guideText) {
        guideText.textContent = translations[state.currentLang].guide_text;
    }
    
    const statusMessage = document.getElementById('statusMessage');
    const precheckStatus = document.querySelector('.precheck-status');
    if (statusMessage) {
        statusMessage.textContent = translations[state.currentLang].precheck_initial;
        statusMessage.className = 'status-message';
        precheckStatus.className = 'precheck-status'; // Сбрасываем цвет фона
    }
    
    // управление кнопками
    const startPrecheckBtn = document.getElementById('startPrecheckBtn');
    const startCalibBtn = document.getElementById('startCalibBtn');
    
    if (startPrecheckBtn) {
        startPrecheckBtn.style.display = 'block';
        startPrecheckBtn.disabled = false;
    }
    
    if (startCalibBtn) {
        startCalibBtn.style.display = 'none';
        startCalibBtn.disabled = true;
    }
}

export function collectTips() {
    const tips = [];
    
    // проверка освещения (только для failed)
    if (state.indicatorsStatus.illumination === 'failed' && state.runtime.precheckData.illumination) {
        if (state.runtime.precheckData.illumination.status === 'too_dark') {
            tips.push(translations[state.currentLang].tip_light_dark);
        } else if (state.runtime.precheckData.illumination.status === 'too_bright') {
            tips.push(translations[state.currentLang].tip_light_bright);
        }
    }
    
    // проверка размера лица (только для failed)
    if (state.indicatorsStatus.face === 'failed' && state.runtime.precheckData.face) {
        if (!state.runtime.precheckData.face.detected) {
            tips.push(translations[state.currentLang].tip_face_not_found);
        } else if (state.runtime.precheckData.face.status === 'too_small') {
            tips.push(translations[state.currentLang].tip_face_too_small);
        } else if (state.runtime.precheckData.face.status === 'too_large') {
            tips.push(translations[state.currentLang].tip_face_too_large);
        } else if (state.runtime.precheckData.face.status === 'out_of_zone') {
            tips.push(translations[state.currentLang].tip_face_out_of_zone);
        } else if (state.runtime.precheckData.face.status === 'tilted') {
            tips.push(translations[state.currentLang].tip_face_tilted);
        }
    }
    
    // проверка позы (расширенная логика для всех новых статусов)
    if (state.indicatorsStatus.pose === 'failed' && state.runtime.precheckData.pose) {
        const pose = state.runtime.precheckData.pose;
        
        if (pose.status === 'no_face') {
            tips.push(translations[state.currentLang].tip_pose_no_face);
        } else if (pose.status === 'partial_face') {
            // Часть лица не видна
            tips.push(translations[state.currentLang].tip_pose_partial_face);
        } else if (pose.status === 'off_center') {
            // Глаза не по центру экрана
            tips.push(translations[state.currentLang].tip_pose_eyes_off_center);
            
            // Добавляем конкретные подсказки о направлении смещения
            if (pose.eyesCentering && pose.eyesCentering.hint) {
                pose.eyesCentering.hint.forEach(hint => {
                    if (hint === 'move_right') tips.push(translations[state.currentLang].tip_pose_move_right);
                    if (hint === 'move_left') tips.push(translations[state.currentLang].tip_pose_move_left);
                    if (hint === 'move_up') tips.push(translations[state.currentLang].tip_pose_move_up);
                    if (hint === 'move_down') tips.push(translations[state.currentLang].tip_pose_move_down);
                });
            }
        } else if (pose.status === 'tilted' || pose.isTilted) {
            // Голова наклонена — даём конкретные подсказки
            if (pose.issues) {
                if (pose.issues.includes('yaw_exceeded')) {
                    // yaw > 0 — голова повёрнута вправо, нужно повернуть влево
                    if (pose.yaw > 0) {
                        tips.push(translations[state.currentLang].tip_pose_turn_down);
                    } else {
                        tips.push(translations[state.currentLang].tip_pose_turn_up);
                    }
                }
                if (pose.issues.includes('pitch_exceeded')) {
                    // pitch > 0 — голова опущена, нужно поднять
                    if (pose.pitch > 0) {
                        tips.push(translations[state.currentLang].tip_pose_tilt_right);
                    } else {
                        tips.push(translations[state.currentLang].tip_pose_tilt_left);
                    }
                }
                if (pose.issues.includes('roll_exceeded')) {
                    tips.push(translations[state.currentLang].tip_pose_straighten);
                }
            } else {
                tips.push(translations[state.currentLang].tip_face_tilted);
            }
        } else if (!pose.isStable) {
            tips.push(translations[state.currentLang].tip_pose_unstable);
        }
    }
    
    // Проверка глаз (если закрыты)
    if (state.runtime.precheckData.eyes && !state.runtime.precheckData.eyes.bothOpen) {
        tips.push(translations[state.currentLang].tip_eyes_closed);
    }
    
    // Проверка видимости лица (FaceSegmenter)
    if (state.indicatorsStatus.visibility === 'failed' && state.runtime.precheckData.visibility) {
        const visibility = state.runtime.precheckData.visibility;
        
        if (visibility.issues && visibility.issues.length > 0) {
            const issues = visibility.issues;
            
            // Волосы закрывают лицо
            if (issues.includes('hair_occlusion') || issues.includes('forehead_occluded')) {
                tips.push(translations[state.currentLang].tip_hair_covers_face);
            }
            
            // Левая сторона лица закрыта
            if (issues.includes('left_side_occluded') || issues.includes('left_cheek_occluded')) {
                tips.push(translations[state.currentLang].tip_left_side_occluded);
            }
            
            // Правая сторона лица закрыта
            if (issues.includes('right_side_occluded') || issues.includes('right_cheek_occluded')) {
                tips.push(translations[state.currentLang].tip_right_side_occluded);
            }
            
            // Общая проблема с видимостью (руки, предметы)
            if (issues.includes('face_occluded') || issues.includes('insufficient_face_visibility')) {
                tips.push(translations[state.currentLang].tip_face_occluded);
            }
            
            // рука на лице
            if (issues.includes('hand_on_face')) {
                tips.push(translations[state.currentLang].tip_hand_on_face);
            }
        }
    }
    
    return tips;
}

export function updateIlluminationIndicator(data) {
    const indicator = document.getElementById('LightIndicator');
    const progressBar = document.getElementById('LightProgress');
    const statusEl = document.getElementById('LightStatus');
    
    if (data.status === "error") {
        progressBar.style.width = '0%';
        statusEl.textContent = translations[state.currentLang].status_error;
        indicator.className = 'indicator failed';
        state.indicatorsStatus.illumination = 'failed';
        return;
    }
    
    progressBar.style.width = data.value + '%';
    
    let statusText, indicatorClass;
    switch(data.status) {
        case 'too_dark':
        case 'too_bright':
            statusText = data.status === 'too_dark' 
                ? translations[state.currentLang].status_too_dark 
                : translations[state.currentLang].status_too_bright;
            indicatorClass = 'failed';
            break;
        default: 
            statusText = translations[state.currentLang].status_optimal;
            indicatorClass = 'passed';
    }
    
    statusEl.textContent = statusText;
    indicator.className = `indicator ${indicatorClass}`;
    state.indicatorsStatus.illumination = indicatorClass;
}

export function updateFaceIndicator(data) {
    const indicator = document.getElementById('FaceIndicator');
    const progressBar = document.getElementById('FaceProgress');
    const statusEl = document.getElementById('FaceStatus');
    
    if (data.status === "error") {
        progressBar.style.width = '0%';
        statusEl.textContent = translations[state.currentLang].status_error;
        indicator.className = 'indicator failed';
        state.indicatorsStatus.face = 'failed';
        return;
    }
    
    let progressValue, statusText, indicatorClass;
    
    if (!data.detected) {
        progressValue = 0;
        statusText = translations[state.currentLang].status_not_found;
        indicatorClass = 'failed';
    } else {
        progressValue = Math.min(data.size / 40 * 100, 100);
        
        switch(data.status) {
            case 'too_small':
            case 'too_large':
                statusText = data.status === 'too_small' 
                    ? translations[state.currentLang].status_too_small 
                    : translations[state.currentLang].status_too_large;
                indicatorClass = 'failed';
                break;
            case 'out_of_zone':
                statusText = translations[state.currentLang].status_out_of_zone;
                indicatorClass = 'failed';
                break;
            case 'tilted':
                statusText = translations[state.currentLang].status_tilted;
                indicatorClass = 'failed';
                break;
            default: 
                statusText = translations[state.currentLang].status_optimal;
                indicatorClass = 'passed';
        }
    }
    
    progressBar.style.width = progressValue + '%';
    statusEl.textContent = statusText;
    indicator.className = `indicator ${indicatorClass}`;
    state.indicatorsStatus.face = indicatorClass;
}

export function updatePoseIndicator(data) {
    const indicator = document.getElementById('PoseIndicator');
    const progressBar = document.getElementById('PoseProgress');
    const statusEl = document.getElementById('PoseStatus');
    
    if (data.status === "error") {
        progressBar.style.width = '0%';
        statusEl.textContent = translations[state.currentLang].status_error;
        indicator.className = 'indicator failed';
        state.indicatorsStatus.pose = 'failed';
        return;
    }
    
    let progressValue, statusText, indicatorClass;
    
    switch(data.status) {
        case 'no_face':
            progressValue = 0;
            statusText = translations[state.currentLang].status_no_face;
            indicatorClass = 'failed';
            break;
        case 'partial_face':
            progressValue = 30;
            statusText = translations[state.currentLang].status_partial_face;
            indicatorClass = 'failed';
            break;
        case 'off_center':
            progressValue = 50;
            statusText = translations[state.currentLang].status_off_center;
            indicatorClass = 'failed';
            break;
        case 'tilted':
            progressValue = 60;
            statusText = translations[state.currentLang].status_tilted;
            indicatorClass = 'failed';
            break;
        case 'unstable':
            progressValue = 70;
            statusText = translations[state.currentLang].status_unstable;
            indicatorClass = 'failed';
            break;
        case 'stable':
        default:
            progressValue = 100;
            statusText = translations[state.currentLang].status_stable;
            indicatorClass = 'passed';
    }
    
    progressBar.style.width = progressValue + '%';
    statusEl.textContent = statusText;
    indicator.className = `indicator ${indicatorClass}`;
    state.indicatorsStatus.pose = indicatorClass;
}

export function updateVisibilityIndicator(data) {
    const indicator = document.getElementById('VisibilityIndicator');
    const progressBar = document.getElementById('VisibilityProgress');
    const statusEl = document.getElementById('VisibilityStatus');
    
    // Если нет данных о видимости
    if (!data) {
        progressBar.style.width = '0%';
        statusEl.textContent = translations[state.currentLang].status_waiting;
        indicator.className = 'indicator';
        state.indicatorsStatus.visibility = null;
        return;
    }
    
    // Если ошибка
    if (data.error) {
        progressBar.style.width = '0%';
        statusEl.textContent = translations[state.currentLang].status_error;
        indicator.className = 'indicator failed';
        state.indicatorsStatus.visibility = 'failed';
        return;
    }
    
    let progressValue, statusText, indicatorClass;
    
    // Используем score из FaceSegmenter (0-100)
    progressValue = data.score || 0;
    
    if (data.isComplete) {
        // Лицо видно полностью
        statusText = translations[state.currentLang].status_face_visible;
        indicatorClass = 'passed';
    } else if (data.issues && data.issues.length > 0) {
        // Есть проблемы с видимостью
        const issues = data.issues;
        
        if (issues.includes('hair_occlusion') || issues.includes('forehead_occluded')) {
            statusText = translations[state.currentLang].status_hair_occlusion;
            indicatorClass = 'failed';
        } else if (issues.includes('left_side_occluded') || issues.includes('right_side_occluded')) {
            statusText = translations[state.currentLang].status_face_occluded;
            indicatorClass = 'failed';
        } else if (issues.includes('left_cheek_occluded') || issues.includes('right_cheek_occluded')) {
            statusText = translations[state.currentLang].status_partial_face;
            indicatorClass = 'failed';
        } else if (issues.includes('insufficient_face_visibility') || issues.includes('low_skin_visibility')) {
            statusText = translations[state.currentLang].status_partial_face;
            indicatorClass = 'failed';
        } else if (issues.includes('hand_on_face')) {
            statusText = translations[state.currentLang].tip_hand_on_face;
            indicatorClass = 'failed';
        } else {
            statusText = translations[state.currentLang].status_face_occluded;
            indicatorClass = 'failed';
        }
    } else {
        // Нет данных или неопределённый статус
        statusText = translations[state.currentLang].status_waiting;
        indicatorClass = '';
    }
    
    progressBar.style.width = progressValue + '%';
    statusEl.textContent = statusText;
    indicator.className = `indicator ${indicatorClass}`;
    state.indicatorsStatus.visibility = indicatorClass || null;
}

export function drawFaceOverlay(faceData) {
    const canvas = document.getElementById('overlayCanvas');
    const ctx = canvas.getContext('2d');
    const video = document.getElementById('precheckVideo');
    
    if (!video.videoWidth || !video.videoHeight) return;
    
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (faceData.detected && faceData.bbox) {
        const bbox = faceData.bbox;
        
        // Инвертируем X координату для зеркального отображения
        // Видео отображается с transform: scaleX(-1), поэтому bbox тоже нужно отзеркалить
        const mirroredX = 1 - bbox.x - bbox.width;
        
        const x = mirroredX * canvas.width;
        const y = bbox.y * canvas.height;
        const width = bbox.width * canvas.width;
        const height = bbox.height * canvas.height;
        
        let color, lineWidth;
        switch(faceData.status) {
            case 'optimal':
                color = '#10B981'; // green
                lineWidth = 2;
                break;
            case 'too_small':
            case 'too_large':
            case 'out_of_zone':
            case 'tilted':
                color = '#EF4444'; // red
                lineWidth = 3;
                break;
            default:
                color = '#F59E0B'; // orange
                lineWidth = 2;
        }
        
        // bounding box
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x, y, width, height);
        
        ctx.fillStyle = color;
        ctx.font = 'bold 14px Arial';
        ctx.fillText(
            `${Math.round(faceData.size)}%`,
            x + width + 5,
            y + height / 2
        );
    }
}

/**
 * Локальный анализ кадра (без бэкенда)
 * Использует PrecheckAnalyzer для анализа освещения, лица, позы и шеи
 * Использует FaceSegmenter для проверки видимости областей лица
 */
async function runLocalPrecheckAnalysis(videoElement) {
    // Инициализируем анализатор если ещё не создан
    if (!state.runtime.localAnalyzer) {
        state.runtime.localAnalyzer = new PrecheckAnalyzer({
            onInitialized: () => console.log('[PreCheck] Локальный анализатор инициализирован'),
            onError: (err) => console.error('[PreCheck] Ошибка анализатора:', err)
        });
    }
    
    // Инициализируем FaceSegmenter если ещё не создан
    if (!state.runtime.faceSegmenter) {
        state.runtime.faceSegmenter = new FaceSegmenter({
            segmentationType: 'selfie_multiclass',
            onInitialized: () => console.log('[PreCheck] FaceSegmenter инициализирован'),
            onError: (err) => console.error('[PreCheck] Ошибка FaceSegmenter:', err)
        });
    }
    
    try {
        // Анализируем кадр локально
        const results = await state.runtime.localAnalyzer.analyzeFrame(videoElement);
        
        // Анализируем видимость областей лица через FaceSegmenter
        let visibilityResults = null;
        try {
            // Передаём landmarks из результатов Face Landmarker для более точного анализа
            const faceLandmarks = results.landmarks || null;
            visibilityResults = await state.runtime.faceSegmenter.segmentFrame(videoElement, faceLandmarks);
            
            // Добавляем результаты видимости в общие результаты
            results.visibility = {
                isComplete: visibilityResults.isComplete,
                score: visibilityResults.score,
                issues: visibilityResults.issues || [],
                regions: visibilityResults.faceVisibility?.regions || {},
                timestamp: visibilityResults.timestamp
            };
        } catch (segmentError) {
            console.warn('[PreCheck] Ошибка FaceSegmenter:', segmentError);
            results.visibility = {
                isComplete: false,
                score: 0,
                issues: (visibilityResults && visibilityResults.issues) || ['segmenter_error'],
                error: true
            };
        }
        
        // Сохраняем в историю для QC-метрик
        state.runtime.precheckFramesHistory.push(results);
        
        // Ограничиваем размер истории (последние 100 кадров)
        if (state.runtime.precheckFramesHistory.length > 100) {
            state.runtime.precheckFramesHistory.shift();
        }
        
        return results;
        
    } catch (error) {
        console.error('[PreCheck] Ошибка локального анализа:', error);
        return {
            error: true,
            errorMessage: error.message,
            illumination: { value: 0, status: 'error' },
            face: { detected: false, size: 0, status: 'error' },
            pose: { status: 'error', isStable: false },
            neck: { visible: false, status: 'error' },
            visibility: { isComplete: false, score: 0, issues: ['analysis_error'], error: true },
            timestamp: Date.now()
        };
    }
}

function checkCalibrationReadiness() {
    if (!state.runtime.localAnalyzer || !state.runtime.precheckData) {
        return { ready: false, issues: ['analyzer_not_ready'] };
    }
    return state.runtime.localAnalyzer.checkCalibrationReadiness(state.runtime.precheckData);
}