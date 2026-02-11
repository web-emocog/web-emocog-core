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
        trackingTest: [], 
        cognitiveResults: [], 
        experimentMeta: null, 
        gazeValidation: null,
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
        successFrames: 0,      // Счетчик успешных кадров пречека
        currentGaze: { x: null, y: null }, // Текущие координаты взгляда
        
        // Объекты анализаторов
        localAnalyzer: null,
        faceSegmenter: null,
        qcMetrics: null,

        
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