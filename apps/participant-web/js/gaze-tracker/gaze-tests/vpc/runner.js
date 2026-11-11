import { state, setSessionPhase, setTaskContext, clearTaskContext, recordSessionEvent } from '../../../web-page/state.js?v=20261025-1';
import { TEST_PHASES, VPC_CONFIG } from '../constants.js?v=20261106-metrics1';
import { FELIDAE_SPECIES_POOLS, FELIDAE_TRIALS } from './manifest-felidae.js?v=20261106-metrics1';
import { createVPCMediaCache, pickLoadableStimulusFromPool } from './fallback.js?v=20261106-metrics1';
import { VPC_METRIC_VERSION, computePairLookMetrics, summarizeVPCRun } from './metrics.js?v=20261106-metrics1';
import { pushVPCSessionRun } from '../session-schema.js';
import { mediaContentRect } from '../../../web-page/stimulus-geometry.mjs?v=20261025-1';
import { getContentViewport } from '../../viewport-coordinates.mjs';

const waitMs = ms => new Promise(resolve => setTimeout(resolve, ms));
const show = element => { if (element) element.style.display = 'block'; };
const hide = element => { if (element) element.style.display = 'none'; };
const text = (translate, key, fallback) => translate?.(key) || fallback;

function storedStimulus(stimulus) {
    if (!stimulus) return null;
    const { url, sourceUrl, ...record } = stimulus;
    return { ...record, sourceUrl, integrityVerified: true };
}

function pairGeometry(ui, novelSide) {
    const viewport = getContentViewport();
    const left = mediaContentRect(ui.left, viewport), right = mediaContentRect(ui.right, viewport);
    return { viewport, regions: { familiar: novelSide === 'left' ? right : left,
        novel: novelSide === 'left' ? left : right } };
}

function watchPresentation(ui, novelSide) {
    const flags = { layoutChanged: false, stimulusAvailable: true };
    let initial = null, stopped = false;
    const changed = () => { if (initial) flags.layoutChanged = true; };
    const failed = () => { flags.stimulusAvailable = false; };
    const visibility = () => { if (document.visibilityState !== 'visible') failed(); };
    visibility();
    document.addEventListener('visibilitychange', visibility);
    const events = [[window, 'resize'], [window, 'scroll'],
        [window.visualViewport, 'resize'], [window.visualViewport, 'scroll']];
    const checkGeometry = () => {
        if (initial && JSON.stringify(pairGeometry(ui, novelSide)) !== JSON.stringify(initial)) changed();
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(checkGeometry) : null;
    observer?.observe(ui.left); observer?.observe(ui.right);
    for (const [target, event] of events) target?.addEventListener(event, changed, { passive: true, capture: true });
    for (const image of ui.images) image.addEventListener('error', failed);
    return { flags, startPair() { initial = pairGeometry(ui, novelSide); return initial; }, stop() {
        if (stopped) return;
        stopped = true;
        checkGeometry(); observer?.disconnect();
        document.removeEventListener('visibilitychange', visibility);
        for (const [target, event] of events) target?.removeEventListener(event, changed, true);
        for (const image of ui.images) image.removeEventListener('error', failed);
    } };
}

function excludedTrial(runId, template, familiarPick, novelPick, errors) {
    return { runId, trialId: template.trialId, methodVersion: VPC_METRIC_VERSION,
        skipped: true, valid: false, reason: 'stimulus_unavailable',
        familiarSpecies: template.familiarSpecies, novelSpecies: template.novelSpecies, novelSide: template.novelSide,
        familiarStimulus: storedStimulus(familiarPick.stimulus), novelStimulus: storedStimulus(novelPick.stimulus),
        fallbackErrors: errors, metrics: null };
}

function loadPresentationImage(image, stimulus) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true; clearTimeout(timer); image.onload = null; image.onerror = null;
            if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error('stimulus_unavailable')), VPC_CONFIG.imageLoadTimeoutMs);
        const ready = async () => {
            try {
                await image.decode();
                if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) throw new Error('stimulus_unavailable');
                finish();
            } catch (error) { finish(error); }
        };
        image.onload = ready; image.onerror = () => finish(new Error('stimulus_unavailable'));
        image.alt = `${stimulus.species} (${stimulus.fileName})`;
        image.src = stimulus.url;
        if (image.complete && image.naturalWidth > 0) void ready();
    });
}

