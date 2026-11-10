import { PhysiologyIntervals } from '../../apps/participant-web/js/session-runtime/physiology-intervals.mjs';

export const FRAME_STEP_MS = 1000 / 30;
export const clone = value => JSON.parse(JSON.stringify(value));

// Deliberately labeled estimates, not pixels or evidence of sensor accuracy.
export function publicationAt(t) {
    const second = t % 60000;
    const hrFresh = t >= 10000 && !(second >= 20000 && second < 23000);
    const rrFresh = t >= 20000 && !(second >= 30000 && second < 32000);
    return { bpm: t >= 10000 ? 80 + Math.floor(t / 60000) % 4 : null,
        published: hrFresh, held: !hrFresh, respRate: t >= 20000 ? 12 + Math.floor(t / 60000) % 3 : null,
        respPublished: rrFresh, respHeld: !rrFresh, respConf: rrFresh ? .9 : .1 };
}

export function newScenario(minutes) {
    if (![40, 125].includes(minutes)) throw new Error('unsupported_synthetic_duration');
    return { minutes, frameCount: minutes * 60 * 30, accumulator: new PhysiologyIntervals(),
        blockId: null, attempt: 0, nextFrame: 0, recoveryCount: 0 };
}

export function stepScenario(run, frame) {
    const t = Math.round(frame * FRAME_STEP_MS);
    const blockId = `block-${Math.floor(t / 300000)}`;
    if (blockId !== run.blockId) {
        run.accumulator.endBlock('accepted', t);
        run.blockId = blockId; run.attempt = 1;
        run.accumulator.beginBlock({ blockId, attempt: 1 }, t);
    } else if (t % 300000 === 60000) {
        run.accumulator.endBlock('repeat_required', t);
        run.attempt++;
        run.accumulator.beginBlock({ blockId, attempt: run.attempt }, t);
    }
    if (frame % 151 === 0) run.accumulator.beginBlock({ blockId, attempt: run.attempt }, t);
    if (t % 60000 >= 40000 && t % 60000 < 43000) run.accumulator.breakContinuity();
    else if (frame % 15 === 0) {
        run.accumulator.record(t, publicationAt(t), 10000, 20000, 750);
        if (frame % 255 === 0) run.accumulator.record(t, publicationAt(t), 10000, 20000, 750);
    }
    run.nextFrame = frame + 1;
    return t;
}

// Both uninterrupted and resumed controls cross exactly the same technical boundary.
export function recoveryBoundary(run, checkpoint = null) {
    const t = Math.round((run.nextFrame - 1) * FRAME_STEP_MS);
    if (checkpoint) {
        run.accumulator = new PhysiologyIntervals(checkpoint);
    } else {
        run.accumulator.endBlock('interrupted', run.accumulator.snapshot(t).throughMs);
        run.accumulator.breakContinuity();
    }
    run.recoveryCount++;
    const restart = t + 5000;
    run.attempt++;
    run.accumulator.beginBlock({ blockId: run.blockId, attempt: run.attempt }, restart);
    run.nextFrame = Math.ceil(restart / FRAME_STEP_MS);
}

export function finishScenario(run) {
    const end = run.minutes * 60000;
    run.accumulator.endBlock('accepted', end);
    return run.accumulator.snapshot(end);
}

export function runSyntheticScenario(minutes, resumed = false) {
    const run = newScenario(minutes);
    let recovered = false;
    while (run.nextFrame < run.frameCount) {
        stepScenario(run, run.nextFrame);
        // Do not choose a block edge; interrupted and repeated attempts must coexist.
        if (!recovered && run.nextFrame >= run.frameCount / 2 + 450) {
            recoveryBoundary(run, resumed ? clone(run.accumulator.snapshot(Math.round((run.nextFrame - 1) * FRAME_STEP_MS))) : null);
            recovered = true;
        }
    }
    return finishScenario(run);
}
