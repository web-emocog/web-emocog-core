import {
    state,
    ex_state,
    setSessionPhase,
    recordSessionEvent,
    setTaskContext,
    clearTaskContext,
    getRelativeSessionTimeMs
} from './state.js';
import { finishSession } from './tests-updated.js';
import { extractEyeSignalSample } from './eye-signal.js';
import { updateFromMetrics as qcOverlayUpdateFromMetrics } from '../qc-pause-overlay-new.js';
import { hide as hideQcOverlay } from '../qc-pause-overlay-new.js';
import { isVisible as isQcOverlayVisible } from '../qc-pause-overlay-new.js';
import { getEmotionSample, appendEmotionSample } from '../emotion-stub-new.js';
import { translations } from '../../translations.js';
import { definitionForCognitiveRunner } from './protocol-invite-utils.js';
import {
    getSessionRuntime,
    isContinuousSessionAnalysisRunning
} from '../session-runtime/index.js';
import {
    buildTrialRepeatPlan,
    collectTrialQualityIssues
} from '../session-runtime/trial-quality.mjs';
import {
    RtResponseCollector,
    normalizeResponseMode
} from '../rt-input/response-policy.mjs';

const TARGET_LOOP_INTERVAL_MS = 33;
const SAME_FRAME_RETRY_MS = 8;

let experimentProtocol = null;
let currentBlockIndex = 0;
let currentTrialIndex = 0;
let fixationTimeout = null;
let trialTimeout = null;
let responseCollector = null;
let activeTrialRuntime = null;
let cognitiveFinished = false;

let cognitiveVideo = null;
let cognitiveLoopLastVideoTime = -1;
let cognitiveSegmenterThrottleCounter = 0;
let cognitiveSegmenterInFlight = false;
let cognitiveLastSegmenterResult = null;
let cognitiveTaskOptions = {
    autoFinishSession: true,
    onComplete: null
};
let trialPhase = 'idle';
let fixationStartPerf = null;
let fixationRemainingMs = 0;
let pendingFixationCallback = null;
let stimulusTimeoutRemainingMs = 0;
let stimulusTimerStartPerf = null;
let pendingStimulusTimeoutCallback = null;
let currentBlockAttempt = 1;
let activeBlockTrialPlan = [];
let activeTrialQualityContext = null;
const MAX_COGNITIVE_BLOCK_ATTEMPTS = 3;

function buildSessionQualityInstruction() {
    const english = state.currentLang === 'en';
    return {
        id: 'session_quality_policy',
        type: 'instruction',
        content: {
            title: english ? 'Test conditions' : 'Условия проведения',
            text: english
                ? 'Do not take the test in a moving vehicle, in darkness, with strong backlight, while lying down, or with your face covered. Brief natural head movements and small lighting changes are allowed. If data quality is insufficient, the affected block will be repeated. Pause is available only on instruction screens.'
                : 'Не проходите тест в движущемся транспорте, в темноте, при ярком свете за спиной, лёжа или с закрытым лицом. Краткие естественные движения головы и небольшие изменения освещения допустимы. Если качество данных станет недостаточным, затронутый блок будет повторён. Пауза доступна только на экранах инструкции.',
            buttonText: english ? 'Continue' : 'Продолжить'
        }
    };
}

function ensureSessionQualityInstruction(protocol) {
    if (!protocol || !Array.isArray(protocol.blocks)) return protocol;
    if (protocol.blocks.some(block => block?.id === 'session_quality_policy')) return protocol;
    protocol.blocks.unshift(buildSessionQualityInstruction());
    return protocol;
}

function resolveTrialStimulusObject(stimulusId, meta) {
    const std = typeof window !== 'undefined' ? window.StandardStimuli : null;
    if (std) {
        return std.resolveParticipantStimulus({
            stimulusId,
            meta,
            lang: state.currentLang || 'ru',
        });
    }
    return {
        type: 'shape',
        style: { width: '140px', height: '140px', borderRadius: '8px', backgroundColor: '#5C66BD' },
        stimulusId: stimulusId || undefined,
    };
}

function buildDefaultTrials(seed = 'default') {
    return [
        {
            id: `trial_${seed}_go`,
            condition: 'go',
            correctResponse: 'Space',
            stimulus: { type: 'shape', style: { width: '140px', height: '140px', borderRadius: '8px', backgroundColor: '#4CAF50' } }
        },
        {
            id: `trial_${seed}_nogo`,
            condition: 'nogo',
            correctResponse: null,
            stimulus: { type: 'shape', style: { width: '140px', height: '140px', borderRadius: '50%', backgroundColor: '#F44336' } }
        }
    ];
}

function buildSimpleRtTrials(seed = 'simple_rt', count = 10) {
    const trials = [];
    for (let i = 0; i < count; i += 1) {
        trials.push({
            id: `trial_${seed}_${i}`,
            condition: 'target',
            correctResponse: 'Space',
            stimulus: {
                type: 'shape',
                style: { width: '120px', height: '120px', borderRadius: '8px', backgroundColor: '#020617' },
                stimulusId: 'std_simple_black_square'
            }
        });
    }
    return trials;
}

