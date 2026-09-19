import { state, clearTaskContext, setSessionPhase, recordSessionEvent } from '../../web-page/state.js?v=20260919-1';
import { translations } from '../../../translations.js?v=20260919-1';
import { getEmotionSample } from '../../emotion-stub-new.js';
import { TEST_IDS, TEST_PHASES } from './constants.js';
import {
    ensureTestHubSessionFields,
    pushHubSelection,
    pushHubRun
} from './session-schema.js';
import { runVPCTest } from './vpc/runner.js';
import { runVisuospatialDrawingTest } from './visuospatial/runner.js?v=20260909-1';
import {
    startGazeTestsAnalysisLoop,
    stopGazeTestsAnalysisLoop,
    isGazeTestsAnalysisLoopRunning
} from './common/analysis-loop.js?v=20260919-1';
import { getSessionRuntime } from '../../session-runtime/index.js?v=20260919-1';

let hubBusy = false;
let hubEmotionTimer = null;

function dbg(scope, event, data) {
    try {
        const d = window.WECOG_DEBUG;
        if (d && d.enabled) d.log(scope, event, data);
    } catch (_) { /* ignore */ }
}

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
            const centralAnalysis = getSessionRuntime()?.isAnalysisRunning();
            const result = centralAnalysis
                ? state.runtime.lastPrecheckResult
                : await analyzer.analyzeFrame(video);
            if (!result) return;
            const sample = centralAnalysis
                ? state.runtime.lastEmotionSample
                : getEmotionSample(result);
            if (!sample) return;
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

