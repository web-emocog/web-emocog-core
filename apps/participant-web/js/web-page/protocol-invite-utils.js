/** Helpers for invitation-driven sessions (post-calibration blocks, hub metrics, MVP shell). */

const MVP_SHELL_BLOCK_TYPES = new Set([
    'consent',
    'questionnaire',
    'precheck',
    'calibration',
    'final'
]);

const POST_CALIBRATION_BLOCK_TYPES = new Set([
    'instruction',
    'instructions',
    'cognitive_task',
    'stimuli',
    'passive',
    'rest',
    'finish'
]);

/** Test Hub card ids (not RT-registry analytics metric names). */
const TEST_HUB_METRIC_IDS = new Set(['rt', 'tracking', 'vpc', 'visuospatial']);

const DEFAULT_PARTICIPANT_SHELL = {
    consent: true,
    questionnaire: true,
    precheck: false,
    calibration: false
};

export function getProtocolBlockTypes(definition) {
    const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
    return new Set(blocks.map((block) => String(block?.type || '').toLowerCase()));
}

export function getParticipantShell(definition) {
    const shell = definition?.participantShell;
    let resolved;
    if (shell && typeof shell === 'object') {
        resolved = {
            consent: shell.consent !== false,
            questionnaire: shell.questionnaire !== false,
            precheck: shell.precheck === true,
            calibration: shell.calibration === true
        };
    } else {
        // Legacy API definitions always include injected system_* blocks; do not infer shell from them.
        resolved = { ...DEFAULT_PARTICIPANT_SHELL };
    }
    return resolved;
}

export function describeParticipantShell(shell, lang = 'ru') {
    const parts = [];
    if (shell.consent) parts.push(lang === 'en' ? 'informed consent' : 'информированное согласие');
    if (shell.questionnaire) parts.push(lang === 'en' ? 'questionnaire' : 'анкета');
    if (shell.precheck) parts.push(lang === 'en' ? 'camera check' : 'проверка камеры');
    if (shell.calibration) parts.push(lang === 'en' ? 'calibration' : 'калибровка');
    if (!parts.length) {
        return lang === 'en'
            ? 'No preparation steps — experiment blocks start immediately.'
            : 'Без подготовительных этапов — сразу блоки эксперимента.';
    }
    return parts.join(lang === 'en' ? ', then ' : ', затем ');
}

export function getPostCalibrationProtocolBlocks(definition) {
    const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
    return blocks.filter((block) => {
        const type = String(block?.type || '').toLowerCase();
        if (MVP_SHELL_BLOCK_TYPES.has(type)) return false;
        return POST_CALIBRATION_BLOCK_TYPES.has(type);
    });
}

export function hasPostCalibrationProtocolBlocks(definition) {
    return getPostCalibrationProtocolBlocks(definition).length > 0;
}

function normalizeHubMetricId(metric) {
    const key = String(metric || '').trim().toLowerCase();
    return TEST_HUB_METRIC_IDS.has(key) ? key : null;
}

/** Metrics that control Test Hub buttons only (explicit list, no auto rt/tracking). */
export function deriveInvitationHubMetrics(definition) {
    if (definition && Object.prototype.hasOwnProperty.call(definition, 'testHubMetrics')) {
        const fromHub = definition.testHubMetrics;
        if (!Array.isArray(fromHub) || !fromHub.length) return [];
        return fromHub.map(normalizeHubMetricId).filter(Boolean);
    }
    const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
    const metrics = [];
    blocks.forEach((block) => {
        const picked = block?.blockConfig?.selected_metrics || block?.content?.selected_metrics;
        if (!Array.isArray(picked)) return;
        picked.forEach((m) => {
            const key = normalizeHubMetricId(m);
            if (key && !metrics.includes(key)) metrics.push(key);
        });
    });
    return metrics;
}

/** @deprecated Use deriveInvitationHubMetrics — kept as alias for imports. */
export function deriveInvitationMetrics(definition) {
    return deriveInvitationHubMetrics(definition);
}

export function definitionForCognitiveRunner(definition) {
    if (!definition || typeof definition !== 'object') return definition;
    const post = getPostCalibrationProtocolBlocks(definition);
    if (!post.length) return definition;
    return Object.assign({}, definition, { blocks: post });
}

export function getInvitationSessionPlan(definition) {
    const shell = getParticipantShell(definition);
    const hubMetrics = deriveInvitationHubMetrics(definition);
    const hasProtocolBlocks = hasPostCalibrationProtocolBlocks(definition);
    return {
        shell,
        hubMetrics,
        hasProtocolBlocks,
        hasHub: hubMetrics.length > 0,
        runProtocolAfterShell: hasProtocolBlocks
    };
}
