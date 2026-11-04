export const PHYSIOLOGY_INTERVAL_VERSION = 'physiology_intervals.v1';
const MINUTE_MS = 60000;
const MAX_MINUTES = 480;
const MAX_BLOCKS = 400;
const MAX_GAP_MS = 250;
const MAX_MS = 86400000;

const counter = () => ({ sum: 0, count: 0, observedMs: 0 });
const channels = () => ({ heartRate: counter(), respiration: counter() });
function restoreChannel(channel, min, max) {
    if (!Number.isSafeInteger(channel?.count) || channel.count < 0 || channel.count > 10000000
        || !Number.isSafeInteger(channel.observedMs) || channel.observedMs < 0
        || (channel.count ? !Number.isFinite(channel.mean) || channel.mean < min || channel.mean > max
            : channel.mean !== null || channel.observedMs !== 0)) throw new Error('Invalid physiology checkpoint channel');
    return { sum: channel.count ? channel.mean * channel.count : 0, count: channel.count,
        observedMs: channel.observedMs };
}

function add(channel, value) {
    if (value !== null) {
        channel.sum += value;
        channel.count++;
    }
}

function describe(channel, duration) {
    return { mean: channel.count ? channel.sum / channel.count : null, count: channel.count,
        observedMs: Math.min(duration, channel.observedMs) };
}

function describeChannels(row, duration) {
    return { heartRate: describe(row.heartRate, duration), respiration: describe(row.respiration, duration) };
}

export class PhysiologyIntervals {
    constructor(saved = null) {
        this.minutes = [];
        this.blocks = [];
        this.throughMs = 0;
        this.lastRecordedMs = null;
        this.truncated = false;
        this.active = null;
        this.breakContinuity();
        if (saved?.schemaVersion !== PHYSIOLOGY_INTERVAL_VERSION) return;
        if (!Array.isArray(saved.minutes) || saved.minutes.length > MAX_MINUTES
            || !Array.isArray(saved.blocks) || saved.blocks.length > MAX_BLOCKS
            || !Number.isSafeInteger(saved.throughMs) || saved.throughMs < 0 || saved.throughMs > MAX_MS) {
            this.truncated = true;
            return;
        }
        this.throughMs = saved.throughMs;
        this.truncated = saved.truncated === true;
        this.minutes = saved.minutes.map(row => ({
            heartRate: restoreChannel(row.heartRate, 45, 180), respiration: restoreChannel(row.respiration, 6, 24)
        }));
        this.blocks = saved.blocks.map(row => ({ ...row,
            // An interrupted block ends at the last durable checkpoint, not at reload time.
            status: row.status === 'in_progress' ? 'interrupted' : row.status,
            heartRate: restoreChannel(row.heartRate, 45, 180), respiration: restoreChannel(row.respiration, 6, 24)
        }));
    }

    breakContinuity() {
        this.previousTime = null;
        this.previousMinute = null;
        this.previousBlock = null;
        this.previousHeartRate = false;
        this.previousRespiration = false;
        this.previousBlockHeartRate = false;
        this.previousBlockRespiration = false;
    }

    advance(ms) {
        if (!Number.isSafeInteger(ms) || ms < 0) return;
        this.throughMs = Math.max(this.throughMs, Math.min(ms, MAX_MS));
        if (ms > MAX_MINUTES * MINUTE_MS) this.truncated = true;
    }

    beginBlock({ blockId, attempt }, ms) {
        if (!Number.isSafeInteger(ms) || ms < 0 || ms >= MAX_MS) return;
        this.advance(ms);
        if (this.active) this.endBlock('interrupted', ms);
        const last = this.blocks.findLast(row => row.blockId === blockId)?.attempt ?? 0;
        attempt ??= last + 1;
        if (this.blocks.length >= MAX_BLOCKS || typeof blockId !== 'string' || !blockId.trim().length
            || blockId.length > 128 || !Number.isSafeInteger(attempt) || attempt <= last || attempt > 10000000) {
            this.truncated = true;
            return;
        }
        this.active = { blockId, attempt, startMs: this.throughMs, status: 'in_progress', ...channels() };
        this.blocks.push(this.active);
    }