/** When API cognitive_task has no trials array, derive runnable trials from taskType. */
function synthesizeInvitationTrials(block, index) {
    const normalized = normalizeV2Trials(block.trials);
    if (normalized.length) return normalized;

    const cfg = block.blockConfig || {};
    const taskType = String(
        block.taskType || cfg.taskType || block.rt_task || cfg.rt_task || 'other'
    ).toLowerCase();
    const useRt = cfg.useRT !== false && block.useRT !== false;

    if (taskType === 'simple_rt' || taskType === 'pvt') {
        return buildSimpleRtTrials(String(index), 10);
    }
    if (taskType === 'go_nogo') {
        return buildDefaultTrials(String(index));
    }
    // Builder often saves RT blocks as taskType "other" with useRT: true
    if (useRt && taskType === 'other') {
        return buildSimpleRtTrials(String(index), 10);
    }
    return buildDefaultTrials(String(index));
}

function toInstructionBlock(id, title, text) {
    return {
        id,
        type: 'instruction',
        content: {
            title: title || 'Инструкция',
            text: text || '',
            buttonText: 'Продолжить'
        }
    };
}

function toCognitiveBlockFromStimuli(defBlock, index) {
    const params = defBlock?.params || {};
    const stimuliMap = state.runtime?.invitationStimuliMap || {};
    const normalizeStimulusId = (id) => {
        const raw = String(id || '');
        if (raw.startsWith('api:')) return raw.slice(4);
        return raw;
    };
    const trials = Array.isArray(params.trials) && params.trials.length
        ? params.trials
        : (
            Array.isArray(params.stimuli_ids) && params.stimuli_ids.length
                ? params.stimuli_ids.map((stimulusId, i) => {
                    const normalizedStimulusId = normalizeStimulusId(stimulusId);
                    const row = stimuliMap[normalizedStimulusId] || null;
                    const stimulus = resolveTrialStimulusObject(normalizedStimulusId, row);
                    return {
                    id: `trial_${index}_${i}_${String(stimulusId)}`,
                    condition: 'go',
                    correctResponse: 'Space',
                    stimulus: {
                        ...stimulus,
                        stimulusId: normalizedStimulusId,
                        stimulusName: row?.name || normalizedStimulusId
                    }
                    };
                })
                : buildDefaultTrials(String(index))
        );

    return {
        id: defBlock?.id || `block_${index}`,
        type: 'cognitive_task',
        // Backward/forward compat:
        // - researcher.html protocol editor currently sets `params.duration_sec` for block timing
        // - runtime expects `fixation_ms` / `stimulus_ms`, so we derive sensible ms values from duration_sec.
        blockConfig: {
            fixation: { duration: Number.isFinite(params.fixation_ms) ? params.fixation_ms : 500 },
            stimulusDuration: Number.isFinite(params.stimulus_ms)
                ? params.stimulus_ms
                : (Number.isFinite(params.duration_sec) ? Math.round(params.duration_sec * 1000) : 1000),
            showFeedback: false,
            useAOI: params.useAOI === true,
            aoiSchemaVersion: params.aoiSchemaVersion || null,
            aoiDefinitions: params.aoiDefinitions || {}
        },
        trials
    };
}

function isResearcherV2Protocol(definition) {
    const version = String(definition?.version || '');
    if (version.startsWith('v2')) return true;
    const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
    return blocks.some((b) => b?.taskType || b?.blockConfig || Array.isArray(b?.trials));
}

function mapActionToCorrectResponse(action) {
    if (!action) return null;
    const a = String(action).toLowerCase();
    if (a === 'space') return 'Space';
    if (a === 'mouse_click') return 'Click';
    if (a === 'mouse_intent' || a === 'pointer_intent') return 'PointerIntent';
    if (a.startsWith('arrow_')) {
        const part = a.replace('arrow_', '');
        return `Arrow${part.charAt(0).toUpperCase()}${part.slice(1)}`;
    }
    return action;
}

function conditionToIsGo(condition) {
    if (condition == null) return null;
    const c = String(condition).toLowerCase();
    if (c.includes('nogo') || c.includes('no-go') || c === 'nogo') return false;
    if (c.includes('go') || c === 'target') return true;
    return null;
}

function keyFromKeyboardEvent(e) {
    if (!e || !e.code) return null;
    if (e.code === 'Space') return 'Space';
    if (e.code.startsWith('Arrow')) return e.code;
    return null;
}

function isAcceptedTaskKey(e, trial) {
    const key = keyFromKeyboardEvent(e);
    if (!key) return false;
    const expected = trial?.correctResponse;
    if (expected == null) return true;
    return key === expected;
}

function normalizeV2Trials(trials) {
    const stimuliMap = state.runtime?.invitationStimuliMap || {};
    const list = Array.isArray(trials) ? trials : [];
    const out = [];
    list.forEach((t, index) => {
        const reps = Math.max(1, parseInt(t.repetitions, 10) || 1);
        for (let r = 0; r < reps; r += 1) {
            const sid = t.stimulusId || `trial_${index}`;
            const meta = stimuliMap[String(sid).replace(/^api:/, '')] || null;
            const stimulus = resolveTrialStimulusObject(sid, meta);
            out.push({
                id: `${sid}_${index}_${r}`,
                condition: t.condition || '',
                correctResponse: mapActionToCorrectResponse(t.action || t.correctResponse),
                responseMode: t.responseMode || null,
                stimulus: { ...stimulus, stimulusId: sid },
                duration: t.duration || null
            });
        }
    });
    return out;
}

