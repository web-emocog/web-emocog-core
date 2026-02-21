import { VPC_CONFIG } from '../constants.js';

function loadImage(url, timeoutMs = VPC_CONFIG.imageLoadTimeoutMs) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error(`timeout:${url}`));
        }, timeoutMs);

        image.onload = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve({ width: image.naturalWidth, height: image.naturalHeight });
        };

        image.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(new Error(`load_error:${url}`));
        };

        image.referrerPolicy = 'no-referrer';
        image.src = url;
    });
}

export async function pickLoadableStimulusFromPool(pool = [], usedStimulusIds = new Set()) {
    const candidates = (pool || []).filter(item => !!item && !usedStimulusIds.has(item.stimulusId));

    const preferred = candidates.length > 0 ? candidates : (pool || []);
    const errors = [];

    for (const candidate of preferred) {
        try {
            await loadImage(candidate.url, VPC_CONFIG.imageLoadTimeoutMs);
            return {
                stimulus: candidate,
                fallbackUsed: candidates.length === 0,
                errors
            };
        } catch (error) {
            errors.push({
                stimulusId: candidate?.stimulusId || null,
                url: candidate?.url || null,
                message: String(error?.message || error)
            });
        }
    }

    return {
        stimulus: null,
        fallbackUsed: true,
        errors
    };
}
