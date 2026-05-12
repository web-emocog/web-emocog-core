// Фаза 0: точка входа с обновлённым UI (агрегаты без PII, опция «только сводка»). Исходный: app.js
// Фаза 1.2: инициализация QC pause overlay
import { state, getCurrentTaskContext, getRelativeSessionTimeMs, recordSessionEvent } from './state.js';
import { 
    setLanguage, 
    nextStep, 
    toggleConsent, 
    generateIdsAndProceed, 
    copyIds, 
    checkForm, 
    validateEmailField, 
    collectTechDataAndProceed, 
    updateFinalStepWithQC,
    stopPreCheckOnLeave,
    downloadData,
    initSecureSenderToggle
} from './ui-updated.js';

import { 
    startPreCheck, 
    stopPreCheck
} from './precheck-updated.js';

import { 
    startCalibration, 
    finishSession 
} from './tests-updated.js';

import { init as initQcPauseOverlay } from '../qc-pause-overlay-new.js';
initQcPauseOverlay({ getLang: () => state.currentLang });

window.setLanguage = setLanguage;
window.nextStep = nextStep;
window.copyIds = copyIds;
window.validateEmailField = validateEmailField;
window.downloadData = downloadData;
window.addEventListener('error', (e) => {
});
window.addEventListener('unhandledrejection', (e) => {
    const reason = e?.reason;
});

export function handleGazeUpdate(gazeData) {
    const customDot = document.getElementById('customGazeDot');
    
    if (!gazeData || gazeData.x === null || gazeData.y === null) {
        state.runtime.currentGaze = { x: null, y: null };
        if (customDot) customDot.style.display = 'none';
        
        if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
            state.runtime.qcMetrics.addGazePoint(null, state.runtime.lastPoseData);
        }
        return;
    }

    const x = Math.round(gazeData.x);
    const y = Math.round(gazeData.y);
    const t = gazeData.t || gazeData.timestamp || Date.now();

    state.runtime.currentGaze = { x, y };
    const phase = state.runtime.currentPhase || '';
    const taskContext = getCurrentTaskContext();
    const screenWidth = window.innerWidth || 1;
    const screenHeight = window.innerHeight || 1;
    const onScreen = x >= 0 && x <= screenWidth && y >= 0 && y <= screenHeight;
    const confidence = Number.isFinite(gazeData.confidence) ? gazeData.confidence : null;
    const hubLike =
        phase === 'test_hub' ||
        phase === 'bpm_test' ||
        (typeof phase === 'string' && phase.indexOf('vpc_') === 0) ||
        phase === 'visuospatial_instruction' ||
        phase === 'visuospatial_drawing';
    const showGazeDot =
        (state.flags.isValidating || (state.flags.isRecording && !hubLike)) &&
        (phase === 'calibration' ||
            phase === 'validation' ||
            phase === 'tracking_test' ||
            phase === 'cognitive_instruction' ||
            phase === 'cognitive_stimulus' ||
            phase === 'paused' ||
            state.flags.isValidating);

    if (customDot && showGazeDot) {
        customDot.style.display = 'block';
        customDot.style.left = `${x}px`;
        customDot.style.top = `${y}px`;
    } else if (customDot) {
        customDot.style.display = 'none';
    }

    if (state.flags.isRecording) {
        state.sessionData.eyeTracking.push({
            x,
            y,
            t,
            tRelMs: getRelativeSessionTimeMs(t),
            phase,
            blockId: taskContext.blockId ?? null,
            trialId: taskContext.trialId ?? null,
            stimulusId: taskContext.stimulusId ?? null,
            stimulusType: taskContext.stimulusType ?? null,
            expectedResponse: taskContext.expectedResponse ?? null,
            onScreen,
            confidence,
            rawX: Number.isFinite(gazeData.rawX) ? gazeData.rawX : null,
            rawY: Number.isFinite(gazeData.rawY) ? gazeData.rawY : null,
            screenWidth,
            screenHeight
        });
    }

    if (state.runtime.qcMetrics && state.runtime.qcMetrics.isRunning()) {
        state.runtime.qcMetrics.addGazePoint({ x, y }, state.runtime.lastPoseData);
    }
}

window.handleGazeUpdate = handleGazeUpdate;

