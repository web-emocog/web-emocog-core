// Pure scheduling only: no clocks, storage, DOM, entropy source or scientific scoring.
export const PRESENTATION_PLAN_VERSION = 'presentation_plan.v1';
export const PRESENTATION_RNG_VERSION = 'mulberry32.v1';
export const PLAN_LIMITS = Object.freeze({ blocks: 200, trials: 5000, presentations: 5000 });
const fail = code => { throw new Error(code); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => value == null ? null : String(value);
const duration = (value, fallback) => {
    const result = Math.max(0, Number(value) || fallback);
    if (!finite(result) || result > 86400000) fail('presentation_plan_invalid_duration');
    return result;
};
const id = (value, fallback) => {
    const result = text(value ?? fallback);
    if (!result || result.length > 256) fail('presentation_plan_invalid_id');
    return result;
};

export function createTrialBudget(maximum = PLAN_LIMITS.trials) {
    let remaining = maximum;
    return count => {
        if (!Number.isSafeInteger(count) || count < 0 || count > remaining) {
            const error = new Error('Protocol trial limit exceeded');
            error.code = 'protocol_trial_limit';
            throw error;
        }
        remaining -= count;
        return count;
    };
}

export function createSeededRng(seed) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) fail('presentation_plan_invalid_seed');
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), state | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

