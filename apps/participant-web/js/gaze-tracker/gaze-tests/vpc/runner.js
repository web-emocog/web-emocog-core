import { state, setSessionPhase, setTaskContext, clearTaskContext, recordSessionEvent } from '../../../web-page/state.js';
import { TEST_PHASES, VPC_CONFIG } from '../constants.js';
import { FELIDAE_SPECIES_POOLS, FELIDAE_TRIALS } from './manifest-felidae.js';
import { pickLoadableStimulusFromPool } from './fallback.js';
import { computePairLookMetrics, summarizeVPCRun } from './metrics.js';
import { pushVPCSessionRun } from '../session-schema.js';

function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function text(t, key, fallback) {
    if (typeof t === 'function') {
        const value = t(key);
        if (value) return value;
    }
    return fallback;
}

function show(el, mode = 'block') {
    if (el) el.style.display = mode;
}

function hide(el) {
    if (el) el.style.display = 'none';
}

function updateScreenMode({ container, vpcScreen }) {
    show(container, 'block');
    show(vpcScreen, 'block');
}

function hideAllStimulus({ fixation, centerImage, leftImage, rightImage }) {
    hide(fixation);
    hide(centerImage);
    hide(leftImage);
    hide(rightImage);
}

function setImageSource(image, stimulus) {
    if (!image) return;
    if (!stimulus) {
        image.removeAttribute('src');
        image.alt = '';
        return;
    }
    image.src = stimulus.url;
    image.alt = `${stimulus.species} (${stimulus.fileName})`;
}

function computeTrialLookMetrics(pairStartMs, pairEndMs, novelSide) {
    const samples = (state.sessionData.eyeTracking || []).filter(sample =>
        Number.isFinite(sample?.t) && sample.t >= pairStartMs && sample.t <= pairEndMs
    );

    const screenMidX = (window.innerWidth || 1) / 2;
    return computePairLookMetrics({
        samples,
        startMs: pairStartMs,
        endMs: pairEndMs,
        screenMidX,
        novelSide
    });
}

