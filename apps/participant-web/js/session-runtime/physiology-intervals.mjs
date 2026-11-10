export const PHYSIOLOGY_INTERVAL_VERSION = 'physiology_intervals.v1';
const MINUTE_MS = 60000;
const MAX_MINUTES = 480;
const MAX_BLOCKS = 400;
const MAX_GAP_MS = 250;
const MAX_MS = 86400000;
const BLOCK_STATUSES = new Set(['in_progress', 'accepted', 'repeat_required', 'interrupted']);

const counter = () => ({ sum: 0, count: 0, observedMs: 0 });
const channels = () => ({ heartRate: counter(), respiration: counter() });
const methodCode = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : null;
function restoreChannel(channel, min, max, duration) {
    if (!Number.isSafeInteger(channel?.count) || channel.count < 0 || channel.count > 10000000
        || channel.count > duration + 1 || !Number.isSafeInteger(channel.observedMs)
        || channel.observedMs < 0 || channel.observedMs > duration
        || (channel.count ? !Number.isFinite(channel.mean) || channel.mean < min || channel.mean > max
            : channel.mean !== null || channel.observedMs !== 0)
        || (Object.hasOwn(channel, 'methodVersion') && !methodCode(channel.methodVersion))) throw new Error('Invalid physiology checkpoint channel');
    return { sum: channel.count ? channel.mean * channel.count : 0, count: channel.count,
        observedMs: channel.observedMs, ...(channel.methodVersion ? { methodVersion: channel.methodVersion } : {}) };
}

function add(channel, value, method) {
    if (value !== null) {
        const incoming = methodCode(method);
        if (channel.methodVersion || incoming) {
            const previous = channel.count > 0 ? channel.methodVersion || 'legacy_summary' : incoming;
            channel.methodVersion = previous === (incoming || 'legacy_summary') ? previous : 'mixed_methods';
        }
        channel.sum += value;
        channel.count++;
    }
}

function describe(channel, duration) {
    return { mean: channel.count ? channel.sum / channel.count : null, count: channel.count,
        observedMs: Math.min(duration, channel.observedMs), ...(channel.methodVersion ? { methodVersion: channel.methodVersion } : {}) };
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
            || !Number.isSafeInteger(saved.throughMs) || saved.throughMs < 0 || saved.throughMs > MAX_MS
            || typeof saved.truncated !== 'boolean'
            || saved.minutes.length !== Math.min(MAX_MINUTES, Math.ceil(saved.throughMs / MINUTE_MS))
            || (saved.throughMs > MAX_MINUTES * MINUTE_MS && !saved.truncated)) {
            throw new Error('Invalid physiology checkpoint');
        }
        this.throughMs = saved.throughMs;
        this.truncated = saved.truncated === true;
        const restoreChannels = row => ({
            heartRate: restoreChannel(row.heartRate, 45, 180, row.endMs - row.startMs),
            respiration: restoreChannel(row.respiration, 6, 24, row.endMs - row.startMs)
        });
        this.minutes = saved.minutes.map((row, index) => {
            if (row?.startMs !== index * MINUTE_MS
                || row.endMs !== Math.min((index + 1) * MINUTE_MS, this.throughMs)) {
                throw new Error('Invalid physiology checkpoint minute');
            }
            return restoreChannels(row);
        });
        const attempts = new Map();
        let previousEnd = 0;
        this.blocks = saved.blocks.map((row, index) => {
            if (!Number.isSafeInteger(row?.startMs) || !Number.isSafeInteger(row.endMs)
                || row.startMs < previousEnd || row.endMs < row.startMs || row.endMs > this.throughMs
                || typeof row.blockId !== 'string' || !row.blockId.trim() || row.blockId.length > 128
                || !Number.isSafeInteger(row.attempt) || row.attempt <= (attempts.get(row.blockId) || 0)
                || row.attempt > 10000000 || !BLOCK_STATUSES.has(row.status)
                || (row.status === 'in_progress' && (index !== saved.blocks.length - 1 || row.endMs !== this.throughMs))) {
                throw new Error('Invalid physiology checkpoint block');
            }
            previousEnd = row.endMs;
            attempts.set(row.blockId, row.attempt);
            return { ...row,
            // An interrupted block ends at the last durable checkpoint, not at reload time.
            status: row.status === 'in_progress' ? 'interrupted' : row.status,
            ...restoreChannels(row) };
        });
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
        if (!Number.isSafeInteger(ms) || ms < this.throughMs || ms >= MAX_MS) return;
        // Duplicate/stale delivery is not a new attempt and must not end a live one.
        if (attempt != null && this.blocks.some(row => row.blockId === blockId && row.attempt === attempt)) return;
        const last = this.blocks.findLast(row => row.blockId === blockId)?.attempt ?? 0;
        attempt ??= last + 1;
        if (this.blocks.length >= MAX_BLOCKS || typeof blockId !== 'string' || !blockId.trim().length
            || blockId.length > 128 || !Number.isSafeInteger(attempt) || attempt <= last || attempt > 10000000) {
            this.truncated = true;
            return;
        }
        this.advance(ms);
        if (this.active) this.endBlock('interrupted', ms);
        this.active = { blockId, attempt, startMs: this.throughMs, status: 'in_progress', ...channels() };
        this.blocks.push(this.active);
    }

    endBlock(status, ms) {
        if (!this.active || !BLOCK_STATUSES.has(status) || status === 'in_progress'
            || !Number.isSafeInteger(ms) || ms < this.throughMs || ms > MAX_MS) return;
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
        // Legacy internal samples had no respiration flags; explicit rejection always wins.
        const rr = sample?.respPublished !== false && sample?.respHeld !== true
            && (!Object.hasOwn(sample || {}, 'respConf') || (Number.isFinite(sample.respConf) && sample.respConf >= .20))
            && Number.isFinite(sample?.respRate) && sample.respRate >= 6 && sample.respRate <= 24 ? sample.respRate : null;
        const blockHr = block && ms - block.startMs >= heartWindowMs ? hr : null;
        const blockRr = block && ms - block.startMs >= respirationWindowMs ? rr : null;
        if (minute) { add(minute.heartRate, hr, sample?.bpmMethodVersion); add(minute.respiration, rr, sample?.respMethodVersion); }
        if (block) { add(block.heartRate, blockHr, sample?.bpmMethodVersion); add(block.respiration, blockRr, sample?.respMethodVersion); }

        // Count time only between adjacent fresh estimates; never bridge capture/reload gaps.
        const dt = this.previousTime === null ? 0 : ms - this.previousTime;
        if (dt > 0 && Number.isFinite(maxEstimateGapMs) && dt <= maxEstimateGapMs) {
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
        if (!Number.isSafeInteger(nowMs) || nowMs < 0) nowMs = this.throughMs;
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
