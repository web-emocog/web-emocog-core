// Adapter for the parsed primary frame in SessionFramePipeline at the pinned WECog revision.
import { createAtlas, summarizeWindow } from './engine.mjs';
import { assessZones } from './regions.mjs';
import { MODEL_ASSETS } from '../../session-runtime/protocol-profile.mjs?v=20261110-integration1';

export const WECog_SOURCE = '6a9f73e'; // Integration base, not the installed deployment HEAD.
export const EXTRACTOR_ID = `mediapipe.face_landmarker:sha256:${MODEL_ASSETS.face.sha256}/wecog-rounded-3dp`;
const CAPTURE_CAP = 1200;
const BYTE_CAP = 24 * 1024 * 1024;

export function frameQuality(frame, segmentationComplete, visible, now) {
    const reasons = [];
    if (!visible) reasons.push('page_hidden');
    if (frame?.error || frame?.errorMessage) reasons.push('frame_error');
    if (frame?.face?.detected !== true) reasons.push('face_missing');
    if (frame?.face?.status !== 'optimal') reasons.push('face_position_or_size');
    if (frame?.illumination?.status !== 'optimal') reasons.push('lighting');
    if (frame?.pose?.status !== 'stable' || frame?.pose?.isTilted !== false
        || ![frame?.pose?.yaw, frame?.pose?.pitch, frame?.pose?.roll].every(Number.isFinite)) {
        reasons.push('head_pose');
    }
    if (segmentationComplete !== true) reasons.push('segmentation_incomplete_or_stale');
    if (!Number.isFinite(frame?.timestamp) || !Number.isFinite(now)
        || now < frame.timestamp || now - frame.timestamp > 1000) reasons.push('timestamp_or_stale_frame');
    return reasons;
}

