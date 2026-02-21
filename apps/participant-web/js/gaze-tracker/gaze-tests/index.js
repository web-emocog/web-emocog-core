import { state, clearTaskContext, setSessionPhase, recordSessionEvent } from '../../web-page/state.js';
import { translations } from '../../../translations.js';
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

    setActiveStep('step6');
    show(document.querySelector('.container'), 'block');
    show(document.querySelector('.top-bar'), 'flex');

    show(hub, 'block');
    hide(cognitive);
    hide(gazeContainer);
    hide(vpc);
    hide(visuospatial);
}

function showRTContainers() {
    const hub = document.getElementById('testHubContainer');
    const cognitive = document.getElementById('cognitiveContainer');
    const gazeContainer = document.getElementById('gazeTestsContainer');
    const vpc = document.getElementById('vpcTestScreen');
    const visuospatial = document.getElementById('visuospatialTestScreen');

    setActiveStep('step6');
    show(document.querySelector('.container'), 'block');
    show(document.querySelector('.top-bar'), 'flex');

    hide(hub);
    show(cognitive, 'block');
    hide(gazeContainer);
    hide(vpc);
    hide(visuospatial);
}

function renderHubTexts() {
    const subtitle = document.getElementById('testHubSubtitle');
    const finishBtn = document.getElementById('hubFinishSessionBtn');
    const runRt = document.getElementById('hubRunRtBtn');
    const runTracking = document.getElementById('hubRunTrackingBtn');
    const runVpc = document.getElementById('hubRunVpcBtn');
    const runVis = document.getElementById('hubRunVisuospatialBtn');

    if (subtitle) subtitle.textContent = t('test_hub_subtitle', 'Выберите тест для запуска. После завершения можно запустить следующий.');
    if (finishBtn) finishBtn.textContent = t('test_hub_finish', 'Завершить сессию');
    if (runRt) runRt.textContent = t('test_card_rt_title', 'RT test (Go/NoGo)');
    if (runTracking) runTracking.textContent = t('test_card_tracking_title', 'Tracking test');
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
        availableTests: [TEST_IDS.RT, TEST_IDS.TRACKING, TEST_IDS.VPC, TEST_IDS.VISUOSPATIAL]
    });

    renderHubStatus(t('test_hub_ready', 'Выберите тест, который хотите пройти.'));

    const rtBtn = document.getElementById('hubRunRtBtn');
    const trackingBtn = document.getElementById('hubRunTrackingBtn');
    const vpcBtn = document.getElementById('hubRunVpcBtn');
    const visBtn = document.getElementById('hubRunVisuospatialBtn');
    const finishBtn = document.getElementById('hubFinishSessionBtn');

    if (rtBtn) {
        rtBtn.onclick = () => runSelectedTest(TEST_IDS.RT, handlers);
    }
    if (trackingBtn) {
        trackingBtn.onclick = () => runSelectedTest(TEST_IDS.TRACKING, handlers);
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
            if (typeof handlers.finishSession === 'function') {
                await handlers.finishSession();
            }
        };
    }
}