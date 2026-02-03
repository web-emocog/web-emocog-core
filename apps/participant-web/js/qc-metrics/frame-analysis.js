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
    
    // === Occlusion detection (check FIRST, affects other flags) ===
    let isOccluded = false;
    
    if (segmenterResult) {
        const fv = segmenterResult.faceVisibility;
        if (fv) {
            // Hand detection
            if (fv.handDetected === true) {
                isOccluded = true;
            }
            
            // Check issues array for any occlusion
            if (Array.isArray(fv.issues) && fv.issues.length > 0) {
                // Any issue indicates occlusion problem
                const occlusionIssues = fv.issues.filter(issue => 
                    issue.includes('occluded') || 
                    issue.includes('hand') ||
                    issue.includes('occlusion') ||
                    issue === 'insufficient_face_visibility' ||
                    issue === 'low_skin_visibility'
                );
                if (occlusionIssues.length > 0) {
                    isOccluded = true;
                }
            }
            
            // Check isComplete flag from segmenter
            if (fv.isComplete === false || segmenterResult.isComplete === false) {
                isOccluded = true;
            }
            
            // Check face visibility score (< 70 means significant occlusion)
            const score = fv.score ?? segmenterResult.score;
            if (typeof score === 'number' && score < 70) {
                isOccluded = true;
            }
        }
    }
    
    flags.occlusionDetected = isOccluded;
    
    // === Face detection ===
    if (precheckResult.face) {
        const faceDetected = precheckResult.face.detected === true;
        const faceStatusOk = precheckResult.face.status === 'optimal';
        
        // faceVisible: лицо детектировано И не закрыто окклюзией
        flags.faceVisible = faceDetected && !isOccluded;
        
        // faceOk: лицо видно, статус optimal, нет окклюзии
        flags.faceOk = faceDetected && faceStatusOk && !isOccluded;
    }
    
    // === Pose ===
    if (precheckResult.pose) {
        const pose = precheckResult.pose;
        flags.poseOk = pose.status === 'stable' && 
                       !pose.isTilted && 
                       (pose.eyesCentering?.centered !== false);
    }
    
    // === Illumination ===
    if (precheckResult.illumination) {
        flags.illuminationOk = precheckResult.illumination.status === 'optimal';
    }
    
    // === Eyes ===
    if (precheckResult.eyes) {
        // Eyes can only be reliably detected if face is not occluded
        flags.eyesOpen = precheckResult.eyes.bothOpen === true && !isOccluded;
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
 * @param {Object} counters - счётчики
 * @returns {Object} проценты
 */
export function computePercentages(counters) {
    const total = counters.totalFrames || 1;
    const gazeValid = counters.gazeValid || 1;
    
    return {
        faceVisiblePct: (counters.faceVisible / total) * 100,
        faceOkPct: (counters.faceOk / total) * 100,
        poseOkPct: (counters.poseOk / total) * 100,
        illuminationOkPct: (counters.illuminationOk / total) * 100,
        eyesOpenPct: (counters.eyesOpen / total) * 100,
        occlusionPct: (counters.occlusionDetected / total) * 100,
        gazeValidPct: (counters.gazeValid / total) * 100,
        gazeOnScreenPct: (counters.gazeOnScreen / gazeValid) * 100,
        lowFpsPct: (counters.lowFpsFrames / total) * 100
    };
}