export function createWecogRecording(catalog, options) {
    // Labels are assigned by the study operator. All numerical fields are derived locally.
    const engine = createAtlas(catalog, { ...options, extractorId: EXTRACTOR_ID });
    const { inputMirrored } = engine.provenance;
    const roiSettings = {
        paddingFraction: options.paddingFraction ?? 0.08,
        zonePadding: Object.freeze({ ...options.zonePadding }),
    };
    const processedZones = new Set(engine.provenance.enabledZones);
    const selectedCatalog = {zones: catalog.zones.filter(zone => processedZones.has(zone.id))};
    // Validate settings before recording the first frame.
    assessZones(selectedCatalog, [], {...roiSettings, inputMirrored, width: 1, height: 1});
    const lines = [], encoder = new TextEncoder();
    let bytes = 0, phase = 'neutral', stopReason = null, lastTime = null, accepted = 0, quality = [];
    let latestObservation = null, latestBoxes = null, taskStartMs = null, stopMs = null;
    const records = [];
    let firstTime = null, previousSlot = -1;
    const samplingIntervalMs = 1000 / engine.provenance.expectedFps;
    const requiredChannels = options.requiredChannels ?? catalog.channels
        .filter(c => c.name !== '_neutral' && processedZones.has(c.zone)).map(c => c.name);
    if (!Array.isArray(requiredChannels) || !requiredChannels.length || requiredChannels.some(name =>
        !catalog.channels.some(c => c.name === name && c.name !== '_neutral' && processedZones.has(c.zone)))) {
        throw new TypeError('Invalid required channels');
    }
    const readyForTask = now => {
        const ready = engine.readiness(now);
        return {...ready, requiredChannels:[...requiredChannels],
            readyRequired:requiredChannels.every(name => ready.readyChannels.includes(name))};
    };
    const neutralStartMs = options.neutralStartMs ?? null;
    if (neutralStartMs !== null && (!Number.isFinite(neutralStartMs) || neutralStartMs < 0)) {
        throw new TypeError('Invalid neutral start timestamp');
    }
    const counts = Object.create(null);

    function stop(reason = 'operator', now = performance.now()) {
        if (phase !== 'stopped') {
            phase = 'stopped';
            stopReason = reason;
            stopMs = Number.isFinite(now) && now >= Math.max(lastTime ?? 0, taskStartMs ?? 0, neutralStartMs ?? 0)
                ? now : null;
            latestBoxes = null;
        }
    }

    function observe(frame, segmentationComplete, {visible, now}) {
        if (phase === 'stopped') return;
        // An inference started before a button press can finish afterwards.
        const capture = frame?.timestamp;
        if (neutralStartMs !== null && Number.isFinite(capture) && capture < neutralStartMs) return;
        if (Number.isFinite(capture)) {
            const slot = Math.floor((capture - (neutralStartMs ?? 0)) / samplingIntervalMs);
            if (slot <= previousSlot) return;
            previousSlot = slot;
        }
        const capturePhase = taskStartMs !== null && Number.isFinite(capture) && capture < taskStartMs ? 'neutral' : phase;
        const width = frame?.frameSize?.width, height = frame?.frameSize?.height;
        const projected = assessZones(selectedCatalog, frame?.landmarks, { inputMirrored, width, height, ...roiSettings });
        quality = frameQuality(frame, segmentationComplete, visible, now);
        latestBoxes = visible && !quality.length ? { width, height,
            // E.g. medial brows and both cheeks contain two disjoint groups of anchors.
            boxes: Object.values(projected.zones).flatMap(zone => zone.valid ? zone.groupBoxes : []), now } : null;
        const record = engine.observe({ timestampMs: capture, phase: capturePhase, blendshapes: frame?.blendShapes,
            qualityOk: quality.length === 0, zoneQuality: projected.zoneQuality });
        // Persist selected scalar signals only. The full camera frame and the mesh remain transient.
        latestObservation = { observations: record.observations, now };
        const { provenance: _header, ...data } = record;
        const line = JSON.stringify({ type: 'frame', ...data, captureReasons: quality,
            zoneReasons: Object.fromEntries(Object.entries(projected.reasons).filter(([, reasons]) => reasons.length)) }) + '\n';
        const size = encoder.encode(line).length;
        if (bytes + size > BYTE_CAP) { stop('byte_limit_before_current_row', now); return; }
        lines.push(line); bytes += size; records.push(record);
        if (firstTime === null && Number.isFinite(capture)) firstTime = capture;
        counts[record.status] = (counts[record.status] ?? 0) + 1;
        if (quality.length === 0 && record.status === 'calibrating') accepted++;
        lastTime = record.timestampMs;
        if (lines.length >= CAPTURE_CAP) stop('frame_limit', now);
        else if (phase === 'neutral' && firstTime !== null && capture - firstTime >= 30000) stop('neutral_timeout', now);
    }
    function startTask(now) {
        if (phase !== 'neutral' || !Number.isFinite(now) || !Number.isFinite(lastTime)
            || now < lastTime || now - lastTime > 300 || !readyForTask(now).readyRequired) return false;
        phase = 'task';
        taskStartMs = now;
        return true;
    }
    function status(now) {
        if (phase === 'neutral' && Number.isFinite(now) && (neutralStartMs ?? firstTime) !== null
            && now - (neutralStartMs ?? firstTime) >= 30000) stop('neutral_timeout', now);
        const ready = phase === 'neutral' ? readyForTask(now) : null;
        return {phase, stopReason, count:lines.length, accepted, bytes, quality:[...quality], ready,
            calibration:engine.calibration(), expectedFps:engine.provenance.expectedFps,
            observedFps:lastTime > firstTime ? (records.length - 1) * 1000 / (lastTime - firstTime) : null,
            window:records.length ? summarizeWindow(records, {endMs:Math.min(now, stopMs ?? now),durationMs:2000}) : null,
            latestBoxes:latestBoxes && now - latestBoxes.now <= 300 ? latestBoxes : null,
            observations:latestObservation && (phase === 'stopped' || now-latestObservation.now<=300) ? latestObservation.observations : []};
    }
    function exportLines() {
        if (phase !== 'stopped') throw new Error('Finish the research block before export');
        const header = {type:'header', schema:'wecog.atlas.local-jsonl/1', integrationBaseCommit:WECog_SOURCE,
            adapterVersion:'wecog-atlas-recording/1.0.1-pilot', model:MODEL_ASSETS.face,
            requiredChannels:[...requiredChannels], samplingMethod:'capture-time-slots.v1',
            provenance:engine.provenance, roiSettings, timestampClock:'performance.now / ms',
            extractorRoundingDecimals:3, profileId:options.profileId ?? null,
            frameLimit:CAPTURE_CAP, byteLimit:BYTE_CAP, neutralStartMs, taskStartMs, stopMs, stopReason,
            frameCount:lines.length, counts:{...counts}, calibration:engine.calibration()};
        return [JSON.stringify(header) + '\n', ...lines];
    }
    function series(channel) {
        return records.slice(-200).map(r => ({timestampMs:r.timestampMs,
            delta:r.observations.find(o=>o.channel===channel)?.delta ?? null}));
    }
    return { observe, status, startTask, stop, exportLines, series };
}
