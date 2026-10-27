const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RtScheduler } = require('../rt/scheduler');
const { runNativeProcess } = require('../security/native-process');
const { eventsToRtJsonl } = require('../rt/event_adapter');
const { computeSessionRtFeatures, computeBlockRtFeatures, getRtAnalyzerHealth,
  ANALYZE_SCRIPT, CONFIG_PATH } = require('../rt/compute');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('RT queue is bounded, FIFO and cancellation frees a waiting slot', async () => {
  const queue = new RtScheduler({ maxQueue: 2, timeoutMs: 5000 });
  let release;
  const first = queue.run(() => new Promise(resolve => { release = resolve; }));
  await delay(0);
  const order = [];
  const controller = new AbortController();
  const cancelled = queue.run(() => assert.fail('cancelled job ran'), { signal: controller.signal });
  const rejected = assert.rejects(cancelled, { code: 'rt_analyzer_cancelled' });
  const second = queue.run(() => order.push(2));
  await assert.rejects(queue.run(() => assert.fail('overflow ran')), { code: 'rt_analyzer_busy' });
  controller.abort();
  await rejected;
  const third = queue.run(() => order.push(3));
  release(1);
  await Promise.all([first, second, third]);
  assert.deepEqual(order, [2, 3]);
});

test('deadline includes queue wait; cancelled running work is reaped before the next job', async () => {
  const queue = new RtScheduler({ timeoutMs: 70 });
  let reaped = false, waitingRan = false;
  const first = queue.run(async ({ signal }) => {
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    await delay(60);
    reaped = true;
  });
  const firstRejected = assert.rejects(first, { code: 'rt_analyzer_timeout' });
  const waiting = queue.run(() => { waitingRan = true; });
  await assert.rejects(waiting, { code: 'rt_analyzer_timeout' });
  assert.equal(waitingRan, false);
  assert.equal(queue.active, 1);
  await firstRejected;
  await queue.run(() => assert.equal(reaped, true));
});

test('native stdin is byte-bounded and aborted process groups cannot leave delayed writes', async t => {
  const echoed = await runNativeProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'],
    { input: 'data', maxInputBytes: 4 });
  assert.equal(echoed.stdout, 'data');
  await assert.rejects(runNativeProcess('/not-executed', [], { input: 'data', maxInputBytes: 3 }), { code: 'input_limit' });
  const already = new AbortController();
  already.abort();
  await assert.rejects(runNativeProcess('/not-executed', [], { signal: already.signal }), { code: 'cancelled' });
  if (process.platform === 'win32') return;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-rt-abort-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'escaped');
  const controller = new AbortController();
  const child = runNativeProcess('/bin/sh', ['-c', '(sleep 0.3; echo escaped > "$1") & wait', 'fixture', marker],
    { signal: controller.signal });
  const rejected = assert.rejects(child, { code: 'cancelled' });
  await delay(40);
  controller.abort();
  await rejected;
  await delay(400);
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
});

test('batched RT preserves single-job Python results and platform projection for mixed tasks', async () => {
  const cases = ['simple_rt', 'choice', 'go_nogo', 'flanker', 'stroop', 'pvt', 'cpt'];
  const blocks = cases.map((taskType, i) => ({ id: `b${i + 1}`, type: 'cognitive_task', taskType,
    blockConfig: { selected_metrics: ['rt_mean', 'omission_rate', 'rt_outlier_frac'] } }));
  const cognitiveResults = blocks.flatMap(block => [
    { blockId: block.id, trialId: 't1', condition: 'go', response: 'KeyD', expectedResponse: 'в', rt: 350 },
    { blockId: block.id, trialId: 't2', condition: 'go', response: null, expectedResponse: 'KeyD', rt: null },
    { blockId: block.id, trialId: 't3', condition: 'nogo', response: 'Space', expectedResponse: 'Space', rt: 20 },
    { blockId: block.id, trialId: 't4', condition: 'go', response: 'ArrowLeft', expectedResponse: 'ArrowRight', rt: 590 },
  ]);
  const jobs = blocks.map(block => {
    const rows = cognitiveResults.filter(row => row.blockId === block.id);
    const adapted = eventsToRtJsonl([], rows, { blockId: block.id, taskType: block.taskType });
    return { events: adapted.events, task: adapted.analyzerTask };
  });
  const python = process.env.RT_PYTHON || 'python3';
  const invoke = async input => JSON.parse((await runNativeProcess(python, [ANALYZE_SCRIPT],
    { input: JSON.stringify({ ...input, config_path: CONFIG_PATH }), maxInputBytes: 1024 * 1024,
      maxOutputBytes: 1024 * 1024 })).stdout);
  const batch = await invoke({ jobs });
  for (let i = 0; i < jobs.length; i++) assert.deepEqual(batch.jobs[i], await invoke(jobs[i]));
  const result = await computeSessionRtFeatures({ cognitiveResults }, { blocks });
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const single = await computeBlockRtFeatures({ blockId: block.id, taskType: block.taskType,
      selectedMetrics: block.blockConfig.selected_metrics }, [], cognitiveResults.filter(row => row.blockId === block.id));
    assert.deepEqual(result.blocks[i], single);
    assert.equal(single.status, 'ok');
  }
});

