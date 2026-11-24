import { test, expect } from '@playwright/test';
import { getPageUrl } from './helpers/testUtils';

for (const exhausted of [false, true]) {
  test(`#177 actual quality issue ${exhausted ? 'keeps an exhausted attempt rejected' : 'does not poison recovered accepted time'}`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-23T12:00:00Z') });
    await page.goto(getPageUrl(), { waitUntil: 'load' });
    await page.waitForFunction(() => (window as any).__WECOG_STATE__?.runtime?.participantShellReady);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.evaluate(async () => {
      const shared = (window as any).__WECOG_STATE__;
      shared.runtime.sessionRuntime.policyShown = true;
      shared.sessionData.startTime = Date.now();
      const { loadAndStartCognitiveTask } = await import(new URL(
        'js/web-page/experimental_task-updated.js?v=20261124-recovery1', location.href).href);
      await loadAndStartCognitiveTask({ autoFinishSession: false, protocol: { version: 'v2.0-quality-recovery-fixture',
        blocks: [{ id: 'rest', type: 'passive', content: { useFixation: false, slideDuration: 5000,
          validTime: { schemaVersion: 'passive_valid_time.v1', enabled: true, maxExtensionRatio: .5, minSegmentMs: 1000 },
          trials: [{ stimulusId: 'std_simple_black_square', duration: 5000 }] } }] } });
    });
    await page.locator('#cogStartBtn').click();
    await page.clock.runFor(100);
    expect(await page.evaluate(() => !!(window as any).__WECOG_STATE__.runtime.validTimeTrial)).toBe(true);
    await page.evaluate(exhausted => {
      const shared = (window as any).__WECOG_STATE__;
      (window as any).__qualityObservations = 0;
      // This tests the real issue/state/repeat path, not physical camera quality.
      (window as any).__qualityOracle = setInterval(() => {
        const tracker = shared.runtime.validTimeTrial;
        if (!tracker) return;
        (window as any).__qualityObservations++;
        const elapsed = performance.now() - tracker.startMs;
        const bad = exhausted || elapsed >= 1800 && elapsed < 2800;
        tracker.observe(performance.now(), bad ? ['protocol_qc_fpsStable'] : []);
        if (bad) shared.runtime.sessionRuntime.reportIssue({ kind: 'quality', code: 'protocol_qc_fpsStable',
          message: 'Synthetic analysis FPS gap', invalidatesBlock: true, recoverable: true });
        else shared.runtime.sessionRuntime.resolveIssue('protocol_qc_fpsStable');
      }, 100);
    }, exhausted);
    await page.clock.runFor(2000);
    await expect(page.locator('#wecog-session-alert')).toHaveCount(1);
    await expect(page.locator('#wecog-session-alert')).toBeHidden();
    await page.clock.runFor(5600);
    const result = await page.evaluate(() => {
      clearInterval((window as any).__qualityOracle);
      const shared = (window as any).__WECOG_STATE__;
      return { trial: shared.sessionData.cognitiveResults[0], observations: (window as any).__qualityObservations,
        issueRecorded: shared.sessionData.events.some((event: any) => event.type === 'session_issue_raised'
          && event.issue?.code === 'protocol_qc_fpsStable'),
        repeat: shared.sessionData.events.some((event: any) => event.type === 'block_repeat_required') };
    });
    expect(result.observations).toBeGreaterThan(50);
    expect(result.issueRecorded).toBe(true);
    expect(result.trial.qualityValid).toBe(!exhausted);
    expect(result.trial.validTime.limitReached).toBe(exhausted);
    expect(result.trial.validTime.actualMs).toBeLessThanOrEqual(7500);
    if (exhausted) expect(result.trial.validTime.acceptedMs).toBe(0);
    else expect(result.trial.validTime.acceptedMs).toBeGreaterThanOrEqual(5000);
    expect(result.repeat).toBe(exhausted);
    expect(result.trial.rt).toBeNull();
  });
}