function toCognitiveBlockFromV2(block, index) {
    const cfg = block.blockConfig || {};
    const taskType = block.taskType || cfg.taskType || 'other';
    const isInvite = !!state.runtime?.invitationProtocolDefinition;
    let trials = normalizeV2Trials(block.trials);
    if (!trials.length && isInvite) {
        trials = synthesizeInvitationTrials(block, index);
    }
    if (!trials.length) {
        trials = buildDefaultTrials(String(index));
    }
    return {
        id: block.id || `cognitive_${index}`,
        type: 'cognitive_task',
        taskType,
        rt_task: taskType,
        selected_metrics: cfg.selected_metrics || block.selected_metrics || null,
        blockConfig: {
            ...cfg,
            fixation: cfg.fixation || { duration: cfg.fixationDuration || 500 },
            stimulusDuration: cfg.stimulusDuration || 1000,
            showFeedback: !!(cfg.showFeedback || cfg.feedbackConfig),
            rtWindow: cfg.rtWindow || 1000,
            omissionRule: cfg.omissionRule || 'skip',
            commissionRule: cfg.commissionRule || 'flag',
            responseMode: cfg.responseMode || null,
            feedbackCorrect: cfg.feedbackConfig?.correctText || null,
            feedbackIncorrect: cfg.feedbackConfig?.incorrectText || null
        },
        trials
    };
}

function normalizeProtocolDefinition(definition) {
    if (isResearcherV2Protocol(definition)) {
        const blocksIn = Array.isArray(definition?.blocks) ? definition.blocks : [];
        const outBlocks = [];
        blocksIn.forEach((block, index) => {
            const type = String(block?.type || '').toLowerCase();
            if (type === 'instruction' || type === 'instructions') {
                outBlocks.push(toInstructionBlock(
                    block.id || `instruction_${index}`,
                    block.content?.title || block.label || 'Инструкция',
                    block.content?.text || ''
                ));
                return;
            }
            if (type === 'cognitive_task' || type === 'stimuli') {
                outBlocks.push(toCognitiveBlockFromV2(block, index));
                return;
            }
            if (type === 'finish' || type === 'final') {
                outBlocks.push(toInstructionBlock(
                    block.id || `finish_${index}`,
                    block.content?.title || block.label || 'Эксперимент завершён',
                    block.content?.text || 'Спасибо за участие!'
                ));
                return;
            }
            if (type === 'passive' || type === 'rest') {
                outBlocks.push(toInstructionBlock(
                    block.id || `${type}_${index}`,
                    block.label || type,
                    block.content?.text || ''
                ));
            }
        });
        if (outBlocks.length) {
            return {
                title: definition?.title || definition?.meta?.name || 'Protocol',
                version: definition?.version || 'v2-runtime',
                blocks: outBlocks
            };
        }
    }

    const blocksIn = Array.isArray(definition?.blocks) ? definition.blocks : [];
    const outBlocks = [];

    blocksIn.forEach((block, index) => {
        const type = String(block?.type || '').toLowerCase();
        const params = block?.params || {};
        if (type === 'instruction' || type === 'instructions') {
            outBlocks.push(toInstructionBlock(block?.id || `instruction_${index}`, params.title || 'Инструкция', params.text || ''));
            return;
        }
        if (type === 'consent') {
            outBlocks.push(toInstructionBlock(block?.id || `consent_${index}`, params.title || 'Согласие', params.text || 'Подтвердите согласие на участие.'));
            return;
        }
        if (type === 'questionnaire' || type === 'calibration' || type === 'rest' || type === 'baseline' || type === 'recovery' || type === 'final') {
            outBlocks.push(toInstructionBlock(block?.id || `${type}_${index}`, params.title || 'Этап', params.text || 'Следующий этап протокола.'));
            return;
        }
        if (type === 'stimuli' || type === 'cognitive_task') {
            outBlocks.push(toCognitiveBlockFromStimuli(block, index));
            return;
        }
    });

    const isInvitationProtocol = !!state.runtime?.invitationProtocolDefinition;
    if (!outBlocks.length && !isInvitationProtocol) {
        outBlocks.push(toInstructionBlock('instruction_auto', 'Эксперимент', 'Подготовка к когнитивному этапу.'));
        outBlocks.push({
            id: 'task_auto',
            type: 'cognitive_task',
            blockConfig: { fixation: { duration: 500 }, stimulusDuration: 1000, showFeedback: false },
            trials: buildDefaultTrials('auto')
        });
    }

    const hasTask = outBlocks.some((b) => b.type === 'cognitive_task');
    if (!hasTask && !isInvitationProtocol) {
        outBlocks.push({
            id: 'task_fallback',
            type: 'cognitive_task',
            blockConfig: { fixation: { duration: 500 }, stimulusDuration: 1000, showFeedback: false },
            trials: buildDefaultTrials('fallback')
        });
    }

    return {
        title: definition?.meta?.name || 'Invitation protocol',
        version: 'invite-runtime-v1',
        blocks: outBlocks
    };
}

function getVideoTime(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return -1;
    const t = videoElement.currentTime;
    return Number.isFinite(t) ? t : -1;
}

function getTaskPayload(extra = {}) {
    const ctx = state.runtime.taskContext || {};
    return {
        phase: state.runtime.currentPhase || null,
        blockId: ctx.blockId ?? null,
        trialId: ctx.trialId ?? null,
        stimulusId: ctx.stimulusId ?? null,
        stimulusType: ctx.stimulusType ?? null,
        expectedResponse: ctx.expectedResponse ?? null,
        ...extra
    };
}

