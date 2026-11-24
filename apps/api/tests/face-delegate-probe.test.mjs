import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceDelegateProbe, DELEGATE_PROBE_POLICY as policy } from '../../participant-web/js/precheck-analyzer/delegate-probe.mjs';

function fixture(gpuMs = 40, cpuMs = 15) {
    let clock = 0;
    const source = {}, stamps = [];
    const output = () => ({ faceLandmarks: [Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }))] });
    const model = duration => ({ closed: 0, calls: 0, close() { this.closed++; }, detectForVideo(input, stamp) {
        assert.equal(input, source); stamps.push(stamp); clock += typeof duration === 'function' ? duration(this.calls++) : duration;
        return output();
    } });
    const gpu = model(gpuMs), cpu = model(cpuMs), probe = new FaceDelegateProbe({ now: () => clock });
    const options = { gpu, createCpu: async () => cpu, source, timestamp: 1000 };
    return { gpu, cpu, probe, options, stamps, advance: ms => { clock += ms; } };
}
const slow = probe => { for (let i = 0; i < policy.samples; i++) probe.observe(40, true); };

test('delegate probe needs eight real slow face measurements and never treats absent/zero timings as evidence', () => {
    const { probe } = fixture();
    for (const ms of [0, NaN, Infinity, -1]) probe.observe(ms, true);
    for (let i = 0; i < 50; i++) probe.observe(40, false);
    assert.equal(probe.due(), false);
    for (let i = 0; i < 8; i++) probe.observe(19, true);
    assert.equal(probe.due(), false);
    slow(probe); assert.equal(probe.due(), true);
    assert.equal(probe.recent.length, 8);
});

test('probe selects a materially faster CPU with model headroom on the same immutable frame', async () => {
    const { probe, options, gpu, cpu, stamps } = fixture(); slow(probe);
    assert.equal(await probe.compare(options), cpu);
    assert.equal(probe.summary.decision, 'cpu_selected');
    assert.equal(probe.summary.modelBudgetMs, 20);
    assert.equal(probe.summary.samples, 8);
    assert.equal(cpu.closed, 0); assert.equal(gpu.closed, 0);
    assert.ok(stamps.every((stamp, i) => !i || stamp > stamps[i - 1]));
    assert.equal(await probe.compare(options), null, 'one probe only');
    assert.equal(probe.summary.cpuMeanMs, 15);
    assert.equal(probe.summary.gpuMeanMs, 40);
});

for (const [name, gpuMs, cpuMs] of [['small gain', 22, 20], ['no primary reserve', 60, 30],
    ['slow CPU', 40, 50], ['tail spike', 40, count => count === 3 ? 26 : 15]]) {
    test(`probe retains GPU and closes the CPU for ${name}`, async () => {
        const { probe, options, gpu, cpu } = fixture(gpuMs, cpuMs); slow(probe);
        assert.equal(await probe.compare(options), null);
        assert.equal(probe.summary.decision, 'gpu_kept');
        assert.equal(cpu.closed, 1); assert.equal(gpu.closed, 0);
    });
}

test('unusable results, inference failures and cancelled ownership cannot select or leak the candidate', async () => {
    for (const mode of ['absent', 'nan', 'throw', 'cancel']) {
        const { probe, options, gpu, cpu } = fixture(); slow(probe);
        const original = cpu.detectForVideo;
        let current = true;
        cpu.detectForVideo = (...args) => {
            if (mode === 'throw') throw new Error('synthetic private exception');
            if (mode === 'cancel') current = false;
            const result = original.apply(cpu, args);
            if (mode === 'absent') result.faceLandmarks = [];
            if (mode === 'nan') result.faceLandmarks[0][0].x = NaN;
            return result;
        };
        assert.equal(await probe.compare({ ...options, isCurrent: () => current }), null);
        assert.equal(cpu.closed, 1); assert.equal(gpu.closed, 0);
        assert.doesNotMatch(JSON.stringify(probe.summary), /private|exception|landmark/);
    }
});

test('synchronous probe work stops at its deadline without changing the active GPU model', async () => {
    const { probe, options, gpu, cpu } = fixture(1000, 50); slow(probe);
    assert.equal(await probe.compare(options), null);
    assert.equal(cpu.closed, 1); assert.equal(gpu.closed, 0);
    assert.ok(probe.summary.samples < 8);
});

test('a late candidate after creation timeout is closed, never installed', async () => {
    const { probe, options, cpu } = fixture(); slow(probe);
    let resolve;
    const started = Date.now();
    assert.equal(await probe.compare({ ...options, createCpu: () => new Promise(done => { resolve = done; }) }), null);
    assert.ok(Date.now() - started >= policy.deadlineMs - 30);
    resolve(cpu); await new Promise(done => setTimeout(done, 0));
    assert.equal(cpu.closed, 1);
});

test('a candidate cleanup exception cannot replace or disable the working GPU', async () => {
    const { probe, options, gpu, cpu } = fixture(40, 50); slow(probe);
    cpu.close = () => { throw new Error('synthetic cleanup failure'); };
    assert.equal(await probe.compare(options), null);
    assert.equal(gpu.closed, 0);
    assert.equal(probe.summary.decision, 'gpu_kept');
});
