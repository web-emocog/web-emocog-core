// === КОНСТАНТЫ И КОНФИГУРАЦИЯ ===
export const BACKEND_CONFIG = {
    BASE_URL: 'http://localhost:5000', 
    ENDPOINTS: {
        ANALYZE_FRAME: '/api/analyze-frame'
    },
    SEND_INTERVAL: 300, // отправляем кадры каждые 300мс
    MAX_FRAME: 60,      // максимум 60 кадров
    COMPRESSION_QUALITY: 0.7 // качество JPEG
};

export const CONSTANTS = {
    REQUIRED_SUCCESS_FRAMES: 15 // Для Pre-check
};

export const state = {
    // Настройки интерфейса
    currentLang: 'ru',
    
    // Основные данные сессии (то, что идет в JSON)
    sessionData: {
        ids: { session: null, participant: null },
        user: { interfaceLanguage: 'ru' }, // Будет обновлено при старте
        tech: {}, 
        precheck: {},
        eyeTracking: [],
        eyeSignals: [],
        trackingTest: [], 
        cognitiveResults: [],
        experimentMeta: null,
        gazeValidation: null,
        heatmaps: null,
        attentionMetrics: null,
        testHub: {
            version: '1.0.0',
            selections: [],
            runs: []
        },
        gazeTests: {
            vpcRuns: [],
            visuospatialRuns: []
        },
        events: [],
        qcSummary: null,
        startTime: Date.now()
    },

    // Флаги состояния приложения
    flags: {
        isRecording: false,
        isPrecheckRunning: false,
        isValidating: false,   // Идет ли процесс валидации точности
        faceDetected: false
    },

    // Runtime данные (временные данные, нужные только в моменте)
    runtime: {
        precheckData: null,

        cameraStream: null,    // Объект MediaStream
        analysisFrameId: null, // ID таймера setTimeout
        analysisInterval: null, // ID setTimeout для single-flight цикла анализа (gaze + QC)
        _validationGazeInterval: null, // ID setTimeout для single-flight gaze prediction во время валидации
        validationSamplingInterval: null, // ID setInterval для сбора validation-сэмплов
        _analysisLoopActive: false, // Флаг single-flight цикла анализа (tracking test)
        _validationLoopActive: false, // Флаг single-flight цикла предсказаний (validation)
        _cognitiveLoopActive: false, // Флаг single-flight цикла предсказаний (cognitive stage)
        cognitiveAnalysisInterval: null, // ID setTimeout для cognitive single-flight цикла
        _gazeTestsLoopActive: false, // Флаг single-flight цикла для custom gaze tests (VPC/visuospatial)
        gazeTestsAnalysisInterval: null, // ID setTimeout для custom gaze tests single-flight цикла
        successFrames: 0,      // Счетчик успешных кадров пречека
        currentGaze: { x: null, y: null }, // Текущие координаты взгляда
        lastPoseData: null,    // Последние данные позы из анализа (для QC gaze inference)
        lastEyeSignal: null,   // Последний eye-signal sample (EAR/iris proxy)
        currentPhase: 'init',
        taskContext: {
            blockId: null,
            trialId: null,
            stimulusId: null,
            stimulusType: null,
            expectedResponse: null
        },
        
        // Объекты анализаторов
        localAnalyzer: null,
        faceSegmenter: null,
        qcMetrics: null,
        gazeTracker: null,        // GazeTracker instance

        
        // Временные массивы
        validationPoints: [],      // Точки во время валидации
        precheckFramesHistory: [], // История для QC
        
        // Время старта сессии для QC
        sessionStartTime: null 
    },

    // Состояние индикаторов Pre-check
    indicatorsStatus: {
        illumination: null,
        face: null,
        pose: null,
        visibility: null
    },

    // Состояние монитора FPS камеры
    cameraFpsState: {
        isRunning: false,
        frameCount: 0,
        lastTime: 0,
        currentFps: 0,
        fpsHistory: [],
        videoFrameCallbackId: null,
        video: null
    }
};

function getNowMs() {
    return Date.now();
}

export function getRelativeSessionTimeMs(ts = getNowMs()) {
    const start = state.sessionData.startTime || ts;
    return Math.max(0, ts - start);
}

export function getCurrentTaskContext() {
    return { ...(state.runtime.taskContext || {}) };
}

export function recordSessionEvent(type, payload = {}) {
    const timestamp = getNowMs();
    const event = {
        type,
        phase: state.runtime.currentPhase || null,
        timestamp,
        tRelMs: getRelativeSessionTimeMs(timestamp),
        ...payload
    };
    state.sessionData.events.push(event);
    return event;
}

export function setSessionPhase(phase, payload = {}) {
    if (!phase) return;
    if (state.runtime.currentPhase === phase && !payload.force) return;
    state.runtime.currentPhase = phase;
    recordSessionEvent('phase_change', { phase, ...payload });
}

export function setTaskContext(contextPatch = {}) {
    state.runtime.taskContext = {
        ...(state.runtime.taskContext || {}),
        ...contextPatch
    };
    return getCurrentTaskContext();
}

export function clearTaskContext() {
    state.runtime.taskContext = {
        blockId: null,
        trialId: null,
        stimulusId: null,
        stimulusType: null,
        expectedResponse: null
    };
    return getCurrentTaskContext();
}
export const ex_state = {
    instruction: {
        container: document.getElementById('cognitiveInstruction'),
        title: document.getElementById('cogTitle'),
        text: document.getElementById('cogText'),
        btn: document.getElementById('cogStartBtn')
    },
    task: {
        area: document.getElementById('cognitiveStimulusArea'),
        stimulus: document.getElementById('cogShape'),
        fixation: document.getElementById('cogFixation'),
        feedback: document.getElementById('cogFeedback')
    }
};
