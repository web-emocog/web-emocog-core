import { participantDebug as dbg, participantDebugError as dbgErr } from '../session-runtime/participant-diagnostic.mjs?v=20261110-integration1';
import {
    state,
    setSessionPhase,
    recordSessionEvent,
    clearTaskContext,
    getRelativeSessionTimeMs
} from './state.js?v=20261025-1';
import { translations } from '../../translations.js?v=20261110-integration1';
import { updateFinalStepWithQC, nextStep } from './ui-updated.js?v=20261112-emotion1';
import { stopPreCheck } from './precheck-updated.js?v=20261110-integration1';
import { resolveSignalProfile } from '../session-runtime/protocol-profile.mjs?v=20261110-integration1';
import { startCameraFpsMonitor, stopCameraFpsMonitor, getAverageCameraFps } from './camera.js?v=20261104-4';
import { loadAndStartCognitiveTask } from './experimental_task-updated.js?v=20261112-emotion1';
import {
    deriveInvitationHubMetrics,
    definitionForCognitiveRunner,
    getInvitationSessionPlan
} from './protocol-invite-utils.js?v=20260915-1';
import { buildSessionHeatmaps } from '../session-runtime/gaze-history.mjs?v=20261102-1';
import { buildAttentionMetrics } from '../gaze-tracker/attention-metrics.js?v=20261025-2';
import {
    runProtocolTestSequence,
    startTestHub,
    stopHubEmotionPreview
} from '../gaze-tracker/gaze-tests/index.js?v=20261112-emotion1';
import { stopGazeTestsAnalysisLoop } from '../gaze-tracker/gaze-tests/common/analysis-loop.js?v=20261112-emotion1';
import { DEFAULT_THRESHOLDS } from '../qc-metrics/constants.js';
import { CALIBRATION_CAPTURE_VERSION, CALIBRATION_CLICKS, CALIBRATION_POSITIONS,
    CORRECTION_POSITIONS, BENCHMARK_POSITIONS, calibrationCapturePolicy, collectCalibrationClick
} from '../gaze-tracker/calibration-capture.mjs?v=20261110-integration1';
import { calibrationFeedback } from '../gaze-tracker/calibration-feedback.mjs?v=20261110-integration1';
import { calculateValidationMetrics as sharedValidationMetrics,
    fitValidationCorrection, assessCorrectionBenchmark } from '../gaze-tracker/validation-metrics.mjs';
import { createValidationSamplingWindow, validationTargetCoverage } from '../gaze-tracker/validation-sampling.mjs';
import { extractEyeSignalSample } from './eye-signal.js';
import { updateFromMetrics as qcOverlayUpdateFromMetrics } from '../qc-pause-overlay-new.js?v=20261103-1';
import { hide as hideQcOverlay, resetFaceLostTimer } from '../qc-pause-overlay-new.js?v=20261103-1';
import { setAutoPauseStimulus, getConfig as getQcPauseConfig } from '../qc-pause-overlay-new.js?v=20261103-1';
import { getEmotionSample, appendEmotionSample, resetEmotionWiringState } from '../emotion-stub-new.js?v=20261112-emotion1';
import { buildAggregatesPayload } from '../unified-aggregates-new.js?v=20261112-emotion1';
import { recordedConsentReceipt, sendSessionFeature } from '../session-runtime/ingest-transport.mjs?v=20261110-integration1';
import { persistenceErrorCode, persistenceMessage } from '../session-runtime/persistence-ui.mjs?v=20261110-integration1';
import {
    getContentViewport,
    targetCenterInContentViewport
} from '../gaze-tracker/viewport-coordinates.mjs';

import {
    getSessionRuntime,
    isContinuousSessionAnalysisRunning
} from '../session-runtime/index.js?v=20261112-emotion1';
import {
    setHeadPoseGuideMode,
    setCalibrationGuideTarget,
    showCalibrationHeadPoseGuide
} from '../gaze-tracker/head-pose-guide.js?v=20261103-1';

