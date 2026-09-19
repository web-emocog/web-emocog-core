import { createSessionEvent } from '../session-runtime/contracts.mjs';

// === КОНСТАНТЫ И КОНФИГУРАЦИЯ ===
export const LOCAL_ANALYSIS_CONFIG = {
    FRAME_INTERVAL_MS: 300
};

export const CONSTANTS = {
    REQUIRED_SUCCESS_FRAMES: 15 // Для Pre-check
};

export const state = {
    // Настройки интерфейса
    currentLang: 'ru',
    
    // Основные данные сессии (то, что идет в JSON)
    sessionData: {
        ids: { session: null, participant: null, participantAlias: null, invitationCode: null },
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
        blinkSummary: null,
        perclosSummary: null,
        emotionSamples: [],
        emotionAccumulator: null,
        emotionSummary: null,
        bodyPoseSamples: [],
        bodyPoseAccumulator: null,
        bodyPoseSummary: null,
        audioConsent: {
            schemaVersion: 'audio_consent.v1',
            offered: false,
            required: false,
            granted: false,
            rawCaptureGranted: false
        },
        audioSummary: null,
        multimodal: null,
        multimodalSummary: null,
        multimodalHeatmap: null,
        emotionEvents: [],
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
        lifecycle: null,
        upload: null,
        qcSummary: null,
        bpmSummary: null,
        rppgSummary: null,
        bpmRuns: [],
        respirationRuns: [],
        // Set when continuous measurement actually starts, after consent/pre-check.
        startTime: null
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
        headPoseReference: null,

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
        currentGazePrediction: null, // raw/corrected/display signal for validation
        lastEmotionSample: null,
        lastBodyPoseSample: null,
        lastMultimodalSample: null,
        lastPoseData: null,    // Последние данные позы из анализа (для QC gaze inference)
        lastEyeSignal: null,   // Последний eye-signal sample (EAR/iris proxy)
        currentPhase: 'init',
        taskContext: {
            blockId: null,
            attempt: null,
            trialId: null,
            presentationId: null,
            stimulusId: null,
            stimulusType: null,
            expectedResponse: null
        },
        
        // Объекты анализаторов
        localAnalyzer: null,
        faceSegmenter: null,
        faceMaskCollector: null,
        qcMetrics: null,
        gazeTracker: null,        // GazeTracker instance
        sessionRuntime: null,      // Единый lifecycle и непрерывные модули сессии
        sessionClock: null,
        sessionFeatureFlags: null,
        audioStream: null,

        
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
    const taskContext = getCurrentTaskContext();
    const event = createSessionEvent({
        type,
        sessionId: state.sessionData?.ids?.session || null,
        phase: state.runtime.currentPhase || null,
        timestamp,
        tRelMs: getRelativeSessionTimeMs(timestamp),
        blockId: payload.blockId ?? taskContext.blockId ?? null,
        trialId: payload.trialId ?? taskContext.trialId ?? null,
        ...payload
    });
    state.sessionData.events.push(event);
    return event;
}

export function setSessionPhase(phase, payload = {}) {
    if (!phase) return;
    if (state.runtime.currentPhase === phase && !payload.force) return;
    state.runtime.currentPhase = phase;
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.sessionPhase = phase;
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('wecog:session-phase-change', {
            detail: { phase }
        }));
    }
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
        attempt: null,
        trialId: null,
        presentationId: null,
        stimulusId: null,
        stimulusName: null,
        stimulusType: null,
        expectedResponse: null
    };
    return getCurrentTaskContext();
}
if (typeof window !== 'undefined') {
    window.__WECOG_STATE__ = state;
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
