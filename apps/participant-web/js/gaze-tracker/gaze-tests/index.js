import { state, clearTaskContext, setSessionPhase, recordSessionEvent } from '../../web-page/state.js';
import { translations } from '../../../translations.js';
import { getEmotionSample } from '../../emotion-stub-new.js';
import { TEST_IDS, TEST_PHASES } from './constants.js';
import {
    ensureTestHubSessionFields,
    pushHubSelection,
    pushHubRun
} from './session-schema.js';
import { runVPCTest } from './vpc/runner.js';
import { runVisuospatialDrawingTest } from './visuospatial/runner.js';
import {
    startGazeTestsAnalysisLoop,
    stopGazeTestsAnalysisLoop,
    isGazeTestsAnalysisLoopRunning
} from './common/analysis-loop.js';

let hubBusy = false;
let hubEmotionTimer = null;

function emotionDisplayName(dominant) {
    const lang = state.currentLang || 'ru';
    const key = 'emotion_' + String(dominant || 'neutral');
    return translations[lang]?.[key] || String(dominant || 'neutral');
}

export function stopHubEmotionPreview() {
    if (hubEmotionTimer) {
        clearInterval(hubEmotionTimer);
        hubEmotionTimer = null;
    }
}

function startHubEmotionPreview() {
    stopHubEmotionPreview();
    const el = document.getElementById('testHubEmotionPreview');
    if (!el) return;
    const video = document.getElementById('precheckVideo');
    const analyzer = state.runtime?.localAnalyzer;
    if (!video?.srcObject || !analyzer) {
        el.textContent = t('hub_emotion_no_camera');
        return;
    }
    el.textContent = `${t('hub_emotion_label')}: …`;
    hubEmotionTimer = setInterval(async () => {
        try {
            if (!video.srcObject || video.readyState < 2) return;
            const result = await analyzer.analyzeFrame(video);
            const sample = getEmotionSample(result);
            const name = emotionDisplayName(sample.dominant);
            const vl = Number.isFinite(sample.valence) ? sample.valence.toFixed(2) : '?';
            const ar = Number.isFinite(sample.arousal) ? sample.arousal.toFixed(2) : '?';
            let top = '';
            if (sample.scores && typeof sample.scores === 'object') {
                top = Object.entries(sample.scores)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([k, v]) => `${emotionDisplayName(k)} ${Math.round((Number(v) || 0) * 100)}%`)
                    .join(' · ');
            }
            el.textContent = `${t('hub_emotion_label')}: ${name} (v ${vl}, a ${ar})${top ? ' — ' + top : ''}`;
        } catch (_) {}
    }, 400);
}

function t(key, fallback = null) {
    const lang = state.currentLang || 'ru';
    const value = translations?.[lang]?.[key];
    if (value) return value;
    return fallback || key;
}

function show(el, mode = 'block') {
    if (el) el.style.display = mode;
}

function hide(el) {
    if (el) el.style.display = 'none';
}

function setActiveStep(stepId) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const step = document.getElementById(stepId);
    if (step) step.classList.add('active');
}

function setHubButtonsDisabled(disabled) {
    const ids = [
        'hubRunRtBtn',
        'hubRunTrackingBtn',
        'hubRunBpmBtn',
        'hubRunVpcBtn',
        'hubRunVisuospatialBtn',
        'hubFinishSessionBtn'
    ];
    for (const id of ids) {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = disabled;
    }
}

function showHubContainers() {
    const hub = document.getElementById('testHubContainer');
    const cognitive = document.getElementById('cognitiveContainer');
    const gazeContainer = document.getElementById('gazeTestsContainer');
    const vpc = document.getElementById('vpcTestScreen');
    const visuospatial = document.getElementById('visuospatialTestScreen');
    const bpm = document.getElementById('bpmTestScreen');

    setActiveStep('step6');
    show(document.querySelector('.container'), 'block');
    show(document.querySelector('.top-bar'), 'flex');

    show(hub, 'block');
    hide(cognitive);
    hide(gazeContainer);
    hide(vpc);
    hide(visuospatial);
    hide(bpm);
    startHubEmotionPreview();
}

function showRTContainers() {
    const hub = document.getElementById('testHubContainer');
    const cognitive = document.getElementById('cognitiveContainer');
    const gazeContainer = document.getElementById('gazeTestsContainer');
    const vpc = document.getElementById('vpcTestScreen');
    const visuospatial = document.getElementById('visuospatialTestScreen');
    const bpm = document.getElementById('bpmTestScreen');

    setActiveStep('step6');
    show(document.querySelector('.container'), 'block');
    show(document.querySelector('.top-bar'), 'flex');

    hide(hub);
    show(cognitive, 'block');
    hide(gazeContainer);
    hide(vpc);
    hide(visuospatial);
    hide(bpm);
    stopHubEmotionPreview();
}