function emitTaskEvent(type, payload = {}) {
    return recordSessionEvent(type, getTaskPayload(payload));
}

function handleQcPauseState(overlayVisible) {
    const runtime = getSessionRuntime();
    if (!runtime) return;
    if (overlayVisible) {
        runtime.reportIssue({
            kind: 'quality',
            code: 'qc_degraded',
            message: 'Качество видеосигнала длительно ниже допустимого уровня.',
            recoverable: true
        });
    } else {
        runtime.resolveIssue('qc_degraded');
    }
}

function resetStimulusViews() {
    if (ex_state.task?.stimulus) {
        ex_state.task.stimulus.style.display = 'none';
    }

    const imageEl = document.getElementById('cogImage');
    if (imageEl) {
        imageEl.style.display = 'none';
        imageEl.removeAttribute('src');
    }
}

function renderStimulus(trial) {
    resetStimulusViews();

    const stimulus = trial?.stimulus || {};
    const stimulusType = stimulus.type || 'shape';
    const shapeEl = ex_state.task?.stimulus;
    const imageEl = document.getElementById('cogImage');

    if (stimulusType === 'image' && imageEl) {
        imageEl.style.cssText = '';
        if (stimulus.style && typeof stimulus.style === 'object') {
            Object.assign(imageEl.style, stimulus.style);
        }
        if (stimulus.src) {
            imageEl.src = stimulus.src;
        }
        imageEl.style.display = 'block';
        return;
    }

    if (shapeEl) {
        shapeEl.style.cssText = '';
        shapeEl.textContent = '';
        if (stimulusType === 'text') {
            shapeEl.textContent = stimulus.text || '';
            if (stimulus.style && typeof stimulus.style === 'object') {
                Object.assign(shapeEl.style, stimulus.style);
            }
            shapeEl.style.display = 'block';
            return;
        }
        if (stimulus.style && typeof stimulus.style === 'object') {
            Object.assign(shapeEl.style, stimulus.style);
        }
        shapeEl.style.display = 'block';
    }
}

function stopCognitiveAnalysisLoop() {
    state.runtime._cognitiveLoopActive = false;
    if (state.runtime.cognitiveAnalysisInterval) {
        clearTimeout(state.runtime.cognitiveAnalysisInterval);
        state.runtime.cognitiveAnalysisInterval = null;
    }
    cognitiveVideo = null;
}

function scheduleCognitiveAnalysisTick(delayMs = 0) {
    if (!state.runtime._cognitiveLoopActive) return;
    state.runtime.cognitiveAnalysisInterval = setTimeout(runCognitiveAnalysisTick, delayMs);
}

async function runCognitiveAnalysisTick() {
    if (!state.runtime._cognitiveLoopActive) return;
    if (!cognitiveVideo || !state.runtime.localAnalyzer) {
        scheduleCognitiveAnalysisTick(100);
        return;
    }

    const tickStart = performance.now();

    try {
        const videoTime = getVideoTime(cognitiveVideo);
        if (videoTime < 0 || videoTime === cognitiveLoopLastVideoTime) {
            scheduleCognitiveAnalysisTick(SAME_FRAME_RETRY_MS);
            return;
        }
        cognitiveLoopLastVideoTime = videoTime;

        const precheckResult = await state.runtime.localAnalyzer.analyzeFrame(cognitiveVideo);
        state.runtime.lastPrecheckResult = precheckResult;

        if (precheckResult && precheckResult.pose) {
            state.runtime.lastPoseData = {
                yaw: precheckResult.pose.yaw ?? null,
                pitch: precheckResult.pose.pitch ?? null,
                roll: precheckResult.pose.roll ?? null
            };
        } else {
            state.runtime.lastPoseData = null;
        }

        if (
            state.runtime.gazeTracker &&
            state.runtime.gazeTracker.isCalibrated() &&
            precheckResult &&
            precheckResult.landmarks
        ) {
            const gaze = state.runtime.gazeTracker.predict(precheckResult.landmarks);
            if (gaze && window.handleGazeUpdate) {
                window.handleGazeUpdate(gaze);
            }
        }

        const eyeSignal = extractEyeSignalSample(precheckResult, Date.now());
        if (eyeSignal && window.handleEyeSignalUpdate) {
            window.handleEyeSignalUpdate(eyeSignal);
        }

        cognitiveSegmenterThrottleCounter++;
        if (cognitiveSegmenterThrottleCounter >= 3) {
            cognitiveSegmenterThrottleCounter = 0;
            if (!cognitiveSegmenterInFlight && state.runtime.faceSegmenter && precheckResult && precheckResult.landmarks) {
                cognitiveSegmenterInFlight = true;
                state.runtime.faceSegmenter.segmentFrame(cognitiveVideo, precheckResult.landmarks)
                    .then((segmenterResult) => {
                        cognitiveLastSegmenterResult = segmenterResult;
                    })
                    .catch((segmenterError) => {
                        console.warn('[Cognitive] Ошибка сегментации:', segmenterError);
                    })
                    .finally(() => {
                        cognitiveSegmenterInFlight = false;
                    });
            }
        }

        if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
            state.runtime.qcMetrics.processFrame(precheckResult, cognitiveLastSegmenterResult);
            // Фаза 1.2: overlay при низком QC / потере лица
            const metrics = state.runtime.qcMetrics.getCurrentMetrics();
            qcOverlayUpdateFromMetrics(metrics, precheckResult);
            handleQcPauseState(isQcOverlayVisible());
        }
        // Фаза 1.3: сэмплы эмоций (заглушка valence/arousal)
        const emotionSample = getEmotionSample(precheckResult);
        appendEmotionSample(state, emotionSample, Date.now(), getRelativeSessionTimeMs());
        const cogEmoHud = document.getElementById('cognitiveEmotionHud');
        if (cogEmoHud && emotionSample) {
            const lang = state.currentLang || 'ru';
            const ek = 'emotion_' + String(emotionSample.dominant || 'neutral');
            const name = translations[lang]?.[ek] || emotionSample.dominant || 'neutral';
            const lab = translations[lang]?.hub_emotion_label || 'Emotion';
            const v = Number.isFinite(emotionSample.valence) ? emotionSample.valence.toFixed(2) : '?';
            const a = Number.isFinite(emotionSample.arousal) ? emotionSample.arousal.toFixed(2) : '?';
            cogEmoHud.textContent = `${lab}: ${name} (v ${v}, a ${a})`;
        }
    } catch (e) {
        console.warn('[Cognitive] Ошибка анализа:', e);
    }

    const elapsed = performance.now() - tickStart;
    const nextDelay = Math.max(0, TARGET_LOOP_INTERVAL_MS - elapsed);
    scheduleCognitiveAnalysisTick(nextDelay);
}