    endBlock(status, ms) {
        if (!this.active) return;
        this.advance(ms);
        this.active.endMs = this.throughMs;
        this.active.status = status;
        this.active = null;
    }

    record(ms, sample, heartWindowMs, respirationWindowMs, maxEstimateGapMs = MAX_GAP_MS) {
        if (!Number.isSafeInteger(ms) || ms < 0 || ms >= MAX_MS
            || ms < this.throughMs || (this.lastRecordedMs !== null && ms <= this.lastRecordedMs)) return;
        this.advance(ms);
        this.lastRecordedMs = ms;
        const index = Math.floor(ms / MINUTE_MS);
        const minute = index < MAX_MINUTES ? (this.minutes[index] ||= channels()) : null;
        if (!minute) this.truncated = true;
        const block = this.active;
        const hr = sample?.published === true && sample.held !== true
            && Number.isFinite(sample.bpm) && sample.bpm >= 45 && sample.bpm <= 180 ? sample.bpm : null;
        const rr = Number.isFinite(sample?.respRate) && sample.respRate >= 6 && sample.respRate <= 24 ? sample.respRate : null;
        const blockHr = block && ms - block.startMs >= heartWindowMs ? hr : null;
        const blockRr = block && ms - block.startMs >= respirationWindowMs ? rr : null;
        if (minute) { add(minute.heartRate, hr); add(minute.respiration, rr); }
        if (block) { add(block.heartRate, blockHr); add(block.respiration, blockRr); }

        // Count time only between adjacent fresh estimates; never bridge capture/reload gaps.
        const dt = this.previousTime === null ? 0 : ms - this.previousTime;
        if (dt > 0 && dt <= maxEstimateGapMs) {
            const boundary = index * MINUTE_MS;
            const earlier = Math.max(0, boundary - this.previousTime);
            if (hr !== null && this.previousHeartRate) {
                if (earlier && this.previousMinute) this.previousMinute.heartRate.observedMs += earlier;
                if (minute) minute.heartRate.observedMs += dt - earlier;
            }
            if (rr !== null && this.previousRespiration) {
                if (earlier && this.previousMinute) this.previousMinute.respiration.observedMs += earlier;
                if (minute) minute.respiration.observedMs += dt - earlier;
            }
            if (block && block === this.previousBlock) {
                if (blockHr !== null && this.previousBlockHeartRate) block.heartRate.observedMs += dt;
                if (blockRr !== null && this.previousBlockRespiration) block.respiration.observedMs += dt;
            }
        }
        this.previousTime = ms;
        this.previousMinute = minute;
        this.previousBlock = block;
        this.previousHeartRate = hr !== null;
        this.previousRespiration = rr !== null;
        this.previousBlockHeartRate = blockHr !== null;
        this.previousBlockRespiration = blockRr !== null;
    }

    snapshot(nowMs = this.throughMs) {
        const throughMs = Math.min(MAX_MS, Math.max(this.throughMs, nowMs, (this.lastRecordedMs ?? -1) + 1));
        const length = Math.min(MAX_MINUTES, Math.ceil(throughMs / MINUTE_MS));
        const minutes = Array.from({ length }, (_, index) => {
            const startMs = index * MINUTE_MS;
            const endMs = Math.min(startMs + MINUTE_MS, throughMs);
            return { startMs, endMs, ...describeChannels(this.minutes[index] || channels(), endMs - startMs) };
        });
        const blocks = this.blocks.map(row => {
            const { blockId, attempt, startMs, status } = row;
            const endMs = row.endMs ?? throughMs;
            return { blockId, attempt, startMs, endMs, status, ...describeChannels(row, endMs - startMs) };
        });
        return { schemaVersion: PHYSIOLOGY_INTERVAL_VERSION, throughMs,
            truncated: this.truncated || nowMs > MAX_MINUTES * MINUTE_MS, minutes, blocks };
    }
}