function renderHubTexts() {
    const subtitle = document.getElementById('testHubSubtitle');
    const finishBtn = document.getElementById('hubFinishSessionBtn');
    const runRt = document.getElementById('hubRunRtBtn');
    const runTracking = document.getElementById('hubRunTrackingBtn');
    const runBpm = document.getElementById('hubRunBpmBtn');
    const runVpc = document.getElementById('hubRunVpcBtn');
    const runVis = document.getElementById('hubRunVisuospatialBtn');

    if (subtitle) subtitle.textContent = t('test_hub_subtitle', 'Выберите тест для запуска. После завершения можно запустить следующий.');
    if (finishBtn) finishBtn.textContent = t('test_hub_finish', 'Завершить сессию');
    if (runRt) runRt.textContent = t('test_card_rt_title', 'RT test (Go/NoGo)');
    if (runTracking) runTracking.textContent = t('test_card_tracking_title', 'Tracking test');
    if (runBpm) runBpm.textContent = t('test_card_bpm_title', 'BPM test (rPPG)');
    if (runVpc) runVpc.textContent = t('test_card_vpc_title', 'VPC (Felidae)');
    if (runVis) runVis.textContent = t('test_card_visuospatial_title', 'Visuospatial drawing');
}

function renderHubStatus(message) {
    const status = document.getElementById('testHubLastResult');
    if (!status) return;
    status.textContent = message;
}

function buildSelectionRecord(testId) {
    return {
        testId,
        selectedAt: Date.now(),
        phase: state.runtime.currentPhase || null
    };
}

function summarizeRunForHub(testId, payload) {
    if (!payload) return `${testId}: no payload`;

    if (testId === TEST_IDS.VPC) {
        const summary = payload.summary || {};
        return `VPC: trials=${summary.trialCount || 0}, valid=${summary.validTrials || 0}, novelty=${summary.meanNoveltyPreferencePct ?? 'n/a'}%`;
    }

    if (testId === TEST_IDS.VISUOSPATIAL) {
        const metrics = payload.metrics || {};
        return `Visuospatial: points=${metrics.pointCount || 0}, path=${metrics.pathLengthPx || 0}px, coverage=${metrics.coveragePct || 0}%`;
    }

    if (testId === TEST_IDS.TRACKING) {
        return `Tracking: samples=${payload.trackingSamples || 0}, avgCameraFps=${payload.averageCameraFps ?? 'n/a'}`;
    }

    if (testId === TEST_IDS.BPM) {
        return `BPM: samples=${payload.sampleCount || 0}, mean=${payload.bpmMean ?? 'n/a'}`;
    }

    if (testId === TEST_IDS.RT) {
        const trials = payload?.trialResults ?? payload?.cognitiveResults ?? null;
        return `RT: trials=${Number.isFinite(trials) ? trials : 'n/a'}`;
    }

    return `${testId}: completed`;
}

