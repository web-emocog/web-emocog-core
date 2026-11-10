import { resolveSignalProfile } from './protocol-profile.mjs?v=20261109-issues2';

export const DEFAULT_SESSION_FEATURE_FLAGS = Object.freeze({
    audio: false,
    multimodal: true,
    bodyMovement: false,
    gamerMode: false,
    audioDebugCapture: false
});

function bool(value, fallback) {
    if (typeof value === 'boolean') return value;
    return fallback;
}
function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function resolveSessionFeatureFlags(definition = null) {
    const source = object(definition);
    const settings = object(source.settings);
    const featureFlags = {
        ...object(settings.featureFlags),
        ...object(source.featureFlags)
    };
    const features = {
        ...object(settings.features),
        ...object(source.features)
    };
    const audio = object(features.audio ?? source.audio);
    const multimodal = object(features.multimodal ?? source.multimodal);
    const body = object(features.bodyMovement ?? features.body ?? source.bodyMovement);

    return Object.freeze({
        audio: bool(audio.enabled, bool(featureFlags.audio, DEFAULT_SESSION_FEATURE_FLAGS.audio)),
        multimodal: bool(
            multimodal.enabled,
            bool(featureFlags.multimodal, DEFAULT_SESSION_FEATURE_FLAGS.multimodal)
        ),
        bodyMovement: bool(
            body.enabled,
            bool(featureFlags.bodyMovement, resolveSignalProfile(definition).bodyMovementDefault)
        ),
        gamerMode: bool(
            multimodal.gamerMode,
            bool(featureFlags.gamerMode, DEFAULT_SESSION_FEATURE_FLAGS.gamerMode)
        ),
        // Raw capture remains disabled in the production participant flow. A
        // protocol flag alone must never turn it on.
        audioDebugCapture: false
    });
}
