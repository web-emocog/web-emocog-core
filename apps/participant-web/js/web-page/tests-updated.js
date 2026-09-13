import {
    state,
    setSessionPhase,
    recordSessionEvent,
    clearTaskContext,
    getRelativeSessionTimeMs
} from './state.js';
import { translations } from '../../translations.js?v=20260913-2';
import { updateFinalStepWithQC, nextStep } from './ui-updated.js?v=20260913-2';
import { stopPreCheck } from './precheck-updated.js?v=20260909-1';
import { startCameraFpsMonitor, stopCameraFpsMonitor, getAverageCameraFps } from './camera.js';
import { loadAndStartCognitiveTask } from './experimental_task-updated.js?v=20260913-2';
import {
    deriveInvitationHubMetrics,
    definitionForCognitiveRunner,
    getInvitationSessionPlan
} from './protocol-invite-utils.js';
import { buildHeatmaps } from './heatmap.js';
import { buildAttentionMetrics } from '../gaze-tracker/attention-metrics.js';
import {
    runProtocolTestSequence,
    startTestHub
} from '../gaze-tracker/gaze-tests/index.js?v=20260913-2';
import { DEFAULT_THRESHOLDS } from '../qc-metrics/constants.js';
import { extractEyeSignalSample } from './eye-signal.js';
import { updateFromMetrics as qcOverlayUpdateFromMetrics } from '../qc-pause-overlay-new.js';
import { hide as hideQcOverlay, resetFaceLostTimer } from '../qc-pause-overlay-new.js';
import { setAutoPauseStimulus, getConfig as getQcPauseConfig } from '../qc-pause-overlay-new.js';
import { getEmotionSample, appendEmotionSample, resetEmotionWiringState } from '../emotion-stub-new.js';
import { buildAggregatesPayload } from '../unified-aggregates-new.js?v=20260828-2';
import { sendSessionFeature } from '../session-runtime/ingest-transport.mjs?v=20260807-1';
import {
    getContentViewport,
    targetCenterInContentViewport
} from '../gaze-tracker/viewport-coordinates.mjs';

import {
    applyResidualBiasCorrection,
    evaluateIndependentCorrectionBenchmark,
    evaluateResidualBiasLOOCV,
    fitResidualBias,
    shouldApplyResidualBiasCorrection
} from '../gaze-tracker/bias-correction.mjs';
import {
    getSessionRuntime,
    isContinuousSessionAnalysisRunning
} from '../session-runtime/index.js?v=20260913-2';
import {
    setHeadPoseGuideMode,
    setCalibrationGuideTarget,
    showCalibrationHeadPoseGuide
} from '../gaze-tracker/head-pose-guide.js?v=20260909-1';

function participantMessage(key, replacements = {}) {
    const pack = translations[state.currentLang] || translations.en;
    let value = String(pack[key] || translations.en[key] || key);
    Object.entries(replacements).forEach(([name, replacement]) => {
        value = value.replaceAll(`{${name}}`, String(replacement));
    });
    return value;
}

function dbg(scope, event, data) {
    try {
        const d = window.WECOG_DEBUG;
        if (d && d.enabled) d.log(scope, event, data);
    } catch (_) { /* ignore */ }
}

function dbgErr(scope, event, data) {
    try {
        const d = window.WECOG_DEBUG;
        if (d && d.enabled) d.error(scope, event, data);
    } catch (_) { /* ignore */ }
}

let _qcOverlayLogN = 0;
let _trackingQcLogN = 0;

function summarizeRespirationForDebug(sessionData) {
    const runs = Array.isArray(sessionData?.respirationRuns) ? sessionData.respirationRuns : [];
    const bpmRuns = Array.isArray(sessionData?.bpmRuns) ? sessionData.bpmRuns : [];
    const fromRuns = runs.map((r) => r?.respRateMean).filter(Number.isFinite);
    const fromBpm = [];
    bpmRuns.forEach((run) => {
        const rows = run?.rppgSession?.samples;
        if (!Array.isArray(rows)) return;
        rows.forEach((s) => {
            if (Number.isFinite(s?.resp_rate)) fromBpm.push(s.resp_rate);
        });
    });
    const all = fromRuns.length ? fromRuns : fromBpm;
    const mean = all.length ? all.reduce((a, v) => a + v, 0) / all.length : null;
    const min = all.length ? Math.min(...all) : null;
    const max = all.length ? Math.max(...all) : null;
    return {
        resp_rate_mean: mean != null ? Math.round(mean * 10) / 10 : null,
        resp_rate_min: min != null ? Math.round(min * 10) / 10 : null,
        resp_rate_max: max != null ? Math.round(max * 10) / 10 : null,
        resp_sample_count: all.length,
        resp_available: all.length > 0,
        source: fromRuns.length ? 'respirationRuns' : (fromBpm.length ? 'bpmRuns.rppgSession.samples' : null)
    };
}

const TARGET_LOOP_INTERVAL_MS = 33;
const SAME_FRAME_RETRY_MS = 8;
let trackingTestOptions = null;

function formatEmotionHudLine(sample) {
    if (!sample) return '';
    const lang = state.currentLang || 'ru';
    const key = 'emotion_' + String(sample.dominant || 'neutral');
    const name = translations[lang]?.[key] || sample.dominant || 'neutral';
    const label = translations[lang]?.hub_emotion_label || 'Emotion';
    const v = Number.isFinite(sample.valence) ? sample.valence.toFixed(2) : '?';
    const a = Number.isFinite(sample.arousal) ? sample.arousal.toFixed(2) : '?';
    return `${label}: ${name} (v ${v}, a ${a})`;
}
function ensureUploadStatusElement() {
    const finalStep = document.getElementById('step7');
    if (!finalStep) return null;
    let el = document.getElementById('uploadStatus');
    if (!el) {
        el = document.createElement('div');
        el.id = 'uploadStatus';
        el.style.margin = '12px 0 14px 0';
        el.style.fontSize = '14px';
        el.style.color = 'var(--text-secondary, #64748B)';
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn && downloadBtn.parentNode === finalStep) {
            finalStep.insertBefore(el, downloadBtn);
        } else {
            finalStep.appendChild(el);
        }
    }
    return el;
}

function ensureUploadRetryButton() {
    const finalStep = document.getElementById('step7');
    if (!finalStep) return null;
    let button = document.getElementById('retryUploadBtn');
    if (button) return button;
    button = document.createElement('button');
    button.id = 'retryUploadBtn';
    button.type = 'button';
    button.className = 'btn btn-secondary';
    button.style.display = 'none';
    button.textContent = participantMessage('runtime_upload_retry_action');
    button.addEventListener('click', () => {
        button.disabled = true;
        finishSession().finally(() => {
            button.disabled = false;
        });
    });
    const downloadBtn = document.getElementById('downloadBtn');
    finalStep.insertBefore(button, downloadBtn || null);
    return button;
}

function setUploadStatus(message, tone) {
    const el = ensureUploadStatusElement();
    if (!el) return;
    el.textContent = message;
    if (tone === 'error') {
        el.style.color = 'var(--error, #EF4444)';
    } else if (tone === 'success') {
        el.style.color = 'var(--success, #10B981)';
    } else {
        el.style.color = 'var(--text-secondary, #64748B)';
    }
    const retryButton = ensureUploadRetryButton();
    if (retryButton) retryButton.style.display = tone === 'error' ? '' : 'none';
}

async function uploadAggregatesWithRetry(payload, options = {}) {
    return sendSessionFeature(payload, {
        ...options,
        onAttempt: ({ attempt, retries }) => {
            setUploadStatus(participantMessage('runtime_upload_attempt', { attempt, retries }), 'info');
            recordSessionEvent('upload_attempt', { attempt, retries, endpoint: '/ingest' });
        },
        onRetry: ({ attempt, retries, delayMs, error }) => {
            recordSessionEvent('upload_retry', {
                attempt,
                retries,
                message: error?.message || String(error)
            });
            setUploadStatus(participantMessage('runtime_upload_retry_wait', {
                seconds: Math.round(delayMs / 1000)
            }), 'error');
        },
        onSuccess: ({ attempt, status }) => {
            recordSessionEvent('upload_success', { attempt, status });
            setUploadStatus(participantMessage('runtime_upload_success'), 'success');
        },
        onFailure: error => {
            recordSessionEvent('upload_failed', { message: error?.message || String(error) });
            console.error('[Final upload]', {
                message: error?.message || String(error),
                status: error?.httpStatus || null,
                payload: error?.payload || null
            });
            setUploadStatus(participantMessage('runtime_upload_failure'), 'error');
        }
    });
}