async function runSelectedTest(testId, handlers) {
    const hub = document.getElementById('testHubContainer');
    if (!hub) return;

    if (hubBusy) return;
    hubBusy = true;
    setHubButtonsDisabled(true);
    stopHubEmotionPreview();

    const selection = buildSelectionRecord(testId);
    pushHubSelection(state.sessionData, selection);

    recordSessionEvent('test_hub_select', {
        testId,
        selectedAt: selection.selectedAt
    });

    try {
        // Safety: на старте каждого запуска гарантируем, что custom-loop не завис с предыдущего теста.
        stopGazeTestsAnalysisLoop();
        clearTaskContext();
        state.flags.isRecording = true;
        renderHubStatus(t('test_hub_running', 'Тест выполняется...'));

        let runPayload = null;

        if (testId === TEST_IDS.RT) {
            if (typeof handlers.runRTTest !== 'function') throw new Error('runRTTest handler missing');
            showRTContainers();
            runPayload = await handlers.runRTTest();
        } else if (testId === TEST_IDS.TRACKING) {
            if (typeof handlers.runTrackingTest !== 'function') throw new Error('runTrackingTest handler missing');
            hide(hub);
            runPayload = await handlers.runTrackingTest();
        } else if (testId === TEST_IDS.BPM) {
            if (typeof handlers.runBpmTest !== 'function') throw new Error('runBpmTest handler missing');
            hide(hub);
            runPayload = await handlers.runBpmTest();
        } else if (testId === TEST_IDS.VPC) {
            hide(hub);
            if (!isGazeTestsAnalysisLoopRunning()) {
                const started = startGazeTestsAnalysisLoop();
                if (!started) {
                    throw new Error('Не удалось запустить анализ камеры для VPC');
                }
            }
            runPayload = await runVPCTest({ t: key => t(key) });
            stopGazeTestsAnalysisLoop();
        } else if (testId === TEST_IDS.VISUOSPATIAL) {
            hide(hub);
            if (!isGazeTestsAnalysisLoopRunning()) {
                const started = startGazeTestsAnalysisLoop();
                if (!started) {
                    throw new Error('Не удалось запустить анализ камеры для visuospatial');
                }
            }
            runPayload = await runVisuospatialDrawingTest({ t: key => t(key) });
            stopGazeTestsAnalysisLoop();
        } else {
            throw new Error(`Unsupported testId: ${testId}`);
        }

        const runSummaryText = summarizeRunForHub(testId, runPayload);
        pushHubRun(state.sessionData, {
            testId,
            startedAt: selection.selectedAt,
            completedAt: Date.now(),
            summary: runSummaryText
        });

        recordSessionEvent('test_hub_run_complete', {
            testId,
            completedAt: Date.now(),
            summary: runSummaryText
        });

        showHubContainers();
        setSessionPhase(TEST_PHASES.HUB, { source: 'test_hub_return' });
        renderHubStatus(`${t('test_hub_last_result', 'Последний результат')}: ${runSummaryText}`);
    } catch (error) {
        stopGazeTestsAnalysisLoop();
        showHubContainers();
        setSessionPhase(TEST_PHASES.HUB, { source: 'test_hub_error_return' });

        const message = String(error?.message || error);
        recordSessionEvent('test_hub_run_error', {
            testId,
            message
        });
        renderHubStatus(`${t('test_hub_error', 'Ошибка теста')}: ${message}`);
    } finally {
        hubBusy = false;
        setHubButtonsDisabled(false);
    }
}

export function startTestHub(handlers = {}) {
    ensureTestHubSessionFields(state.sessionData);

    stopGazeTestsAnalysisLoop();
    clearTaskContext();
    state.flags.isRecording = true;

    renderHubTexts();
    showHubContainers();

    setSessionPhase(TEST_PHASES.HUB, { source: 'start_test_hub' });
    recordSessionEvent('test_hub_open', {
        availableTests: [TEST_IDS.RT, TEST_IDS.TRACKING, TEST_IDS.BPM, TEST_IDS.VPC, TEST_IDS.VISUOSPATIAL]
    });

    renderHubStatus(t('test_hub_ready', 'Выберите тест, который хотите пройти.'));

    const rtBtn = document.getElementById('hubRunRtBtn');
    const trackingBtn = document.getElementById('hubRunTrackingBtn');
    const bpmBtn = document.getElementById('hubRunBpmBtn');
    const vpcBtn = document.getElementById('hubRunVpcBtn');
    const visBtn = document.getElementById('hubRunVisuospatialBtn');
    const finishBtn = document.getElementById('hubFinishSessionBtn');

    if (rtBtn) {
        rtBtn.onclick = () => runSelectedTest(TEST_IDS.RT, handlers);
    }
    if (trackingBtn) {
        trackingBtn.onclick = () => runSelectedTest(TEST_IDS.TRACKING, handlers);
    }
    if (bpmBtn) {
        bpmBtn.onclick = () => runSelectedTest(TEST_IDS.BPM, handlers);
    }
    if (vpcBtn) {
        vpcBtn.onclick = () => runSelectedTest(TEST_IDS.VPC, handlers);
    }
    if (visBtn) {
        visBtn.onclick = () => runSelectedTest(TEST_IDS.VISUOSPATIAL, handlers);
    }
    if (finishBtn) {
        finishBtn.onclick = async () => {
            if (hubBusy) return;
            hubBusy = true;
            setHubButtonsDisabled(true);

            recordSessionEvent('test_hub_finish_session_click', {
                selectedRuns: state.sessionData?.testHub?.runs?.length || 0
            });

            stopGazeTestsAnalysisLoop();
            stopHubEmotionPreview();
            if (typeof handlers.finishSession === 'function') {
                await handlers.finishSession();
            }
        };
    }
}