function participantMessage(key, replacements = {}) {
    const pack = translations[state.currentLang] || translations.en;
    let value = String(pack[key] || translations.en[key] || key);
    Object.entries(replacements).forEach(([name, replacement]) => {
        value = value.replaceAll(`{${name}}`, String(replacement));
    });
    return value;
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
        if (button.disabled) return;
        button.disabled = true;
        void finishSession().catch(() => {
            dbgErr('delivery', 'upload:retry-failed');
            setUploadStatus(participantMessage('runtime_upload_prepare_failure'), 'error');
        }).finally(() => {
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
        consentReceipt: recordedConsentReceipt(state.sessionData, payload.ids?.session),
        onAttempt: ({ attempt, retries }) => {
            setUploadStatus(participantMessage('runtime_upload_attempt', { attempt, retries }), 'info');
            recordSessionEvent('upload_attempt', { attempt, retries, endpoint: '/ingest' });
        },
        onRetry: ({ attempt, retries, delayMs, error }) => {
            recordSessionEvent('upload_retry', {
                attempt,
                retries,
                errorCode: persistenceErrorCode(error), httpStatus: error?.httpStatus || null
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
            const errorCode = persistenceErrorCode(error);
            const httpStatus = Number.isInteger(error?.httpStatus) ? error.httpStatus : null;
            recordSessionEvent('upload_failed', { errorCode, httpStatus });
            dbgErr('delivery', 'upload:failed', { category: errorCode, httpStatus });
            setUploadStatus(persistenceMessage(errorCode, state.currentLang), 'error');
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
    try {
        return await startInvitationSessionAfterShell();
    } catch (_) {
        handleInvitationStartFailure();
        return false;
    }
}

function handleInvitationStartFailure() {
    dbgErr('app', 'invitation:start-failed');
    state.runtime.handlePreparationFailure?.();
}

async function startInvitationSessionAfterShell() {
    if (state.runtime.participantPageExited) return false;
    const inviteDef = state.runtime?.invitationProtocolDefinition;
    const invitationCode = state.sessionData?.ids?.invitationCode
        || state.runtime?.invitationProtocolMeta?.code;
    state.flags.isRecording = true;
    const continuousStarted = await getSessionRuntime()?.startContinuousModules();
    if (state.runtime.participantPageExited) return false;
    if (continuousStarted !== true) {
        returnToMandatoryPreparation();
        return false;
    }

    if (!invitationCode && !inviteDef) {
        await startTestHub(buildTestHubHandlers());
        return true;
    }

    if (invitationCode && !inviteDef) {
        recordSessionEvent('invitation_protocol_missing_after_shell', {
            category: 'technical',
            severity: 'error',
            invitationCode
        });
        await loadAndStartCognitiveTask({
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
        await loadAndStartCognitiveTask({
            protocol: definitionForCognitiveRunner(inviteDef),
            autoFinishSession: !plan.hasHub,
            onComplete: plan.hasHub
                ? () => { void runProtocolTestSequence(plan.hubMetrics, hubHandlers).catch(handleInvitationStartFailure); }
                : undefined
        });
        return;
    }

    if (plan.hasHub) {
        await runProtocolTestSequence(plan.hubMetrics, hubHandlers);
        return;
    }

    recordSessionEvent('invitation_protocol_empty', {
        category: 'technical',
        severity: 'error',
        invitationCode
    });
    await loadAndStartCognitiveTask({
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
    if (!intro || !button) return Promise.resolve(true);

    const t = translations[state.currentLang] || translations.en;
    if (kicker) kicker.textContent = t.calib_progress;
    const targeted = options.targeted === true;
    if (title) {
        title.textContent = targeted ? t.calib_progress : t.runtime_instruction_title;
    }
    if (text) {
        text.textContent = options.viewportChanged
            ? calibrationFeedback(state.currentLang, 'viewport_changed')
            : (targeted ? `${t.qc_failed_full} ${t.calib_click_instruction}` : (t.calibration_intro_body || t.calib_click_instruction));
    }
    button.textContent = targeted || options.viewportChanged ? t.runtime_recalibrate : t.runtime_instruction_action;
    intro.hidden = false;
    const focusFrame = requestAnimationFrame(() => button.focus());

    return new Promise((resolve) => {
        const finish = accepted => {
            cancelAnimationFrame(focusFrame);
            button.onclick = null;
            intro.hidden = true;
            state.runtime.cancelCalibrationIntro = null;
            if (accepted) recordSessionEvent('calibration_instruction_acknowledged', { category: 'block' });
            resolve(accepted);
        };
        state.runtime.cancelCalibrationIntro = () => finish(false);
        button.onclick = () => finish(true);
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

let calibrationSetup = null;
let calibrationGeneration = 0;
let calibrationGeometryWatch = null;

function calibrationGeometry() {
    return { ...getContentViewport(), dpr: window.devicePixelRatio };
}

export function startCalibration(options = {}) {
    if (calibrationSetup) return calibrationSetup;
    const pending = prepareCalibration(options).finally(() => {
        if (calibrationSetup === pending) calibrationSetup = null;
    });
    calibrationSetup = pending;
    return pending;
}

async function prepareCalibration(options) {
    if (state.runtime.participantPageExited) return;
    const generation = ++calibrationGeneration;
    calibrationGeometryWatch?.abort();
    const targetedPositions = normalizeCalibrationTargets(options.targetedPositions);
    const targeted = targetedPositions.length > 0
        && state.runtime?.gazeTracker?.isCalibrated?.() === true;
    const shell = state.runtime?.invitationParticipantShell;
    const profile = resolveSignalProfile(state.runtime.invitationProtocolDefinition);
    if (!targeted && shell?.precheck !== false && !getSessionRuntime()?.isAnalysisRunning?.()
        && profile.precheck.method === 'recent-window.v2'
        && state.runtime.precheckGate?.snapshot(performance.now()).passed !== true) {
        state.sessionData.precheck = { ...(state.sessionData.precheck || {}), pass_fail: false, fail_reason: 'fresh_precheck_required' };
    }
    // Фаза 1.1: gate — не запускать калибровку, если pre-check не пройден
    if (state.sessionData.precheck && state.sessionData.precheck.pass_fail === false) {
        dbgErr('gaze', 'calibration:precheck-not-passed');
        const msg = (translations[state.currentLang] && translations[state.currentLang].precheck_must_pass) || 'Complete pre-check successfully first.';
        if (typeof alert !== 'undefined') alert(msg);
        return;
    }
    if (shell && shell.calibration === false) {
        await continueInvitationSessionAfterShell();
        return;
    }
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
        if (state.runtime.participantPageExited) return;
        dbg('qc', 'module:ready:QCMetrics', { resolved: true });
    }
    if (!targeted) {
        state.runtime.qcMetrics?.stop?.();
        state.runtime.qcMetrics = new QCMetrics();
        state.runtime.qcMetrics.start();
        state.runtime.sessionStartTime = Date.now();
        dbg('qc', 'QCMetrics:instance:created', {});
    }

    // === ИНИЦИАЛИЗАЦИЯ GAZE TRACKER ===
    if (window.GazeTrackerReady) {
        await window.GazeTrackerReady;
        if (state.runtime.participantPageExited) return;
        dbg('gaze', 'module:ready:GazeTracker', { resolved: true });
    }
    if (!targeted) {
        state.runtime.gazeTracker = new GazeTracker({
            onGazeUpdate: (gazeData) => {
                if (window.handleGazeUpdate) {
                    window.handleGazeUpdate(gazeData);
                }
            }
        });
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
    if (state.runtime.participantPageExited) return;
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
    const acknowledged = await waitForCalibrationIntroduction({ targeted, viewportChanged: options.viewportChanged === true });
    if (!acknowledged || state.runtime.participantPageExited || generation !== calibrationGeneration
        || state.runtime.currentPhase !== 'calibration' || !calibScreen.classList.contains('active')) return;
    if (instructionPanel) instructionPanel.style.display = '';
    point.style.display = 'block';
    point.style.opacity = '1';
    point.style.backgroundColor = '#DC2626';
    point.style.cursor = 'pointer';

    // Fixed UI is now in its measuring layout; the classic scrollbar from
    // preparation is gone. Never freeze geometry while the preview is visible.
    calibScreen.getBoundingClientRect();
    const contentViewport = calibrationGeometry();
    const ownerTracker = state.runtime.gazeTracker;
    const ownsCalibration = () => !state.runtime.participantPageExited && state.runtime.gazeTracker === ownerTracker
        && generation === calibrationGeneration && state.runtime.currentPhase === 'calibration'
        && calibScreen.classList.contains('active');
    const geometryMatches = () => {
        const current = calibrationGeometry();
        return Object.keys(contentViewport).every(key => current[key] === contentViewport[key]);
    };
    const restartForViewport = () => {
        if (!ownsCalibration() || geometryWatch.signal.aborted) return;
        geometryWatch.abort();
        point.onclick = null;
        point.style.display = 'none';
        recordSessionEvent('calibration_viewport_changed', {
            category: 'technical', severity: 'warning', targeted
        });
        // Let the current setup finish before restarting (including the case
        // of a targeted repair in a different viewport). A fresh tracker must
        // never mix newly measured targets with the previous calibration.
        const pending = calibrationSetup;
        void Promise.resolve(pending).then(() => {
            if (ownsCalibration()) return startCalibration({ viewportChanged: true });
        });
    };
    const geometryWatch = calibrationGeometryWatch = new AbortController();
    const listenerOptions = { signal: geometryWatch.signal };
    const onGeometryChange = () => {
        if (ownsCalibration() && !geometryMatches()) restartForViewport();
    };
    window.addEventListener('resize', onGeometryChange, listenerOptions);
    window.visualViewport?.addEventListener?.('resize', onGeometryChange, listenerOptions);
    window.visualViewport?.addEventListener?.('scroll', onGeometryChange, listenerOptions);
    window.matchMedia(`(resolution: ${contentViewport.dpr}dppx)`).addEventListener('change', onGeometryChange, listenerOptions);
    window.addEventListener('wecog:session-phase-change', ({ detail }) => {
        if (detail?.phase !== 'calibration') geometryWatch.abort();
    }, listenerOptions);
    window.addEventListener('pagehide', event => {
        if (!event.persisted) geometryWatch.abort();
    }, listenerOptions);

    const fittedViewport = targeted ? ownerTracker.getStatus().calibrationScreenSize : null;
    if (targeted && (!fittedViewport || fittedViewport.width !== contentViewport.width || fittedViewport.height !== contentViewport.height)) {
        restartForViewport();
        return;
    }
    ownerTracker.updateScreenSize(contentViewport.width, contentViewport.height);

    instructionText.innerText = translations[state.currentLang].calib_click_instruction;

    const fullCalibrationPositions = CALIBRATION_POSITIONS;
    const positions = targeted ? targetedPositions : fullCalibrationPositions;
    
    const video = document.getElementById('precheckVideo');
    let i = 0;
    const CLICKS_PER_POINT = targeted ? 3 : CALIBRATION_CLICKS;
    const calibrationBuildTag = targeted
        ? 'calib-targeted-repair-v2-click-capture'
        : 'calib-grid-5x5-v4-click-capture';
    window.__gazeCalibrationDebug = {
        build: calibrationBuildTag,
        moduleUrl: import.meta.url,
        points: positions.length,
        clicksPerPoint: CLICKS_PER_POINT
    };
    dbg('gaze', 'calibration:plan', { build: calibrationBuildTag, points: positions.length, clicksPerPoint: CLICKS_PER_POINT });
    let clicksOnCurrentPoint = 0;
    const captureStatus = document.getElementById('calibrationCaptureStatus');
    const captureStatusText = document.getElementById('calibrationCaptureStatusText');
    const recoveryButton = document.getElementById('calibrationRecoveryBtn');
    if (captureStatus) captureStatus.hidden = true;
    if (recoveryButton) { recoveryButton.hidden = true; recoveryButton.onclick = null; }
    const showCaptureStatus = (message, recoverable = false) => {
        instructionText.textContent = message;
        if (captureStatus && captureStatusText) {
            captureStatusText.textContent = message;
            // Keep feedback in the opposite half, never on top of the target.
            captureStatus.style.top = positions[i].y >= 50 ? '12px' : 'auto';
            captureStatus.style.bottom = positions[i].y >= 50 ? 'auto' : '12px';
            captureStatus.hidden = false;
        }
        if (recoveryButton) {
            recoveryButton.hidden = !recoverable;
            recoveryButton.style.display = recoverable ? 'inline-flex' : 'none';
        }
    };
    const showCaptureRecovery = message => {
        showCaptureStatus(message, true);
        if (recoveryButton) {
            let recoveryGeneration = generation;
            recoveryButton.textContent = participantMessage('calibration_camera_action');
            recoveryButton.onclick = async () => {
                if (recoveryGeneration === calibrationGeneration && !state.runtime.participantPageExited) {
                    recoveryGeneration = ++calibrationGeneration;
                    point.onclick = null;
                    recoveryButton.disabled = true;
                    try {
                        await getSessionRuntime()?.stopContinuousModules('calibration_recovery');
                        if (calibrationGeneration === recoveryGeneration && !state.runtime.participantPageExited) returnToMandatoryPreparation();
                    } catch (_) {
                        if (!state.runtime.participantPageExited) showCaptureStatus(participantMessage('runtime_generic_technical'), true);
                    } finally { recoveryButton.disabled = false; }
                }
            };
        }
    };
    const captureIsActive = () => ownsCalibration() && !geometryWatch.signal.aborted && !document.hidden
        && isContinuousSessionAnalysisRunning() && geometryMatches();
    const recoverFromInactiveCapture = () => {
        if (!ownsCalibration() || geometryWatch.signal.aborted) return;
        if (!geometryMatches()) { restartForViewport(); return; }
        geometryWatch.abort();
        if (!isContinuousSessionAnalysisRunning()) {
            getSessionRuntime()?.reportIssue({
                kind: 'technical', code: 'continuous_modules_not_started',
                message: 'Continuous camera analysis could not start.', recoverable: true, invalidatesBlock: false
            });
        }
        returnToMandatoryPreparation();
    };
    let clickPending = false;
    const pointFailureCounts = new Array(positions.length).fill(0);
    
    const updatePoint = () => {
        point.style.left = `${positions[i].x}%`;
        point.style.top = `${positions[i].y}%`;
        setCalibrationGuideTarget(positions[i].x, positions[i].y);
        progressText.innerText = `${translations[state.currentLang].calib_progress} ${i + 1} ${translations[state.currentLang].point_of} ${positions.length} (${clicksOnCurrentPoint}/${CLICKS_PER_POINT})`;
    };

    // Обработчик клика на точку для калибровки
    // Два клика на точку; свежая серия открытых глаз с прежними pose limits.
    const handleCalibClick = async () => {
        if (state.runtime.participantPageExited) return;
        if (clickPending || document.hidden || !ownsCalibration() || geometryWatch.signal.aborted) return;
        if (!captureIsActive()) { recoverFromInactiveCapture(); return; }
        clickPending = true;
        // Prevent double-clicks while collecting frames
        point.onclick = null;
        point.style.opacity = '0.5';
        point.setAttribute('aria-busy', 'true');
        showCaptureStatus(participantMessage('calibration_collecting'));
        try {
            // === GAZE CALIBRATION: собираем iris features с усреднением ===
            if (!ownerTracker || !state.runtime.localAnalyzer || !video) throw new Error('Calibration is not ready');
            {
                const currentPos = positions[i];
                const target = targetCenterInContentViewport(point);
                if (!target) throw new Error('Calibration target has no viewport bounds');
                const screenX = target.x;
                const screenY = target.y;
                const failedClicksForPoint = pointFailureCounts[i] || 0;
                const policy = calibrationCapturePolicy(currentPos);
                const capture = await collectCalibrationClick({
                    policy, getFrame: () => state.runtime.lastPrecheckResult, isActive: captureIsActive
                });
                if (capture.summary.cancelled || !captureIsActive()) {
                    capture.frames.length = 0;
                    recoverFromInactiveCapture();
                    return;
                }
                const accepted = capture.summary.accepted && ownerTracker.addAveragedCalibrationPoint(
                    capture.frames, screenX, screenY, { minFrames: policy.minFrames }
                );
                capture.frames.length = 0;
                recordSessionEvent('calibration_click_sampled', {
                    captureVersion: CALIBRATION_CAPTURE_VERSION, pointIndex: i,
                    clickIndex: clicksOnCurrentPoint, accepted, usableFrames: capture.summary.usableFrames,
                    minFrames: policy.minFrames, invalidEyes: capture.summary.invalidEyes,
                    invalidPose: capture.summary.invalidPose, staleFrames: capture.summary.sampling.beforeWindow,
                    duplicateFrames: capture.summary.sampling.duplicate
                });
                if (accepted) pointFailureCounts[i] = 0;

                if (!accepted) {
                    pointFailureCounts[i] = failedClicksForPoint + 1;
                    dbg('gaze', 'calibration:point-retry', { point: i + 1, frames: capture.summary.usableFrames, failures: pointFailureCounts[i] });
                    showCaptureRecovery(calibrationFeedback(state.currentLang, 'insufficient_frames'));
                    point.style.opacity = '1';
                    point.onclick = handleCalibClick;
                    return;
                }
            }
        } catch (_) {
            if (!captureIsActive()) { recoverFromInactiveCapture(); return; }
            dbgErr('gaze', 'calibration:point-failed');
            showCaptureRecovery(`${participantMessage('runtime_generic_technical')} ${participantMessage('calibration_capture_retry')}`);
            point.style.opacity = '1';
            point.onclick = handleCalibClick;
            return;
        } finally {
            clickPending = false;
            point.removeAttribute('aria-busy');
        }
        
        if (state.runtime.participantPageExited) return;
        clicksOnCurrentPoint++;
        if (captureStatus) captureStatus.hidden = true;
        if (recoveryButton) recoveryButton.hidden = true;
        instructionText.innerText = translations[state.currentLang].calib_click_instruction;
        
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
                dbg('gaze', 'calibration:completed', { calibrated: !!calibrated });
            }
            
            instructionText.innerText = translations[state.currentLang].calib_complete;
            progressText.innerText = '';
            point.style.display = 'none';
            
            setTimeout(async () => {
                // После калибровки запускаем валидацию точности
                if (captureIsActive()) startGazeValidation();
                else recoverFromInactiveCapture();
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
    if (state.runtime.participantPageExited) return;
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
    const correctionPositions = CORRECTION_POSITIONS;
    // Independent targets are never used to fit the correction.
    const benchmarkPositions = BENCHMARK_POSITIONS;
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
    
    const POLLS_PER_POINT = 60; // ~2 seconds; only unique capture predictions become samples.
    const SAMPLE_INTERVAL = 33; // ~30 FPS
    const SETTLE_DELAY_MS = 1000;
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

    function stopValidationSampling() {
        state.flags.isValidating = false;
        clearInterval(samplingInterval);
        clearTimeout(samplingDelayTimeout);
        state.runtime.validationSamplingInterval = null;
        samplingInterval = samplingDelayTimeout = null;
        stopValidationPredictionLoop();
        state.runtime.stopValidationSampling = null;
    }
    state.runtime.stopValidationSampling = stopValidationSampling;

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
            if (!state.runtime._validationLoopActive) return;
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
            const samplingWindow = createValidationSamplingWindow({
                monotonicStart: performance.now(), wallStart: Date.now()
            });
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
                    && samplingWindow.accept(prediction)
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
                        frameTimestamp: Number.isFinite(prediction.frameTimestamp) ? prediction.frameTimestamp : null,
                        t: Number.isFinite(prediction.timestamp) ? prediction.timestamp : null
                    });
                }
                sampleCount++;
                
                if (sampleCount >= POLLS_PER_POINT) {
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
                        sampling: samplingWindow.summary(),
                        timestamp: Date.now()
                    });
                    
                    currentPoint++;
                    showNextPoint();
                }
            }, SAMPLE_INTERVAL);
            state.runtime.validationSamplingInterval = samplingInterval;
        }, SETTLE_DELAY_MS);
    }

    function finishCorrectionStage() {
        try {
            const rawValidationPoints = state.runtime.validationPoints;
            const fitted = fitValidationCorrection(rawValidationPoints, validationViewport);
            const { rawMetrics, filteredMetrics } = fitted;
            postCalibrationCorrection = fitted.postCalibrationCorrection;
            if (postCalibrationCorrection.fitted) {
                postCalibrationCorrection.correctionId = generateCorrectionId();
                if (postCalibrationCorrection.applied) {
                    const applied = state.runtime.gazeTracker?.setPostCalibrationCorrection?.({
                        ...fitted.correction, correctionId: postCalibrationCorrection.correctionId
                    });
                    postCalibrationCorrection.applied = applied === true;
                }
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
        }, SETTLE_DELAY_MS);
    }

    function finishValidationSafely() {
        try {
            finishValidation();
        } catch (error) {
            stopValidationSampling();
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
        stopValidationSampling();

        const benchmarkPoints = state.runtime.validationBenchmarkPoints;
        const { filteredBenchmark, correctedCandidatePoints, baselinePoints, rawMetrics,
            correctedCandidateMetrics, displayMetrics, independentDecision } = assessCorrectionBenchmark(
            benchmarkPoints, validationViewport, postCalibrationCorrection.applied
        );
        const useCorrected = postCalibrationCorrection.applied && independentDecision.accepted;
        const selectedPoints = useCorrected ? correctedCandidatePoints : baselinePoints;
        const metrics = useCorrected ? correctedCandidateMetrics : rawMetrics;
        const coverage = validationTargetCoverage(selectedPoints, benchmarkPositions.length);
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
            samplingVersion: 'unique_capture.v1',
            sampling: [...state.runtime.validationPoints, ...state.runtime.validationBenchmarkPoints]
                .map(({ stage, pointIndex, sampling }) => ({ stage, pointIndex, ...sampling })),
            coverage,
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
                coverage.complete
                && Number.isFinite(metrics.accuracyPct)
                && Number.isFinite(metrics.precisionPct)
                && metrics.accuracyPct <= DEFAULT_THRESHOLDS.gaze_accuracy_pct_max
                && metrics.precisionPct <= DEFAULT_THRESHOLDS.gaze_precision_pct_max
        };
        recordSessionEvent('validation_complete', {
            validationSampleCount: qcValidationSamples.length,
            validationSamplingVersion: 'unique_capture.v1',
            missingTargetCount: coverage.missingTargetIndices.length,
            accuracyPct: metrics.accuracyPct,
            precisionPct: metrics.precisionPct,
            biasXPct: metrics.biasXPct,
            biasYPct: metrics.biasYPct,
            baselineAccuracyPct: rawMetrics.accuracyPct,
            correctionApplied: postCalibrationCorrection.applied
        });
        
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
                !coverage.complete ? 'validation_result_missing_targets_advice'
                    : validationPassed ? 'validation_result_passed_advice' : 'validation_result_failed_advice'
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

        const worstTargets = coverage.complete ? getWorstValidationTargets(selectedPoints, validationViewport, 4) : [];
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
    return sharedValidationMetrics(points, viewport);
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


function generateCorrectionId() {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 6);
    return `corr_${t}_${r}`;
}

// --- ТЕСТ СЛЕЖЕНИЯ ЗА ФИГУРАМИ ---
export function startTrackingTest(options = {}) {
    if (state.runtime.participantPageExited) return;
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
    if (!isContinuousSessionAnalysisRunning() && video && video.srcObject) {
        startCameraFpsMonitor(video);
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
            if (!state.runtime._analysisLoopActive) return;
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
                        .catch(() => {
                            dbgErr('tracking', 'segmentation:failed');
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
        } catch (_) {
            dbgErr('tracking', 'frame:analysis-failed');
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
    }
    
    function runTrajectory() {
        if (state.runtime.participantPageExited) return;
        if (currentTrajectory >= trajectories.length) {
            // Останавливаем анализ
            stopTrackingAnalysisLoop();
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
                state.runtime.trackingMotionRaf = requestAnimationFrame(animate);
            } else {
                currentTrajectory++;
                state.runtime.trackingMotionTimer = setTimeout(runTrajectory, 500);
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
    }
    
    // === Останавливаем CameraFPSMonitor (если ещё работает) ===
    if (!isContinuousSessionAnalysisRunning()) stopCameraFpsMonitor();
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
    
    state.runtime.trackingMotionTimer = setTimeout(() => {
        if (state.runtime.participantPageExited) return;
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

export function stopParticipantTestLoops() {
    calibrationGeneration++;
    state.runtime.cancelCalibrationIntro?.();
    state.runtime.cancelVisuospatialTest?.();
    state.runtime.stopValidationSampling?.();
    stopGazeTestsAnalysisLoop();
    stopHubEmotionPreview();
    state.runtime._analysisLoopActive = false;
    state.runtime._cognitiveLoopActive = false;
    state.runtime._gazeTestsLoopActive = false;
    cancelAnimationFrame(state.runtime.trackingMotionRaf);
    state.runtime.trackingMotionRaf = null;
    for (const key of ['analysisInterval', 'cognitiveAnalysisInterval', 'gazeTestsAnalysisInterval', 'trackingMotionTimer']) {
        clearTimeout(state.runtime[key]);
        state.runtime[key] = null;
    }
    stopCameraFpsMonitor();
}

export function stopSessionMediaResources() {
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
        void window.Photodiode?.finish();
        finishSessionPromise = finishSessionOnce();
    }
    finishSessionPromise = finishSessionPromise
        .catch(error => {
            stopSessionMediaResources();
            runtime?.failFinish(error);
            throw error;
        }).finally(() => {
            // Later calls must take the explicit completed/idempotent branch.
            finishSessionPromise = null;
        });
    return finishSessionPromise;
}

function prepareFinalUploadPayload(finishAttemptId, completedAt) {
    const uploadPayload = buildAggregatesPayload(state.sessionData, { forIngest: true });
    if (!uploadPayload) return null;
    if (state.sessionData.finalDelivery) uploadPayload.delivery = { ...state.sessionData.finalDelivery };
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
        finishAttemptId,
        modules: { ...(getSessionRuntime()?.moduleStatus || state.sessionData.lifecycle?.modules || {}) }
    };
    return uploadPayload;
}

async function uploadFinalPayload(runtime, finishAttemptId, completedAt) {
    const saved = state.sessionData.pendingFinalUpload;
    const uploadPayload = saved?.finishAttemptId === finishAttemptId
        && saved.payload?.ids?.session === state.sessionData.ids?.session
        && saved.payload?.ids?.invitationCode === state.sessionData.ids?.invitationCode
        ? saved.payload : prepareFinalUploadPayload(finishAttemptId, completedAt);
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
    // Server error bodies are untrusted and must not enter exported state.
    const deliveryError = uploadResult.ok ? null : persistenceErrorCode({ status: uploadResult.status });
    state.sessionData.upload = {
        ...(state.sessionData.upload || {}),
        ok: uploadResult.ok,
        attempt: uploadResult.attempt || null,
        error: deliveryError,
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
        error: deliveryError
    });
    if (uploadResult.ok) {
        state.sessionData.finalizedPayload = uploadPayload;
        delete state.sessionData.pendingFinalUpload;
        try { await runtime?.clearCompletedCheckpoint(); }
        catch (_) { dbgErr('delivery', 'checkpoint:cleanup-failed'); }
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
    runtime?.stopServerCheckpoints();
    setSessionPhase('final', { source: 'finishSession' });
    runtime?.ui?.hideIssue?.();
    recordSessionEvent('session_finish_start', {
        finishAttemptId: finish.finishAttemptId
    });
    state.flags.isRecording = false;
    try {
        const shutdown = runtime?.stopContinuousModules('session_finish');
        // The camera is no longer needed while queued analysis finishes.
        stopSessionMediaResources();
        await shutdown;
    } catch (_) {
        dbgErr('app', 'session:shutdown-failed');
    } finally {
        // Teardown does not depend on analytics or final-screen DOM succeeding.
        stopSessionMediaResources();
    }
    
    const customDot = document.getElementById('customGazeDot');
    if (customDot) {
        customDot.style.display = 'none';
    }
    
    stopParticipantTestLoops();

    resetEmotionWiringState();

    // === Heatmap + attention analytics (research-only) ===
    try {
        // Передаём validationRmsPx из gazeValidation, чтобы heatmap получил
        // quality-weighting (плохая калибровка → меньший вклад в bin'ы).
        const validationRmsPx = Number.isFinite(state.sessionData?.gazeValidation?.metrics?.accuracyPx)
            ? state.sessionData.gazeValidation.metrics.accuracyPx
            : null;
        const heatmaps = buildSessionHeatmaps(state.sessionData, state.runtime, {
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
    } catch (_) {
        dbgErr('gaze', 'heatmap:calculation-failed');
        state.sessionData.heatmaps = null;
    }

    try {
        state.sessionData.attentionMetrics = buildAttentionMetrics(state.sessionData);
        state.sessionData.blinkSummary =
            state.sessionData.attentionMetrics?.global?.blinkDynamics || null;
        state.sessionData.perclosSummary =
            state.sessionData.attentionMetrics?.global?.perclos || null;
    } catch (_) {
        dbgErr('gaze', 'attention:calculation-failed');
        state.sessionData.attentionMetrics = null;
        state.sessionData.blinkSummary = null;
        state.sessionData.perclosSummary = null;
    }
    
    // === GAZE TRACKER: сброс ===
    if (state.runtime.gazeTracker) {
        state.runtime.gazeTracker.reset();
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
            state.sessionData.qcSummary = { ...qcSummary,
                protocolQc: globalThis.WecogProtocolQuality?.evaluate(state.runtime.invitationProtocolDefinition, qcSummary) || null };
            if (state.sessionData.qcSummary.protocolQc?.failed.length || state.sessionData.qcSummary.protocolQc?.missing.length
                || state.sessionData.experimentMeta?.protocolTermination) state.sessionData.qcSummary.overallPass = false;
            finalQcSummary = state.sessionData.qcSummary;
            dbg('respiration', 'respiration:summary', () => summarizeRespirationForDebug(state.sessionData));

            // Останавливаем QCMetrics
            state.runtime.qcMetrics.stop();
        } catch (_) {
            dbgErr('qc', 'summary:calculation-failed');
        }
    }
    // The aggregate cards (blinks, PERCLOS, emotion, body pose) do not depend
    // on QCMetrics and must be rendered for every completed session.
    try { updateFinalStepWithQC(finalQcSummary); }
    catch (_) { dbgErr('ui', 'summary:render-failed'); }
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
    const terminalTime = new Date(completedAt).toISOString();
    state.sessionData.pendingFinalUpload = {
        finishAttemptId: finish.finishAttemptId,
        payload: prepareFinalUploadPayload(finish.finishAttemptId, terminalTime)
    };
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

    return state.sessionData.upload || { ok: false };
}