function participantText(ru, en, es) {
    if (state.currentLang === 'ru') return ru;
    if (state.currentLang === 'es') return es || en;
    return en;
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

function applyInvitationHubVisibility() {
    const allowed = state.runtime?.invitationSelectedMetrics;
    const invitationCode = state.sessionData?.ids?.invitationCode
        || state.runtime?.invitationProtocolMeta?.code;
    const map = {
        rt: 'hubRunRtBtn',
        tracking: 'hubRunTrackingBtn',
        vpc: 'hubRunVpcBtn',
        visuospatial: 'hubRunVisuospatialBtn'
    };
    const showAll = !invitationCode && (!Array.isArray(allowed) || !allowed.length);
    Object.keys(map).forEach((metric) => {
        const btn = document.getElementById(map[metric]);
        if (!btn) return;
        const visible = showAll || allowed.includes(metric);
        btn.style.display = visible ? '' : 'none';
        btn.disabled = !visible;
    });
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
    if (!disabled) applyInvitationHubVisibility();
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
    startHubEmotionPreview();
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
    stopHubEmotionPreview();
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

function testIdForPendingRepeat(repeat) {
    const blockId = String(repeat?.blockId || '');
    const blockType = String(repeat?.blockType || '');
    const directId = blockId.startsWith('test_') ? blockId.slice(5) : blockType;
    if (Object.values(TEST_IDS).includes(directId)) return directId;
    if (blockType === 'cognitive_task') {
        return TEST_IDS.RT;
    }
    return null;
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

function instructionForTest(testId, options = {}) {
    const position = Number.isInteger(options.index) && Number.isInteger(options.count)
        ? `${options.index + 1}/${options.count}`
        : null;
    const title = testId === TEST_IDS.TRACKING
        ? t('test_card_tracking_title', 'Слежение за фигурой')
        : (testId === TEST_IDS.VPC
            ? t('test_card_vpc_title', 'VPC: семейство кошачьих')
            : t('test_card_visuospatial_title', 'Зрительно-пространственное рисование'));
    const body = testId === TEST_IDS.TRACKING
        ? participantText(
            'Следите глазами за движущейся фигурой естественно. Не пытайтесь управлять маркером взгляда.',
            'Follow the moving figure naturally with your eyes. Do not try to move the gaze marker.',
            'Siga la figura en movimiento de forma natural con la mirada. No intente controlar el marcador de mirada.'
        )
        : (testId === TEST_IDS.VPC
            ? t('vpc_instruction', 'Смотрите на изображения кошачьих естественно. Нажимать ничего не нужно.')
            : participantText(
                'Прочитайте задание. Удерживайте Пробел, чтобы рисовать взглядом; отпустите его, чтобы поднять кисть.',
                'Read the prompt. Hold Space to draw with your gaze and release it to lift the pen.',
                'Lea la consigna. Mantenga pulsada la barra espaciadora para dibujar con la mirada y suéltela para levantar el pincel.'
            ));
    return {
        blockId: `test_${testId}`,
        blockType: testId,
        title: position ? `${title} · ${position}` : title,
        body
    };
}

async function runSelectedTest(testId, handlers, options = {}) {
    const hub = document.getElementById('testHubContainer');
    if (!hub) return;
    const returnToHub = options.returnToHub !== false;

    if (hubBusy) return;
    hubBusy = true;
    let delegatedRetry = false;
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
        const runtime = getSessionRuntime();
        const usesInternalBlocks = testId === TEST_IDS.RT;
        let runPayload = null;

        if (testId === TEST_IDS.RT) {
            if (typeof handlers.runRTTest !== 'function') throw new Error('runRTTest handler missing');
            showRTContainers();
            runPayload = await handlers.runRTTest();
        } else if (testId === TEST_IDS.TRACKING) {
            if (typeof handlers.runTrackingTest !== 'function') throw new Error('runTrackingTest handler missing');
            await runtime?.promptBlockInstruction(instructionForTest(testId, options));
            runtime?.beginBlock({ blockId: `test_${testId}`, blockType: testId });
            hide(hub);
            runPayload = await handlers.runTrackingTest();
        } else if (testId === TEST_IDS.VPC) {
            await runtime?.promptBlockInstruction(instructionForTest(testId, options));
            runtime?.beginBlock({ blockId: `test_${testId}`, blockType: testId });
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
            runtime?.enterInstruction({
                source: 'visuospatial_instruction',
                blockId: `test_${testId}`,
                blockType: testId
            });
            hide(hub);
            if (!isGazeTestsAnalysisLoopRunning()) {
                const started = startGazeTestsAnalysisLoop();
                if (!started) {
                    throw new Error('Не удалось запустить анализ камеры для visuospatial');
                }
            }
            runPayload = await runVisuospatialDrawingTest({
                t: key => t(key),
                onStart: () => {
                    runtime?.beginBlock({
                        blockId: `test_${testId}`,
                        blockType: testId
                    });
                }
            });
            stopGazeTestsAnalysisLoop();
        } else {
            throw new Error(`Unsupported testId: ${testId}`);
        }

        const blockDecision = usesInternalBlocks
            ? { repeatRequired: false }
            : (runtime?.completeBlock({ success: true }) || { repeatRequired: false });
        if (blockDecision.repeatRequired) {
            if (returnToHub) showHubContainers();
            else hide(hub);
            const attempt = blockDecision.block?.attempt || 1;
            if (attempt < 3) {
                await runtime.promptRepeat(`test_${testId}`);
                hubBusy = false;
                setHubButtonsDisabled(false);
                delegatedRetry = true;
                return runSelectedTest(testId, handlers, options);
            }
            const abandonedRepeat = runtime?.discardRepeat(`test_${testId}`);
            if (abandonedRepeat) await runtime.notifyRepeatLimit(abandonedRepeat);
            if (runPayload && typeof runPayload === 'object') {
                runPayload.qualityValid = false;
                runPayload.qualityRetryLimitReached = true;
            }
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

        if (options.protocolLocked && testId !== TEST_IDS.RT) {
            await runtime?.notifyBlockComplete({
                blockId: `test_${testId}`,
                blockType: testId
            });
        }

        if (returnToHub) {
            showHubContainers();
            setSessionPhase(TEST_PHASES.HUB, { source: 'test_hub_return' });
            renderHubStatus(`${t('test_hub_last_result', 'Последний результат')}: ${runSummaryText}`);
        } else {
            hide(hub);
        }
        return runPayload;
    } catch (error) {
        const runtime = getSessionRuntime();
        const issue = runtime?.reportIssue({
            kind: 'technical',
            code: `module_run_failed_${testId}`,
            message: `Тест ${testId} завершился технической ошибкой: ${error?.message || String(error)}`,
            recoverable: true
        });
        const current = runtime?.getCurrentBlock();
        const decision = current
            ? runtime.completeBlock({ success: false, reason: issue?.code || 'module_error' })
            : { repeatRequired: false, block: null };
        stopGazeTestsAnalysisLoop();
        if (returnToHub) {
            showHubContainers();
            setSessionPhase(TEST_PHASES.HUB, { source: 'test_hub_error_return' });
        } else {
            hide(hub);
        }

        const message = String(error?.message || error);
        recordSessionEvent('test_hub_run_error', {
            testId,
            message
        });
        renderHubStatus(`${t('test_hub_error', 'Ошибка теста')}: ${message}`);
        if (decision.repeatRequired && (decision.block?.attempt || 1) < 3) {
            await runtime.promptRepeat(decision.block.blockId);
            runtime.resolveIssue(issue.code);
            hubBusy = false;
            setHubButtonsDisabled(false);
            delegatedRetry = true;
            return runSelectedTest(testId, handlers, options);
        }
        if (decision.repeatRequired && decision.block?.blockId) {
            runtime.discardRepeat(decision.block.blockId);
        }
        if (issue?.code) runtime.resolveIssue(issue.code);
    } finally {
        if (!delegatedRetry) {
            hubBusy = false;
            setHubButtonsDisabled(false);
        }
    }
}

export async function runProtocolTestSequence(testIds, handlers = {}) {
    ensureTestHubSessionFields(state.sessionData);
    const supported = new Set(Object.values(TEST_IDS));
    const protocolAliases = {
        rt: TEST_IDS.RT,
        tracking: TEST_IDS.TRACKING,
        vpc: TEST_IDS.VPC,
        visuospatial: TEST_IDS.VISUOSPATIAL
    };
    const queue = (Array.isArray(testIds) ? testIds : [])
        .map(testId => String(testId || '').trim().toLowerCase())
        .map(testId => protocolAliases[testId] || testId)
        .filter(testId => supported.has(testId));
    const hub = document.getElementById('testHubContainer');

    stopGazeTestsAnalysisLoop();
    stopHubEmotionPreview();
    clearTaskContext();
    state.flags.isRecording = true;
    hide(hub);
    setActiveStep('step6');
    show(document.querySelector('.container'), 'block');
    show(document.querySelector('.top-bar'), 'flex');

    setSessionPhase('protocol_instruction', { source: 'protocol_test_sequence' });
    getSessionRuntime()?.enterInstruction({ source: 'protocol_test_sequence' });
    recordSessionEvent('protocol_test_sequence_start', {
        tests: queue,
        count: queue.length
    });
    await getSessionRuntime()?.requireQualityInstruction();

    for (let index = 0; index < queue.length; index += 1) {
        const testId = queue[index];
        recordSessionEvent('protocol_test_sequence_advance', {
            testId,
            index,
            count: queue.length
        });
        await runSelectedTest(testId, handlers, {
            returnToHub: false,
            protocolLocked: true,
            index,
            count: queue.length
        });
    }

    recordSessionEvent('protocol_test_sequence_complete', {
        tests: queue,
        count: queue.length
    });
    if (typeof handlers.finishSession === 'function') {
        await handlers.finishSession();
    }
}

export async function startTestHub(handlers = {}) {
    ensureTestHubSessionFields(state.sessionData);

    stopGazeTestsAnalysisLoop();
    clearTaskContext();
    state.flags.isRecording = true;

    renderHubTexts();
    applyInvitationHubVisibility();
    showHubContainers();
    setHubButtonsDisabled(true);

    setSessionPhase(TEST_PHASES.HUB, { source: 'start_test_hub' });
    getSessionRuntime()?.enterInstruction({ source: 'test_hub' });
    recordSessionEvent('test_hub_open', {
        availableTests: [TEST_IDS.RT, TEST_IDS.TRACKING, TEST_IDS.VPC, TEST_IDS.VISUOSPATIAL]
    });

    renderHubStatus(t('test_hub_ready', 'Выберите тест, который хотите пройти.'));
    await getSessionRuntime()?.requireQualityInstruction();
    setHubButtonsDisabled(false);

    const rtBtn = document.getElementById('hubRunRtBtn');
    const trackingBtn = document.getElementById('hubRunTrackingBtn');
    const vpcBtn = document.getElementById('hubRunVpcBtn');
    const visBtn = document.getElementById('hubRunVisuospatialBtn');
    const finishBtn = document.getElementById('hubFinishSessionBtn');

    if (rtBtn) {
        rtBtn.onclick = () => {
            dbg('ui', 'button:hubRunRtBtn', { testId: TEST_IDS.RT });
            runSelectedTest(TEST_IDS.RT, handlers);
        };
    }
    if (trackingBtn) {
        trackingBtn.onclick = () => {
            dbg('ui', 'button:hubRunTrackingBtn', { testId: TEST_IDS.TRACKING });
            runSelectedTest(TEST_IDS.TRACKING, handlers);
        };
    }
    if (vpcBtn) {
        vpcBtn.onclick = () => {
            dbg('ui', 'button:hubRunVpcBtn', { testId: TEST_IDS.VPC });
            runSelectedTest(TEST_IDS.VPC, handlers);
        };
    }
    if (visBtn) {
        visBtn.onclick = () => {
            dbg('ui', 'button:hubRunVisuospatialBtn', { testId: TEST_IDS.VISUOSPATIAL });
            runSelectedTest(TEST_IDS.VISUOSPATIAL, handlers);
        };
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

    const runtime = getSessionRuntime();
    const pendingRepeat = runtime?.machine?.snapshot?.().repeatQueue?.[0] || null;
    const repeatTestId = testIdForPendingRepeat(pendingRepeat);
    if (pendingRepeat && repeatTestId) {
        renderHubStatus(
            participantText(
                'Сейчас будет повторён прерванный тест.',
                'The interrupted test will now be repeated.',
                'Ahora se repetirá la prueba interrumpida.'
            )
        );
        if (repeatTestId !== TEST_IDS.RT) {
            await runtime.promptRepeat(pendingRepeat.blockId);
        }
        return runSelectedTest(repeatTestId, handlers);
    }
}
