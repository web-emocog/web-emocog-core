import { resolveSessionFeatureFlags } from '../session-runtime/feature-flags.mjs';

const CONSENT_VERSION = 'audio_consent.v1';

function consentElements() {
    return {
        block: document.getElementById('audioConsentBlock'),
        checkbox: document.getElementById('audioConsentCheck')
    };
}

export function configureAudioConsentUI(state, definition = null) {
    const flags = resolveSessionFeatureFlags(definition);
    const { block, checkbox } = consentElements();
    state.runtime.featureFlags = flags;
    if (!state.sessionData.audioConsent || typeof state.sessionData.audioConsent !== 'object') {
        state.sessionData.audioConsent = {};
    }
    state.sessionData.audioConsent = {
        ...state.sessionData.audioConsent,
        schemaVersion: CONSENT_VERSION,
        offered: flags.audio,
        required: false
    };
    if (block) block.hidden = !flags.audio;
    if (checkbox) {
        checkbox.checked = flags.audio && state.sessionData.audioConsent.granted === true;
        checkbox.disabled = !flags.audio;
    }
    return flags;
}

export function captureAudioConsent(state) {
    const flags = state.runtime.featureFlags
        || resolveSessionFeatureFlags(state.runtime.invitationProtocolDefinition);
    const { checkbox } = consentElements();
    const granted = flags.audio && checkbox?.checked === true;
    state.sessionData.audioConsent = {
        schemaVersion: CONSENT_VERSION,
        offered: flags.audio,
        required: false,
        granted,
        decidedAt: Date.now(),
        rawCaptureGranted: false
    };
    return state.sessionData.audioConsent;
}