function getVideoTime(videoElement) {
    if (!videoElement || videoElement.readyState < 2) return -1;
    const t = videoElement.currentTime;
    return Number.isFinite(t) ? t : -1;
}

function buildTestHubHandlers() {
    return {
        runRTTest: () => new Promise(resolve => {
            const prevPause = getQcPauseConfig().autoPauseStimulus !== false;
            setAutoPauseStimulus(false);
            loadAndStartCognitiveTask({
                autoFinishSession: false,
                onComplete: (payload) => {
                    setAutoPauseStimulus(prevPause);
                    resolve(payload || {
                        trialResults: state.sessionData.cognitiveResults.length
                    });
                }
            });
        }),
        runTrackingTest: () => new Promise(resolve => {
            startTrackingTest({
                returnToHub: true,
                onComplete: (payload) => {
                    resolve(payload || {
                        trackingSamples: state.sessionData.trackingTest.length,
                        averageCameraFps: getAverageCameraFps()
                    });
                }
            });
        }),
        finishSession: async () => {
            await finishSession();
        }
    };
}

export async function continueInvitationSessionAfterShell() {
    const inviteDef = state.runtime?.invitationProtocolDefinition;
    const invitationCode = state.sessionData?.ids?.invitationCode
        || state.runtime?.invitationProtocolMeta?.code;
    state.flags.isRecording = true;
    const continuousStarted = await getSessionRuntime()?.startContinuousModules();
    if (continuousStarted !== true) {
        returnToMandatoryPreparation();
        return false;
    }

    if (!invitationCode && !inviteDef) {
        startTestHub(buildTestHubHandlers());
        return true;
    }

    if (invitationCode && !inviteDef) {
        recordSessionEvent('invitation_protocol_missing_after_shell', {
            category: 'technical',
            severity: 'error',
            invitationCode
        });
        loadAndStartCognitiveTask({
            protocol: {
                version: 'invalid-invitation',
                title: participantMessage('runtime_generic_technical'),
                blocks: []
            },
            autoFinishSession: false
        });
        return true;
    }

    const plan = inviteDef
        ? getInvitationSessionPlan(inviteDef)
        : {
            hubMetrics: state.runtime?.invitationSelectedMetrics || [],
            hasHub: Array.isArray(state.runtime?.invitationSelectedMetrics)
                && state.runtime.invitationSelectedMetrics.length > 0,
            runProtocolAfterShell: false
        };

    state.runtime.invitationSelectedMetrics = plan.hubMetrics;
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const step6 = document.getElementById('step6');
    if (step6) step6.classList.add('active');
    document.querySelector('.container').style.display = 'block';
    document.querySelector('.top-bar').style.display = 'flex';

    const hubHandlers = buildTestHubHandlers();

    if (plan.runProtocolAfterShell) {
        recordSessionEvent('invitation_auto_start_cognitive', {
            protocolId: state.runtime?.invitationProtocolMeta?.protocolId || null,
            hasHub: plan.hasHub
        });
        loadAndStartCognitiveTask({
            protocol: definitionForCognitiveRunner(inviteDef),
            autoFinishSession: !plan.hasHub,
            onComplete: plan.hasHub
                ? () => runProtocolTestSequence(plan.hubMetrics, hubHandlers)
                : undefined
        });
        return;
    }

    if (plan.hasHub) {
        runProtocolTestSequence(plan.hubMetrics, hubHandlers);
        return;
    }

    recordSessionEvent('invitation_protocol_empty', {
        category: 'technical',
        severity: 'error',
        invitationCode
    });
    loadAndStartCognitiveTask({
        protocol: definitionForCognitiveRunner(inviteDef),
        autoFinishSession: false
    });
}

function returnToMandatoryPreparation() {
    state.flags.isRecording = false;
    document.getElementById('fullscreenCalibration')?.classList.remove('active');
    const container = document.querySelector('.container');
    const topBar = document.querySelector('.top-bar');
    if (container) container.style.display = '';
    if (topBar) topBar.style.display = '';
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    document.getElementById('step5')?.classList.add('active');
    const precheck = document.getElementById('precheckContainer');
    const start = document.getElementById('startPrecheckBtn');
    if (precheck) precheck.style.display = '';
    if (start) {
        start.style.display = 'block';
        start.disabled = false;
    }
    recordSessionEvent('continuous_modules_recovery_to_precheck', {
        category: 'technical',
        severity: 'warning'
    });
}

function waitForCalibrationIntroduction(options = {}) {
    const intro = document.getElementById('calibrationIntro');
    const kicker = document.getElementById('calibrationIntroKicker');
    const title = document.getElementById('calibrationIntroTitle');
    const text = document.getElementById('calibrationIntroText');
    const button = document.getElementById('calibrationIntroStartBtn');
    if (!intro || !button) return Promise.resolve();

    const t = translations[state.currentLang] || translations.en;
    if (kicker) kicker.textContent = t.calib_progress;
    const targeted = options.targeted === true;
    if (title) {
        title.textContent = targeted ? t.calib_progress : t.runtime_instruction_title;
    }
    if (text) {
        text.textContent = targeted
            ? `${t.qc_failed_full} ${t.calib_click_instruction}`
            : (t.calibration_intro_body || t.calib_click_instruction);
    }
    button.textContent = targeted ? t.runtime_recalibrate : t.runtime_instruction_action;
    intro.hidden = false;
    requestAnimationFrame(() => button.focus());

    return new Promise((resolve) => {
        button.onclick = () => {
            button.onclick = null;
            intro.hidden = true;
            recordSessionEvent('calibration_instruction_acknowledged', {
                category: 'block'
            });
            resolve();
        };
    });
}

