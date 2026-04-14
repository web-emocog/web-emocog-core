/**
 * Frame Analysis
 * 
 * Анализ кадров и обновление счётчиков
 * 
 * @module qc-metrics/frame-analysis
 */

/**
 * Создание счётчиков инструментов
 */
export function createInstrumentCounters() {
    return {
        totalFrames: 0,
        faceVisible: 0,
        faceOk: 0,
        poseOk: 0,
        illuminationOk: 0,
        eyesOpen: 0,
        occlusionDetected: 0,
        gazeValid: 0,
        gazeOnScreen: 0,
        gazeTotal: 0, // общее число кадров когда был вызван addGazePoint
        lowFpsFrames: 0,
        consecutiveLowFpsMs: 0,
        maxConsecutiveLowFpsMs: 0,
        totalLowFpsMs: 0
    };
}

/**
 * Вычисление флагов кадра из данных precheck
 * 
 * @param {Object} precheckResult - результат PrecheckAnalyzer
 * @param {Object} segmenterResult - результат FaceSegmenter (опционально)
 * @returns {Object} флаги кадра
 */
export function computeFrameFlags(precheckResult, segmenterResult = null) {
    const flags = {
        faceVisible: false,
        faceOk: false,
        poseOk: false,
        illuminationOk: false,
        eyesOpen: false,
        occlusionDetected: false
    };
    
    if (!precheckResult) return flags;
    
    // === Occlusion detection (ИСПРАВЛЕНО - менее агрессивная логика) ===
    // Окклюзия только если FaceSegmenter ЯВНО детектирует руку или серьёзную проблему
    let isOccluded = false;
    if (segmenterResult && segmenterResult.faceVisibility) {
        // Проверяем только явную детекцию руки
        if (segmenterResult.faceVisibility.handDetected === true) {
            isOccluded = true;
        }
        // Или если есть критические issues (но НЕ low_skin_visibility - это часто ложное)
        const issues = segmenterResult.issues || segmenterResult.faceVisibility?.issues || [];
        if (Array.isArray(issues)) {
            const criticalIssues = issues.filter(i => 
                i === 'hand_on_face' || 
                i.includes('hand_occluded')
            );
            if (criticalIssues.length > 0) isOccluded = true;
        }
    }
    
    flags.occlusionDetected = isOccluded;
    
    // === Face detection ===
    if (precheckResult.face) {
        const faceDetected = precheckResult.face.detected === true;
        const faceStatus = precheckResult.face.status;
        const badStatuses = ['too_small', 'too_large', 'out_of_bounds', 'not_found'];
        
        // faceVisible НЕ зависит от окклюзии - лицо может быть видно даже с частичной окклюзией
        flags.faceVisible = faceDetected;
        // faceOk учитывает окклюзию
        flags.faceOk = faceDetected && !isOccluded && !badStatuses.includes(faceStatus);
    }
    
    // === Pose (LEGACY-compatible) ===
    if (precheckResult.pose) {
        flags.poseOk = (precheckResult.pose.status === 'stable') || 
                       (precheckResult.pose.isStable === true && precheckResult.pose.isTilted !== true);
    }
    
    // === Illumination ===
    if (precheckResult.illumination) {
        flags.illuminationOk = precheckResult.illumination.status === 'optimal';
    }
    
    // === Eyes ===
    if (precheckResult.eyes) {
        const eyesBothOpen = precheckResult.eyes.bothOpen ?? 
            ((precheckResult.eyes.left?.open ?? true) && (precheckResult.eyes.right?.open ?? true));
        flags.eyesOpen = !!eyesBothOpen;
    }
    
    return flags;
}

/**
 * Обновление счётчиков инструментов
 * 
 * @param {Object} counters - текущие счётчики
 * @param {Object} flags - флаги кадра
 * @param {Object} gazeState - состояние gaze
 * @param {boolean} isLowFps - низкий FPS
 * @param {number} deltaMs - время с предыдущего кадра
 * @returns {Object} обновлённые счётчики
 */
export function updateInstrumentCounters(counters, flags, gazeState, isLowFps, deltaMs) {
    const newCounters = { ...counters };
    
    newCounters.totalFrames++;
    
    if (flags.faceVisible) newCounters.faceVisible++;
    if (flags.faceOk) newCounters.faceOk++;
    if (flags.poseOk) newCounters.poseOk++;
    if (flags.illuminationOk) newCounters.illuminationOk++;
    if (flags.eyesOpen) newCounters.eyesOpen++;
    if (flags.occlusionDetected) newCounters.occlusionDetected++;
    
    if (gazeState.valid) newCounters.gazeValid++;
    if (gazeState.onScreen === true) newCounters.gazeOnScreen++;
    
    // FPS tracking
    if (isLowFps) {
        newCounters.lowFpsFrames++;
        newCounters.consecutiveLowFpsMs += deltaMs;
        newCounters.totalLowFpsMs += deltaMs;
        newCounters.maxConsecutiveLowFpsMs = Math.max(
            newCounters.maxConsecutiveLowFpsMs,
            newCounters.consecutiveLowFpsMs
        );
    } else {
        newCounters.consecutiveLowFpsMs = 0;
    }
    
    return newCounters;
}

/**
 * Расчёт процентов из счётчиков
 * 
 * ИСПРАВЛЕНО: gazeValidPct считается от gazeTotal (сколько раз вызывали addGazePoint),
 * а не от totalFrames. gazeOnScreenPct считается от gazeValid.
 * 
 * @param {Object} counters - счётчики
 * @returns {Object} проценты
 */
export function computePercentages(counters) {
    const total = counters.totalFrames || 1;
    // gazeTotal = количество вызовов addGazePoint; gazeValid = из них валидных
    const gazeTotal = counters.gazeTotal || 0;
    const gazeValid = counters.gazeValid || 0;
    
    return {
        faceVisiblePct: (counters.faceVisible / total) * 100,
        faceOkPct: (counters.faceOk / total) * 100,
        poseOkPct: (counters.poseOk / total) * 100,
        illuminationOkPct: (counters.illuminationOk / total) * 100,
        eyesOpenPct: (counters.eyesOpen / total) * 100,
        occlusionPct: (counters.occlusionDetected / total) * 100,
        // gazeValidPct = gazeValid / gazeTotal (только от вызовов addGazePoint)
        gazeValidPct: gazeTotal > 0 ? (gazeValid / gazeTotal) * 100 : 0,
        // gazeOnScreenPct считается от валидных точек взгляда
        gazeOnScreenPct: gazeValid > 0 ? (counters.gazeOnScreen / gazeValid) * 100 : 0,
        lowFpsPct: (counters.lowFpsFrames / total) * 100
    };
}