function startCognitiveAnalysisLoop() {
    if (isContinuousSessionAnalysisRunning()) {
        console.log('[Cognitive] Используется непрерывный session analysis loop');
        return;
    }
    if (state.runtime._cognitiveLoopActive) return;

    cognitiveVideo = document.getElementById('precheckVideo');
    if (!(cognitiveVideo && cognitiveVideo.srcObject && state.runtime.localAnalyzer)) {
        console.warn('[Cognitive] analysis loop не запущен: нет video/localAnalyzer');
        return;
    }

    cognitiveLoopLastVideoTime = -1;
    cognitiveSegmenterThrottleCounter = 0;
    cognitiveSegmenterInFlight = false;
    cognitiveLastSegmenterResult = null;

    state.runtime._cognitiveLoopActive = true;
    scheduleCognitiveAnalysisTick(0);
    console.log('[Cognitive] Single-flight цикл анализа запущен (gaze + eye-signal + QC)');
}

function emitStimulusOffIfNeeded(rtMs, reason) {
    if (!activeTrialRuntime || activeTrialRuntime.stimulusOff) return;
    activeTrialRuntime.stimulusOff = true;
    emitTaskEvent('stimulus_off', {
        reason,
        rtMs: Number.isFinite(rtMs) ? Math.round(rtMs) : null
    });
}

function finishCognitiveTask(reason = 'completed', errorMessage = null) {
    if (cognitiveFinished) return;
    cognitiveFinished = true;

    cleanupTrial();
    resetStimulusViews();

    if (ex_state.task?.fixation) ex_state.task.fixation.style.display = 'none';
    if (ex_state.task?.feedback) ex_state.task.feedback.style.display = 'none';

    stopCognitiveAnalysisLoop();
    hideQcOverlay();
    const cogEmoClear = document.getElementById('cognitiveEmotionHud');
    if (cogEmoClear) cogEmoClear.textContent = '';

    if (reason === 'error') {
        recordSessionEvent('cognitive_task_error', {
            reason,
            message: errorMessage || null
        });
    } else {
        recordSessionEvent('cognitive_task_complete', {
            blocksProcessed: currentBlockIndex,
            trialResults: state.sessionData.cognitiveResults.length
        });
    }

    clearTaskContext();
    const payload = {
        reason,
        errorMessage: errorMessage || null,
        trialResults: state.sessionData.cognitiveResults.length,
        blocksProcessed: currentBlockIndex
    };

    if (cognitiveTaskOptions.autoFinishSession !== false) {
        setSessionPhase('final', { source: 'finishCognitiveTask' });
        console.log('[Cognitive] Задача завершена');
        finishSession();
        cognitiveTaskOptions = { autoFinishSession: true, onComplete: null };
    } else {
        setSessionPhase('cognitive_instruction', { source: 'finishCognitiveTask_return' });
        console.log('[Cognitive] Задача завершена, возврат в Test Hub');
        if (typeof cognitiveTaskOptions.onComplete === 'function') {
            cognitiveTaskOptions.onComplete(payload);
        }
        cognitiveTaskOptions = { autoFinishSession: true, onComplete: null };
    }
}