test('health is single-flight/cached and analysis failures do not expose native stderr', async t => {
  if (process.platform === 'win32') return;
  const original = process.env.RT_PYTHON;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wecog-rt-health-'));
  t.after(async () => {
    if (original === undefined) delete process.env.RT_PYTHON;
    else process.env.RT_PYTHON = original;
    await fs.rm(root, { recursive: true, force: true });
  });
  const executable = path.join(root, 'python-fixture');
  const marker = path.join(root, 'probes');
  await fs.writeFile(executable, `#!/bin/sh\nif [ "$1" = '--version' ]; then\nprintf x >> '${marker}'\nsleep 0.1\nprintf 'Python 3.11.0 private-path-secret\\n'\nelse\nprintf 'SYNTHETIC-SECRET /private/traceback' >&2\nexit 1\nfi\n`, { mode: 0o700 });
  process.env.RT_PYTHON = executable;
  const probes = Array.from({ length: 20 }, () => getRtAnalyzerHealth());
  await delay(20); // The event loop remains responsive while the child sleeps.
  const health = await Promise.all(probes);
  assert.equal(await fs.readFile(marker, 'utf8'), 'x');
  assert.equal(health[0].python_version, 'Python 3.11.0');
  assert.equal(health[0].script_path, 'analyze_events_json.py');
  assert.ok(!JSON.stringify(health).includes('private-path-secret'));
  await getRtAnalyzerHealth();
  assert.equal(await fs.readFile(marker, 'utf8'), 'x');
  await assert.rejects(computeBlockRtFeatures({ blockId: 'b1' }, [], [{ rt: 350 }]), error => {
    assert.equal(error.code, 'rt_analyzer_failed');
    assert.ok(!error.message.includes('SECRET'));
    return true;
  });
});

test('oversized expanded RT input is rejected before spawning and does not poison the queue', async () => {
  const protocol = { blocks: [{ id: 'b1', type: 'cognitive_task', taskType: 'simple_rt' }] };
  await assert.rejects(computeSessionRtFeatures({ cognitiveResults: [{ blockId: 'b1',
    stimulusType: 'x'.repeat(11 * 1024 * 1024), rt: 420 }] }, protocol), { code: 'rt_analyzer_input_limit' });
  const result = await computeSessionRtFeatures({ cognitiveResults: [{ blockId: 'b1', rt: 420, response: 'Space' }] }, protocol);
  assert.equal(result.blocks[0].status, 'ok');
});

test('missing/foreign block data never fabricate RT trials; legacy unscoped rows require unambiguous scope', async () => {
  const block = id => ({ id, type: 'cognitive_task', taskType: 'simple_rt', blockConfig: { selected_metrics: ['rt_mean'] } });
  const empty = await computeSessionRtFeatures({}, { blocks: [block('empty')] });
  assert.equal(empty.adapter_version, 'rt_event_adapter.v2');
  assert.equal(empty.blocks[0].status, 'no_events');
  assert.deepEqual(empty.blocks[0].computed_metrics, {});
  const result = await computeSessionRtFeatures({ cognitiveResults: [{ blockId: 'main', rt: 420, response: 'Space' }] },
    { blocks: [block('practice'), block('main')] });
  assert.equal(result.blocks[0].status, 'no_events');
  assert.equal(result.blocks[1].computed_metrics.rt_mean.value, 420);
  assert.deepEqual(result.session_metrics.rt_mean.blocks, { main: 420 });
  const legacy = { cognitiveResults: [{ rt: 350, response: 'Space' }] };
  const unambiguous = await computeSessionRtFeatures(legacy, { blocks: [block('main')] });
  assert.equal(unambiguous.blocks[0].computed_metrics.rt_mean.value, 350);
  const ambiguous = await computeSessionRtFeatures(legacy, { blocks: [block('practice'), block('main')] });
  assert.deepEqual(ambiguous.blocks.map(item => item.status), ['no_events', 'no_events']);
  const foreign = await computeSessionRtFeatures({ cognitiveResults: [{ blockId: 'foreign', rt: 420 }] },
    { blocks: [block('main')] });
  assert.equal(foreign.blocks[0].status, 'no_events');
  const adapted = eventsToRtJsonl([{ type: 'response', blockId: 'main', rtMs: 350 }], [], { blockId: 'main' });
  assert.deepEqual(adapted.events, []);
});

test('special protocol block IDs survive RT projection and JSON round trips as own data', async () => {
  const ids = ['__proto__', 'constructor', 'toString', 'normal'];
  const result = await computeSessionRtFeatures({ cognitiveResults: ids.map((blockId, index) => ({
    blockId, rt: 300 + index * 100, response: 'Space', expectedResponse: 'Space', correct: true,
  })) }, { blocks: ids.map(id => ({ id, type: 'cognitive_task', taskType: 'simple_rt' })) });
  const projected = result.session_metrics.rt_mean.blocks;
  assert.equal(Object.getPrototypeOf(projected), Object.prototype);
  const restored = JSON.parse(JSON.stringify(result));
  for (const [index, id] of ids.entries()) {
    assert.equal(Object.hasOwn(projected, id), true);
    assert.equal(projected[id], 300 + index * 100);
    assert.equal(restored.session_metrics.rt_mean.blocks[id], 300 + index * 100);
  }
});
