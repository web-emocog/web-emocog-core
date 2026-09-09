// Фаза 0: точка входа с обновлённым UI (агрегаты без PII, опция «только сводка»). Исходный: app.js
// Фаза 1.2: инициализация QC pause overlay
import { state, getCurrentTaskContext, getRelativeSessionTimeMs, recordSessionEvent } from './state.js';
import { 
    setLanguage, 
    nextStep, 
    toggleConsent, 
    generateIdsAndProceed, 
    generateUniqueId,
    copyIds, 
    checkForm, 
    submitForm,
    validateEmailField, 
    collectTechDataAndProceed, 
    updateFinalStepWithQC,
    stopPreCheckOnLeave,
    downloadData
} from './ui-updated.js?v=20260909-1';

import { 
    startPreCheck, 
    stopPreCheck
} from './precheck-updated.js?v=20260909-1';

import { 
    startCalibration, 
    finishSession
} from './tests-updated.js?v=20260909-2';

import {
    deriveInvitationHubMetrics,
    getInvitationSessionPlan,
    getParticipantShell
} from './protocol-invite-utils.js';

import { init as initQcPauseOverlay } from '../qc-pause-overlay-new.js';
import { initSessionRuntime, getSessionRuntime } from '../session-runtime/index.js?v=20260909-1';
import {
    getContentViewport,
    contentToLayoutViewport
} from '../gaze-tracker/viewport-coordinates.mjs';
import { resolveParticipantApiBase } from '../session-runtime/api-base.mjs';
import {
    captureAudioConsent,
    configureAudioConsentUI
} from '../audio/consent-ui.js';

const RETAINED_GAZE_TARGET = 30_000;
const RETAINED_GAZE_HARD_CAP = 32_000;
const PARTICIPANT_LOCALES = new Set(['ru', 'en', 'zh', 'es', 'hi', 'ar', 'fr', 'bn', 'pt', 'ur']);

function participantText(ru, en, es) {
    if (state.currentLang === 'ru') return ru;
    if (state.currentLang === 'es') return es || en;
    return en;
}

export function appendGazeSample(sample) {
    state.sessionData.eyeTracking.push(sample);
    if (state.sessionData.eyeTracking.length > RETAINED_GAZE_HARD_CAP) {
        const overflow = state.sessionData.eyeTracking.length - RETAINED_GAZE_TARGET;
        state.sessionData.eyeTracking.splice(0, overflow);
    }
}
initQcPauseOverlay({ getLang: () => state.currentLang });

