export const BPM_PUBLICATION_LIMITS = Object.freeze({
    hardMin: 45,
    hardMax: 180,
    cautionLow: 50,
    cautionHigh: 120,
    cautionConfidence: 0.70,
    cautionStreak: 8,
    cautionMaxSpread: 6
});

export class BpmPublicationGate {
    constructor(limits = {}) {
        this.limits = { ...BPM_PUBLICATION_LIMITS, ...limits };
        this.cautionValues = [];
        this.cautionZone = null;
    }

    reset() {
        this.cautionValues = [];
        this.cautionZone = null;
    }

    evaluate(output) {
        const bpm = Number(output?.bpmPublished);
        const confidence = Number(output?.confidence);
        const isHeldEngineValue = /^hold_/.test(String(output?.publishReason || ''));
        if ((output?.published !== true && !isHeldEngineValue) || !Number.isFinite(bpm)) {
            this.reset();
            return { accepted: false, bpm: null, reason: output?.publishReason || 'engine_rejected', confidence: Number.isFinite(confidence) ? confidence : null };
        }
        if (bpm < this.limits.hardMin || bpm > this.limits.hardMax) {
            this.reset();
            return { accepted: false, bpm: null, reason: 'outside_physiological_range', confidence: Number.isFinite(confidence) ? confidence : null };
        }

        const zone = bpm < this.limits.cautionLow ? 'low' : (bpm > this.limits.cautionHigh ? 'high' : null);
        if (!zone) {
            this.reset();
            return { accepted: true, bpm, reason: isHeldEngineValue ? 'held_last_valid' : 'ok', confidence: Number.isFinite(confidence) ? confidence : null, classification: 'typical', held: isHeldEngineValue };
        }
        if (!Number.isFinite(confidence) || confidence < this.limits.cautionConfidence) {
            this.reset();
            return { accepted: false, bpm: null, reason: `${zone}_confidence`, confidence: Number.isFinite(confidence) ? confidence : null };
        }
        if (this.cautionZone !== zone) {
            this.cautionZone = zone;
            this.cautionValues = [];
        }
        this.cautionValues.push(bpm);
        if (this.cautionValues.length > this.limits.cautionStreak) this.cautionValues.shift();
        const spread = this.cautionValues.length
            ? Math.max(...this.cautionValues) - Math.min(...this.cautionValues)
            : Infinity;
        if (this.cautionValues.length < this.limits.cautionStreak || spread > this.limits.cautionMaxSpread) {
            return {
                accepted: false,
                bpm: null,
                reason: `${zone}_requires_confirmation`,
                confidence,
                confirmationCount: this.cautionValues.length
            };
        }
        return { accepted: true, bpm, reason: `${zone}_confirmed`, confidence, classification: zone === 'high' ? 'elevated' : 'low' };
    }
}
