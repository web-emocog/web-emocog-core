import {
    state,
    ex_state,
    setSessionPhase,
    recordSessionEvent,
    setTaskContext,
    clearTaskContext
} from './state.js';
import { finishSession } from './tests.js';
import { extractEyeSignalSample } from './eye-signal.js';

const TARGET_LOOP_INTERVAL_MS = 33;
const SAME_FRAME_RETRY_MS = 8;

let experimentProtocol = null;
let currentBlockIndex = 0;
let currentTrialIndex = 0;
let fixationTimeout = null;
let trialTimeout = null;
let responseHandler = null;
let activeTrialRuntime = null;
let cognitiveFinished = false;

let cognitiveVideo = null;
let cognitiveLoopLastVideoTime = -1;
let cognitiveSegmenterThrottleCounter = 0;
let cognitiveSegmenterInFlight = false;
let cognitiveLastSegmenterResult = null;

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
        }
    } catch (e) {
        console.warn('[Cognitive] Ошибка анализа:', e);
    }

    const elapsed = performance.now() - tickStart;
    const nextDelay = Math.max(0, TARGET_LOOP_INTERVAL_MS - elapsed);
    scheduleCognitiveAnalysisTick(nextDelay);
}

function startCognitiveAnalysisLoop() {
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
    setSessionPhase('final', { source: 'finishCognitiveTask' });

    console.log('[Cognitive] Задача завершена');
    finishSession();
}

export async function loadAndStartCognitiveTask() {
    console.log('[Cognitive] Инициализация задачи...');

    cognitiveFinished = false;
    clearTaskContext();

    try {
        const response = await fetch('./experiment.json');
        if (!response.ok) throw new Error('Файл experiment.json не найден');

        experimentProtocol = await response.json();
        state.sessionData.cognitiveResults = [];
        state.sessionData.experimentMeta = {
            ...(state.sessionData.experimentMeta || {}),
            title: experimentProtocol?.title || null,
            version: experimentProtocol?.version || null,
            loadedAt: Date.now(),
            blockCount: Array.isArray(experimentProtocol?.blocks) ? experimentProtocol.blocks.length : 0
        };

        currentBlockIndex = 0;
        currentTrialIndex = 0;
        activeTrialRuntime = null;

        state.flags.isRecording = true;
        setSessionPhase('cognitive_instruction', { source: 'loadAndStartCognitiveTask' });
        recordSessionEvent('cognitive_task_start', {
            protocolTitle: state.sessionData.experimentMeta.title,
            protocolVersion: state.sessionData.experimentMeta.version,
            blockCount: state.sessionData.experimentMeta.blockCount
        });

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

    if (currentBlockIndex >= experimentProtocol.blocks.length) {
        finishCognitiveTask();
        return;
    }

    const block = experimentProtocol.blocks[currentBlockIndex];
    console.log('[Cognitive] Переход к блоку:', block.id, 'Тип:', block.type);

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

function startTaskBlock(block) {
    ex_state.instruction.container.style.display = 'none';
    ex_state.task.area.style.display = 'flex';
    currentTrialIndex = 0;

    emitTaskEvent('task_block_ready', {
        blockIndex: currentBlockIndex,
        trialCount: Array.isArray(block?.trials) ? block.trials.length : 0
    });

    runTrial();
}

function runTrial() {
    const block = experimentProtocol.blocks[currentBlockIndex];
    const trials = Array.isArray(block?.trials) ? block.trials : [];

    if (currentTrialIndex >= trials.length) {
        emitTaskEvent('block_end', {
            blockIndex: currentBlockIndex,
            blockType: block?.type || 'cognitive_task',
            trialCount: trials.length
        });
        currentBlockIndex++;
        runNextBlock();
        return;
    }

    const trial = trials[currentTrialIndex];
    const config = block.blockConfig || {};
    const fixationDuration = config.fixation?.duration || 500;
    const stimulusDuration = config.stimulusDuration || 1000;

    const stimulusType = trial?.stimulus?.type || 'shape';
    const trialId = trial?.id || `trial_${currentTrialIndex + 1}`;

    setTaskContext({
        blockId: block?.id ?? null,
        trialId,
        stimulusId: trialId,
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

    fixationTimeout = setTimeout(() => {
        ex_state.task.fixation.style.display = 'none';
        renderStimulus(trial);

        const stimulusOnPerf = performance.now();
        activeTrialRuntime = {
            stimulusOnPerf,
            stimulusOnEpoch: Date.now(),
            stimulusOff: false,
            blockId: block?.id ?? null,
            trialId
        };

        setSessionPhase('cognitive_stimulus', { source: 'stimulus_on' });
        emitTaskEvent('stimulus_on', {
            trialIndex: currentTrialIndex,
            condition: trial?.condition ?? null
        });

        let responded = false;
        responseHandler = (e) => {
            if (e.code === 'Space' && !responded) {
                responded = true;
                handleResponse(performance.now() - stimulusOnPerf, 'Space');
            }
        };
        document.addEventListener('keydown', responseHandler);

        trialTimeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                handleResponse(null, null);
            }
        }, stimulusDuration);
    }, fixationDuration);
}

function handleResponse(rt, key) {
    cleanupTrial();

    const block = experimentProtocol.blocks[currentBlockIndex];
    const trial = block.trials[currentTrialIndex];
    const config = block.blockConfig || {};

    const rtMs = Number.isFinite(rt) ? Math.round(rt) : null;
    emitStimulusOffIfNeeded(rtMs, key ? 'response' : 'timeout');

    emitTaskEvent('response', {
        key: key || null,
        responded: key !== null,
        rtMs
    });

    setSessionPhase('cognitive_instruction', { source: 'stimulus_off' });
    resetStimulusViews();

    const isCorrect = trial.correctResponse === key;

    state.sessionData.cognitiveResults.push({
        trialId: trial.id,
        block: block.id,
        blockId: block.id,
        stimulusId: trial.id,
        stimulusType: trial?.stimulus?.type || 'shape',
        expectedResponse: trial.correctResponse ?? null,
        rt: rtMs,
        condition: trial.condition,
        response: key || null,
        correct: isCorrect,
        timestamp: Date.now()
    });

    emitTaskEvent('trial_end', {
        trialIndex: currentTrialIndex,
        condition: trial?.condition ?? null,
        key: key || null,
        rtMs,
        correct: isCorrect
    });

    activeTrialRuntime = null;

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

function moveToNextTrial() {
    setTimeout(() => {
        currentTrialIndex++;
        runTrial();
    }, 200);
}

function cleanupTrial() {
    if (responseHandler) {
        document.removeEventListener('keydown', responseHandler);
        responseHandler = null;
    }

    if (fixationTimeout) {
        clearTimeout(fixationTimeout);
        fixationTimeout = null;
    }

    if (trialTimeout) {
        clearTimeout(trialTimeout);
        trialTimeout = null;
    }
}