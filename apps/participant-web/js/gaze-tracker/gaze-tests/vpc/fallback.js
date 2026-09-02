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

    const species = (pool && pool[0] && pool[0].species) || 'stimulus';
    const label = String(species).replace(/_/g, ' ');
    const hue = (label.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect fill="hsl(${hue},38%,88%)" width="100%" height="100%"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="26" fill="#1e293b" font-family="system-ui,sans-serif">${label}</text></svg>`;
    const placeholder = {
        species,
        fileName: 'local_placeholder.svg',
        stimulusId: `local_placeholder:${species}:${Date.now()}`,
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        sourcePage: '',
        author: 'local',
        license: 'placeholder',
        licenseUrl: ''
    };

    return {
        stimulus: placeholder,
        fallbackUsed: true,
        errors
    };
}
