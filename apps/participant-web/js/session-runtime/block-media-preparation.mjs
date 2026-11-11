import { createMediaCache, MediaPreparationError, mediaContentKey } from './media-cache.mjs?v=20261110-integration1';
import { mediaAbortError } from './media-preload.mjs?v=20261110-integration1';

const normalizedId = id => String(id ?? '').replace(/^api:/, '');

export function invitationMediaScope(meta) {
    return JSON.stringify([meta.code, meta.invitationId, meta.projectId, meta.protocolId, meta.publicationVersion]);
}

export function invitationMediaDescriptor(row) {
    const rawSize = row?.size_bytes;
    return {
        sourceUrl: row?.metadata?.source_url || null,
        mimeType: String(row?.mime_type || ''), version: row?.version ?? null, sha256: row?.sha256 ?? null,
        sizeBytes: Number.isSafeInteger(rawSize) && rawSize > 0 ? rawSize : null
    };
}

// The manifest is metadata only. Successful URLs are views of cache ownership,
// never persisted handles or an invitation-wide promise of offline readiness.
export function createBlockMediaPreparation({ scope, rows = {}, request, budgetBytes, environment, probe, requireManifest = true, onStatus = () => {} }) {
    let disposed = false, pending = null, active = null;
    const manifestByKey = new Map();
    for (const row of Object.values(rows)) {
        row.metadata = { ...row.metadata, url: '' };
        row.mediaReadiness = 'unprepared';
        const key = mediaContentKey(scope, invitationMediaDescriptor(row));
        if (!manifestByKey.has(key)) manifestByKey.set(key, []);
        manifestByKey.get(key).push(row);
    }
    const cache = createMediaCache({ scope, request, budgetBytes, environment, probe, onChange: (stats, change) => {
        if (disposed) return;
        for (const row of change ? manifestByKey.get(change.key) || [] : []) {
            row.metadata = { ...row.metadata, url: change.url || '' };
            row.mediaReadiness = row.metadata.url ? 'ready' : 'unprepared';
        }
        onStatus(stats);
    } });

    const describe = trial => {
        const stimulus = trial?.stimulus || {};
        const id = normalizedId(stimulus.stimulusId ?? trial?.stimulusId);
        const row = rows[id];
        if (row) return invitationMediaDescriptor(row);
        if (requireManifest && /^[1-9]\d*$/.test(id)) {
            throw new MediaPreparationError('media_manifest_missing', 'This stimulus is missing from the pinned publication. Reconnect and reload the invitation before retrying.');
        }
        if (!['image', 'slides', 'video', 'audio'].includes(stimulus.type)) return null;
        return { sourceUrl: stimulus.preparedSource || stimulus.src, mimeType: stimulus.type === 'video' ? 'video/' : stimulus.type === 'audio' ? 'audio/' : 'image/',
            version: stimulus.stimulusVersion ?? null, sha256: null, sizeBytes: null };
    };

    function prepareBlock(block) {
        if (disposed) return Promise.reject(mediaAbortError());
        if (active?.block === block && active.lease.valid()) return Promise.resolve(active.lease);
        if (pending?.block === block) return pending.promise;
        // Never release an active block as a side effect of preparing another one.
        // The runner must release it at an explicit instruction boundary first.
        if (active) return Promise.reject(new MediaPreparationError('media_block_active', 'Finish the active block before preparing another block.'));
        pending?.controller.abort();
        const operation = { block, controller: new AbortController() };
        pending = operation;
        operation.promise = Promise.resolve().then(async () => {
            const trials = Array.isArray(block?.trials) ? block.trials : [];
            const descriptors = trials.map(trial => ({ trial, row: describe(trial) })).filter(item => item.row);
            if (descriptors.some(item => !item.row.sourceUrl)) {
                throw new MediaPreparationError('media_source_missing', 'The stimulus file is unavailable in this publication. Reconnect and retry before starting the block.');
            }
            const lease = await cache.prepare(descriptors.map(item => item.row), { signal: operation.controller.signal });
            if (disposed || pending !== operation || operation.controller.signal.aborted) { lease.release(); throw mediaAbortError(); }
            for (const { trial, row } of descriptors) {
                const previous = trial.stimulus || {};
                trial.stimulus = { ...previous,
                    type: row.mimeType.startsWith('video/') ? 'video' : row.mimeType.startsWith('audio/') ? 'audio' : 'image',
                    src: lease.urlFor(row), fallbackSrc: undefined, preparedMedia: true, preparedSource: row.sourceUrl,
                    stimulusVersion: row.version ?? previous.stimulusVersion };
            }
            active = { block, lease, bindings: descriptors.map(({ trial }) => ({ trial, url: trial.stimulus.src })) };
            return lease;
        }).finally(() => { if (pending === operation) pending = null; });
        return operation.promise;
    }

    return {
        scope, rows, cache, prepareBlock,
        releaseBlock() {
            pending?.controller.abort();
            pending = null;
            if (active) {
                for (const { trial, url } of active.bindings) {
                    if (trial.stimulus?.preparedMedia && trial.stimulus.src === url) {
                        trial.stimulus = { ...trial.stimulus, src: '', preparedMedia: false };
                    }
                }
                active.lease.release(); active = null;
            }
        },
        dispose() {
            disposed = true;
            pending?.controller.abort();
            // Pinned URLs survive a scope switch until the playback owner releases.
            cache.dispose();
        }
    };
}
