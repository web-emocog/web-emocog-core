import type { Request } from '@playwright/test';

export function ingestAcknowledgement(request: Request, overrides: Record<string, unknown> = {}) {
  const payload = request.postDataJSON();
  const completed = payload.lifecycle?.status === 'completed';
  return {
    session_id: payload.ids.session, ingested: true, idempotent: false,
    idempotency_key: request.headers()['idempotency-key'] || null,
    qc_validity: null, proxy_ready: false,
    lifecycle_status: completed ? 'completed' : 'in_progress',
    completed_at: completed ? new Date(payload.lifecycle.completedAt || Date.now()).toISOString() : null,
    ...overrides
  };
}