export async function loadAndStartCognitiveTask(options = {}) {
    console.log('[Cognitive] Инициализация задачи...');
    cognitiveTaskOptions = {
        autoFinishSession: options.autoFinishSession !== false,
        onComplete: typeof options.onComplete === 'function' ? options.onComplete : null
    };

    cognitiveFinished = false;
    clearTaskContext();

    try {
        if (state.runtime?.invitationProtocolDefinition) {
            experimentProtocol = ensureSessionQualityInstruction(normalizeProtocolDefinition(
                definitionForCognitiveRunner(state.runtime.invitationProtocolDefinition)
            ));
        } else {
            const response = await fetch('./experiment.json');
            if (!response.ok) throw new Error('Файл experiment.json не найден');
            experimentProtocol = ensureSessionQualityInstruction(await response.json());
        }
        const runtime = getSessionRuntime();
        const protocolBlocks = Array.isArray(experimentProtocol?.blocks)
            ? experimentProtocol.blocks
            : [];
        const pendingRepeat = runtime?.machine?.snapshot?.().repeatQueue?.find(repeat =>
            protocolBlocks.some(block => String(block?.id || '') === String(repeat?.blockId || ''))
        ) || null;
        const repeatBlockIndex = pendingRepeat
            ? protocolBlocks.findIndex(block =>
                String(block?.id || '') === String(pendingRepeat.blockId)
            )
            : -1;
        if (!pendingRepeat) state.sessionData.cognitiveResults = [];
        state.sessionData.experimentMeta = {
            ...(state.sessionData.experimentMeta || {}),
            title: experimentProtocol?.title || null,
            version: experimentProtocol?.version || null,
            loadedAt: Date.now(),
            blockCount: Array.isArray(experimentProtocol?.blocks) ? experimentProtocol.blocks.length : 0
        };

        currentBlockIndex = repeatBlockIndex >= 0 ? repeatBlockIndex : 0;
        currentTrialIndex = 0;
        activeTrialRuntime = null;

        state.flags.isRecording = true;
        setSessionPhase('cognitive_instruction', { source: 'loadAndStartCognitiveTask' });
        recordSessionEvent('cognitive_task_start', {
            protocolTitle: state.sessionData.experimentMeta.title,
            protocolVersion: state.sessionData.experimentMeta.version,
            blockCount: state.sessionData.experimentMeta.blockCount
        });
        if (pendingRepeat) {
            await runtime.promptRepeat(pendingRepeat.blockId);
            recordSessionEvent('cognitive_task_resume_after_reload', {
                blockId: pendingRepeat.blockId,
                failedAttempt: pendingRepeat.failedAttempt,
                blockIndex: currentBlockIndex
            });
        }

        document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
        document.getElementById('step6').classList.add('active');

        startCognitiveAnalysisLoop();
        runNextBlock();
    } catch (e) {
        console.error('[Cognitive] Ошибка загрузки:', e);
        alert('Ошибка: не удалось загрузить протокол эксперимента.');
        finishCognitiveTask('error', String(e?.message || e));
    }
}

function runNextBlock() {
    if (!experimentProtocol || !Array.isArray(experimentProtocol.blocks)) {
        finishCognitiveTask('error', 'Некорректный формат experiment.json');
        return;
    }

    if (!experimentProtocol.blocks.length) {
        finishCognitiveTask('empty_protocol', 'No experiment blocks in invitation protocol');
        return;
    }

    if (currentBlockIndex >= experimentProtocol.blocks.length) {
        finishCognitiveTask();
        return;
    }

    const block = experimentProtocol.blocks[currentBlockIndex];
    console.log('[Cognitive] Переход к блоку:', block.id, 'Тип:', block.type);
    getSessionRuntime()?.enterInstruction({
        source: 'cognitive_block_instruction',
        blockId: block?.id || null,
        blockType: block?.type || 'unknown'
    });

    setTaskContext({
        blockId: block?.id ?? null,
        trialId: null,
        stimulusId: null,
        stimulusType: null,
        expectedResponse: null
    });

    emitTaskEvent('block_start', {
        blockIndex: currentBlockIndex,
        blockType: block?.type || 'unknown'
    });

    if (block.type === 'instruction' || block.type === 'instructions') {
        setSessionPhase('cognitive_instruction', { source: 'instruction_block' });
        showInstructions(block);
        return;
    }

    if (block.type === 'cognitive_task') {
        setSessionPhase('cognitive_instruction', { source: 'task_block' });
        startTaskBlock(block);
        return;
    }

    emitTaskEvent('block_skip', {
        blockIndex: currentBlockIndex,
        blockType: block?.type || 'unknown'
    });
    currentBlockIndex++;
    runNextBlock();
}

function showInstructions(block) {
    ex_state.task.area.style.display = 'none';
    ex_state.instruction.container.style.display = 'block';

    ex_state.instruction.title.innerText = block.content?.title || 'Инструкция';
    ex_state.instruction.text.innerText = block.content?.text || '';
    ex_state.instruction.btn.innerText = block.content?.buttonText || 'Далее';

    const checkbox = document.getElementById('cogCheck');
    const checkContainer = document.getElementById('cogCheckContainer');
    const btn = ex_state.instruction.btn;

    if (checkbox) checkbox.checked = false;

    if (block.id === 'instruction') {
        checkContainer.style.display = 'block';
        btn.disabled = true;
    } else {
        checkContainer.style.display = 'none';
        btn.disabled = false;
    }

    if (checkbox) {
        checkbox.onchange = (e) => {
            btn.disabled = !e.target.checked;
        };
    }

    btn.onclick = (e) => {
        e.preventDefault();
        emitTaskEvent('block_end', {
            blockIndex: currentBlockIndex,
            blockType: block?.type || 'instruction',
            reason: 'button_click'
        });
        currentBlockIndex++;
        runNextBlock();
    };
}

function buildTrialPlan(block) {
    const trials = Array.isArray(block?.trials) ? block.trials : [];
    return trials.map((trial, sourceIndex) => ({
        trial,
        sourceIndex,
        trialId: String(trial?.id || `trial_${sourceIndex + 1}`)
    }));
}