// Non-security fingerprint; authorization and publication identity stay server-owned.
function fingerprint(value) {
    let hash = 2166136261;
    for (const char of JSON.stringify(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash;
}

function scheduleInputs(blocks) {
    const cognitiveBlocks = Array.isArray(blocks) ? blocks.filter(block => block.type === 'cognitive_task') : null;
    if (!cognitiveBlocks || cognitiveBlocks.length > PLAN_LIMITS.blocks) fail('presentation_plan_block_limit');
    let count = 0;
    const ids = new Set();
    return cognitiveBlocks.map((block, blockIndex) => {
        const blockId = id(block.id, `cognitive_${blockIndex}`);
        if (ids.has(blockId)) fail('presentation_plan_duplicate_block');
        ids.add(blockId);
        const cfg = block.blockConfig || {};
        const trials = Array.isArray(block.trials) ? block.trials : [];
        count += trials.length;
        if (count > PLAN_LIMITS.trials) fail('presentation_plan_trial_limit');
        return { blockId, randomize: cfg.randomize === true,
            protocolDurationMs: duration(cfg.protocolDurationMs, 0),
            useFixation: cfg.useFixation !== false && Boolean(cfg.fixation),
            fixationMs: duration(cfg.fixation?.duration, 500),
            randomInterStimulus: cfg.randomInterStimulus === true,
            interStimulusMinMs: duration(cfg.interStimulusMinMs, 0),
            interStimulusMaxMs: duration(cfg.interStimulusMaxMs, 0),
            stimulusDurationMs: Math.max(1, duration(cfg.stimulusDuration, 1000)),
            trials: trials.map((trial, sourceIndex) => ({
                planItemId: `item:${blockIndex}:${sourceIndex}`, sourceIndex,
                trialId: id(trial.id, `trial_${sourceIndex + 1}`),
                stimulusId: id(trial.stimulus?.stimulusId, trial.id ?? `trial_${sourceIndex + 1}`),
                stimulusVersion: text(trial.stimulus?.stimulusVersion ?? '1'),
                condition: text(trial.condition), expectedResponse: text(trial.correctResponse),
                responseMode: text(trial.responseMode ?? cfg.responseMode),
                fixationMinMs: duration(trial.fixationMin, 0), fixationMaxMs: duration(trial.fixationMax, 0),
                randomItiMinMs: duration(trial.randomItiMin, 0), randomItiMaxMs: duration(trial.randomItiMax, 0),
                stimulusDurationMs: Math.max(1, duration(trial.duration, duration(cfg.stimulusDuration, 1000))),
                // Preserve existing scheduler semantics (including legacy zero -> 200).
                itiMs: duration(trial.iti, 200)
            })) };
    });
}

function drawTiming(block, trial, rng) {
    const draw = (min, max) => Math.round(min + rng() * (Math.max(min, max) - min));
    const fixationBaseMs = !block.useFixation ? 0 : Math.max(trial.fixationMinMs, trial.fixationMaxMs) > 0
        ? draw(trial.fixationMinMs, trial.fixationMaxMs) : block.fixationMs;
    const randomPreStimulusMs = block.randomInterStimulus
        ? draw(block.interStimulusMinMs, block.interStimulusMaxMs)
        : Math.max(trial.randomItiMinMs, trial.randomItiMaxMs) > 0
            ? draw(trial.randomItiMinMs, trial.randomItiMaxMs) : 0;
    return { fixationBaseMs, randomPreStimulusMs, fixationDurationMs: fixationBaseMs + randomPreStimulusMs,
        stimulusDurationMs: trial.stimulusDurationMs, itiMs: trial.itiMs };
}

export function createPresentationPlan({ blocks, seed }) {
    const rng = createSeededRng(seed);
    const inputs = scheduleInputs(blocks);
    return { schemaVersion: PRESENTATION_PLAN_VERSION, rngVersion: PRESENTATION_RNG_VERSION, seed,
        sourceInputs: inputs, counterbalancing: { mode: 'none', assignment: null },
        repeatTimingPolicy: 'seed_and_actual_sequence.v1',
        timedBlockPolicy: 'cycle_saved_order_until_monotonic_deadline.v1',
        blocks: inputs.map(block => {
            const entries = block.trials.map(trial => ({ ...trial }));
            if (block.randomize) for (let i = entries.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [entries[i], entries[j]] = [entries[j], entries[i]];
            }
            return { blockId: block.blockId, protocolDurationMs: block.protocolDurationMs,
                entries: entries.map((trial, orderIndex) => ({ ...trial, orderIndex, ...drawTiming(block, trial, rng) })) };
        }), actual: [] };
}

export function restorePresentationPlan(saved, blocks) {
    if (!saved || saved.schemaVersion !== PRESENTATION_PLAN_VERSION || saved.rngVersion !== PRESENTATION_RNG_VERSION) {
        fail('presentation_plan_version_unsupported');
    }
    const expected = createPresentationPlan({ blocks, seed: saved.seed });
    for (const key of ['sourceInputs', 'blocks', 'counterbalancing', 'repeatTimingPolicy', 'timedBlockPolicy']) {
        if (JSON.stringify(saved[key]) !== JSON.stringify(expected[key])) fail('presentation_plan_protocol_mismatch');
    }
    if (!Array.isArray(saved.actual) || saved.actual.length > PLAN_LIMITS.presentations) fail('presentation_plan_actual_limit');
    const sequences = new Set(), identities = new Set();
    for (const record of saved.actual) {
        const block = expected.blocks.find(item => item.blockId === record.blockId);
        if (!block?.entries.some(item => item.planItemId === record.planItemId)
            || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || sequences.has(record.sequence)
            || !record.presentationId || identities.has(record.presentationId)) fail('presentation_plan_actual_invalid');
        sequences.add(record.sequence); identities.add(record.presentationId);
    }
    return saved; // Never silently replace a saved plan, even after a failed attempt.
}

export function resolveBlockPresentationPlan(plan, block) {
    const saved = plan.blocks.find(item => item.blockId === String(block.id));
    if (!saved) fail('presentation_plan_block_missing');
    return saved.entries.map(entry => ({ trial: block.trials[entry.sourceIndex],
        sourceIndex: entry.sourceIndex, trialId: entry.trialId, planItemId: entry.planItemId }));
}

export function createPresentationRecord(plan, { blockId, planItemId, presentationId, sequence, attempt,
    epochMs, perfMs, timeOriginMs, sessionStartEpochMs }) {
    if (plan.actual.length >= PLAN_LIMITS.presentations) fail('presentation_plan_actual_limit');
    const block = plan.blocks.find(item => item.blockId === String(blockId));
    const entry = block?.entries.find(item => item.planItemId === planItemId);
    if (!entry || !Number.isSafeInteger(sequence) || sequence < 1 || !Number.isSafeInteger(attempt) || attempt < 1
        || !presentationId || ![epochMs, perfMs, timeOriginMs].every(finite)
        || plan.actual.some(item => item.sequence === sequence || item.presentationId === presentationId)) {
        fail('presentation_plan_record_invalid');
    }
    const first = !plan.actual.some(item => item.planItemId === planItemId);
    const input = plan.sourceInputs.find(item => item.blockId === block.blockId);
    const timing = first ? drawSaved(entry) : drawTiming(input, entry,
        createSeededRng(fingerprint([plan.seed, entry.planItemId, sequence])));
    return { ...timing, planItemId, blockId: block.blockId, trialId: entry.trialId,
        stimulusId: entry.stimulusId, stimulusVersion: entry.stimulusVersion, orderIndex: entry.orderIndex,
        sourceIndex: entry.sourceIndex, sequence, presentationId: id(presentationId), attempt,
        status: 'prepared', startedAtEpochMs: epochMs, startedAtPerfMs: perfMs, timeOriginMs,
        sessionStartEpochMs: finite(sessionStartEpochMs) ? sessionStartEpochMs : null,
        stimulusOnEpochMs: null, stimulusOnPerfMs: null, stimulusOffEpochMs: null, stimulusOffPerfMs: null,
        effectiveStimulusDurationMs: null, actualItiMs: null, deviations: [] };
}

export function presentationWindow(plannedMs, onsetPerfMs, deadlinePerfMs) {
    const availableMs = finite(deadlinePerfMs) ? Math.max(0, deadlinePerfMs - onsetPerfMs) : plannedMs;
    return Math.min(plannedMs, availableMs);
}

function drawSaved(entry) {
    return Object.fromEntries(['fixationBaseMs', 'randomPreStimulusMs', 'fixationDurationMs', 'stimulusDurationMs', 'itiMs']
        .map(key => [key, entry[key]]));
}
