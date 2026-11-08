import type { Page } from '@playwright/test';

// Synthetic /auth/me only. No real accounts, server mutation or sensor grant.
export async function installGazeAccess(page: Page, initialRole = 'developer') {
  let role = initialRole, id = '1';
  await page.route('**/api-base.js?*', route => route.fulfill({ contentType: 'text/javascript',
    body: `window.EmocogApiBase = { resolve: () => location.origin + '/api' };` }));
  await page.route('**/api/auth/me', route => {
    const pinned = route.request().headers()['x-staff-user-id'];
    return pinned && pinned !== id ? route.fulfill({ status: 409, json: { code: 'staff_account_changed' } })
      : route.fulfill({ json: { id, role, email: 'synthetic@example.test' } });
  });
  // Test the benchmark's denied-role redirect, not the destination app's own routing/API.
  await page.route('**/apps/web/researcher.html', route => route.fulfill({ contentType: 'text/html', body: '<p>Researcher destination</p>' }));
  return { role(value: string) { role = value; }, id(value: string) { id = value; } };
}