function trialQualityIssues(runtime, context) {
    const blockIssues = runtime?.getCurrentBlock()?.issues || [];
    const activeNow = runtime?.getActiveIssues?.() || [];
    return collectTrialQualityIssues({
        activeAtStart: context?.activeAtStart || [],
        blockIssues,
        issueStartIndex: context?.issueStartIndex || 0,
        activeNow
    });
}

function startTaskBlock(block, trialPlan = null) {
    ex_state.instruction.container.style.display = 'none';
    ex_state.task.area.style.display = 'flex';
    currentTrialIndex = 0;
    activeBlockTrialPlan = Array.isArray(trialPlan) && trialPlan.length
        ? trialPlan
        : buildTrialPlan(block);
    const sessionBlock = getSessionRuntime()?.beginBlock({
        blockId: block?.id || `cognitive_${currentBlockIndex}`,
        blockType: block?.type || 'cognitive_task'
    });
    currentBlockAttempt = sessionBlock?.attempt || 1;

    emitTaskEvent('task_block_ready', {
        blockIndex: currentBlockIndex,
        trialCount: activeBlockTrialPlan.length,
        totalTrialCount: Array.isArray(block?.trials) ? block.trials.length : 0,
        attempt: currentBlockAttempt
    });

    runTrial();
}

function runTrial() {
    const block = experimentProtocol.blocks[currentBlockIndex];
    const trials = activeBlockTrialPlan;

    if (currentTrialIndex >= trials.length) {
        emitTaskEvent('block_end', {
            blockIndex: currentBlockIndex,
            blockType: block?.type || 'cognitive_task',
            trialCount: trials.length,
            attempt: currentBlockAttempt
        });
        finishTaskBlockAttempt(block);
        return;
    }

    const planItem = trials[currentTrialIndex];
    const trial = planItem.trial;
    const config = block.blockConfig || {};
    const fixationDuration = config.fixation?.duration || 500;
    const stimulusDuration = config.stimulusDuration || 1000;

    const stimulusType = trial?.stimulus?.type || 'shape';
    const trialId = planItem.trialId;
    const runtime = getSessionRuntime();
    activeTrialQualityContext = {
        issueStartIndex: runtime?.getCurrentBlock()?.issues?.length || 0,
        activeAtStart: runtime?.getActiveIssues?.() || []
    };

    setTaskContext({
        blockId: block?.id ?? null,
        trialId,
        stimulusId: trial?.stimulus?.stimulusId ?? trialId,
        stimulusName: trial?.stimulus?.stimulusName ?? null,
        stimulusType,
        expectedResponse: trial?.correctResponse ?? null
    });

    emitTaskEvent('trial_start', {
        trialIndex: currentTrialIndex,
        condition: trial?.condition ?? null,
        fixationDuration,
        stimulusDuration
    });

    resetStimulusViews();
    ex_state.task.feedback.style.display = 'none';
    ex_state.task.fixation.style.display = 'block';
    setSessionPhase('cognitive_instruction', { source: 'trial_fixation' });
    trialPhase = 'fixation';
    fixationRemainingMs = fixationDuration;
    fixationStartPerf = performance.now();
    const responseMode = normalizeResponseMode(config, trial);
    responseCollector = new RtResponseCollector({
        mode: responseMode,
        target: document
    });
    responseCollector.startBaseline();

    pendingFixationCallback = () => {
        ex_state.task.fixation.style.display = 'none';
        renderStimulus(trial);

        const stimulusOnPerf = performance.now();
        activeTrialRuntime = {
            stimulusOnPerf,
            stimulusOnEpoch: Date.now(),
            stimulusOff: false,
            blockId: block?.id ?? null,
            trialId,
            qualityContext: activeTrialQualityContext
        };

        setSessionPhase('cognitive_stimulus', { source: 'stimulus_on' });
        const isGo = conditionToIsGo(trial?.condition);
        const rtWindowMs = config.rtWindow || config.stimulusDuration || 1000;
        emitTaskEvent('stimulus_on', {
            trialIndex: currentTrialIndex,
            trial_id: currentTrialIndex + 1,
            condition: trial?.condition ?? null,
            task_id: block?.taskType || block?.rt_task || null,
            stimulus_type: trial?.condition || stimulusType,
            expected_response: trial?.correctResponse ?? null,
            is_go: isGo,
            timeout_ms: rtWindowMs,
            response_mode: responseMode
        });

        let responded = false;
        trialPhase = 'stimulus';
        stimulusTimeoutRemainingMs = stimulusDuration;
        stimulusTimerStartPerf = performance.now();
        responseCollector.arm((decision) => {
            if (responded) return;
            responded = true;
            handleResponse(decision.rtMs, decision.response, decision);
        });

        pendingStimulusTimeoutCallback = () => {
            if (!responded) {
                responded = true;
                handleResponse(null, null, {
                    responseMode,
                    inputType: null,
                    decisionTimestampMs: null,
                    pointerSummary: responseCollector?.pointerSummary(null) || null
                });
            }
        };
        trialTimeout = setTimeout(pendingStimulusTimeoutCallback, stimulusDuration);
    };

    fixationTimeout = setTimeout(pendingFixationCallback, fixationDuration);
}

