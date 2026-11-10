import { createMediaCache } from '../../../session-runtime/media-cache.mjs?v=20261109-issues2';
import { fetchMediaWithDeadline } from '../../../session-runtime/media-preload.mjs?v=20261109-issues2';
import { VPC_CONFIG } from '../constants.js?v=20261106-metrics1';

export function createVPCMediaCache() {
    return createMediaCache({ scope: 'vpc_felidae_assets.v2',
        request: (url, init, read) => fetchMediaWithDeadline(url, init, read, VPC_CONFIG.imageLoadTimeoutMs),
        budgetBytes: 32 * 1024 * 1024 });
}

export async function pickLoadableStimulusFromPool(pool = [], usedStimulusIds = new Set(), options = {}) {
    const candidates = pool.filter(item => item && item.license !== 'placeholder'
        && !String(item.stimulusId).startsWith('local_placeholder:')
        && /^[a-f0-9]{64}$/.test(item.sha256 || ''));
    const unused = candidates.filter(item => !usedStimulusIds.has(item.stimulusId));
    const preferred = [...unused, ...candidates.filter(item => usedStimulusIds.has(item.stimulusId))];
    const cache = options.cache || createVPCMediaCache();
    const errors = [];
    for (const candidate of preferred) {
        const descriptor = { sourceUrl: candidate.url, mimeType: 'image/jpeg', sha256: candidate.sha256,
            sizeBytes: candidate.sizeBytes, version: candidate.sha256 };
        try {
            const lease = await cache.prepare([descriptor]);
            let released = false;
            return {
                stimulus: { ...candidate, url: lease.urlFor(descriptor), sourceUrl: candidate.url },
                fallbackUsed: usedStimulusIds.has(candidate.stimulusId) || errors.length > 0,
                errors,
                release() {
                    if (released) return;
                    released = true; lease.release();
                    if (!options.cache) cache.dispose();
                }
            };
        } catch (error) {
            errors.push({ stimulusId: candidate.stimulusId, code: error.code || 'stimulus_unavailable' });
        }
    }
    if (!options.cache) cache.dispose();
    return { stimulus: null, fallbackUsed: true, errors, reason: 'stimulus_unavailable', release() {} };
}