async function presentTrial(ui, runId, template, familiarPick, novelPick, errors, translate) {
    const familiar = familiarPick.stimulus, novel = novelPick.stimulus;
    const novelOnLeft = template.novelSide === 'left';
    const sources = [familiar, novelOnLeft ? novel : familiar, novelOnLeft ? familiar : novel];
    try {
        for (const [index, image] of ui.images.entries()) {
            await loadPresentationImage(image, sources[index]);
        }
    } catch (_) { return excludedTrial(runId, template, familiarPick, novelPick, errors); }
    const watch = watchPresentation(ui, template.novelSide);
    try {
        setSessionPhase(TEST_PHASES.VPC_FIXATION, { source: 'vpc_fixation' });
        ui.phase.textContent = text(translate, 'vpc_phase_fixation', 'Fixation');
        show(ui.fixation);
        await waitMs(VPC_CONFIG.fixationMs);
        hide(ui.fixation);
        setSessionPhase(TEST_PHASES.VPC_FAMILIAR, { source: 'vpc_familiarization' });
        ui.phase.textContent = text(translate, 'vpc_phase_familiar', 'Familiarization');
        show(ui.center);
        recordSessionEvent('vpc_familiar_on', { runId, trialId: template.trialId,
            familiarStimulusId: familiar.stimulusId, familiarSpecies: familiar.species, sha256: familiar.sha256 });
        await waitMs(VPC_CONFIG.familiarizationMs);
        hide(ui.center);
        ui.phase.textContent = text(translate, 'vpc_phase_isi', 'Inter-stimulus interval');
        setSessionPhase(TEST_PHASES.VPC_ITI, { source: 'vpc_isi' });
        await waitMs(VPC_CONFIG.isiMs);
        show(ui.left); show(ui.right);
        ui.phase.textContent = text(translate, 'vpc_phase_pair', 'Pair');
        await new Promise(resolve => requestAnimationFrame(resolve));
        const geometry = watch.startPair();
        const startMs = Date.now();
        setSessionPhase(TEST_PHASES.VPC_PAIR, { source: 'vpc_pair' });
        recordSessionEvent('vpc_pair_on', { runId, trialId: template.trialId,
            familiarStimulusId: familiar.stimulusId, novelStimulusId: novel.stimulusId,
            familiarSha256: familiar.sha256, novelSha256: novel.sha256, novelSide: template.novelSide });
        await waitMs(VPC_CONFIG.pairMs);
        const endMs = Date.now();
        watch.stop();
        const metrics = computePairLookMetrics({ samples: state.sessionData.eyeTracking || [],
            startMs, endMs, ...geometry, ...watch.flags });
        hide(ui.left); hide(ui.right);
        return { runId, trialId: template.trialId, methodVersion: VPC_METRIC_VERSION,
            skipped: false, valid: metrics.valid, reason: metrics.reason,
            familiarSpecies: template.familiarSpecies, novelSpecies: template.novelSpecies,
            familiarStimulus: storedStimulus(familiar), novelStimulus: storedStimulus(novel),
            novelSide: template.novelSide, fallbackErrors: errors, metrics,
            pairWindow: { startMs, endMs, durationMs: endMs - startMs } };
    } finally { watch.stop(); }
}