export function handleEyeSignalUpdate(signalData) {
    if (!signalData || !Number.isFinite(signalData.t)) return;

    const phase = state.runtime.currentPhase || null;
    const taskContext = getCurrentTaskContext();
    const sample = {
        t: signalData.t,
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

function getParticipantApiBase() {
    try {
        const fromStorage = localStorage.getItem('emocog_api_base');
        if (fromStorage && fromStorage.trim()) return fromStorage.trim().replace(/\/$/, '');
    } catch (_) {}
    if (window.PROTOCOL_RUN_API_BASE) return String(window.PROTOCOL_RUN_API_BASE).replace(/\/$/, '');
    if (window.API_BASE) return String(window.API_BASE).replace(/\/$/, '');
    return (window.location.origin + '/api').replace(/\/$/, '');
}

async function loadInvitationProtocolByCode(code) {
    const base = getParticipantApiBase();
    const response = await fetch(base + '/invitations/by-code/' + encodeURIComponent(code));
    if (!response.ok) {
        throw new Error('Invitation lookup failed: HTTP ' + response.status);
    }
    const payload = await response.json();
    if (payload && payload.definition && typeof payload.definition === 'object') {
        const protocolBlocks = Array.isArray(payload.definition?.blocks) ? payload.definition.blocks : [];
        const stimulusIds = [];
        protocolBlocks.forEach((block) => {
            const ids = Array.isArray(block?.params?.stimuli_ids) ? block.params.stimuli_ids : [];
            ids.forEach((id) => {
                const key = String(id);
                if (key && !stimulusIds.includes(key)) stimulusIds.push(key);
            });
        });

        let stimuliMap = {};
        if (payload.project_id && stimulusIds.length) {
            try {
                const stimuliResp = await fetch(base + '/stimuli?project_id=' + encodeURIComponent(payload.project_id));
                if (stimuliResp.ok) {
                    const rows = await stimuliResp.json();
                    if (Array.isArray(rows)) {
                        rows.forEach((row) => {
                            const id = String(row?.id);
                            if (stimulusIds.includes(id)) {
                                stimuliMap[id] = {
                                    id,
                                    name: row?.name || id,
                                    mime_type: row?.mime_type || null,
                                    metadata: row?.metadata || {}
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
            invitationCode: payload.code || code,
            protocolId: payload.protocol_id || null,
            projectId: payload.project_id || null,
            protocolName: payload.protocol_name || null,
            loadedAt: Date.now()
        };
        if (payload.protocol_id != null) {
            state.sessionData.ids.protocolId = payload.protocol_id;
        }
    }
}

function isPlausibleInvitationCode(code) {
    const c = String(code || '').trim();
    if (c.length < 4 || c.length > 256) return false;
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

    let code = null;
    try {
        const u = new URL(value);
        code = u.searchParams.get('code');
        if (code) code = code.trim();
    } catch (_) {
        if (value.includes('?')) {
            const qs = value.split('?')[1] || '';
            code = fromSearchParams(qs);
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
        if (!token) return false;
        const base = getParticipantApiBase();
        const r = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return false;
        const me = await r.json();
        if (me.bypass_admin === true) return true;
        const role = me.role;
        return role === 'developer' || role === 'admin';
    } catch (_) {
        return false;
    }
}

function ensureDeveloperSessionIds() {
    if (state.sessionData.ids.session && state.sessionData.ids.participant) return;
    const sessionId = 'S-DEV-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const participantId = 'P-DEV-' + Math.random().toString(36).slice(2, 7).toUpperCase();
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
    console.log('App initialized (Phase 0 – privacy & aggregates)');
    try {
        const pendingLang = window.__EMOCOG_PENDING_LANG__;
        const storedLang = localStorage.getItem('emocog_participant_lang');
        const preferredLang = pendingLang || storedLang;
        if (preferredLang === 'en' || preferredLang === 'ru') {
            state.currentLang = preferredLang;
        }
    } catch (_) {}

    const participantInviteBypass = await fetchParticipantInviteBypass();

    // Код приглашения из URL (ссылка-приглашение ведёт на пречек с ?code=...)
    const params = new URLSearchParams(window.location.search);
    const invitationCode = params.get('code');
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
                invitationCode: invitationCode.trim(),
                protocolId: state.runtime?.invitationProtocolMeta?.protocolId || null
            });
        } catch (e) {
            console.warn('[Invitation] Failed to load protocol by code:', e);
            recordSessionEvent('invitation_protocol_load_failed', {
                invitationCode: invitationCode.trim(),
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
            const hint = inviteHint || inviteHintGlobal;
            if (inviteInput) {
                const raw = (inviteInput.value || '').trim();
                if (!raw) {
                    if (!participantInviteBypass && !state.sessionData.ids.invitationCode && !invitationCode) {
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
    if (consentBtn) consentBtn.addEventListener('click', generateIdsAndProceed);
    
    const emailInput = document.getElementById('userEmail');
    if (emailInput) emailInput.addEventListener('blur', validateEmailField);

    const step3Btn = document.getElementById('step3NextBtn');
    if (step3Btn) {
        step3Btn.addEventListener('click', async () => {
            const emailEl = document.getElementById('userEmail');
            const beforeStep = document.querySelector('.step.active')?.id || null;
            try {
                await collectTechDataAndProceed();
                const afterStep = document.querySelector('.step.active')?.id || null;
            } catch (err) {
            }
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
            if (checkForm()) nextStep(5);
        });
    }

    const startPrecheckBtn = document.getElementById('startPrecheckBtn');
    if (startPrecheckBtn) startPrecheckBtn.addEventListener('click', startPreCheck);

    const startCalibBtn = document.getElementById('startCalibBtn');
    if (startCalibBtn) {
        startCalibBtn.addEventListener('click', async () => {
            try {
                await startCalibration();
            } catch (err) {
            }
        });
    }

    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) downloadBtn.addEventListener('click', () => downloadData());

    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.addEventListener('click', () => window.location.reload());

    const langRu = document.getElementById('langRu');
    const langEn = document.getElementById('langEn');
    if (langRu) langRu.addEventListener('click', () => setLanguage('ru'));
    if (langEn) langEn.addEventListener('click', () => setLanguage('en'));

    setLanguage(state.currentLang);
    const devModuleEntry =
        developerModule === 'precheck' || developerModule === 'tracking' || developerModule === 'hub' || developerAutoPrecheck;
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
    initSecureSenderToggle();
});

window.addEventListener('beforeunload', () => {
    stopPreCheckOnLeave();
});