import { analyzeAudioWindow } from './session-audio.js?v=20260915-1';

self.onmessage = event => {
    const { id, samples, sampleRate, context } = event.data || {};
    try {
        const result = analyzeAudioWindow(samples, sampleRate, context);
        self.postMessage({ id, ok: true, result });
    } catch (error) {
        self.postMessage({
            id,
            ok: false,
            error: error?.message || String(error)
        });
    }
};