export async function runVPCTest(options = {}) {
    const runId = `vpc_run_${Date.now()}`, startedAt = Date.now();
    const usedStimulusIds = new Set(), leases = [], trials = [];
    const ui = { container: document.getElementById('gazeTestsContainer'), screen: document.getElementById('vpcTestScreen'),
        progress: document.getElementById('vpcProgressText'), phase: document.getElementById('vpcPhaseText'),
        fixation: document.getElementById('vpcFixationMark'), center: document.getElementById('vpcCenterImage'),
        left: document.getElementById('vpcLeftImage'), right: document.getElementById('vpcRightImage') };
    if (Object.values(ui).some(element => !element)) throw new Error('VPC presentation UI unavailable');
    ui.images = [ui.center, ui.left, ui.right];
    const hideStimuli = () => { hide(ui.fixation); ui.images.forEach(hide); };
    const mediaCache = createVPCMediaCache();
    show(ui.container); show(ui.screen);
    hide(ui.screen.querySelector('[data-i18n="vpc_instruction"]'));
    hideStimuli();
    setSessionPhase(TEST_PHASES.VPC_FIXATION, { source: 'vpc_run_start' });
    recordSessionEvent('vpc_run_start', { runId, methodVersion: VPC_METRIC_VERSION, trialCount: VPC_CONFIG.trialsCount });
    try {
        for (let index = 0; index < VPC_CONFIG.trialsCount; index++) {
            const template = FELIDAE_TRIALS[index], trialId = template.trialId;
            hideStimuli();
            setSessionPhase(TEST_PHASES.VPC_PREPARING, { source: 'vpc_media_preparation' });
            ui.phase.textContent = state.currentLang === 'ru' ? 'Подготовка изображений...' : 'Preparing images...';
            setTaskContext({ blockId: 'vpc', trialId, stimulusId: trialId, stimulusType: 'image_pair', expectedResponse: null });
            recordSessionEvent('vpc_trial_start', { runId, trialId, trialIndex: index,
                familiarSpecies: template.familiarSpecies, novelSpecies: template.novelSpecies, novelSide: template.novelSide });
            ui.progress.textContent = `${text(options.t, 'vpc_progress', 'VPC trial')} ${index + 1}/${VPC_CONFIG.trialsCount}`;
            const familiarPick = await pickLoadableStimulusFromPool(FELIDAE_SPECIES_POOLS[template.familiarSpecies], usedStimulusIds, { cache: mediaCache });
            leases.push(familiarPick);
            const novelPick = await pickLoadableStimulusFromPool(FELIDAE_SPECIES_POOLS[template.novelSpecies], usedStimulusIds, { cache: mediaCache });
            leases.push(novelPick);
            const errors = [...familiarPick.errors.map(item => ({ ...item, role: 'familiar' })),
                ...novelPick.errors.map(item => ({ ...item, role: 'novel' }))];
            let trial;
            if (!familiarPick.stimulus || !novelPick.stimulus) trial = excludedTrial(runId, template, familiarPick, novelPick, errors);
            else {
                usedStimulusIds.add(familiarPick.stimulus.stimulusId); usedStimulusIds.add(novelPick.stimulus.stimulusId);
                trial = await presentTrial(ui, runId, template, familiarPick, novelPick, errors, options.t);
            }
            trials.push(trial);
            recordSessionEvent('vpc_trial_end', { runId, trialId, skipped: trial.skipped, valid: trial.valid, reason: trial.reason,
                lookMsNovel: trial.metrics?.lookMsNovel ?? null, lookMsFamiliar: trial.metrics?.lookMsFamiliar ?? null,
                noveltyPreferencePct: trial.metrics?.noveltyPreferencePct ?? null });
            if (trial.skipped) ui.phase.textContent = state.currentLang === 'ru'
                ? 'Изображение недоступно. Проба исключена.' : 'Stimulus unavailable. Trial excluded.';
            else {
                ui.phase.textContent = text(options.t, 'vpc_phase_iti', 'Inter-trial interval');
                setSessionPhase(TEST_PHASES.VPC_ITI, { source: 'vpc_iti' });
                await waitMs(VPC_CONFIG.itiMs);
            }
        }
    } finally {
        hideStimuli(); ui.images.forEach(image => image.removeAttribute('src'));
        for (const lease of leases) lease.release();
        mediaCache.dispose(); hide(ui.screen); hide(ui.container); clearTaskContext();
    }
    const endedAt = Date.now(), summary = summarizeVPCRun(trials);
    const runPayload = { runId, methodVersion: VPC_METRIC_VERSION, startedAt, endedAt, durationMs: endedAt - startedAt,
        config: { ...VPC_CONFIG }, trials, summary };
    pushVPCSessionRun(state.sessionData, runPayload);
    recordSessionEvent('vpc_run_end', { runId, validTrials: summary.validTrials, skippedTrials: summary.skippedTrials,
        invalidTrials: summary.invalidTrials, meanNoveltyPreferencePct: summary.meanNoveltyPreferencePct, totalLookMs: summary.totalLookMs });
    return runPayload;
}