function handleResponse(rt, key, decision = {}) {
    cleanupTrial();

    const block = experimentProtocol.blocks[currentBlockIndex];
    const planItem = activeBlockTrialPlan[currentTrialIndex];
    const trial = planItem.trial;
    const config = block.blockConfig || {};
    const runtime = getSessionRuntime();
    const qualityIssues = trialQualityIssues(
        runtime,
        activeTrialRuntime?.qualityContext || activeTrialQualityContext
    );
    const qualityValid = qualityIssues.length === 0;

    const rtMs = Number.isFinite(rt) ? Math.round(rt) : null;
    emitStimulusOffIfNeeded(rtMs, key ? 'response' : 'timeout');

    emitTaskEvent('response', {
        key: key || null,
        responded: key !== null,
        rtMs,
        response_mode: decision.responseMode || normalizeResponseMode(config, trial),
        input_type: decision.inputType || null,
        decision_timestamp_ms: decision.decisionTimestampMs ?? null,
        pointer_summary: decision.pointerSummary || null
    });

    setSessionPhase('cognitive_instruction', { source: 'stimulus_off' });
    resetStimulusViews();

    const isCorrect = trial.correctResponse === key;

    state.sessionData.cognitiveResults.push({
        trialId: planItem.trialId,
        block: block.id,
        blockId: block.id,
        task_id: block?.taskType || block?.rt_task || null,
        stimulusId: trial?.stimulus?.stimulusId ?? planItem.trialId,
        stimulusType: trial?.stimulus?.type || 'shape',
        expectedResponse: trial.correctResponse ?? null,
        rt: rtMs,
        condition: trial.condition,
        response: key || null,
        responseMode: decision.responseMode || normalizeResponseMode(config, trial),
        inputType: decision.inputType || null,
        decisionTimestampMs: decision.decisionTimestampMs ?? null,
        pointerSummary: decision.pointerSummary || null,
        correct: isCorrect,
        attempt: currentBlockAttempt,
        qualityValid,
        qualityIssueCodes: qualityIssues.map(issue => issue.code),
        qualityIssues,
        sourceTrialIndex: planItem.sourceIndex,
        repeatSequenceIndex: currentTrialIndex,
        timestamp: Date.now()
    });

    emitTaskEvent('trial_end', {
        trialIndex: currentTrialIndex,
        condition: trial?.condition ?? null,
        key: key || null,
        rtMs,
        correct: isCorrect,
        qualityValid,
        qualityIssueCodes: qualityIssues.map(issue => issue.code)
    });

    activeTrialRuntime = null;
    activeTrialQualityContext = null;

    if (config.showFeedback) {
        ex_state.task.feedback.innerText = isCorrect ? '✓ Верно' : '✗ Ошибка';
        ex_state.task.feedback.style.color = isCorrect ? '#4CAF50' : '#F44336';
        ex_state.task.feedback.style.display = 'block';

        setTimeout(() => {
            ex_state.task.feedback.style.display = 'none';
            moveToNextTrial();
        }, 500);
    } else {
        moveToNextTrial();
    }
}

async function finishTaskBlockAttempt(block) {
    const runtime = getSessionRuntime();
    const blockId = String(block?.id || '');
    const attemptResults = state.sessionData.cognitiveResults.filter(result => (
        String(result?.blockId || '') === blockId
        && Number(result?.attempt) === Number(currentBlockAttempt)
    ));
    const {
        invalidResults,
        repeatTrialPlan,
        repeatItems
    } = buildTrialRepeatPlan(activeBlockTrialPlan, attemptResults);
    const invalidIds = new Set(invalidResults.map(result => String(result.trialId)));
    const decision = runtime?.completeBlock({
        success: true,
        reason: invalidResults.length ? 'trial_quality_issue' : null,
        repeatItems,
        repeatItemLabel: 'trial',
        totalItemCount: Array.isArray(block?.trials) ? block.trials.length : activeBlockTrialPlan.length
    }) || {
        repeatRequired: false,
        block: { attempt: currentBlockAttempt }
    };
    const attempt = decision.block?.attempt || currentBlockAttempt;

    if (decision.repeatRequired) {
        emitTaskEvent('block_repeat_required', {
            blockIndex: currentBlockIndex,
            blockType: block?.type || 'cognitive_task',
            failedAttempt: attempt,
            invalidTrialCount: invalidResults.length,
            repeatTrialIds: [...invalidIds]
        });
        if (attempt < MAX_COGNITIVE_BLOCK_ATTEMPTS && repeatTrialPlan.length) {
            await runtime.promptRepeat(blockId);
            startTaskBlock(block, repeatTrialPlan);
            return;
        }
        const abandonedRepeat = runtime?.discardRepeat(blockId);
        if (abandonedRepeat) await runtime.notifyRepeatLimit(abandonedRepeat);
    }

    activeBlockTrialPlan = [];
    currentBlockIndex++;
    runNextBlock();
}

function moveToNextTrial() {
    setTimeout(() => {
        currentTrialIndex++;
        runTrial();
    }, 200);
}

function cleanupTrial() {
    responseCollector?.dispose();
    responseCollector = null;

    if (fixationTimeout) {
        clearTimeout(fixationTimeout);
        fixationTimeout = null;
    }

    if (trialTimeout) {
        clearTimeout(trialTimeout);
        trialTimeout = null;
    }

    trialPhase = 'idle';
    fixationStartPerf = null;
    fixationRemainingMs = 0;
    pendingFixationCallback = null;
    stimulusTimeoutRemainingMs = 0;
    stimulusTimerStartPerf = null;
    pendingStimulusTimeoutCallback = null;
    activeTrialQualityContext = null;
}
