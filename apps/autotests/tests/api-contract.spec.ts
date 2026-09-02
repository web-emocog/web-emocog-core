import { test, expect } from '@playwright/test';

const API_BASE = (process.env.API_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const RUN_API_CONTRACT = process.env.RUN_API_CONTRACT === '1';
const API_EXPORT_TOKEN = process.env.API_EXPORT_TOKEN || '';

test.describe('API smoke/contract', () => {
  test.skip(!RUN_API_CONTRACT, 'Set RUN_API_CONTRACT=1 to run API contract tests');

  test('health and readiness endpoints are available', async ({ request }) => {
    const health = await request.get(`${API_BASE}/health`);
    expect(health.ok()).toBeTruthy();
    const healthJson = await health.json();
    expect(healthJson.status).toBe('ok');

    const ready = await request.get(`${API_BASE}/ready`);
    expect([200, 503]).toContain(ready.status());
  });

  test('public registration cannot grant privileged role', async ({ request }) => {
    const email = `autotest_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.test`;
    const registerRes = await request.post(`${API_BASE}/auth/register`, {
      data: {
        email,
        password: 'StrongPass123!',
        display_name: 'API Contract Test',
        role: 'admin'
      }
    });

    expect(registerRes.status()).toBe(201);
    const payload = await registerRes.json();
    expect(payload?.user?.role).toBe('respondent');
    expect(typeof payload?.token).toBe('string');
    expect(payload.token.length).toBeGreaterThan(10);
  });

  test('ingest rejects an unauthenticated request without exposing admission details', async ({ request }) => {
    const ingestRes = await request.post(`${API_BASE}/ingest`, {
      data: {
        ids: {
          session: `sess_${Date.now()}`
        }
      }
    });

    expect(ingestRes.status()).toBe(401);
    const payload = await ingestRes.json();
    expect(payload?.error).toBe('Unauthorized');
  });

  test('export supports pagination and enforces RBAC', async ({ request }) => {
    const email = `autotest_export_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.test`;
    const registerRes = await request.post(`${API_BASE}/auth/register`, {
      data: {
        email,
        password: 'StrongPass123!',
        display_name: 'API Export RBAC'
      }
    });
    expect(registerRes.status()).toBe(201);
    const registerPayload = await registerRes.json();
    const token = registerPayload?.token;
    expect(typeof token).toBe('string');

    const exportRes = await request.get(`${API_BASE}/export?format=json&limit=5&offset=0`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    expect(exportRes.status()).toBe(403);
  });

  test('respondent token cannot create an unscoped ingest session', async ({ request }) => {
    const email = `autotest_ingest_${Date.now()}_${Math.floor(Math.random() * 10000)}@example.test`;
    const registerRes = await request.post(`${API_BASE}/auth/register`, {
      data: {
        email,
        password: 'StrongPass123!',
        display_name: 'API Ingest Contract'
      }
    });
    expect(registerRes.status()).toBe(201);
    const registerPayload = await registerRes.json();
    const token = registerPayload?.token;
    expect(typeof token).toBe('string');

    const ingestRes = await request.post(`${API_BASE}/ingest`, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      data: {
        schemaVersion: 'session_feature.v1',
        ids: {
          session: `sess_contract_${Date.now()}`,
          participant: `p_${Math.floor(Math.random() * 100000)}`
        },
        lifecycle: {
          schemaVersion: 'session_lifecycle.v1',
          state: 'running',
          status: 'in_progress'
        },
        events: [],
        qcSummary: {
          qcScore: 0.81,
          checks: {
            duration: true,
            faceVisible: true,
            faceOk: true,
            poseOk: true,
            illuminationOk: true,
            eyesOpen: true,
            occlusion: true,
            gazeValid: true,
            gazeOnScreen: true,
            lowFps: true
          }
        },
        blocks: [
          {
            name: 'Block_1',
            attention: 82,
            arousal: 0.61,
            valence: -0.04,
            blinks: 14,
            rt: 745,
            omissions: 2.5
          }
        ],
        cognitiveResults: [
          { blockId: 'Block_1', rt: 720, response: 'Space' },
          { blockId: 'Block_1', rt: 770, response: null }
        ]
      }
    });

    expect(ingestRes.status()).toBe(403);
    const ingestPayload = await ingestRes.json();
    expect(ingestPayload.error).toBe('Forbidden');
  });

  test('export includes blocks and qc keys when privileged token provided', async ({ request }) => {
    test.skip(!API_EXPORT_TOKEN, 'Set API_EXPORT_TOKEN to run privileged export contract checks');

    const exportRes = await request.get(`${API_BASE}/export?format=json&limit=1&offset=0`, {
      headers: {
        Authorization: `Bearer ${API_EXPORT_TOKEN}`
      }
    });
    expect(exportRes.ok()).toBeTruthy();
    const payload = await exportRes.json();
    expect(typeof payload?.count).toBe('number');
    expect(Array.isArray(payload?.rows)).toBeTruthy();
    if (payload.rows.length > 0) {
      const row = payload.rows[0];
      expect(row).toHaveProperty('qc_summary');
      expect(row).toHaveProperty('qc_score');
      expect(row).toHaveProperty('qc_validity');
      expect(row).toHaveProperty('blocks');
      if (row.qc_summary) {
        expect(row.qc_summary).toHaveProperty('qc_score');
        expect(row.qc_summary).toHaveProperty('validity');
        expect(row.qc_summary).toHaveProperty('checks');
      }
      expect(Array.isArray(row.blocks)).toBeTruthy();
      if (row.blocks.length > 0) {
        const firstBlock = row.blocks[0];
        expect(firstBlock).toHaveProperty('name');
        expect(firstBlock).toHaveProperty('attention');
        expect(firstBlock).toHaveProperty('arousal');
        expect(firstBlock).toHaveProperty('valence');
        expect(firstBlock).toHaveProperty('blinks');
        expect(firstBlock).toHaveProperty('rt');
        expect(firstBlock).toHaveProperty('omissions');
      }
    }
  });
});
