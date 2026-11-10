// Фаза 0: точка входа с обновлённым UI (агрегаты без PII, опция «только сводка»). Исходный: app.js
// Фаза 1.2: инициализация QC pause overlay
import { participantDebug as dbg, participantDebugError as dbgErr } from '../session-runtime/participant-diagnostic.mjs?v=20261109-issues2';
import { state, getCurrentTaskContext, getRelativeSessionTimeMs, recordSessionEvent } from './state.js?v=20261025-1';
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
} from './ui-updated.js?v=20261109-issues2';

import { startPreCheck } from './precheck-updated.js?v=20261109-issues2';

import { 
    startCalibration, 
    stopParticipantTestLoops,
    stopSessionMediaResources
} from './tests-updated.js?v=20261109-issues2';

import {
    deriveInvitationHubMetrics,
    getInvitationSessionPlan,
    getParticipantShell
} from './protocol-invite-utils.js?v=20260915-1';

import { init as initQcPauseOverlay } from '../qc-pause-overlay-new.js?v=20261103-1';
import { initSessionRuntime, getSessionRuntime } from '../session-runtime/index.js?v=20261109-issues2';
import {
    getContentViewport,
    contentToLayoutViewport
} from '../gaze-tracker/viewport-coordinates.mjs';
import { resolveParticipantApiBase } from '../session-runtime/api-base.mjs?v=20261109-issues2';
import { createInvitationRequestPool, pinnedInvitationContentUrl } from '../session-runtime/invitation-http.mjs?v=20261109-issues2';
import { fetchMediaWithDeadline } from '../session-runtime/media-preload.mjs?v=20261109-issues2';
import { createBlockMediaPreparation, invitationMediaDescriptor, invitationMediaScope } from '../session-runtime/block-media-preparation.mjs?v=20261109-issues2';
import { fetchWithDeadline, throwIfRequestAborted } from '../session-runtime/http.mjs?v=20261109-issues2';
import { appendGazeHistory } from '../session-runtime/gaze-history.mjs?v=20261102-1';
import { mediaContentRect } from './stimulus-geometry.mjs?v=20261025-1';
import { qcGazeSignal, QC_GAZE_SIGNAL_METHOD } from '../gaze-tracker/qc-signal.mjs';
import {
    captureAudioConsent,
    configureAudioConsentUI
} from '../audio/consent-ui.js?v=20261109-issues2';

const RETAINED_GAZE_TARGET = 30_000;
const RETAINED_GAZE_HARD_CAP = 32_000;
const PARTICIPANT_LOCALES = new Set(['ru', 'en', 'zh', 'es', 'hi', 'ar', 'fr', 'bn', 'pt', 'ur']);
const fetchInvitationResource = createInvitationRequestPool({ fetchRequest: fetchMediaWithDeadline });
let invitationLoadGeneration = 0;
let invitationLoadController = null;

function participantText(ru, en, es) {
    if (state.currentLang === 'ru') return ru;
    if (state.currentLang === 'es') return es || en;
    return en;
}