if (typeof window !== 'undefined') {
    window.__WECOG_STATE__ = state;
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

let _gazeDebugSampleN = 0;
let _eyeTrackingShapeLogged = false;

function currentStimulusContentRect() {
    if (state.runtime.currentPhase !== 'cognitive_stimulus') return null;
    const stage = document.getElementById('cognitiveStimulusArea');
    if (!stage || getComputedStyle(stage).display === 'none') return null;
    const rect = stage.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    const viewport = getContentViewport();
    return {
        left: rect.left - viewport.offsetLeft,
        top: rect.top - viewport.offsetTop,
        width: rect.width,
        height: rect.height,
        intrinsicWidth: null,
        intrinsicHeight: null
    };
}

window.setLanguage = setLanguage;
window.nextStep = nextStep;
window.copyIds = copyIds;
window.validateEmailField = validateEmailField;
window.downloadData = downloadData;

export function handleGazeUpdate(gazeData) {
    const customDot = document.getElementById('customGazeDot');
    state.runtime.currentGazePrediction = gazeData || null;
    const displayX = Number.isFinite(gazeData?.displayX)
        ? gazeData.displayX
        : (Number.isFinite(gazeData?.x) ? gazeData.x : null);
    const displayY = Number.isFinite(gazeData?.displayY)
        ? gazeData.displayY
        : (Number.isFinite(gazeData?.y) ? gazeData.y : null);
    const d = window.WECOG_DEBUG;
    if (d && d.enabled) {
        if (d.recordGazeSample) {
            d.recordGazeSample({
                onScreen: typeof gazeData?.onScreen === 'boolean' ? gazeData.onScreen : null,
                clipped: typeof gazeData?.clipped === 'boolean' ? gazeData.clipped : null,
                correctedX: gazeData?.correctedX,
                correctedY: gazeData?.correctedY,
                screenWidth: getContentViewport().width,
                screenHeight: getContentViewport().height
            });
        }
        _gazeDebugSampleN += 1;
        if (_gazeDebugSampleN % 30 === 0) {
            const sw = window.innerWidth || 1;
            const sh = window.innerHeight || 1;
            dbg('gaze', 'handleGazeUpdate', {
                sampleIndex: _gazeDebugSampleN,
                modelXFinite: Number.isFinite(gazeData?.modelX),
                modelYFinite: Number.isFinite(gazeData?.modelY),
                correctedXFinite: Number.isFinite(gazeData?.correctedX),
                correctedYFinite: Number.isFinite(gazeData?.correctedY),
                clipped: gazeData?.clipped,
                onScreen: gazeData?.onScreen,
                onScreenSource: typeof gazeData?.onScreen === 'boolean' ? 'gazeData' : 'boundary_fallback',
                bounds: { xMin: 0, xMax: sw, yMin: 0, yMax: sh },
                phase: state.runtime.currentPhase || null
            });
        }
    }

    if (!gazeData || !Number.isFinite(displayX) || !Number.isFinite(displayY)) {
        state.runtime.currentGaze = { x: null, y: null };
        if (customDot) customDot.style.display = 'none';

        if (gazeData && state.flags.isRecording) {
            const rejectedAt = gazeData.t || gazeData.timestamp || Date.now();
            const taskContext = getCurrentTaskContext();
            const viewport = getContentViewport();
            const stimulusRect = currentStimulusContentRect();
            const clockStamp = state.runtime.sessionClock?.now?.() || null;
            appendGazeSample({
                x: null,
                y: null,
                displayX: null,
                displayY: null,
                rawX: Number.isFinite(gazeData.rawX) ? gazeData.rawX : null,
                rawY: Number.isFinite(gazeData.rawY) ? gazeData.rawY : null,
                correctedX: Number.isFinite(gazeData.correctedX) ? gazeData.correctedX : null,
                correctedY: Number.isFinite(gazeData.correctedY) ? gazeData.correctedY : null,
                valid: false,
                rejectionReason: gazeData.rejectionReason || 'no_display_signal',
                confidence: Number.isFinite(gazeData.confidence) ? gazeData.confidence : null,
                ood: gazeData.ood || null,
                onScreen: false,
                clipped: gazeData.clipped === true,
                t: rejectedAt,
                timeOriginMs: clockStamp?.timeOriginMs ?? null,
                monotonicMs: clockStamp?.monotonicMs ?? rejectedAt,
                sessionTimeMs: clockStamp?.sessionTimeMs ?? getRelativeSessionTimeMs(rejectedAt),
                tRelMs: getRelativeSessionTimeMs(rejectedAt),
                phase: state.runtime.currentPhase || '',
                blockId: taskContext.blockId ?? null,
                attempt: taskContext.attempt ?? null,
                trialId: taskContext.trialId ?? null,
                presentationId: taskContext.presentationId ?? null,
                stimulusId: taskContext.stimulusId ?? null,
                stimulusName: taskContext.stimulusName ?? null,
                stimulusType: taskContext.stimulusType ?? null,
                stimulusRect,
                screenWidth: viewport.width,
                screenHeight: viewport.height
            });
        }
        
        if (
            state.runtime.qcMetrics
            && state.runtime.qcMetrics.isRunning()
            && state.runtime.gazeTracker?.isCalibrated?.() === true
        ) {
            state.runtime.qcMetrics.addGazePoint(null, state.runtime.lastPoseData);
        }
        return;
    }

    const x = Math.round(displayX);
    const y = Math.round(displayY);
    const t = gazeData.t || gazeData.timestamp || Date.now();

    state.runtime.currentGaze = { x, y };
    const phase = state.runtime.currentPhase || '';
    const taskContext = getCurrentTaskContext();
    const viewport = getContentViewport();
    const screenWidth = viewport.width;
    const screenHeight = viewport.height;
    // Берём честный onScreen из gaze-tracker (считается по correctedX/correctedY до clamp).
    // Fallback на boundary-чек по зажатым x/y оставляем ради старых сэмплов / тестов,
    // где трекер мог не выставить флаг.
    const onScreen = typeof gazeData.onScreen === 'boolean'
        ? gazeData.onScreen
        : (x >= 0 && x <= screenWidth && y >= 0 && y <= screenHeight);
    const clipped = typeof gazeData.clipped === 'boolean' ? gazeData.clipped : !onScreen;
    const confidence = Number.isFinite(gazeData.confidence) ? gazeData.confidence : null;
    const stimulusRect = currentStimulusContentRect();
    // Participant-facing sessions never expose the predicted gaze position.
    // The signal is still collected and remains available in developer tools.
    const showGazeDot = false;

    if (customDot && showGazeDot) {
        const layoutPoint = contentToLayoutViewport({ x, y });
        customDot.style.display = 'block';
        customDot.style.left = `${layoutPoint.x}px`;
        customDot.style.top = `${layoutPoint.y}px`;
    } else if (customDot) {
        customDot.style.display = 'none';
    }

    if (state.flags.isRecording) {
        const clockStamp = state.runtime.sessionClock?.now?.() || null;
        const eyeSample = {
            x,
            y,
            displayX: x,
            displayY: y,
            t,
            timeOriginMs: clockStamp?.timeOriginMs ?? null,
            monotonicMs: clockStamp?.monotonicMs ?? t,
            sessionTimeMs: clockStamp?.sessionTimeMs ?? getRelativeSessionTimeMs(t),
            tRelMs: getRelativeSessionTimeMs(t),
            phase,
            blockId: taskContext.blockId ?? null,
            attempt: taskContext.attempt ?? null,
            trialId: taskContext.trialId ?? null,
            presentationId: taskContext.presentationId ?? null,
            stimulusId: taskContext.stimulusId ?? null,
            stimulusName: taskContext.stimulusName ?? null,
            stimulusType: taskContext.stimulusType ?? null,
            stimulusRect,
            expectedResponse: taskContext.expectedResponse ?? null,
            onScreen,
            clipped,
            confidence,
            valid: gazeData.valid !== false,
            rejectionReason: gazeData.rejectionReason || null,
            ood: gazeData.ood || null,
            head: gazeData.head || null,
            smoothing: gazeData.smoothing || null,
            // Сырое предсказание модели (до post-correction). Полезно для
            // последующего переобучения affine correction на собранных сессиях.
            rawX: Number.isFinite(gazeData.rawX) ? gazeData.rawX : null,
            rawY: Number.isFinite(gazeData.rawY) ? gazeData.rawY : null,
            modelX: Number.isFinite(gazeData.rawX) ? gazeData.rawX : null,
            modelY: Number.isFinite(gazeData.rawY) ? gazeData.rawY : null,
            // После post-correction, до финального clamp. Аналитические координаты —
            // именно по ним нужно считать AOI / heatmap / off-screen.
            correctedX: Number.isFinite(gazeData.correctedX) ? gazeData.correctedX : null,
            correctedY: Number.isFinite(gazeData.correctedY) ? gazeData.correctedY : null,
            normalizedX: Number.isFinite(gazeData.correctedX) && screenWidth > 0
                ? gazeData.correctedX / screenWidth
                : null,
            normalizedY: Number.isFinite(gazeData.correctedY) && screenHeight > 0
                ? gazeData.correctedY / screenHeight
                : null,
            screenWidth,
            screenHeight
        };
        appendGazeSample(eyeSample);
        if (d && d.enabled && !_eyeTrackingShapeLogged) {
            _eyeTrackingShapeLogged = true;
            dbg('gaze', 'eyeTracking:sampleShape', {
                hasModelX: Object.prototype.hasOwnProperty.call(eyeSample, 'modelX'),
                hasModelY: Object.prototype.hasOwnProperty.call(eyeSample, 'modelY'),
                hasCorrectedX: Object.prototype.hasOwnProperty.call(eyeSample, 'correctedX'),
                hasCorrectedY: Object.prototype.hasOwnProperty.call(eyeSample, 'correctedY'),
                hasClipped: Object.prototype.hasOwnProperty.call(eyeSample, 'clipped'),
                hasOnScreen: Object.prototype.hasOwnProperty.call(eyeSample, 'onScreen'),
                hasRawX: Object.prototype.hasOwnProperty.call(eyeSample, 'rawX'),
                hasRawY: Object.prototype.hasOwnProperty.call(eyeSample, 'rawY')
            });
        }
    }

    if (
        state.runtime.qcMetrics
        && state.runtime.qcMetrics.isRunning()
        && state.runtime.gazeTracker?.isCalibrated?.() === true
    ) {
        // Передаём onScreen, чтобы QC использовал честный флаг от трекера
        // и не пересчитывал его по уже зажатым координатам.
        state.runtime.qcMetrics.addGazePoint({ x, y, onScreen }, state.runtime.lastPoseData);
    }
}

window.handleGazeUpdate = handleGazeUpdate;

export function handleEyeSignalUpdate(signalData) {
    if (!signalData || !Number.isFinite(signalData.t)) return;

    const phase = state.runtime.currentPhase || null;
    const taskContext = getCurrentTaskContext();
    const sample = {
        t: signalData.t,
        frameTimestamp: Number.isFinite(signalData.frameTimestamp)
            ? signalData.frameTimestamp
            : null,
        tRelMs: getRelativeSessionTimeMs(signalData.t),
        phase,
        blockId: taskContext.blockId ?? null,
        trialId: taskContext.trialId ?? null,
        stimulusId: taskContext.stimulusId ?? null,
        stimulusType: taskContext.stimulusType ?? null,
        expectedResponse: taskContext.expectedResponse ?? null,
        leftEAR: Number.isFinite(signalData.leftEAR) ? signalData.leftEAR : null,
        rightEAR: Number.isFinite(signalData.rightEAR) ? signalData.rightEAR : null,
        earAvg: Number.isFinite(signalData.earAvg) ? signalData.earAvg : null,
        bothOpen: signalData.bothOpen === true,
        leftIrisRadius: Number.isFinite(signalData.leftIrisRadius) ? signalData.leftIrisRadius : null,
        rightIrisRadius: Number.isFinite(signalData.rightIrisRadius) ? signalData.rightIrisRadius : null,
        leftEyeWidth: Number.isFinite(signalData.leftEyeWidth) ? signalData.leftEyeWidth : null,
        rightEyeWidth: Number.isFinite(signalData.rightEyeWidth) ? signalData.rightEyeWidth : null,
        pupilProxy: Number.isFinite(signalData.pupilProxy) ? signalData.pupilProxy : null
    };

    state.runtime.lastEyeSignal = sample;
    if (state.flags.isRecording) {
        state.sessionData.eyeSignals.push(sample);
    }
}

window.handleEyeSignalUpdate = handleEyeSignalUpdate;

export function getActiveInvitationParticipantShell() {
    if (state.runtime?.invitationParticipantShell) {
        return state.runtime.invitationParticipantShell;
    }
    if (state.runtime?.invitationProtocolDefinition) {
        return getParticipantShell(state.runtime.invitationProtocolDefinition);
    }
    return null;
}

window.getActiveInvitationParticipantShell = getActiveInvitationParticipantShell;

async function loadInvitationProtocolByCode(code) {
    const base = resolveParticipantApiBase();
    dbg('api', 'invitation:load:start', { base, codePresent: true });
    const lookupUrl = new URL(base + '/invitations/by-code/' + encodeURIComponent(code));
    const restoredSessionId = state.sessionData?.ids?.session;
    if (restoredSessionId) lookupUrl.searchParams.set('session_id', restoredSessionId);
    const response = await fetch(lookupUrl.toString());
    if (!response.ok) {
        dbgErr('api', 'invitation:load:error', { base, status: response.status });
        throw new Error('Invitation lookup failed: HTTP ' + response.status);
    }
    const payload = await response.json();
    if (payload && payload.definition && typeof payload.definition === 'object') {
        const protocolBlocks = Array.isArray(payload.definition?.blocks) ? payload.definition.blocks : [];
        const stimulusIds = [];
        const addStimulusId = (value) => {
            const key = String(value ?? '').replace(/^api:/, '').trim();
            if (key && !stimulusIds.includes(key)) stimulusIds.push(key);
        };
        const addTrialStimuli = (trials) => {
            if (!Array.isArray(trials)) return;
            trials.forEach((trial) => addStimulusId(
                trial?.stimulusId ?? trial?.stimulus_id ?? trial?.stimulus?.stimulusId ?? trial?.stimulus?.id
            ));
        };
        protocolBlocks.forEach((block) => {
            const ids = Array.isArray(block?.params?.stimuli_ids) ? block.params.stimuli_ids : [];
            ids.forEach(addStimulusId);
            addStimulusId(block?.params?.stimulus_id);
            addTrialStimuli(block?.params?.trials);
            addTrialStimuli(block?.trials);
            addTrialStimuli(block?.content?.trials);
        });

        let stimuliMap = {};
        if (payload.project_id && stimulusIds.length) {
            try {
                const stimuliResp = await fetch(
                    base + '/invitations/by-code/' + encodeURIComponent(code) + '/stimuli'
                );
                if (stimuliResp.ok) {
                    const rows = await stimuliResp.json();
                    if (Array.isArray(rows)) {
                        rows.forEach((row) => {
                            const id = String(row?.id);
                            if (stimulusIds.includes(id)) {
                                const contentUrl = typeof row?.content_url === 'string'
                                    ? base + row.content_url
                                    : null;
                                stimuliMap[id] = {
                                    id,
                                    name: row?.name || id,
                                    mime_type: row?.mime_type || null,
                                    metadata: {
                                        ...(row?.metadata || {}),
                                        ...(contentUrl ? { url: contentUrl } : {})
                                    }
                                };
                            }
                        });
                    }
                }
            } catch (e) {
                console.warn('[Invitation] Failed to load stimuli metadata:', e);
            }
        }

        state.runtime.invitationProtocolDefinition = payload.definition;
        configureAudioConsentUI(state, payload.definition);
        state.runtime.invitationProtocolMeta = {
            invitationId: payload.invitation_id || null,
            protocolId: payload.protocol_id || null,
            projectId: payload.project_id || null,
            protocolName: payload.protocol_name || null,
            code: payload.code || code
        };
        state.runtime.invitationStimuliMap = stimuliMap;
        state.sessionData.experimentMeta = {
            ...(state.sessionData.experimentMeta || {}),
            source: 'invitation',
            protocolId: payload.protocol_id || null,
            projectId: payload.project_id || null,
            protocolName: payload.protocol_name || null,
            loadedAt: Date.now()
        };
        if (payload.protocol_id != null) {
            state.sessionData.ids.protocolId = payload.protocol_id;
        }
        state.sessionData.ids.invitationCode = payload.code || code;
        const plan = getInvitationSessionPlan(payload.definition);
        state.runtime.invitationParticipantShell = plan.shell;
        state.runtime.invitationSelectedMetrics = plan.hubMetrics;
        state.runtime.invitationSessionPlan = plan;
        dbg('api', 'invitation:load:success', {
            protocolId: payload.protocol_id || null,
            projectId: payload.project_id || null,
            blockCount: protocolBlocks.length,
            hubMetrics: plan.hubMetrics,
            shell: plan.shell,
            runProtocolAfterShell: plan.runProtocolAfterShell
        });
    }
}

function isPlausibleInvitationCode(code) {
    const c = String(code || '').trim();
    if (c.length < 1 || c.length > 64) return false;
    return /^[a-zA-Z0-9_-]+$/.test(c);
}

function extractInvitationCodeFromInput(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return null;

    const fromSearchParams = (search) => {
        try {
            const sp = new URLSearchParams(search);
            const code = sp.get('code');
            return code && code.trim() ? code.trim() : null;
        } catch (_) {
            return null;
        }
    };

    const fromParticipantHash = (hash) => {
        const m = String(hash || '').match(/^#\/?participant\/([^/?#]+)/i);
        if (!m || !m[1]) return null;
        const c = decodeURIComponent(m[1]).trim();
        return isPlausibleInvitationCode(c) ? c : null;
    };

    let code = null;
    try {
        const u = new URL(value);
        code = u.searchParams.get('code');
        if (code) code = code.trim();
        if (!code) code = fromParticipantHash(u.hash);
    } catch (_) {
        if (value.includes('?')) {
            const qs = value.split('?')[1] || '';
            code = fromSearchParams(qs);
        }
        if (!code && value.includes('#')) {
            code = fromParticipantHash(value.slice(value.indexOf('#')));
        }
    }

    if (!code && /^https?:\/\//i.test(value)) {
        return null;
    }
    if (!code) {
        code = value;
    }
    if (!isPlausibleInvitationCode(code)) return null;
    return code;
}

async function fetchParticipantInviteBypass() {
    try {
        const token = localStorage.getItem('emocog_api_token');
        const base = resolveParticipantApiBase();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const r = await fetch(`${base}/auth/me`, {
            headers,
            credentials: 'include'
        });
        if (!r.ok) return false;
        const me = await r.json();
        const role = me?.user?.role || me?.role;
        return role === 'developer' || role === 'admin';
    } catch (_) {
        return false;
    }
}

function ensureDeveloperSessionIds() {
    if (state.sessionData.ids.session && state.sessionData.ids.participant) return;
    const sessionId = `S-DEV-${generateUniqueId()}`;
    const participantId = `P-DEV-${generateUniqueId()}`;
    state.sessionData.ids.session = sessionId;
    state.sessionData.ids.participant = participantId;
    state.sessionData.user.interfaceLanguage = state.currentLang;
    const idBadge = document.getElementById('idDisplay');
    if (idBadge) {
        idBadge.style.display = 'block';
        idBadge.innerText = `ID: ${participantId}`;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    let initialParticipantLanguage = state.currentLang;
    try {
        const pendingLang = window.__EMOCOG_PENDING_LANG__;
        const storedLang = localStorage.getItem('emocog_participant_lang');
        const preferredLang = pendingLang || storedLang;
        if (PARTICIPANT_LOCALES.has(preferredLang)) initialParticipantLanguage = preferredLang;
    } catch (_) {}
    setLanguage(initialParticipantLanguage);

    const sessionRuntime = await initSessionRuntime();
    configureAudioConsentUI(state, state.runtime?.invitationProtocolDefinition || null);
    dbg('app', 'app:init:start', { href: window.location.href });
    dbg('api', 'api:base', { base: resolveParticipantApiBase() });
    console.log('App initialized (Phase 0 – privacy & aggregates)');
    const participantInviteBypass = await fetchParticipantInviteBypass();

    // Код приглашения из URL (ссылка-приглашение ведёт на пречек с ?code=...)
    const params = new URLSearchParams(window.location.search);
    const invitationCodeFromUrl = params.get('code');
    const invitationCode = invitationCodeFromUrl || state.sessionData.ids.invitationCode;
    const developerModule = (params.get('developer_module') || '').trim().toLowerCase();
    let developerAutoPrecheck = false;
    try {
        developerAutoPrecheck = localStorage.getItem('emocog_dev_auto_precheck') === '1';
    } catch (_) {}
    const inviteHintGlobal = document.getElementById('inviteLinkHint');
    if (invitationCode && invitationCode.trim()) {
        state.sessionData.ids.invitationCode = invitationCode.trim();
        try {
            await loadInvitationProtocolByCode(invitationCode.trim());
            recordSessionEvent('invitation_protocol_loaded', {
                protocolId: state.runtime?.invitationProtocolMeta?.protocolId || null
            });
        } catch (e) {
            console.warn('[Invitation] Failed to load protocol by code:', e);
            state.sessionData.ids.invitationCode = null;
            state.runtime.invitationProtocolDefinition = null;
            state.runtime.invitationProtocolMeta = null;
            state.runtime.invitationLoadError = {
                code: invitationCode.trim(),
                message: e?.message || String(e)
            };
            recordSessionEvent('invitation_protocol_load_failed', {
                message: e?.message || String(e)
            });
            if (inviteHintGlobal) {
                inviteHintGlobal.textContent = participantInviteBypass
                    ? 'Приглашение из адреса не загрузилось. Проверьте код или продолжите в тестовом режиме без приглашения.'
                    : 'Приглашение из адреса страницы не загрузилось. Проверьте ссылку или попросите исследователя новую.';
            }
        }
    }

    const inviteInput = document.getElementById('inviteLinkInput');
    const inviteBtn = document.getElementById('applyInviteLinkBtn');
    const inviteHint = document.getElementById('inviteLinkHint');
    if (inviteInput && invitationCodeFromUrl) inviteInput.value = invitationCodeFromUrl;
    if (inviteBtn && inviteInput) {
        const applyInvite = () => {
            const code = extractInvitationCodeFromInput(inviteInput.value);
            if (!code) {
                if (inviteHint) {
                    inviteHint.textContent = participantInviteBypass
                        ? 'Ссылка или код не распознаны. Для теста без приглашения очистите поле и нажмите «Начать» на первом шаге.'
                        : 'Ссылка или код не распознаны. Нужна полная ссылка с ?code=… или код приглашения от исследователя.';
                }
                return;
            }
            if (inviteHint) inviteHint.textContent = 'Код принят, переходим по приглашению...';
            const url = new URL(window.location.href);
            url.searchParams.set('code', code);
            window.location.href = url.toString();
        };
        inviteBtn.addEventListener('click', applyInvite);
        inviteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyInvite();
            }
        });
    }

    const btnStartIntro = document.getElementById('btnStartIntro');
    if (btnStartIntro) {
        btnStartIntro.addEventListener('click', async () => {
            dbg('ui', 'button:btnStartIntro', { hasInviteInput: !!inviteInput });
            const hint = inviteHint || inviteHintGlobal;
            if (inviteInput) {
                const raw = (inviteInput.value || '').trim();
                if (!raw) {
                    if (
                        !participantInviteBypass
                        && !state.sessionData.ids.invitationCode
                        && !invitationCode
                    ) {
                        if (hint) {
                            hint.textContent =
                                'Вставьте ссылку-приглашение или код. Если у вас нет приглашения, попросите исследователя отправить ссылку.';
                        }
                        return;
                    }
                    if (!participantInviteBypass && state.runtime?.invitationLoadError) {
                        if (hint) {
                            hint.textContent = 'Приглашение не найдено или больше не действует. Получите новую ссылку у исследователя.';
                        }
                        return;
                    }
                    nextStep(2);
                    return;
                }
                const code = extractInvitationCodeFromInput(inviteInput.value);
                if (!code) {
                    if (hint) {
                        hint.textContent = participantInviteBypass
                            ? 'Ссылка или код не распознаны. Проверьте ввод или очистите поле для тестового режима.'
                            : 'Ссылка или код не распознаны. Вставьте корректную ссылку с ?code=… или код приглашения.';
                    }
                    return;
                }
                const loadedMeta = state.runtime?.invitationProtocolMeta;
                const loadedDef = state.runtime?.invitationProtocolDefinition;
                const same =
                    loadedDef &&
                    loadedMeta &&
                    String(loadedMeta.code || '') === String(code);
                if (!same) {
                    try {
                        await loadInvitationProtocolByCode(code);
                    } catch (e) {
                        if (hint) {
                            hint.textContent = participantInviteBypass
                                ? 'Приглашение не найдено. Проверьте код или очистите поле для тестового режима.'
                                : 'Приглашение не найдено. Проверьте код или получите новую ссылку у исследователя.';
                        }
                        return;
                    }
                    if (!state.runtime.invitationProtocolDefinition) {
                        if (hint) {
                            hint.textContent =
                                'Приглашение не найдено. Введите другой код.';
                        }
                        return;
                    }
                    state.sessionData.ids.invitationCode = code;
                    if (hint) hint.textContent = 'Приглашение загружено.';
                }
            }
            nextStep(2);
        });
    }

    const consentCheck = document.getElementById('consentCheck');
    if (consentCheck) consentCheck.addEventListener('change', toggleConsent);

    const consentBtn = document.getElementById('consentBtn');
    if (consentBtn) consentBtn.addEventListener('click', async () => {
        dbg('ui', 'button:consentBtn', {});
        consentBtn.disabled = true;
        try {
            captureAudioConsent(state);
            await generateIdsAndProceed();
        } finally {
            consentBtn.disabled = false;
        }
    });
    
    const emailInput = document.getElementById('userEmail');
    if (emailInput) emailInput.addEventListener('blur', validateEmailField);

    const step3Btn = document.getElementById('step3NextBtn');
    if (step3Btn) {
        step3Btn.addEventListener('click', async (e) => {
            e.preventDefault();
            dbg('ui', 'button:step3NextBtn', {});
            await collectTechDataAndProceed(4);
        });
    }

    const userForm = document.getElementById('userForm');
    if (userForm) {
        userForm.addEventListener('input', checkForm);
        userForm.addEventListener('change', checkForm);
    }

    const formBtn = document.getElementById('formBtn');
    if (formBtn) {
        formBtn.addEventListener('click', (e) => {
            e.preventDefault();
            dbg('ui', 'button:formBtn', { formValid: checkForm() });
            if (checkForm()) submitForm();
        });
    }

    const startPrecheckBtn = document.getElementById('startPrecheckBtn');
    if (startPrecheckBtn) startPrecheckBtn.addEventListener('click', () => {
        dbg('precheck', 'button:startPrecheckBtn', {});
        startPreCheck();
    });

    const startCalibBtn = document.getElementById('startCalibBtn');
    if (startCalibBtn) startCalibBtn.addEventListener('click', () => {
        dbg('calibration', 'button:startCalibBtn', {});
        startCalibration();
    });

    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => downloadData());

    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.addEventListener('click', () => window.location.reload());

    const langRu = document.getElementById('langRu');
    const langEn = document.getElementById('langEn');
    const participantLanguageSelect = document.getElementById('participantLanguageSelect');
    if (langRu) langRu.addEventListener('click', () => setLanguage('ru'));
    if (langEn) langEn.addEventListener('click', () => setLanguage('en'));
    if (participantLanguageSelect) {
        participantLanguageSelect.addEventListener('change', () => {
            setLanguage(participantLanguageSelect.value);
        });
    }

    // A stale developer flag must never hijack a real invitation session. It used
    // to replace participant/session ids with P-DEV/S-DEV and bypass admission.
    const devModuleEntry = participantInviteBypass && !invitationCode && (
        developerModule === 'precheck'
        || developerModule === 'tracking'
        || developerModule === 'hub'
        || developerAutoPrecheck
    );
    const platformBypassEntry = participantInviteBypass && !invitationCode;
    if (devModuleEntry || platformBypassEntry) {
        ensureDeveloperSessionIds();
        nextStep(5);
        const hint = document.getElementById('inviteLinkHint');
        if (hint) {
            if (platformBypassEntry && !devModuleEntry) {
                hint.textContent = 'Режим разработчика/администратора: пречек и калибровка без приглашения.';
            } else {
                hint.textContent =
                    developerModule === 'precheck' || developerAutoPrecheck
                        ? 'Developer mode: открыт модуль Precheck.'
                        : 'Developer mode: сначала пройдите Precheck и калибровку, затем откроется Test Hub.';
            }
        }
        if (developerAutoPrecheck && !developerModule) {
            try { localStorage.removeItem('emocog_dev_auto_precheck'); } catch (_) {}
        }
    }

    if (window.__EMOCOG_PENDING_LANG__) {
        setLanguage(window.__EMOCOG_PENDING_LANG__);
        window.__EMOCOG_PENDING_LANG__ = null;
    }
    dbg('app', 'app:init:done', {
        invitationCode: state.sessionData.ids.invitationCode || invitationCode || null,
        developerBypass: participantInviteBypass
    });

    if (window.WECOG_DEBUG_HUD && window.WECOG_DEBUG?.enabled) {
        window.WECOG_DEBUG_HUD.start();
    }

    if (sessionRuntime?.reloadRecovery) {
        const requiresPrompt = sessionRuntime.reloadRecovery.requiresPrompt !== false;
        const interruptedBlock = sessionRuntime.reloadRecovery.interruptedBlock;
        const restoredShellStep = Number(state.sessionData?.shellStep);
        const recoveryStep = (requiresPrompt || interruptedBlock)
            ? 5
            : (restoredShellStep >= 3 && restoredShellStep <= 5
            ? restoredShellStep
            : 3);
        nextStep(recoveryStep);
        if (requiresPrompt) {
            const precheckStatus = document.getElementById('precheckStatus');
            if (precheckStatus) {
                precheckStatus.textContent = participantText(
                    'Перезапустите проверку камеры и калибровку перед продолжением.',
                    'Restart the camera check and calibration before continuing.',
                    'Reinicie la comprobación de la cámara y la calibración antes de continuar.'
                );
            }
        }
        sessionRuntime.promptReloadRecovery()
            .catch(error => console.warn('[SessionRuntime] reload recovery prompt failed:', error));
    }
});

window.addEventListener('beforeunload', () => {
    getSessionRuntime()?.saveCheckpoint();
    stopPreCheckOnLeave();
});
