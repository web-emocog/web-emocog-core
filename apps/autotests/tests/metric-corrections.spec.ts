import { test, expect } from '@playwright/test';

for (const scenario of ['observed', 'no-gaze', 'missing-media', 'corrupt-media', 'presentation-error', 'layout-change', 'mobile'] as const) {
  test('VPC actual presentation, summary and media teardown: ' + scenario, async ({ page }) => {
    if (scenario === 'mobile') await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__metric-test', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="/apps/participant-web/style.css">
      <main style="max-width:700px;width:100%;min-width:0;margin:0 auto"><div id="gazeTestsContainer"><div id="vpcTestScreen">
      <div id="vpcProgressText"></div><div id="vpcPhaseText"></div><div id="vpcFixationMark">+</div>
      <img id="vpcCenterImage" class="vpc-center-image" style="display:none">
      <div class="vpc-pair-row"><img id="vpcLeftImage" class="vpc-side-image" style="display:none">
      <img id="vpcRightImage" class="vpc-side-image" style="display:none"></div></div></div></main>` }));
    if (scenario === 'missing-media') await page.route('**/assets/vpc/felidae/*.jpg',
      route => route.fulfill({ status: 404, body: 'Synthetic unavailable asset' }));
    if (scenario === 'corrupt-media') await page.route('**/assets/vpc/felidae/*.jpg',
      route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: 'Synthetic corrupt bytes' }));
    await page.clock.install();
    await page.goto('/apps/participant-web/__metric-test');
    await page.evaluate(async scenario => {
      const w = window as any;
      const statePath = '/apps/participant-web/js/web-page/state.js?v=20261025-1';
      const runnerPath = '/apps/participant-web/js/gaze-tracker/gaze-tests/vpc/runner.js?v=20261106-metrics1';
      const { state } = await import(statePath);
      const { runVPCTest } = await import(runnerPath);
      w.__vpcState = state;
      const urls = new Set<string>(), create = URL.createObjectURL, revoke = URL.revokeObjectURL;
      URL.createObjectURL = blob => { const url = create(blob); urls.add(url); return url; };
      URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
      w.__vpcResources = urls;
      w.__vpcGeometry = [];
      const tick = setInterval(() => {
        if (state.runtime.currentPhase !== 'vpc_pair') return;
        const element = document.getElementById('vpcLeftImage') as HTMLImageElement;
        const rect = element.getBoundingClientRect();
        if (scenario === 'layout-change') window.dispatchEvent(new Event('resize'));
        if (scenario === 'presentation-error') element.dispatchEvent(new Event('error'));
        if (scenario === 'no-gaze') return;
        state.sessionData.eyeTracking.push({ t: Date.now(), valid: true, onScreen: true,
          correctedX: rect.left + rect.width / 2, correctedY: rect.top + rect.height / 2,
          x: innerWidth + 1000, y: innerHeight + 1000 });
        if (w.__vpcGeometry.length === 0) w.__vpcGeometry.push({ width: innerWidth,
          left: rect.left, right: rect.right, bottom: rect.bottom, height: innerHeight });
      }, 33);
      w.__vpcDone = false;
      w.__vpcPromise = runVPCTest().then((result: unknown) => { w.__vpcResult = result; })
        .catch((error: Error) => { w.__vpcError = error.message; })
        .finally(() => { clearInterval(tick); w.__vpcDone = true; URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
    }, scenario);
    for (let i = 0; i < 1000; i++) {
      if (await page.evaluate(() => (window as any).__vpcDone)) break;
      if (await page.evaluate(() => (window as any).__vpcState.runtime.currentPhase === 'vpc_preparing')) {
        await page.waitForTimeout(25);
        continue;
      }
      await page.clock.runFor(1500);
    }
    expect(await page.evaluate(() => (window as any).__vpcDone)).toBe(true);
    const result = await page.evaluate(() => {
      const w = window as any;
      return { result: w.__vpcResult, error: w.__vpcError, resources: w.__vpcResources.size, geometry: w.__vpcGeometry,
        sources: ['vpcCenterImage','vpcLeftImage','vpcRightImage'].map(id => document.getElementById(id)!.getAttribute('src')) };
    });
    expect(result.error).toBeUndefined(); expect(errors).toEqual([]);
    expect(result.resources).toBe(0); expect(result.sources).toEqual([null,null,null]);
    expect(result.result.methodVersion).toBe('vpc_image_aoi.v2');
    expect(result.result.trials).toHaveLength(12);
    expect(JSON.stringify(result.result)).not.toMatch(/blob:|local_placeholder/);
    const successful = scenario === 'observed' || scenario === 'mobile';
    expect(result.result.summary.validTrials, JSON.stringify({ geometry: result.geometry, trials: result.result.trials.map((trial: any) => ({
      reason: trial.reason, regions:trial.metrics?.regions, coverage:trial.metrics?.coverageFraction
    })) })).toBe(successful ? 12 : 0);
    expect(result.result.summary.legacyUnscoredTrials).toBe(0);
    if (successful) {
      for (const trial of result.result.trials) {
        expect(trial.metrics.gazeSignal).toBe('corrected');
        expect(trial.metrics.coverageFraction).toBeGreaterThan(.8);
        expect(trial.metrics.noveltyPreferencePct).toBe(trial.novelSide === 'left' ? 100 : 0);
        expect(trial.familiarStimulus.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(trial.familiarStimulus.integrityVerified).toBe(true);
      }
      expect(result.geometry[0].left).toBeGreaterThanOrEqual(0);
      expect(result.geometry[0].right).toBeLessThanOrEqual(result.geometry[0].width);
      expect(result.geometry[0].bottom).toBeLessThanOrEqual(result.geometry[0].height);
    } else {
      expect(result.result.summary.meanNoveltyPreferencePct).toBeNull();
      for (const trial of result.result.trials) expect(trial.reason).toBe(
        ['missing-media', 'corrupt-media', 'presentation-error'].includes(scenario) ? 'stimulus_unavailable'
          : scenario === 'layout-change' ? 'layout_changed' : 'no_valid_observation');
    }
  });
}