function normalizeCalibrationTargets(targets) {
    if (!Array.isArray(targets)) return [];
    const unique = new Map();
    for (const target of targets) {
        const x = Number(target?.x);
        const y = Number(target?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const normalized = {
            x: Math.max(5, Math.min(95, x)),
            y: Math.max(5, Math.min(95, y))
        };
        unique.set(`${normalized.x.toFixed(2)}:${normalized.y.toFixed(2)}`, normalized);
    }
    return [...unique.values()].slice(0, 6);
}

export function getWorstValidationTargets(points, viewport = getContentViewport(), limit = 4) {
    const width = Math.max(1, Number(viewport?.width) || 1);
    const height = Math.max(1, Number(viewport?.height) || 1);
    return (points || [])
        .map(pointData => {
            const samples = (pointData?.samples || []).filter(sample =>
                Number.isFinite(sample?.gazeX)
                && Number.isFinite(sample?.gazeY)
                && Number.isFinite(sample?.targetX)
                && Number.isFinite(sample?.targetY)
            );
            if (!samples.length) return null;
            const errorPx = samples.reduce((sum, sample) => (
                sum + Math.hypot(sample.gazeX - sample.targetX, sample.gazeY - sample.targetY)
            ), 0) / samples.length;
            const targetX = Number(pointData?.targetX ?? samples[0].targetX);
            const targetY = Number(pointData?.targetY ?? samples[0].targetY);
            return {
                x: Math.max(5, Math.min(95, targetX / width * 100)),
                y: Math.max(5, Math.min(95, targetY / height * 100)),
                errorPx: Math.round(errorPx * 10) / 10,
                validSamples: samples.length
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.errorPx - a.errorPx)
        .slice(0, Math.max(1, Math.min(6, Number(limit) || 4)));
}

export async function startCalibration(options = {}) {
    const targetedPositions = normalizeCalibrationTargets(options.targetedPositions);
    const targeted = targetedPositions.length > 0
        && state.runtime?.gazeTracker?.isCalibrated?.() === true;
    const shell = state.runtime?.invitationParticipantShell;
    if (shell && shell.calibration === false) {
        continueInvitationSessionAfterShell();
        return;
    }
    // Фаза 1.1: gate — не запускать калибровку, если pre-check не пройден
    if (state.sessionData.precheck && state.sessionData.precheck.pass_fail === false) {
        console.warn('[Phase1] Calibration blocked: precheck pass_fail is false');
        const msg = (translations[state.currentLang] && translations[state.currentLang].precheck_must_pass) || 'Complete pre-check successfully first.';
        if (typeof alert !== 'undefined') alert(msg);
        return;
    }
    console.log('Запуск калибровки на основе MediaPipe Face Landmarker...');
    setSessionPhase('calibration', { source: 'startCalibration' });
    recordSessionEvent(targeted ? 'calibration_targeted_start' : 'calibration_start', {
        targetCount: targeted ? targetedPositions.length : 25,
        repairAttempt: Number(options.repairAttempt) || 0
    });
    clearTaskContext();
    
    // Сохраняем данные pre-check (сохраняем pass_fail / fail_reason из Фазы 1.1)
    state.sessionData.precheck = {
        ...(state.sessionData.precheck || {}),
        ...(state.runtime.precheckData || {}),
        timestamp: Date.now(),
        videoResolution: {
            width: document.getElementById('precheckVideo')?.videoWidth,
            height: document.getElementById('precheckVideo')?.videoHeight
        }
    };
    
    // === ИНИЦИАЛИЗАЦИЯ QC METRICS ===
    // Ждём завершения dynamic import() ES-модуля ./qc-metrics/. Если он успешен —
    // window.QCMetrics будет реальным модульным классом; иначе остаётся inline-fallback.
    if (window.QCMetricsReady) {
        await window.QCMetricsReady;
        dbg('qc', 'module:ready:QCMetrics', { resolved: true });
    }
    const sessionViewport = getContentViewport();
    if (!targeted) {
        state.runtime.qcMetrics = new QCMetrics({
            screenWidth: sessionViewport.width,
            screenHeight: sessionViewport.height
        });
        state.runtime.qcMetrics.start();
        state.runtime.sessionStartTime = Date.now();
        console.log('[QC] QCMetrics инициализирован и запущен');
        dbg('qc', 'QCMetrics:instance:created', {});
    }

    // === ИНИЦИАЛИЗАЦИЯ GAZE TRACKER ===
    if (window.GazeTrackerReady) {
        await window.GazeTrackerReady;
        dbg('gaze', 'module:ready:GazeTracker', { resolved: true });
    }
    const contentViewport = sessionViewport;
    if (!targeted) {
        state.runtime.gazeTracker = new GazeTracker({
            screenWidth: contentViewport.width,
            screenHeight: contentViewport.height,
            onGazeUpdate: (gazeData) => {
                if (window.handleGazeUpdate) {
                    window.handleGazeUpdate(gazeData);
                }
            }
        });
        console.log('[GazeTracker] Инициализирован');
        dbg('gaze', 'GazeTracker:instance:created', {});
    } else {
        state.runtime.gazeTracker.clearPostCalibrationCorrection?.();
    }

    // Скрываем pre-check интерфейс
    document.getElementById('precheckContainer').style.display = 'none';
    document.getElementById('startPrecheckBtn').style.display = 'none';
    document.getElementById('startCalibBtn').style.display = 'none';
    
    if (state.flags.isPrecheckRunning) {
        stopPreCheck();
    }

    // С этого момента один frame pipeline ведёт gaze/blinks/emotion/BPM/body
    // без параллельных analyzeFrame loops. До камеры/пречека измерений нет.
    state.flags.isRecording = true;
    const continuousStarted = await getSessionRuntime()?.startContinuousModules();
    if (continuousStarted !== true) {
        returnToMandatoryPreparation();
        return;
    }
    
    // Показываем fullscreen калибровку
    const calibScreen = document.getElementById('fullscreenCalibration');
    const point = document.getElementById('fullscreenCalibPoint');
    const instructionText = document.getElementById('calibInstructionText');
    const progressText = document.getElementById('calibProgressText');
    const calibrationActions = document.getElementById('calibrationActions');
    const recalibrateButton = document.getElementById('recalibrateGazeBtn');
    const continueButton = document.getElementById('continueAfterValidationBtn');
    const validationIntro = document.getElementById('validationIntro');
    const validationIntroKicker = document.getElementById('validationIntroKicker');
    const validationIntroTitle = document.getElementById('validationIntroTitle');
    const validationIntroText = document.getElementById('validationIntroText');
    const validationIntroStartButton = document.getElementById('validationIntroStartBtn');
    const validationResult = document.getElementById('validationResult');
    const validationResultTitle = document.getElementById('validationResultTitle');
    const validationResultMetrics = document.getElementById('validationResultMetrics');
    const validationResultAdvice = document.getElementById('validationResultAdvice');
    if (calibrationActions) calibrationActions.style.display = 'none';
    if (validationIntro) validationIntro.hidden = true;
    if (validationResult) validationResult.hidden = true;
    if (recalibrateButton) recalibrateButton.onclick = null;
    if (continueButton) continueButton.onclick = null;
    
    // Скрываем контейнер и шапку
    document.querySelector('.container').style.display = 'none';
    document.querySelector('.top-bar').style.display = 'none';
    
    // Показываем отдельную инструкцию до появления первой измерительной точки.
    calibScreen.classList.add('active');
    point.style.display = 'none';
    showCalibrationHeadPoseGuide(true);
    const instructionPanel = instructionText?.closest('.calib-instruction');
    if (instructionPanel) instructionPanel.style.display = 'none';
    await waitForCalibrationIntroduction({ targeted });
    if (instructionPanel) instructionPanel.style.display = '';
    point.style.display = 'block';
    
    instructionText.innerText = translations[state.currentLang].calib_click_instruction;

    // Усиленная калибровка по ВСЕМУ экрану: 5×5 сетка (25 точек) в snake-порядке.
    // Snake-маршрут уменьшает длинные скачки глаз и делает фиксацию стабильнее.
    const fullCalibrationPositions = [
        { x: 5, y: 5 }, { x: 27.5, y: 5 }, { x: 50, y: 5 }, { x: 72.5, y: 5 }, { x: 95, y: 5 },
        { x: 95, y: 27.5 }, { x: 72.5, y: 27.5 }, { x: 50, y: 27.5 }, { x: 27.5, y: 27.5 }, { x: 5, y: 27.5 },
        { x: 5, y: 50 }, { x: 27.5, y: 50 }, { x: 50, y: 50 }, { x: 72.5, y: 50 }, { x: 95, y: 50 },
        { x: 95, y: 72.5 }, { x: 72.5, y: 72.5 }, { x: 50, y: 72.5 }, { x: 27.5, y: 72.5 }, { x: 5, y: 72.5 },
        { x: 5, y: 95 }, { x: 27.5, y: 95 }, { x: 50, y: 95 }, { x: 72.5, y: 95 }, { x: 95, y: 95 }
    ];
    const positions = targeted ? targetedPositions : fullCalibrationPositions;
    
    const video = document.getElementById('precheckVideo');
    let i = 0;
    const CLICKS_PER_POINT = targeted ? 3 : 2;
    const calibrationBuildTag = targeted
        ? 'calib-targeted-repair-v1'
        : 'calib-grid-5x5-v3-robustval';
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
    const screenDiag = Math.hypot(contentViewport.width, contentViewport.height);
    let previousTarget = null;
    const pointFailureCounts = new Array(positions.length).fill(0);
    
    const updatePoint = () => {
        point.style.left = `${positions[i].x}%`;
        point.style.top = `${positions[i].y}%`;
        setCalibrationGuideTarget(positions[i].x, positions[i].y);
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
                const target = targetCenterInContentViewport(point);
                if (!target) throw new Error('Calibration target has no viewport bounds');
                const screenX = target.x;
                const screenY = target.y;
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
                let lastResultTimestamp = -1;
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
                            const result = isContinuousSessionAnalysisRunning()
                                ? state.runtime.lastPrecheckResult
                                : await state.runtime.localAnalyzer.analyzeFrame(video);
                            if (
                                isContinuousSessionAnalysisRunning()
                                && Number.isFinite(result?.timestamp)
                                && result.timestamp === lastResultTimestamp
                            ) {
                                await new Promise(r => setTimeout(r, SAME_FRAME_RETRY_MS));
                                continue;
                            }
                            if (Number.isFinite(result?.timestamp)) lastResultTimestamp = result.timestamp;
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
                                // iris нормализован относительно глаз, а head pose проверяется отдельным OOD gate.
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
                    instructionText.innerText = `${translations[state.currentLang].tip_pose_unstable} ${translations[state.currentLang].calib_click_instruction}`;
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
            instructionText.innerText = `${participantMessage('runtime_generic_technical')} ${translations[state.currentLang].calib_click_instruction}`;
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
            recordSessionEvent(targeted ? 'calibration_targeted_complete' : 'calibration_complete', {
                calibrationPointCount: positions.length,
                clicksPerPoint: CLICKS_PER_POINT,
                repairAttempt: Number(options.repairAttempt) || 0
            });
            
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
            
            setTimeout(async () => {
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
    setSessionPhase('validation', { source: 'startGazeValidation' });
    setHeadPoseGuideMode('validation');
    const calibScreen = document.getElementById('fullscreenCalibration');
    const point = document.getElementById('fullscreenCalibPoint');
    const instructionText = document.getElementById('calibInstructionText');
    const progressText = document.getElementById('calibProgressText');
    const calibrationActions = document.getElementById('calibrationActions');
    const recalibrateButton = document.getElementById('recalibrateGazeBtn');
    const continueButton = document.getElementById('continueAfterValidationBtn');
    const validationIntro = document.getElementById('validationIntro');
    const validationIntroKicker = document.getElementById('validationIntroKicker');
    const validationIntroTitle = document.getElementById('validationIntroTitle');
    const validationIntroText = document.getElementById('validationIntroText');
    const validationIntroStartButton = document.getElementById('validationIntroStartBtn');
    const validationResult = document.getElementById('validationResult');
    const validationResultTitle = document.getElementById('validationResultTitle');
    const validationResultMetrics = document.getElementById('validationResultMetrics');
    const validationResultAdvice = document.getElementById('validationResultAdvice');
    if (calibrationActions) calibrationActions.style.display = 'none';
    
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
    const correctionPositions = [
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
    // Independent targets are never used to fit or select the correction.
    const benchmarkPositions = [
        { x: 30, y: 22 },
        { x: 70, y: 22 },
        { x: 22, y: 70 },
        { x: 78, y: 70 },
        { x: 50, y: 63 }
    ];
    recordSessionEvent('validation_start', {
        correctionPointCount: correctionPositions.length,
        benchmarkPointCount: benchmarkPositions.length
    });
    dbg('gaze', 'validation:start', {
        correctionPointCount: correctionPositions.length,
        benchmarkPointCount: benchmarkPositions.length,
        calibrationPointCount: state.sessionData?.gazeCalibration?.points?.length ?? null
    });
    
    const validationViewport = getContentViewport();
    const screenW = validationViewport.width;
    const screenH = validationViewport.height;
    
    let currentPoint = 0;
    let validationStage = 'correction';
    let activePositions = correctionPositions;
    let postCalibrationCorrection = {
        fitted: false,
        applied: false
    };
    let correctionStageResult = null;
    state.runtime.validationPoints = []; // Сброс
    state.runtime.validationBenchmarkPoints = [];
    state.flags.isValidating = true;
    state.runtime.gazeTracker?.clearPostCalibrationCorrection?.();
    
    const SAMPLES_PER_POINT = 30; // ~1 секунда при 30 FPS
    const SAMPLE_INTERVAL = 33; // ~30 FPS
    let currentSamples = [];
    let sampleCount = 0;
    let samplingInterval = null;
    let samplingDelayTimeout = null;
    let correctionTransitionStarted = false;
    let validationFinishStarted = false;
    
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

    if (!isContinuousSessionAnalysisRunning()
        && state.runtime.gazeTracker && state.runtime.gazeTracker.isCalibrated()
        && state.runtime.localAnalyzer && video && video.srcObject) {
        state.runtime._validationLoopActive = true;
        scheduleValidationPrediction(0);
        console.log('[Validation] Gaze prediction запущен');
    }
    
    function showNextPoint() {
        if (currentPoint >= activePositions.length) {
            if (validationStage === 'correction') {
                if (correctionTransitionStarted) return;
                correctionTransitionStarted = true;
                finishCorrectionStage();
            } else {
                if (validationFinishStarted) return;
                validationFinishStarted = true;
                stopValidationPredictionLoop();
                finishValidationSafely();
            }
            return;
        }
        
        const pos = activePositions[currentPoint];
        point.style.left = pos.x + '%';
        point.style.top = pos.y + '%';
        setCalibrationGuideTarget(pos.x, pos.y);
        const target = targetCenterInContentViewport(point);
        const targetX = target?.x ?? (pos.x / 100) * screenW;
        const targetY = target?.y ?? (pos.y / 100) * screenH;
        
        const stageName = validationStage === 'correction' ? 'LOOCV' : 'benchmark';
        progressText.innerText = `${stageName}: ${currentPoint + 1} ${translations[state.currentLang].point_of} ${activePositions.length}`;
        
        // Сброс семплов
        currentSamples = [];
        sampleCount = 0;
        
        // Небольшая задержка перед началом сбора (чтобы глаза успели перейти)
        samplingDelayTimeout = setTimeout(() => {
            samplingDelayTimeout = null;
            if (!state.flags.isValidating) return;
            // Начинаем сбор семплов
            samplingInterval = setInterval(() => {
                const prediction = state.runtime.currentGazePrediction;
                const signalX = validationStage === 'correction'
                    ? prediction?.rawX
                    : prediction?.correctedX;
                const signalY = validationStage === 'correction'
                    ? prediction?.rawY
                    : prediction?.correctedY;
                if (
                    prediction?.valid !== false
                    && Number.isFinite(signalX)
                    && Number.isFinite(signalY)
                ) {
                    currentSamples.push({
                        gazeX: signalX,
                        gazeY: signalY,
                        rawX: Number.isFinite(prediction.rawX) ? prediction.rawX : null,
                        rawY: Number.isFinite(prediction.rawY) ? prediction.rawY : null,
                        correctedX: Number.isFinite(prediction.correctedX) ? prediction.correctedX : null,
                        correctedY: Number.isFinite(prediction.correctedY) ? prediction.correctedY : null,
                        displayX: Number.isFinite(prediction.displayX) ? prediction.displayX : null,
                        displayY: Number.isFinite(prediction.displayY) ? prediction.displayY : null,
                        confidence: Number.isFinite(prediction.confidence) ? prediction.confidence : null,
                        ood: prediction.ood || null,
                        targetX: targetX,
                        targetY: targetY,
                        t: Date.now()
                    });
                }
                sampleCount++;
                
                if (sampleCount >= SAMPLES_PER_POINT) {
                    clearInterval(samplingInterval);
                    state.runtime.validationSamplingInterval = null;
                    
                    // Сохраняем результаты для этой точки
                    const targetCollection = validationStage === 'correction'
                        ? state.runtime.validationPoints
                        : state.runtime.validationBenchmarkPoints;
                    targetCollection.push({
                        pointIndex: currentPoint,
                        stage: validationStage,
                        targetX: targetX,
                        targetY: targetY,
                        samples: currentSamples,
                        timestamp: Date.now()
                    });
                    
                    currentPoint++;
                    showNextPoint();
                }
            }, SAMPLE_INTERVAL);
            state.runtime.validationSamplingInterval = samplingInterval;
        }, 500); // 500ms задержка перед сбором
    }

    function finishCorrectionStage() {
        try {
            const rawValidationPoints = state.runtime.validationPoints;
            const rawMetrics = calculateValidationMetrics(rawValidationPoints, validationViewport);
            const filteredValidation = filterValidationPointsForMetrics(rawValidationPoints, 0.8);
            const filteredValidationPoints = filteredValidation.points;
            const filteredMetrics = calculateValidationMetrics(
                filteredValidationPoints,
                validationViewport
            );
            postCalibrationCorrection = {
                fitted: false,
                applied: false,
                sampleFilter: filteredValidation.stats
            };

            const fittedCorrection = fitResidualBias(filteredValidationPoints, validationViewport);
            if (fittedCorrection) {
                const correctedPoints = applyResidualBiasCorrection(
                    filteredValidationPoints,
                    fittedCorrection
                );
                const correctedMetrics = calculateValidationMetrics(
                    correctedPoints,
                    validationViewport
                );
                const loocv = evaluateResidualBiasLOOCV(
                    filteredValidationPoints,
                    validationViewport
                );
                const shouldApply = correctedMetrics.accuracyPx <= filteredMetrics.accuracyPx
                    && shouldApplyResidualBiasCorrection(loocv);
                const correctionId = generateCorrectionId();
                postCalibrationCorrection = {
                    correctionId,
                    fitted: true,
                    applied: shouldApply,
                    source: fittedCorrection.source,
                    sampleCount: fittedCorrection.sampleCount,
                    kind: fittedCorrection.kind,
                    offsetX: Math.round(fittedCorrection.offsetX * 10) / 10,
                    offsetY: Math.round(fittedCorrection.offsetY * 10) / 10,
                    trajectory: fittedCorrection.trajectory,
                    rawMetrics,
                    filteredMetrics,
                    correctedInSampleMetrics: correctedMetrics,
                    loocv: loocv || { available: false }
                };
                if (shouldApply) {
                    state.runtime.gazeTracker?.setPostCalibrationCorrection?.({
                        ...fittedCorrection,
                        correctionId
                    });
                }
                dbg('gaze', 'loocv:evaluateResidualBiasLOOCV', {
                    applied: shouldApply,
                    loocvRmsHeldOutPx: loocv?.loocvRmsHeldOutPx ?? null,
                    rawTargetRmsPx: loocv?.rawTargetRmsPx ?? null,
                    worsenedTargetCount: loocv?.worsenedTargetCount ?? null,
                    targetCount: loocv?.targetCount ?? null
                });
            }

            correctionStageResult = {
                pointCount: rawValidationPoints.length,
                points: rawValidationPoints,
                rawMetrics,
                filteredMetrics,
                postCalibrationCorrection
            };
            recordSessionEvent('validation_correction_stage_complete', {
                correctionApplied: postCalibrationCorrection.applied,
                loocvRmsHeldOutPx:
                    postCalibrationCorrection.loocv?.loocvRmsHeldOutPx ?? null
            });
        } catch (error) {
            state.runtime.gazeTracker?.clearPostCalibrationCorrection?.();
            let rawMetrics = null;
            try {
                rawMetrics = calculateValidationMetrics(
                    state.runtime.validationPoints,
                    validationViewport
                );
            } catch (_) {
                rawMetrics = null;
            }
            postCalibrationCorrection = {
                fitted: false,
                applied: false,
                error: 'correction_calculation_failed'
            };
            correctionStageResult = {
                pointCount: state.runtime.validationPoints.length,
                points: state.runtime.validationPoints,
                rawMetrics,
                filteredMetrics: null,
                postCalibrationCorrection
            };
            recordSessionEvent('validation_correction_stage_failed', {
                category: 'technical',
                severity: 'warning',
                message: error?.message || String(error)
            });
            dbgErr('gaze', 'validation:correction-stage-failed', {
                message: error?.message || String(error)
            });
        }
        validationStage = 'benchmark';
        activePositions = benchmarkPositions;
        currentPoint = 0;
        currentSamples = [];
        sampleCount = 0;
        instructionText.innerText =
            translations[state.currentLang].validation_look_instruction;
        samplingDelayTimeout = setTimeout(() => {
            samplingDelayTimeout = null;
            showNextPoint();
        }, 500);
    }

    function pointsForSignal(points, xKey, yKey) {
        return (points || []).map(pointData => ({
            ...pointData,
            samples: (pointData.samples || []).map(sample => ({
                ...sample,
                gazeX: Number.isFinite(sample?.[xKey]) ? sample[xKey] : null,
                gazeY: Number.isFinite(sample?.[yKey]) ? sample[yKey] : null
            }))
        }));
    }

    function finishValidationSafely() {
        try {
            finishValidation();
        } catch (error) {
            state.flags.isValidating = false;
            if (state.runtime.validationSamplingInterval) {
                clearInterval(state.runtime.validationSamplingInterval);
                state.runtime.validationSamplingInterval = null;
            }
            if (samplingDelayTimeout) {
                clearTimeout(samplingDelayTimeout);
                samplingDelayTimeout = null;
            }
            stopValidationPredictionLoop();
            state.runtime.gazeTracker?.clearPostCalibrationCorrection?.();

            const technicalError = error?.message || String(error);
            state.sessionData.gazeValidation = {
                timestamp: Date.now(),
                coordinateSpace: 'content_viewport',
                targetBlindPrediction: true,
                correctionSet: correctionStageResult,
                benchmarkPoints: state.runtime.validationBenchmarkPoints,
                points: [],
                metrics: null,
                postCalibrationCorrection: {
                    ...postCalibrationCorrection,
                    applied: false,
                    error: 'validation_calculation_failed'
                },
                passed: false,
                technicalError
            };
            recordSessionEvent('validation_calculation_failed', {
                category: 'technical',
                severity: 'error',
                message: technicalError
            });
            dbgErr('gaze', 'validation:calculation-failed', { message: technicalError });

            instructionText.textContent = participantMessage('validation_complete');
            if (validationResultTitle) {
                validationResultTitle.textContent = participantMessage('validation_complete');
            }
            if (validationResultMetrics) {
                validationResultMetrics.textContent = state.currentLang === 'en'
                    ? 'Accuracy could not be calculated.'
                    : 'Точность не удалось рассчитать.';
            }
            if (validationResultAdvice) {
                validationResultAdvice.textContent = participantMessage('validation_result_failed_advice');
            }
            progressText.innerText = '';
            point.style.display = 'none';
            point.style.backgroundColor = '#DC2626';
            point.style.cursor = 'pointer';
            if (validationResult) validationResult.hidden = false;
            if (continueButton) continueButton.style.display = 'none';
            if (recalibrateButton) {
                recalibrateButton.style.display = '';
                recalibrateButton.textContent = participantMessage('runtime_recalibrate');
                recalibrateButton.onclick = () => {
                    if (calibrationActions) calibrationActions.style.display = 'none';
                    if (validationResult) validationResult.hidden = true;
                    startCalibration();
                };
            }
            if (calibrationActions) calibrationActions.style.display = 'flex';
        }
    }

    function finishValidation() {
        state.flags.isValidating = false;
        if (state.runtime.validationSamplingInterval) {
            clearInterval(state.runtime.validationSamplingInterval);
            state.runtime.validationSamplingInterval = null;
        }
        if (samplingDelayTimeout) {
            clearTimeout(samplingDelayTimeout);
            samplingDelayTimeout = null;
        }
        stopValidationPredictionLoop();
        state.runtime._validationGazeInterval = null;

        const benchmarkPoints = state.runtime.validationBenchmarkPoints;
        const filteredBenchmark = filterValidationPointsForMetrics(benchmarkPoints, 0.8);
        const correctedCandidatePoints = filteredBenchmark.points;
        const baselinePoints = pointsForSignal(correctedCandidatePoints, 'rawX', 'rawY');
        const displayPoints = pointsForSignal(correctedCandidatePoints, 'displayX', 'displayY');
        const correctedCandidateMetrics = calculateValidationMetrics(
            correctedCandidatePoints,
            validationViewport
        );
        const rawMetrics = calculateValidationMetrics(baselinePoints, validationViewport);
        const displayMetrics = calculateValidationMetrics(displayPoints, validationViewport);
        const independentDecision = postCalibrationCorrection.applied
            ? evaluateIndependentCorrectionBenchmark(rawMetrics, correctedCandidateMetrics)
            : { accepted: false, reason: 'correction_not_applied' };
        const useCorrected = postCalibrationCorrection.applied && independentDecision.accepted;
        const selectedPoints = useCorrected ? correctedCandidatePoints : baselinePoints;
        const metrics = useCorrected ? correctedCandidateMetrics : rawMetrics;
        const qcValidationSamples = flattenValidationSamples(selectedPoints);
        if (postCalibrationCorrection.applied && !useCorrected) {
            state.runtime.gazeTracker?.clearPostCalibrationCorrection?.();
            postCalibrationCorrection = {
                ...postCalibrationCorrection,
                applied: false,
                rolledBack: true,
                rollbackReason: independentDecision.reason,
                independentBenchmark: independentDecision
            };
            recordSessionEvent('validation_correction_rolled_back', {
                correctionId: postCalibrationCorrection.correctionId,
                reason: independentDecision.reason,
                accuracyGainPx: independentDecision.accuracyGainPx ?? null,
                precisionDeltaPx: independentDecision.precisionDeltaPx ?? null
            });
        } else {
            postCalibrationCorrection = {
                ...postCalibrationCorrection,
                independentBenchmark: independentDecision
            };
        }
        const baselineVsNew = {
            independent: true,
            targetsUsedForFit: 0,
            targetCount: correctedCandidatePoints.length,
            sampleFilter: filteredBenchmark.stats,
            baselineRaw: rawMetrics,
            candidateCorrected: correctedCandidateMetrics,
            selected: metrics,
            selectedSignal: useCorrected ? 'corrected' : 'raw',
            decision: independentDecision,
            displayOnly: displayMetrics,
            improvement: {
                accuracyPx: Number.isFinite(rawMetrics.accuracyPx)
                    ? rawMetrics.accuracyPx - correctedCandidateMetrics.accuracyPx
                    : null,
                precisionPx: Number.isFinite(rawMetrics.precisionPx)
                    ? rawMetrics.precisionPx - correctedCandidateMetrics.precisionPx
                    : null,
                accuracyPct: Number.isFinite(rawMetrics.accuracyPct)
                    ? rawMetrics.accuracyPct - correctedCandidateMetrics.accuracyPct
                    : null
            }
        };

        state.sessionData.gazeValidation = {
            timestamp: Date.now(),
            coordinateSpace: 'content_viewport',
            targetBlindPrediction: true,
            correctionSet: correctionStageResult,
            benchmarkPoints,
            points: selectedPoints,
            metrics,
            rawMetrics,
            correctedCandidateMetrics,
            displayMetrics,
            baselineVsNew,
            postCalibrationCorrection,
            passed:
                Number.isFinite(metrics.accuracyPct)
                && Number.isFinite(metrics.precisionPct)
                && metrics.accuracyPct <= DEFAULT_THRESHOLDS.gaze_accuracy_pct_max
                && metrics.precisionPct <= DEFAULT_THRESHOLDS.gaze_precision_pct_max
        };
        recordSessionEvent('validation_complete', {
            validationSampleCount: qcValidationSamples.length,
            accuracyPct: metrics.accuracyPct,
            precisionPct: metrics.precisionPct,
            biasXPct: metrics.biasXPct,
            biasYPct: metrics.biasYPct,
            baselineAccuracyPct: rawMetrics.accuracyPct,
            correctionApplied: postCalibrationCorrection.applied
        });
        
        console.log('[Validation] Результаты:', metrics);
        dbg('gaze', 'validation:end', {
            accuracyPct: metrics?.accuracyPct,
            precisionPct: metrics?.precisionPct,
            correctionApplied: !!postCalibrationCorrection?.applied,
            correctionId: postCalibrationCorrection?.correctionId || null
        });
        try {
            const d = window.WECOG_DEBUG;
            if (d?.setGazeCalibrationDiagnostics) {
                d.setGazeCalibrationDiagnostics({
                    postCalibrationApplied: !!postCalibrationCorrection?.applied,
                    loocvPass: postCalibrationCorrection?.applied === true,
                    loocvRejectedReason: postCalibrationCorrection && !postCalibrationCorrection.applied
                        ? (postCalibrationCorrection.rollbackReason || 'held_out_or_insufficient_gain')
                        : null,
                    accuracyPx: metrics?.accuracyPx ?? null,
                    validationRmsPx: metrics?.accuracyPx ?? null,
                    biasCorrectionStatus: postCalibrationCorrection?.correctionId ? 'fitted' : 'not_fitted',
                    calibrationStatus: state.runtime.gazeTracker?._isCalibrated ? 'calibrated' : 'unknown'
                });
            }
        } catch (_) { /* ignore */ }
        
        // === Передаём данные валидации в QCMetrics для accuracy/precision checks ===
        if (state.runtime.qcMetrics) {
            state.runtime.qcMetrics.setValidationData(qcValidationSamples);
        }
        
        const validationPassed = state.sessionData.gazeValidation.passed;
        const formatMetric = value => Number.isFinite(value) ? value.toFixed(1) : '—';
        instructionText.textContent = participantMessage('validation_complete');
        if (validationResultTitle) validationResultTitle.textContent = participantMessage('validation_complete');
        if (validationResultMetrics) {
            validationResultMetrics.textContent = [
                `${participantMessage('validation_accuracy')}: ${formatMetric(metrics.accuracyPx)}${participantMessage('pixels')} (${formatMetric(metrics.accuracyPct)}%)`,
                `${participantMessage('validation_precision')}: ${formatMetric(metrics.precisionPx)}${participantMessage('pixels')} (${formatMetric(metrics.precisionPct)}%)`
            ].join('\n');
        }
        if (validationResultAdvice) {
            validationResultAdvice.textContent = participantMessage(
                validationPassed ? 'validation_result_passed_advice' : 'validation_result_failed_advice'
            );
        }
        progressText.innerText = '';
        point.style.display = 'none';
        if (validationResult) validationResult.hidden = false;
        
        // Восстанавливаем стиль точки для будущего использования
        point.style.backgroundColor = '#DC2626';
        point.style.cursor = 'pointer';
        
        const proceedToProtocol = () => {
            if (calibrationActions) calibrationActions.style.display = 'none';
            if (validationResult) validationResult.hidden = true;
            if (recalibrateButton) recalibrateButton.onclick = null;
            if (continueButton) continueButton.onclick = null;
            calibScreen.classList.remove('active');
            showCalibrationHeadPoseGuide(false);
            state.runtime.validationRepairAttempt = 0;
            state.runtime.qcMetrics?.resetGazeAvailability?.();
            continueInvitationSessionAfterShell();
        };

        const worstTargets = getWorstValidationTargets(selectedPoints, validationViewport, 4);
        if (recalibrateButton) {
            recalibrateButton.textContent = participantMessage('runtime_recalibrate');
            recalibrateButton.onclick = () => {
                recordSessionEvent('validation_manual_recalibration', {
                    accuracyPct: metrics.accuracyPct,
                    precisionPct: metrics.precisionPct,
                    passed: validationPassed
                });
                if (calibrationActions) calibrationActions.style.display = 'none';
                if (validationResult) validationResult.hidden = true;
                const nextRepairAttempt = (Number(state.runtime.validationRepairAttempt) || 0) + 1;
                state.runtime.validationRepairAttempt = nextRepairAttempt;
                startCalibration(!validationPassed && worstTargets.length
                    ? { targetedPositions: worstTargets, repairAttempt: nextRepairAttempt }
                    : {});
            };
        }
        if (continueButton) {
            continueButton.style.display = validationPassed ? '' : 'none';
            continueButton.textContent = participantMessage('runtime_continue');
            continueButton.onclick = () => {
                recordSessionEvent('validation_continue_selected', {
                    accuracyPct: metrics.accuracyPct,
                    precisionPct: metrics.precisionPct,
                    passed: validationPassed
                });
                proceedToProtocol();
            };
        }
        if (recalibrateButton) recalibrateButton.style.display = '';
        if (calibrationActions) calibrationActions.style.display = 'flex';
    }
    
    if (validationIntro && validationIntroStartButton) {
        if (validationIntroKicker) validationIntroKicker.textContent = participantMessage('validation_intro_kicker');
        if (validationIntroTitle) validationIntroTitle.textContent = participantMessage('validation_intro_title');
        if (validationIntroText) validationIntroText.textContent = participantMessage('validation_intro_body');
        validationIntroStartButton.textContent = participantMessage('validation_intro_action');
        point.style.display = 'none';
        validationIntro.hidden = false;
        validationIntroStartButton.onclick = () => {
            validationIntroStartButton.onclick = null;
            validationIntro.hidden = true;
            point.style.display = 'block';
            recordSessionEvent('validation_instruction_acknowledged', { category: 'block' });
            showNextPoint();
        };
        requestAnimationFrame(() => validationIntroStartButton.focus());
    } else {
        point.style.display = 'block';
        showNextPoint();
    }
}

/**
 * Вычисляет метрики валидации: accuracy, precision, bias.
 * 
 * v2.0: Метрики в % диагонали экрана вместо ненадёжных градусов.
 * px→° зависит от размера монитора, разрешения и дистанции до экрана —
 * невозможно точно вычислить без калибровки расстояния.
 * % диагонали — универсальная метрика, не зависящая от разрешения.
 */
export function calculateValidationMetrics(points, viewport = getContentViewport()) {
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
    const screenW = viewport.width;
    const screenH = viewport.height;
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
            if (Number.isFinite(s.gazeX) && Number.isFinite(s.gazeY)) {
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

function generateCorrectionId() {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 6);
    return `corr_${t}_${r}`;
}

// --- ТЕСТ СЛЕЖЕНИЯ ЗА ФИГУРАМИ ---
export function startTrackingTest(options = {}) {
    trackingTestOptions = options || {};
    setSessionPhase('tracking_test', { source: 'startTrackingTest' });
    recordSessionEvent('tracking_test_start');
    clearTaskContext();
    hideQcOverlay();
    resetFaceLostTimer();
    if (!state.flags.isRecording) state.flags.isRecording = true;

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
            state.runtime.lastPrecheckResult = precheckResult;

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

            // 3b) Eye-signal sample (EAR / pupil proxy) для attention-метрик
            const eyeSignal = extractEyeSignalSample(precheckResult, Date.now());
            if (eyeSignal && window.handleEyeSignalUpdate) {
                window.handleEyeSignalUpdate(eyeSignal);
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
                // Фаза 1.2: overlay при низком QC / потере лица
                const metrics = state.runtime.qcMetrics.getCurrentMetrics();
                qcOverlayUpdateFromMetrics(metrics, precheckResult);
                if (window.WECOG_DEBUG && window.WECOG_DEBUG.enabled) {
                    _trackingQcLogN += 1;
                    if (_trackingQcLogN % 45 === 0) {
                        const overlay = window.qcPauseOverlay;
                        const cfg = overlay?.getConfig?.() || getQcPauseConfig();
                        dbg('qc', 'overlay:state', {
                            visible: overlay?.isVisible?.() ?? null,
                            qcScore: metrics?.qcScore,
                            illuminationOkPct: metrics?.illuminationOkPct,
                            faceDetected: precheckResult?.face?.detected,
                            thresholds: {
                                qcScoreThreshold: cfg.qcScoreThreshold,
                                faceLostSec: cfg.faceLostSec
                            },
                            frameAcceptable: precheckResult?.face?.detected !== false
                        });
                    }
                }
            }
            // Фаза 1.3: сэмплы эмоций (заглушка valence/arousal)
            const emotionSample = getEmotionSample(precheckResult);
            appendEmotionSample(state, emotionSample, Date.now(), getRelativeSessionTimeMs());
            const trackHud = document.getElementById('trackingEmotionHud');
            if (trackHud) trackHud.textContent = formatEmotionHudLine(emotionSample);
        } catch (e) {
            console.warn('[TrackingTest] Ошибка анализа:', e);
        }

        const elapsed = performance.now() - tickStart;
        const nextDelay = Math.max(0, TARGET_LOOP_INTERVAL_MS - elapsed);
        scheduleTrackingAnalysisTick(nextDelay);
    }

    if (!isContinuousSessionAnalysisRunning() && video && video.srcObject && state.runtime.localAnalyzer) {
        state.runtime._analysisLoopActive = true;
        const trackHud = document.getElementById('trackingEmotionHud');
        if (trackHud) trackHud.textContent = '';
        scheduleTrackingAnalysisTick(0);
        console.log('[TrackingTest] Single-flight цикл анализа запущен (gaze + QC)');
    }
    
    function runTrajectory() {
        if (currentTrajectory >= trajectories.length) {
            // Останавливаем анализ
            stopTrackingAnalysisLoop();
            stopCameraFpsMonitor();
            console.log(`[TrackingTest] CameraFPSMonitor остановлен. Средний FPS: ${getAverageCameraFps()}`);
            finishTrackingTest(trackingTestOptions);
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

export function finishTrackingTest(options = trackingTestOptions || {}) {
    // === Останавливаем analysis interval (если ещё работает) ===
    state.runtime._analysisLoopActive = false;
    if (state.runtime.analysisInterval) {
        clearTimeout(state.runtime.analysisInterval);
        state.runtime.analysisInterval = null;
        console.log('[TrackingTest] Analysis interval остановлен');
    }
    
    // === Останавливаем CameraFPSMonitor (если ещё работает) ===
    stopCameraFpsMonitor();
    if (state.runtime.qcMetrics && state.sessionData.trackingTest && state.sessionData.trackingTest.length > 0) {
        state.runtime.qcMetrics.setTrackingDeviationData(state.sessionData.trackingTest);
        const summary = state.runtime.qcMetrics.getSummary?.();
        const td = summary?.trackingDeviation;
        dbg('gaze', 'gaze_on_target:summary', {
            totalSamples: td?.sampleCount ?? state.sessionData.trackingTest.length,
            validSampleCount: td?.validSampleCount ?? null,
            gazeOnTargetPct: td?.onTargetPct ?? null,
            deviationPx: td?.deviationPx ?? null
        });
    }
    hideQcOverlay();
    dbg('qc', 'overlay:hidden', { source: 'finishTrackingTest' });
    const trackEmoHud = document.getElementById('trackingEmotionHud');
    if (trackEmoHud) trackEmoHud.textContent = '';

    const testArea = document.getElementById('trackingTestArea');
    const progressText = document.getElementById('testProgressText');
    const customDot = document.getElementById('customGazeDot');
    
    progressText.innerText = translations[state.currentLang].test_complete;
    
    setTimeout(() => {
        testArea.classList.remove('active');

        document.querySelector('.container').style.display = 'block'; 
        document.querySelector('.top-bar').style.display = 'flex';
        customDot.style.display = 'none';

        recordSessionEvent('tracking_test_complete', {
            trackingSamples: state.sessionData.trackingTest.length,
            averageCameraFps: getAverageCameraFps()
        });

        const completionPayload = {
            trackingSamples: state.sessionData.trackingTest.length,
            averageCameraFps: getAverageCameraFps()
        };

        if (typeof options.onComplete === 'function') {
            options.onComplete(completionPayload);
            trackingTestOptions = null;
            return;
        }

        // Запускаем когнитивный контур (backward-compatible поведение)
        setSessionPhase('cognitive_instruction', { source: 'finishTrackingTest' });
        loadAndStartCognitiveTask();
        trackingTestOptions = null;
    }, 1500);
}

let finishSessionPromise = null;

function stopSessionMediaResources() {
    const stream = state.runtime.cameraStream;
    state.runtime.cameraStream = null;
    for (const track of stream?.getTracks?.() || []) {
        try { track.stop(); } catch (_) {}
    }
    for (const videoId of ['precheckVideo', 'bpmVideo']) {
        const video = document.getElementById(videoId);
        if (!video) continue;
        try { video.pause(); } catch (_) {}
        try { video.srcObject = null; } catch (_) {}
    }
    if (state.runtime.faceSegmenter?.dispose) {
        try { state.runtime.faceSegmenter.dispose(); } catch (_) {}
    }
    state.runtime.faceSegmenter = null;
    if (state.runtime.localAnalyzer?.dispose) {
        try { state.runtime.localAnalyzer.dispose(); } catch (_) {}
    }
    state.runtime.localAnalyzer = null;
}

export function finishSession() {
    showCalibrationHeadPoseGuide(false);
    if (finishSessionPromise) return finishSessionPromise;
    const runtime = getSessionRuntime();
    if (runtime?.machine?.state === 'completed') {
        if (state.sessionData.upload?.ok === true) {
            return Promise.resolve({ ...state.sessionData.upload, idempotent: true });
        }
        finishSessionPromise = retryFinalUpload(runtime);
    } else {
        finishSessionPromise = finishSessionOnce();
    }
    finishSessionPromise = finishSessionPromise
        .then(result => {
            // Keep only in-flight calls deduplicated. Later calls must execute the
            // explicit completed/idempotent branch without another network write.
            finishSessionPromise = null;
            return result;
        })
        .catch(error => {
            stopSessionMediaResources();
            runtime?.failFinish(error);
            finishSessionPromise = null;
            throw error;
        });
    return finishSessionPromise;
}

function prepareFinalUploadPayload(finishAttemptId, completedAt) {
    const uploadPayload = buildAggregatesPayload(state.sessionData, { forIngest: true });
    if (!uploadPayload) return null;
    if (!uploadPayload.ids.invitationCode) {
        const code = state.sessionData?.ids?.invitationCode
            || state.runtime?.invitationProtocolMeta?.code
            || null;
        if (code) uploadPayload.ids.invitationCode = code;
    }
    uploadPayload.lifecycle = {
        ...(state.sessionData.lifecycle || {}),
        schemaVersion: 'session_lifecycle.v1',
        state: 'completed',
        status: 'completed',
        completedAt,
        finishAttemptId
    };
    return uploadPayload;
}

async function uploadFinalPayload(runtime, finishAttemptId, completedAt) {
    const uploadPayload = prepareFinalUploadPayload(finishAttemptId, completedAt);
    if (!uploadPayload) {
        const result = {
            ok: false,
            attempt: null,
            error: 'final_payload_build_failed',
            updatedAt: Date.now()
        };
        state.sessionData.upload = result;
        setUploadStatus(participantMessage('runtime_upload_prepare_failure'), 'error');
        await runtime?.persistCompletedCheckpoint();
        return result;
    }

    const uploadResult = await uploadAggregatesWithRetry(uploadPayload, {
        idempotencyKey: finishAttemptId
    });
    state.sessionData.upload = {
        ...(state.sessionData.upload || {}),
        ok: uploadResult.ok,
        attempt: uploadResult.attempt || null,
        error: uploadResult.error || null,
        qcValidity: uploadResult.result?.qc_validity || null,
        proxyReady: uploadResult.result?.proxy_ready === true,
        updatedAt: Date.now()
    };
    if (uploadResult.ok && state.sessionData.upload.qcValidity) {
        updateFinalStepWithQC(state.sessionData.qcSummary || null, {
            serverValidity: state.sessionData.upload.qcValidity
        });
    }
    recordSessionEvent(uploadResult.ok ? 'session_final_upload_complete' : 'session_final_upload_failed', {
        category: uploadResult.ok ? 'upload' : 'technical',
        severity: uploadResult.ok ? 'info' : 'error',
        finishAttemptId,
        attempt: uploadResult.attempt || null,
        error: uploadResult.error || null
    });
    if (uploadResult.ok) {
        await runtime?.clearCompletedCheckpoint();
    } else {
        await runtime?.persistCompletedCheckpoint();
    }
    return state.sessionData.upload;
}

async function retryFinalUpload(runtime) {
    nextStep(7);
    setUploadStatus(participantMessage('runtime_upload_retrying'), 'info');
    const finishAttemptId = state.sessionData.lifecycle?.finishAttemptId;
    const completedAt = state.sessionData.lifecycle?.completedAt || new Date().toISOString();
    if (!finishAttemptId) {
        const result = {
            ok: false,
            error: 'finish_attempt_id_missing',
            updatedAt: Date.now()
        };
        state.sessionData.upload = result;
        await runtime?.persistCompletedCheckpoint();
        return result;
    }
    return uploadFinalPayload(runtime, finishAttemptId, completedAt);
}

async function finishSessionOnce() {
    const runtime = getSessionRuntime();
    const finish = runtime?.beginFinish() || {
        accepted: true,
        finishAttemptId: `finish-${state.sessionData?.ids?.session || Date.now()}`
    };
    if (!finish.accepted && runtime?.machine?.state === 'completed') {
        return state.sessionData.upload || { ok: true, idempotent: true };
    }
    if (!finish.accepted && runtime?.machine?.state !== 'finishing') {
        throw new Error('Session finish rejected while a test block is active');
    }
    setSessionPhase('final', { source: 'finishSession' });
    runtime?.ui?.hideIssue?.();
    recordSessionEvent('session_finish_start', {
        finishAttemptId: finish.finishAttemptId
    });
    state.flags.isRecording = false;
    try {
        await runtime?.stopContinuousModules('session_finish');
    } finally {
        // Teardown does not depend on analytics or final-screen DOM succeeding.
        stopSessionMediaResources();
    }
    
    const customDot = document.getElementById('customGazeDot');
    if (customDot) {
        customDot.style.display = 'none';
    }
    
    // === Очищаем validation gaze interval (если ещё работает) ===
    state.runtime._validationLoopActive = false;
    if (state.runtime._validationGazeInterval) {
        clearTimeout(state.runtime._validationGazeInterval);
        state.runtime._validationGazeInterval = null;
    }
    if (state.runtime.validationSamplingInterval) {
        clearInterval(state.runtime.validationSamplingInterval);
        state.runtime.validationSamplingInterval = null;
    }

    // === Очищаем single-flight analysis loop (если ещё работает) ===
    state.runtime._analysisLoopActive = false;
    if (state.runtime.analysisInterval) {
        clearTimeout(state.runtime.analysisInterval);
        state.runtime.analysisInterval = null;
    }

    // === Очищаем cognitive single-flight loop (если ещё работает) ===
    state.runtime._cognitiveLoopActive = false;
    if (state.runtime.cognitiveAnalysisInterval) {
        clearTimeout(state.runtime.cognitiveAnalysisInterval);
        state.runtime.cognitiveAnalysisInterval = null;
    }
    state.runtime._gazeTestsLoopActive = false;
    if (state.runtime.gazeTestsAnalysisInterval) {
        clearTimeout(state.runtime.gazeTestsAnalysisInterval);
        state.runtime.gazeTestsAnalysisInterval = null;
    }

    resetEmotionWiringState();

    // === Heatmap + attention analytics (research-only) ===
    try {
        // Передаём validationRmsPx из gazeValidation, чтобы heatmap получил
        // quality-weighting (плохая калибровка → меньший вклад в bin'ы).
        const validationRmsPx = Number.isFinite(state.sessionData?.gazeValidation?.metrics?.accuracyPx)
            ? state.sessionData.gazeValidation.metrics.accuracyPx
            : null;
        const heatmaps = buildHeatmaps(state.sessionData.eyeTracking, {
            gridWidth: 32,
            gridHeight: 18,
            validationRmsPx
        });
        state.sessionData.heatmaps = heatmaps;
        dbg('gaze', 'heatmap:built', {
            validationRmsPx,
            qualityWeight: heatmaps?.qualityWeight ?? null,
            sessionSampleCount: heatmaps?.session?.totalSamples ?? null,
            onScreenSamples: heatmaps?.session?.onScreenSamples ?? null
        });
    } catch (e) {
        console.warn('[finishSession] Ошибка расчёта heatmaps:', e);
        state.sessionData.heatmaps = null;
    }

    try {
        state.sessionData.attentionMetrics = buildAttentionMetrics(state.sessionData);
        state.sessionData.blinkSummary =
            state.sessionData.attentionMetrics?.global?.blinkDynamics || null;
        state.sessionData.perclosSummary =
            state.sessionData.attentionMetrics?.global?.perclos || null;
    } catch (e) {
        console.warn('[finishSession] Ошибка расчёта attention metrics:', e);
        state.sessionData.attentionMetrics = null;
        state.sessionData.blinkSummary = null;
        state.sessionData.perclosSummary = null;
    }
    
    // === GAZE TRACKER: сброс ===
    if (state.runtime.gazeTracker) {
        state.runtime.gazeTracker.reset();
        console.log('[GazeTracker] Сброшен');
    }
    
    // === Сброс данных позы ===
    state.runtime.lastPoseData = null;
    state.runtime.lastEyeSignal = null;
    clearTaskContext();
    
    // === QC METRICS: получаем итоговый отчёт ===
    let finalQcSummary = state.sessionData.qcSummary || null;
    if (state.runtime.qcMetrics) {
        try {
            const qcSummary = state.runtime.qcMetrics.getSummary();
            finalQcSummary = qcSummary;
            state.sessionData.qcSummary = qcSummary;
            console.log('[QC] Summary:', qcSummary);
            dbg('respiration', 'respiration:summary', summarizeRespirationForDebug(state.sessionData));

            // Останавливаем QCMetrics
            state.runtime.qcMetrics.stop();
            console.log('[QC] QCMetrics остановлен');
        } catch (e) {
            console.warn('[finishSession] Ошибка QC metrics:', e);
        }
    }
    // The aggregate cards (blinks, PERCLOS, emotion, body pose) do not depend
    // on QCMetrics and must be rendered for every completed session.
    updateFinalStepWithQC(finalQcSummary);
    hideQcOverlay();
    
    // Убираем класс active со step5 до вызова nextStep,
    // чтобы stopPreCheckOnLeave() не вызывался повторно
    document.getElementById('step5')?.classList.remove('active');
    
    // Показываем интерфейс
    const container = document.querySelector('.container');
    const topBar = document.querySelector('.top-bar');
    if (container) container.style.display = 'block';
    if (topBar) topBar.style.display = 'flex';
    
    const completedAt = Date.now();
    if (runtime) {
        // Keep a completed checkpoint until the final ingest confirms receipt.
        await runtime.completeFinish({ source: 'finishSession' }, { clearCheckpoint: false });
    } else {
        state.sessionData.lifecycle = {
            schemaVersion: 'session_lifecycle.v1',
            state: 'completed',
            status: 'completed',
            finishAttemptId: finish.finishAttemptId,
            completedAt: new Date(completedAt).toISOString()
        };
    }

    // Переходим на финальный шаг
    nextStep(7);
    recordSessionEvent('session_finish_complete');
    setUploadStatus(participantMessage('runtime_upload_preparing'), 'info');

    await uploadFinalPayload(
        runtime,
        finish.finishAttemptId,
        state.sessionData.lifecycle?.completedAt || new Date(completedAt).toISOString()
    );

    if (state.sessionData.upload?.ok !== true) {
        await runtime?.persistCompletedCheckpoint();
    }

    console.log('[finishSession] Сессия завершена, показан step7, upload flow выполнен');
    return state.sessionData.upload || { ok: false };
}
