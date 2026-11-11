import { test, expect, Page } from '@playwright/test';

const pagePath = '/apps/participant-web/mvp_with_precheck_1-updated.html';
async function prepare(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__captureCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      w.__captureCalls++; throw new Error('Camera and microphone are forbidden in this test');
    };
  });
  await page.route('**/auth/me', route => route.fulfill({ status: 401, json: {} }));
  await page.goto(pagePath);
  await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.sessionRuntime);
}

test('a cancelled late protocol response cannot replace a newer protocol or create a failure', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async () => {
    const w = window as any, s = w.__WECOG_STATE__;
    s.runtime.sessionRuntime.policyShown = true;
    const url = performance.getEntriesByType('resource').map(row => row.name)
      .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
    w.__runner = await import(url);
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      if (!String(input).endsWith('experiment.json')) return original(input, options);
      return { ok: true, body: { cancel: async () => { w.__cancelledBodies = (w.__cancelledBodies || 0) + 1; } },
        json: () => new Promise(resolve => {
          w.__releaseOldProtocol = () => resolve({ title: 'OLD MUST NOT APPEAR', version: 'v2', blocks: [
            { id: 'old', type: 'instruction', content: { title: 'OLD MUST NOT APPEAR', text: 'old' } }
          ] });
        }) } as any;
    };
    w.__oldLoad = w.__runner.loadAndStartCognitiveTask({ autoFinishSession: false });
  });
  await page.waitForFunction(() => typeof (window as any).__releaseOldProtocol === 'function');
  await page.evaluate(async () => {
    const w = window as any;
    await w.__runner.loadAndStartCognitiveTask({ autoFinishSession: false, protocol: {
      title: 'New protocol', version: 'v2', blocks: [
        { id: 'new', type: 'instruction', content: { title: 'New instruction', text: 'New text', standardInstruction: false } }
      ]
    } });
    w.__releaseOldProtocol();
    await w.__oldLoad;
  });
  const data = await page.evaluate(() => {
    const w = window as any, s = w.__WECOG_STATE__;
    return { title: s.sessionData.experimentMeta.title, captureCalls: w.__captureCalls,
      failures: s.sessionData.events.filter((event: any) => event.type === 'protocol_runtime_start_failed').length,
      cancelledBodies: w.__cancelledBodies };
  });
  expect(data).toEqual({ title: 'New protocol', captureCalls: 0, failures: 0, cancelledBodies: 1 });
  await expect(page.locator('#step6')).toContainText('New instruction');
  await expect(page.locator('#step6')).not.toContainText('OLD MUST NOT APPEAR');
  await page.evaluate(() => (window as any).__WECOG_STATE__.runtime.stopCognitiveStimulusPlayback());
});

test('stopping during protocol loading suppresses the late result and error dialog', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const w = window as any, s = w.__WECOG_STATE__;
    s.runtime.sessionRuntime.policyShown = true;
    const url = performance.getEntriesByType('resource').map(row => row.name)
      .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
    const runner = await import(url);
    let release!: () => void, headers!: () => void;
    const reading = new Promise<void>(resolve => { headers = resolve; });
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      if (!String(input).endsWith('experiment.json')) return original(input, options);
      return { ok: true, json: () => { headers(); return new Promise(resolve => {
        release = () => resolve({ title: 'STOPPED', blocks: [] });
      }); } } as any;
    };
    const pending = runner.loadAndStartCognitiveTask({ autoFinishSession: false });
    await reading;
    s.runtime.stopCognitiveStimulusPlayback();
    release();
    await pending;
    return { title: s.sessionData.experimentMeta?.title || null, captureCalls: w.__captureCalls,
      failures: s.sessionData.events.filter((event: any) => event.type === 'protocol_runtime_start_failed').length };
  });
  expect(result).toEqual({ title: null, captureCalls: 0, failures: 0 });
});

for (const delay of ['feedback', 'iti']) {
  test(`stopping during ${delay} cancels the next trial timer`, async ({ page }) => {
    await prepare(page);
    await page.evaluate(async delay => {
      const w = window as any, s = w.__WECOG_STATE__;
      s.runtime.sessionRuntime.policyShown = true;
      const url = performance.getEntriesByType('resource').map(row => row.name)
        .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
      const runner = await import(url);
      await runner.loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2', blocks: [
        { id: 'timer-test', type: 'cognitive_task', taskType: 'simple_rt',
          blockConfig: { useFixation: false, stimulusDuration: 10000, showFeedback: delay === 'feedback' },
          trials: [0, 1].map(id => ({ id: String(id), stimulusId: 'std_simple_black_square',
            action: 'space', duration: 10000, iti: 200, feedbackDuration: 200 })) }
      ] } });
    }, delay);
    await page.locator('#cogStartBtn').click();
    await page.waitForFunction(() => (window as any).__WECOG_STATE__.runtime.currentPhase === 'cognitive_stimulus');
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.cognitiveResults.length)).toBe(1);
    const events = await page.evaluate(() => {
      const s = (window as any).__WECOG_STATE__;
      s.runtime.stopCognitiveStimulusPlayback();
      return s.sessionData.events.length;
    });
    // Deliberately cross the old pending timer boundary.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.events.length)).toBe(events);
    expect(await page.evaluate(() => (window as any).__captureCalls)).toBe(0);
  });
}

test('a stopped rest timer cannot finish or advance the replacement protocol', async ({ page }) => {
  await prepare(page);
  const events = await page.evaluate(async () => {
    const w = window as any, s = w.__WECOG_STATE__;
    s.runtime.sessionRuntime.policyShown = true;
    const url = performance.getEntriesByType('resource').map(row => row.name)
      .find(name => name.includes('/js/web-page/experimental_task-updated.js'))!;
    const runner = await import(url);
    await runner.loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2', blocks: [
      { id: 'rest', type: 'rest', content: { durationMs: 1000 } },
      { id: 'stale', type: 'instruction', content: { title: 'STALE REST FINISHED' } }
    ] } });
    s.runtime.stopCognitiveStimulusPlayback();
    return s.sessionData.events.length;
  });
  await page.waitForTimeout(1300);
  expect(await page.evaluate(() => (window as any).__WECOG_STATE__.sessionData.events.length)).toBe(events);
  await expect(page.locator('#step6')).not.toContainText('STALE REST FINISHED');
});