export function appendGazeSample(sample) {
    appendGazeHistory(state.sessionData, state.runtime, sample);
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

function revokeInvitationStimulusObjectUrls() {
    state.runtime.invitationMediaPreparation?.dispose();
    state.runtime.invitationStimulusObjectUrls = [];
}

let _gazeDebugSampleN = 0;
let _eyeTrackingShapeLogged = false;

export function currentStimulusContentRect() {
    if (state.runtime.currentPhase !== 'cognitive_stimulus') return null;
    const viewport = getContentViewport();
    for (const id of ['cogVideo', 'cogImage']) {
        const media = document.getElementById(id);
        if (media && getComputedStyle(media).display !== 'none') return mediaContentRect(media, viewport);
    }
    if (['image', 'slides', 'video', 'audio'].includes(getCurrentTaskContext().stimulusType)) return null;
    const stage = document.getElementById('cognitiveStimulusArea');
    if (!stage || getComputedStyle(stage).display === 'none') return null;
    const rect = stage.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
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
    if (gazeData?.featureMethod === 'same_eye_iris.v2') {
        state.sessionData.tech ||= {};
        state.sessionData.tech.gazeFeatureMethod = gazeData.featureMethod;
        if (gazeData.calibrationSampling === 'open_eye_calibration.v1') {
            state.sessionData.tech.gazeCalibrationSampling = gazeData.calibrationSampling;
        }
    }
    // Feed QC once, before the display-only branch. Display may be absent for
    // a valid off-screen prediction; it must not turn that sample into missing.
    if (state.runtime.qcMetrics?.isRunning()
        && state.runtime.gazeTracker?.isCalibrated?.() === true) {
        state.sessionData.tech ||= {};
        state.sessionData.tech.gazeQcSignalMethod = QC_GAZE_SIGNAL_METHOD;
        state.runtime.qcMetrics.addGazePoint(qcGazeSignal(gazeData, getContentViewport()), state.runtime.lastPoseData);
    }
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
                stimulusVersion: taskContext.stimulusVersion ?? null,
                stimulusType: taskContext.stimulusType ?? null,
                stimulusRect,
                screenWidth: viewport.width,
                screenHeight: viewport.height
            });
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
            stimulusVersion: taskContext.stimulusVersion ?? null,
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
    const generation = ++invitationLoadGeneration;
    invitationLoadController?.abort();
    const controller = new AbortController();
    invitationLoadController = controller;
    const assertCurrent = () => {
        if (generation !== invitationLoadGeneration || controller.signal.aborted) {
            const error = new Error('Invitation load cancelled'); error.name = 'AbortError'; throw error;
        }
    };
    window.Photodiode?.configureProtocol(null);
    const base = resolveParticipantApiBase();
    dbg('api', 'invitation:load:start');
    const lookupUrl = new URL(base + '/invitations/by-code/' + encodeURIComponent(code));
    const restoredSessionId = state.sessionData?.ids?.session;
    if (restoredSessionId) lookupUrl.searchParams.set('session_id', restoredSessionId);
    const { response, payload } = await fetchInvitationResource(lookupUrl.toString(), {
        cache: 'no-store', signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer'
    }, async response => ({
        response, payload: await response.json().catch(() => null)
    }));
    assertCurrent();
    if (!response.ok) {
        dbgErr('api', 'invitation:load:error', { status: response.status });
        let detail = '';
        try {
            const errorPayload = payload;
            detail = errorPayload?.message || errorPayload?.error || '';
        } catch (_) { /* Use the HTTP status below. */ }
        const error = new Error(detail || ('Invitation lookup failed: HTTP ' + response.status));
        error.httpStatus = response.status;
        throw error;
    }
    if (!payload?.definition || typeof payload.definition !== 'object' || Array.isArray(payload.definition)) throw new Error('Invalid invitation response');
    if (payload && payload.definition && typeof payload.definition === 'object') {
        const stimulusIds = window.WecogProtocolStimuli?.referencedStimulusIds
            ? window.WecogProtocolStimuli.referencedStimulusIds(payload.definition)
            : [];

        const protocolMeta = {
            invitationId: payload.invitation_id || null,
            protocolId: payload.protocol_id || null,
            projectId: payload.project_id || null,
            publicationVersion: payload.publication_version || null,
            code: payload.code || code
        };
        const scope = invitationMediaScope(protocolMeta);
        let preparation = state.runtime.invitationMediaPreparation;
        // Refresh metadata even for the same publication: source/version/hash are
        // part of every cache key, so changed files cannot inherit stale handles.
        let stimuliMap = {};
        if (payload.project_id && stimulusIds.length) {
            const { response: stimuliResp, rows } = await fetchInvitationResource(
                base + '/invitations/by-code/' + encodeURIComponent(payload.code || code) + '/stimuli',
                { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' },
                async response => ({ response, rows: await response.json().catch(() => null) })
            );
            assertCurrent();
            if (!stimuliResp.ok || !Array.isArray(rows)) {
                const error = new Error('Stimulus metadata is unavailable. Reconnect and retry.');
                error.httpStatus = stimuliResp.status;
                throw error;
            }
            const referenced = new Set(stimulusIds.map(String));
            stimuliMap = Object.fromEntries(rows.filter(row => referenced.has(String(row?.id))).map(row => {
                const id = String(row.id);
                const sourceUrl = pinnedInvitationContentUrl(base, protocolMeta.code, id, row.content_url);
                return [id, { ...row, id, metadata: { ...(row.metadata || {}), source_url: sourceUrl, url: '' }, mediaReadiness: 'unprepared' }];
            }));
        }
        const manifestKey = map => JSON.stringify(Object.values(map).map(row =>
            [row.id, row.metadata?.source_url, row.version ?? null, row.sha256 ?? null, row.size_bytes ?? null]));
        const reusable = preparation?.scope === scope && !preparation.cache.snapshot().closed
            && manifestKey(preparation.rows) === manifestKey(stimuliMap);
        if (reusable) stimuliMap = preparation.rows;
        else {
            if (preparation?.cache.snapshot().pinnedEntries) {
                throw new Error('Media are in use by the current block. Finish or leave that block before changing invitations.');
            }
            revokeInvitationStimulusObjectUrls();
            await preparation?.cache.whenIdle();
            assertCurrent();
            preparation = createBlockMediaPreparation({ scope, rows: stimuliMap, request: fetchInvitationResource,
                onStatus: stats => {
                    if (state.runtime.invitationMediaPreparation !== preparation) return;
                    state.runtime.invitationMediaStatus = { state: 'unprepared', ...stats };
                    state.runtime.invitationStimulusObjectUrls = preparation.cache.urls();
                }
            });
            state.runtime.invitationMediaPreparation = preparation;
        }
        assertCurrent();

        state.runtime.invitationProtocolDefinition = payload.definition;
        window.Photodiode?.configureProtocol(payload.definition);
        configureAudioConsentUI(state, payload.definition);
        state.runtime.invitationProtocolMeta = {
            invitationId: payload.invitation_id || null,
            protocolId: payload.protocol_id || null,
            projectId: payload.project_id || null,
            protocolName: payload.protocol_name || null,
            publicationVersion: payload.publication_version || null,
            code: payload.code || code
        };
        state.runtime.invitationStimuliMap = stimuliMap;
        state.sessionData.experimentMeta = {
            ...(state.sessionData.experimentMeta || {}),
            source: 'invitation',
            protocolId: payload.protocol_id || null,
            projectId: payload.project_id || null,
            protocolName: payload.protocol_name || null,
            publicationVersion: payload.publication_version || null,
            invitationEntryCode: payload.public_code || code,
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
        state.runtime.invitationLoadError = null;
        // Warm only the first media block, never the entire protocol. Later
        // blocks are prepared on their own instruction screens, outside RT.
        const firstMediaBlock = (payload.definition.blocks || []).find(block =>
            window.WecogProtocolStimuli?.referencedStimulusIds({ blocks: [block] })?.some(id => stimuliMap[id]));
        const firstIds = firstMediaBlock
            ? window.WecogProtocolStimuli.referencedStimulusIds({ blocks: [firstMediaBlock] }) : [];
        state.runtime.invitationMediaStatus = { state: 'preparing', preparedBlockId: firstMediaBlock?.id || null, ...preparation.cache.snapshot() };
        try {
            const lease = await preparation.cache.prepare(firstIds.filter(id => stimuliMap[id])
                .map(id => invitationMediaDescriptor(stimuliMap[id])), { signal: controller.signal });
            lease.release();
            assertCurrent();
            state.runtime.invitationMediaStatus = { state: 'ready', preparedBlockId: firstMediaBlock?.id || null, ...preparation.cache.snapshot() };
        } catch (error) {
            assertCurrent();
            // Admission is still possible; block start has its own explicit
            // recoverable gate and never substitutes a network source.
            state.runtime.invitationMediaStatus = { state: 'unavailable', code: error?.code || 'media_unavailable',
                retryAfterMs: error?.retryAfterMs || null, ...preparation.cache.snapshot() };
        }
        dbg('api', 'invitation:load:success', {
            blockCount: Array.isArray(payload.definition?.blocks) ? payload.definition.blocks.length : 0,
            hubMetrics: plan.hubMetrics,
            shell: plan.shell,
            runProtocolAfterShell: plan.runProtocolAfterShell
        });
    }
}

function extractInvitationCodeFromInput(value) {
    return window.EmocogInvitationLink.fromInput(value);
}

const participantPageController = new AbortController();
const participantPageSignal = participantPageController.signal;
const listenForPage = (element, event, handler) =>
    element.addEventListener(event, handler, { signal: participantPageSignal });
let pageExit = null;
state.runtime.handlePreparationFailure = handlePreparationFailure;

async function fetchParticipantInviteBypass() {
    try {
        const base = resolveParticipantApiBase();
        return await fetchWithDeadline(`${base}/auth/me`, {
            credentials: 'include', signal: participantPageController.signal
        }, async (r, signal) => {
            if (!r.ok) return false;
            const me = await r.json();
            throwIfRequestAborted(signal);
            if (typeof me?.csrf_token === 'string') {
                try { sessionStorage.setItem('emocog_csrf_token', me.csrf_token); } catch (_) {}
            }
            const role = me?.user?.role || me?.role;
            return role === 'developer' || role === 'admin';
        }, 10000);
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

async function initializeParticipantPage() {
    let initialParticipantLanguage = state.currentLang;
    try {
        const pendingLang = window.__EMOCOG_PENDING_LANG__;
        window.__EMOCOG_PENDING_LANG__ = null;
        const storedLang = localStorage.getItem('emocog_participant_lang');
        const preferredLang = pendingLang || storedLang;
        if (PARTICIPANT_LOCALES.has(preferredLang)) initialParticipantLanguage = preferredLang;
    } catch (_) {}
    setLanguage(initialParticipantLanguage);
    const langRu = document.getElementById('langRu');
    const langEn = document.getElementById('langEn');
    const participantLanguageSelect = document.getElementById('participantLanguageSelect');
    if (langRu) listenForPage(langRu, 'click', () => setLanguage('ru'));
    if (langEn) listenForPage(langEn, 'click', () => setLanguage('en'));
    if (participantLanguageSelect) {
        listenForPage(participantLanguageSelect, 'change', () => setLanguage(participantLanguageSelect.value));
    }

    const sessionRuntime = await initSessionRuntime();
    if (participantPageSignal.aborted) return;
    configureAudioConsentUI(state, state.runtime?.invitationProtocolDefinition || null);
    dbg('app', 'app:init:start');
    const participantInviteBypass = await fetchParticipantInviteBypass();
    if (participantPageSignal.aborted) return;

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
        try {
            await loadInvitationProtocolByCode(invitationCode.trim());
            if (participantPageSignal.aborted) return;
            recordSessionEvent('invitation_protocol_loaded', {
                protocolId: state.runtime?.invitationProtocolMeta?.protocolId || null
            });
        } catch (e) {
            if (participantPageSignal.aborted || e?.name === 'AbortError') return;
            dbgErr('api', 'invitation:initial-load-failed');
            state.runtime.invitationProtocolDefinition = null;
            state.runtime.invitationProtocolMeta = null;
            state.runtime.invitationLoadError = {
                code: invitationCode.trim(),
                message: e?.message || String(e)
            };
            recordSessionEvent('invitation_protocol_load_failed', {
                httpStatus: Number.isInteger(e?.httpStatus) ? e.httpStatus : null
            });
            if (inviteHintGlobal) {
                inviteHintGlobal.textContent = e?.message
                    || 'Приглашение из адреса страницы не загрузилось. Проверьте ссылку или попросите исследователя новую.';
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
        listenForPage(inviteBtn, 'click', applyInvite);
        listenForPage(inviteInput, 'keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyInvite();
            }
        });
    }

    const btnStartIntro = document.getElementById('btnStartIntro');
    if (btnStartIntro) {
        listenForPage(btnStartIntro, 'click', async () => {
            if (btnStartIntro.disabled) return;
            dbg('ui', 'button:btnStartIntro', { hasInviteInput: !!inviteInput });
            const hint = inviteHint || inviteHintGlobal;
            if (sessionRuntime?.checkpointRestoreFailed) {
                if (hint) hint.textContent = participantText(
                    'Не удалось прочитать сохранённую сессию. Не очищайте данные сайта. Закройте другие вкладки исследования и повторите загрузку страницы; если ошибка останется, обратитесь к исследователю.',
                    'The saved session could not be read. Do not clear site data. Close other study tabs and reload; if the error persists, contact the researcher.'
                );
                return;
            }
            if (inviteInput) {
                const raw = (inviteInput.value || '').trim();
                if (!raw) {
                    if (state.runtime?.invitationLoadError && !state.runtime?.invitationProtocolDefinition) {
                        if (hint) {
                            hint.textContent = state.runtime.invitationLoadError.message
                                || 'Протокол не загрузился. Попросите исследователя проверить ссылку и файлы стимулов.';
                        }
                        return;
                    }
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
                // Refresh the entry link before consent. Existing admissions
                // remain pinned by the session_id lookup on the server.
                btnStartIntro.disabled = true;
                try {
                    await loadInvitationProtocolByCode(code);
                } catch (e) {
                    if (e?.name === 'AbortError') return;
                    if (hint) {
                        hint.textContent = e?.httpStatus === 429
                            ? participantText(
                                'Сервер временно ограничил загрузку. Подождите немного и нажмите «Начать» ещё раз. Ссылку менять не нужно.',
                                'Loading is temporarily rate limited. Please wait and press Start again. You do not need a new invitation link.'
                            )
                            : ![400, 404, 410].includes(e?.httpStatus)
                            ? participantText(
                                'Приглашение пока недоступно. Проверьте подключение и повторите. Если блок уже открыт, сначала завершите его. Ссылку менять не нужно.',
                                'The invitation is temporarily unavailable. Check your connection and retry. If a block is already open, finish it first. You do not need a new invitation link.'
                            )
                            : participantInviteBypass
                            ? 'Приглашение не найдено. Проверьте код или очистите поле для тестового режима.'
                            : 'Приглашение не найдено. Проверьте код или получите новую ссылку у исследователя.';
                    }
                    return;
                } finally {
                    btnStartIntro.disabled = false;
                }
                if (!state.runtime.invitationProtocolDefinition) {
                    if (hint) hint.textContent = 'Приглашение не найдено. Введите другой код.';
                    return;
                }
                // Admission keeps the immutable code returned by the lookup.
                if (hint) hint.textContent = 'Приглашение загружено.';
            }
            nextStep(2);
        });
    }

    const consentCheck = document.getElementById('consentCheck');
    if (consentCheck) listenForPage(consentCheck, 'change', toggleConsent);
    toggleConsent({ keepError: true });

    const consentBtn = document.getElementById('consentBtn');
    if (consentBtn) listenForPage(consentBtn, 'click', async () => {
        if (consentBtn.disabled || consentBtn.getAttribute('aria-busy') === 'true') return;
        dbg('ui', 'button:consentBtn', {});
        consentBtn.setAttribute('aria-busy', 'true');
        consentBtn.disabled = true;
        try {
            captureAudioConsent(state);
            await generateIdsAndProceed({ signal: participantPageSignal });
        } catch (_) {
            if (!participantPageSignal.aborted) {
                dbgErr('ui', 'consent:admission-failed');
                const status = document.getElementById('consentError');
                if (status) {
                    status.hidden = false;
                    status.textContent = participantText(
                        'Не удалось продолжить. Повторите попытку.',
                        'Could not continue. Please try again.');
                }
            }
        } finally {
            consentBtn.removeAttribute('aria-busy');
            if (!participantPageSignal.aborted) toggleConsent({ keepError: true });
        }
    });
    
    const emailInput = document.getElementById('userEmail');
    if (emailInput) listenForPage(emailInput, 'blur', validateEmailField);

    const step3Btn = document.getElementById('step3NextBtn');
    if (step3Btn) {
        listenForPage(step3Btn, 'click', async (e) => {
            e.preventDefault();
            dbg('ui', 'button:step3NextBtn', {});
            await collectTechDataAndProceed(4);
        });
    }

    const userForm = document.getElementById('userForm');
    if (userForm) {
        listenForPage(userForm, 'input', checkForm);
        listenForPage(userForm, 'change', checkForm);
    }

    const formBtn = document.getElementById('formBtn');
    if (formBtn) {
        listenForPage(formBtn, 'click', (e) => {
            e.preventDefault();
            const formValid = checkForm();
            dbg('ui', 'button:formBtn', { formValid });
            if (formValid) submitForm();
        });
    }

    const startPrecheckBtn = document.getElementById('startPrecheckBtn');
    if (startPrecheckBtn) listenForPage(startPrecheckBtn, 'click', async () => {
        dbg('precheck', 'button:startPrecheckBtn', {});
        try { await startPreCheck(); }
        catch (_) { handlePreparationFailure(); }
    });

    const startCalibBtn = document.getElementById('startCalibBtn');
    if (startCalibBtn) listenForPage(startCalibBtn, 'click', async () => {
        dbg('calibration', 'button:startCalibBtn', {});
        try { await startCalibration(); }
        catch (_) { handlePreparationFailure(); }
    });

    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) listenForPage(downloadBtn, 'click', () => downloadData());

    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) listenForPage(restartBtn, 'click', () => window.location.reload());


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

    dbg('app', 'app:init:done', {
        invitationPresent: !!(state.sessionData.ids.invitationCode || invitationCode),
        developerBypass: participantInviteBypass
    });

    if (window.WECOG_DEBUG_HUD && window.WECOG_DEBUG?.enabled) {
        window.WECOG_DEBUG_HUD.start();
    }

    state.runtime.participantShellReady = true;
    window.dispatchEvent(new Event('wecog:participant-ready'));
    if (sessionRuntime?.restoringFinal) return;
    if (state.sessionData.admissionPending) {
        nextStep(2);
        return;
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
            .catch(() => dbgErr('app', 'recovery:prompt-failed'));
    }
}
document.addEventListener('DOMContentLoaded', () => {
    void initializeParticipantPage().catch(() => handlePreparationFailure());
}, { once: true, signal: participantPageSignal });

function retireParticipantPage() {
    if (pageExit) return;
    const runtime = getSessionRuntime();
    // Keep a terminal document usable (including a failed upload or local-only
    // result). Only interrupted measurement requires a new document.
    const keepFinal = state.runtime.participantShellReady === true
        && ['finishing', 'completed'].includes(runtime?.machine?.state);
    pageExit = { runtime, keepFinal, returning: false };
    invitationLoadController?.abort();
    if (keepFinal) return;

    state.runtime.participantPageExited = true;
    participantPageController.abort();
    state.flags.isRecording = false;
    const cleanup = action => {
        try { action(); } catch (_) { dbgErr('app', 'page-exit:cleanup-failed'); }
    };
    cleanup(() => runtime?.suspendForPageExit());
    cleanup(() => stopPreCheckOnLeave());
    cleanup(() => state.runtime.stopCognitiveStimulusPlayback?.());
    cleanup(stopParticipantTestLoops);
    cleanup(() => {
        void runtime?.stopContinuousModules('page_exit')?.catch(() => dbgErr('app', 'page-exit:modules-failed'));
    });
    cleanup(stopSessionMediaResources);
    cleanup(() => state.runtime.qcMetrics?.stop());
    cleanup(revokeInvitationStimulusObjectUrls);
    for (const root of document.body.children) root.inert = true;
}
window.addEventListener('pagehide', retireParticipantPage);

function handlePreparationFailure() {
    if (pageExit || participantPageSignal.aborted) return;
    // Stop uncertain measurement, but neither finish it nor erase accepted data.
    recordSessionEvent('participant_preparation_failed', { category: 'technical', severity: 'error' });
    dbgErr('app', 'preparation:failed');
    retireParticipantPage();
    if (pageExit?.keepFinal) return;
    showPageRecovery(true);
}

async function resumeAfterPageExit() {
    if (!pageExit || pageExit.returning) return;
    pageExit.returning = true;
    let saved = !state.sessionData.ids?.session;
    if (!saved) {
        try { saved = await pageExit.runtime?.saveCheckpoint() === true; }
        catch (_) { dbgErr('app', 'page-exit:checkpoint-failed'); }
    }
    if (saved) {
        window.location.reload();
        return;
    }
    pageExit.returning = false;
    showPageRecovery();
}

function showPageRecovery(preparationFailed = false) {
    if (document.getElementById('participantPageRecovery')) return;
    const panel = document.createElement('section');
    panel.id = 'participantPageRecovery';
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;overflow:auto;background:var(--bg,#fff);color:var(--text,#17231c);padding:clamp(20px,6vw,80px);';
    const title = document.createElement('h2');
    title.tabIndex = -1;
    title.textContent = preparationFailed
        ? participantText('Не удалось подготовить измерение', 'Measurement preparation failed')
        : participantText('Не удалось сохранить точку восстановления', 'The recovery checkpoint could not be saved');
    const explanation = document.createElement('p');
    explanation.textContent = participantText(
        'Измерение остановлено. Не закрывайте вкладку: повторите восстановление или скачайте имеющиеся данные.',
        'Measurement has stopped. Keep this tab open: retry recovery or download the available data.');
    const downloadStatus = document.createElement('p');
    downloadStatus.hidden = true;
    downloadStatus.setAttribute('role', 'status');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = participantText('Повторить восстановление', 'Retry recovery');
    retry.onclick = async () => {
        retry.disabled = true;
        try { await resumeAfterPageExit(); } finally { retry.disabled = false; }
    };
    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = participantText('Скачать имеющиеся данные', 'Download available data');
    download.onclick = () => downloadData(downloadStatus);
    panel.append(title, explanation, retry, download, downloadStatus);
    document.body.appendChild(panel);
    title.focus();
}

window.addEventListener('pageshow', event => {
    if (!event.persisted) {
        // Form controls can be restored by the browser without a change event.
        if (!participantPageSignal.aborted) toggleConsent({ keepError: true });
        return;
    }
    if (!pageExit) return;
    if (pageExit.keepFinal) { pageExit = null; return; }
    void resumeAfterPageExit();
});
