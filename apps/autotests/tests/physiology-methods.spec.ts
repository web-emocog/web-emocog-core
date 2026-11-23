import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:3000/**', route => route.fulfill({ status: 401, json: {} }));
});

for (const existing of [false, true]) {
  test(`builder keeps current physiology methods by default and saves the chosen ones (${existing ? 'existing protocol' : 'new protocol'})`, async ({ page, baseURL }) => {
    await page.goto(baseURL + '/apps/web/researcher.html?analyticsPreview=1#/overview');
    await page.evaluate(existing => {
      const w = window as any;
      if (existing) localStorage.setItem('emocog_my_experiments', JSON.stringify([{
        id: 'legacy-methods', title: 'Legacy', updatedAt: '2026-11-01T00:00:00Z', blocks: [], savedStep: 6,
        metadata: { title: 'Legacy', protocolId: 'legacy-methods' }
      }]));
      document.body.appendChild(w.ExperimentBuilderView({ startStep: 6,
        ...(existing ? { experimentId: 'legacy-methods' } : {}) }));
    }, existing);
    const heartRate = page.locator('#protocolHeartRateMethod');
    const respiration = page.locator('#protocolRespirationMethod');
    await expect(heartRate).toHaveValue('pos');
    await expect(respiration).toHaveValue('luma');
    await respiration.selectOption('motion');
    await heartRate.selectOption('chrom');
    await page.locator('#saveDraftGlobalBtn').click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments') || '[]')
      .find((row: any) => row.physiologyMethods?.respiration === 'motion')?.physiologyMethods.heartRate)).toBe('chrom');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('emocog_my_experiments') || '[]')
      .find((row: any) => row.physiologyMethods?.respiration === 'motion'));
    await page.reload();
    await page.evaluate(id => document.body.appendChild((window as any).ExperimentBuilderView({ experimentId: id, startStep: 6 })), saved.id);
    await expect(respiration).toHaveValue('motion');
    await expect(heartRate).toHaveValue('chrom');
  });
}
