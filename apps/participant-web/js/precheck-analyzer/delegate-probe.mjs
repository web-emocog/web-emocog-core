export const DELEGATE_PROBE_POLICY = Object.freeze({ samples: 8, modelBudgetMs: 20,
    tailBudgetMs: 25, minGainMs: 3, maxRatio: 0.8, deadlineMs: 1200 });

function usable(result) {
    const points = result?.faceLandmarks?.[0];
    return Array.isArray(points) && points.length >= 468
        && points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
}

function closeCandidate(model) {
    try { model?.close(); } catch (_) { /* Cleanup cannot replace the working delegate. */ }
}

// Only runs before calibration, never as an adaptive measurement/quality policy.
export class FaceDelegateProbe {
    constructor({ now = () => performance.now() } = {}) {
        this.now = now;
        this.recent = [];
        this.attempted = false;
        this.summary = null;
    }

    observe(duration, detected) {
        if (this.attempted || !detected || !Number.isFinite(duration) || duration <= 0) return;
        this.recent.push(duration);
        if (this.recent.length > DELEGATE_PROBE_POLICY.samples) this.recent.shift();
    }

    due() {
        return !this.attempted && this.recent.length === DELEGATE_PROBE_POLICY.samples
            && this.recent.reduce((sum, value) => sum + value, 0) / this.recent.length > DELEGATE_PROBE_POLICY.modelBudgetMs;
    }

    async compare({ gpu, createCpu, source, timestamp, isCurrent = () => true }) {
        if (!this.due() || !isCurrent()) return null;
        this.attempted = true;
        const started = this.now(), gpuTimes = [], cpuTimes = [];
        let cpu = null, expired = false, timer, keep = false;
        const current = () => isCurrent() && this.now() - started < DELEGATE_PROBE_POLICY.deadlineMs;
        try {
            const candidate = Promise.resolve().then(createCpu).then(model => {
                if (expired || !current()) { closeCandidate(model); return null; }
                return model;
            });
            cpu = await Promise.race([candidate, new Promise((_, reject) => {
                timer = setTimeout(() => { expired = true; reject(new Error('probe_deadline')); }, DELEGATE_PROBE_POLICY.deadlineMs);
            })]);
            clearTimeout(timer);
            if (!cpu || !current()) throw new Error('probe_cancelled');
            let last = timestamp;
            const run = (model, times = null) => {
                if (!current()) throw new Error('probe_cancelled');
                // Probe inference is not a participant sample; preserve increasing
                // model clocks without publishing any of these repeated frames.
                last = Math.max(last + 0.01, timestamp + this.now() - started);
                const at = this.now(), result = model.detectForVideo(source, last);
                const elapsed = this.now() - at;
                if (!usable(result) || !Number.isFinite(elapsed) || elapsed <= 0) throw new Error('probe_unusable');
                times?.push(elapsed);
            };
            run(cpu); // Compile/warm up the candidate outside the timed comparison.
            for (let index = 0; index < DELEGATE_PROBE_POLICY.samples; index++) {
                if (index % 2) { run(cpu, cpuTimes); run(gpu, gpuTimes); }
                else { run(gpu, gpuTimes); run(cpu, cpuTimes); }
            }
            const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
            const gpuMean = mean(gpuTimes), cpuMean = mean(cpuTimes);
            keep = current() && cpuMean <= DELEGATE_PROBE_POLICY.modelBudgetMs
                && Math.max(...cpuTimes) <= DELEGATE_PROBE_POLICY.tailBudgetMs
                && gpuMean - cpuMean >= DELEGATE_PROBE_POLICY.minGainMs
                && cpuMean <= gpuMean * DELEGATE_PROBE_POLICY.maxRatio;
            this.summary = { schemaVersion: 'face_delegate_probe.v1', scope: 'precheck_same_frame',
                decision: keep ? 'cpu_selected' : 'gpu_kept', samples: gpuTimes.length,
                gpuMeanMs: gpuMean, cpuMeanMs: cpuMean, cpuMaxMs: Math.max(...cpuTimes),
                modelBudgetMs: DELEGATE_PROBE_POLICY.modelBudgetMs };
            return keep ? cpu : null;
        } catch (_) {
            this.summary = { schemaVersion: 'face_delegate_probe.v1', scope: 'precheck_same_frame',
                decision: isCurrent() ? 'probe_unavailable' : 'probe_cancelled', samples: gpuTimes.length,
                gpuMeanMs: null, cpuMeanMs: null, cpuMaxMs: null, modelBudgetMs: DELEGATE_PROBE_POLICY.modelBudgetMs };
            return null;
        } finally {
            expired = true;
            clearTimeout(timer);
            if (!keep) closeCandidate(cpu);
        }
    }
}