export async function runVPCTest(options = {}) {
    const t = options.t;
    const runId = `vpc_run_${Date.now()}`;
    const startedAt = Date.now();
    const usedStimulusIds = new Set();

    const container = document.getElementById('gazeTestsContainer');
    const vpcScreen = document.getElementById('vpcTestScreen');
    const progressText = document.getElementById('vpcProgressText');
    const phaseText = document.getElementById('vpcPhaseText');
    const fixation = document.getElementById('vpcFixationMark');
    const centerImage = document.getElementById('vpcCenterImage');
    const leftImage = document.getElementById('vpcLeftImage');
    const rightImage = document.getElementById('vpcRightImage');

    updateScreenMode({ container, vpcScreen });
    hideAllStimulus({ fixation, centerImage, leftImage, rightImage });

    setSessionPhase(TEST_PHASES.VPC_FIXATION, { source: 'vpc_run_start' });
    recordSessionEvent('vpc_run_start', {
        runId,
        trialCount: VPC_CONFIG.trialsCount
    });

    const trialResults = [];

    for (let index = 0; index < VPC_CONFIG.trialsCount; index++) {
        const trialTemplate = FELIDAE_TRIALS[index];
        const trialId = trialTemplate.trialId;
        const familiarPool = FELIDAE_SPECIES_POOLS[trialTemplate.familiarSpecies] || [];
        const novelPool = FELIDAE_SPECIES_POOLS[trialTemplate.novelSpecies] || [];

        setTaskContext({
            blockId: 'vpc',
            trialId,
            stimulusId: trialId,
            stimulusType: 'image_pair',
            expectedResponse: null
        });

        recordSessionEvent('vpc_trial_start', {
            runId,
            trialId,
            trialIndex: index,
            familiarSpecies: trialTemplate.familiarSpecies,
            novelSpecies: trialTemplate.novelSpecies,
            novelSide: trialTemplate.novelSide
        });

        if (progressText) {
            progressText.textContent = `${text(t, 'vpc_progress', 'VPC trial')} ${index + 1}/${VPC_CONFIG.trialsCount}`;
        }

        const familiarPick = await pickLoadableStimulusFromPool(familiarPool, usedStimulusIds);
        const novelPick = await pickLoadableStimulusFromPool(novelPool, usedStimulusIds);

        const fallbackErrors = [
            ...(familiarPick.errors || []).map(item => ({ ...item, role: 'familiar' })),
            ...(novelPick.errors || []).map(item => ({ ...item, role: 'novel' }))
        ];

        if (!familiarPick.stimulus || !novelPick.stimulus) {
            recordSessionEvent('vpc_image_fallback', {
                runId,
                trialId,
                reason: 'missing_loadable_stimulus',
                familiarFound: !!familiarPick.stimulus,
                novelFound: !!novelPick.stimulus,
                errors: fallbackErrors
            });

            trialResults.push({
                runId,
                trialId,
                skipped: true,
                reason: 'missing_loadable_stimulus',
                familiarSpecies: trialTemplate.familiarSpecies,
                novelSpecies: trialTemplate.novelSpecies,
                novelSide: trialTemplate.novelSide,
                fallbackErrors,
                metrics: {
                    lookMsNovel: 0,
                    lookMsFamiliar: 0,
                    validLookMs: 0,
                    noveltyPreferencePct: null
                }
            });

            recordSessionEvent('vpc_trial_end', {
                runId,
                trialId,
                skipped: true,
                reason: 'missing_loadable_stimulus'
            });
            continue;
        }

        usedStimulusIds.add(familiarPick.stimulus.stimulusId);
        usedStimulusIds.add(novelPick.stimulus.stimulusId);

        if (familiarPick.fallbackUsed || novelPick.fallbackUsed || fallbackErrors.length > 0) {
            recordSessionEvent('vpc_image_fallback', {
                runId,
                trialId,
                familiarFallbackUsed: familiarPick.fallbackUsed,
                novelFallbackUsed: novelPick.fallbackUsed,
                errors: fallbackErrors
            });
        }

        hideAllStimulus({ fixation, centerImage, leftImage, rightImage });

        setSessionPhase(TEST_PHASES.VPC_FIXATION, { source: 'vpc_fixation' });
        if (phaseText) phaseText.textContent = text(t, 'vpc_phase_fixation', 'Fixation');
        show(fixation, 'block');
        await waitMs(VPC_CONFIG.fixationMs);

        setSessionPhase(TEST_PHASES.VPC_FAMILIAR, { source: 'vpc_familiarization' });
        recordSessionEvent('vpc_familiar_on', {
            runId,
            trialId,
            familiarStimulusId: familiarPick.stimulus.stimulusId,
            familiarSpecies: familiarPick.stimulus.species
        });

        hide(fixation);
        setImageSource(centerImage, familiarPick.stimulus);
        show(centerImage, 'block');
        if (phaseText) phaseText.textContent = text(t, 'vpc_phase_familiar', 'Familiarization');
        await waitMs(VPC_CONFIG.familiarizationMs);

        hide(centerImage);
        if (phaseText) phaseText.textContent = text(t, 'vpc_phase_isi', 'Inter-stimulus interval');
        setSessionPhase(TEST_PHASES.VPC_ITI, { source: 'vpc_isi' });
        await waitMs(VPC_CONFIG.isiMs);

        const novelOnLeft = trialTemplate.novelSide === 'left';
        const leftStimulus = novelOnLeft ? novelPick.stimulus : familiarPick.stimulus;
        const rightStimulus = novelOnLeft ? familiarPick.stimulus : novelPick.stimulus;

        setImageSource(leftImage, leftStimulus);
        setImageSource(rightImage, rightStimulus);
        show(leftImage, 'block');
        show(rightImage, 'block');

        setSessionPhase(TEST_PHASES.VPC_PAIR, { source: 'vpc_pair' });
        recordSessionEvent('vpc_pair_on', {
            runId,
            trialId,
            familiarStimulusId: familiarPick.stimulus.stimulusId,
            novelStimulusId: novelPick.stimulus.stimulusId,
            novelSide: trialTemplate.novelSide
        });

        if (phaseText) phaseText.textContent = text(t, 'vpc_phase_pair', 'Pair');

        const pairStartMs = Date.now();
        await waitMs(VPC_CONFIG.pairMs);
        const pairEndMs = Date.now();

        hide(leftImage);
        hide(rightImage);

        const metrics = computeTrialLookMetrics(pairStartMs, pairEndMs, trialTemplate.novelSide);

        const trialResult = {
            runId,
            trialId,
            skipped: false,
            familiarSpecies: trialTemplate.familiarSpecies,
            novelSpecies: trialTemplate.novelSpecies,
            familiarStimulus: familiarPick.stimulus,
            novelStimulus: novelPick.stimulus,
            novelSide: trialTemplate.novelSide,
            fallbackErrors,
            metrics,
            pairWindow: {
                startMs: pairStartMs,
                endMs: pairEndMs,
                durationMs: pairEndMs - pairStartMs
            }
        };

        trialResults.push(trialResult);

        recordSessionEvent('vpc_trial_end', {
            runId,
            trialId,
            skipped: false,
            lookMsNovel: metrics.lookMsNovel,
            lookMsFamiliar: metrics.lookMsFamiliar,
            noveltyPreferencePct: metrics.noveltyPreferencePct
        });

        if (phaseText) phaseText.textContent = text(t, 'vpc_phase_iti', 'Inter-trial interval');
        setSessionPhase(TEST_PHASES.VPC_ITI, { source: 'vpc_iti' });
        await waitMs(VPC_CONFIG.itiMs);
    }

    hideAllStimulus({ fixation, centerImage, leftImage, rightImage });
    hide(vpcScreen);
    hide(container);

    clearTaskContext();

    const endedAt = Date.now();
    const summary = summarizeVPCRun(trialResults);
    const runPayload = {
        runId,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        config: {
            ...VPC_CONFIG
        },
        trials: trialResults,
        summary
    };

    pushVPCSessionRun(state.sessionData, runPayload);

    recordSessionEvent('vpc_run_end', {
        runId,
        validTrials: summary.validTrials,
        skippedTrials: summary.skippedTrials,
        meanNoveltyPreferencePct: summary.meanNoveltyPreferencePct,
        totalLookMs: summary.totalLookMs
    });

    return runPayload;
}
