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
    'survey',
    'rest',
    'finish'
]);

/** Test Hub card ids (not RT-registry analytics metric names). */
const TEST_HUB_METRIC_IDS = new Set(['rt', 'tracking', 'vpc', 'visuospatial']);

const DEFAULT_PARTICIPANT_SHELL = {
    consent: true,
    questionnaire: true,
    precheck: true,
    calibration: true
};

export function getProtocolBlockTypes(definition) {
    const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
    return new Set(blocks.map((block) => String(block?.type || '').toLowerCase()));
}

export function getParticipantShell(definition) {
    // These stages establish consent, session covariates and a participant-specific
    // measurement baseline. They are mandatory even for legacy definitions that
    // explicitly disabled pre-check/calibration before the contract was tightened.
    return { ...DEFAULT_PARTICIPANT_SHELL };
}

export function describeParticipantShell(shell, lang = 'ru') {
    const labels = lang === 'ru'
        ? { consent: 'информированное согласие', questionnaire: 'анкета', precheck: 'проверка камеры', calibration: 'калибровка', join: ', затем ', empty: 'Без подготовительных этапов — сразу блоки эксперимента.' }
        : (lang === 'es'
            ? { consent: 'consentimiento informado', questionnaire: 'cuestionario', precheck: 'comprobación de la cámara', calibration: 'calibración', join: ', después ', empty: 'Sin preparación: los bloques del experimento comienzan inmediatamente.' }
            : { consent: 'informed consent', questionnaire: 'questionnaire', precheck: 'camera check', calibration: 'calibration', join: ', then ', empty: 'No preparation steps — experiment blocks start immediately.' });
    const parts = [];
    if (shell.consent) parts.push(labels.consent);
    if (shell.questionnaire) parts.push(labels.questionnaire);
    if (shell.precheck) parts.push(labels.precheck);
    if (shell.calibration) parts.push(labels.calibration);
    return parts.length ? parts.join(labels.join) : labels.empty;
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
