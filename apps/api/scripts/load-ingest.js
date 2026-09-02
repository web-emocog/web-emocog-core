const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = String(process.env.LOAD_TEST_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const requests = Math.min(500, Math.max(10, Number.parseInt(process.env.LOAD_TEST_REQUESTS || '100', 10)));
const concurrency = Math.min(50, Math.max(1, Number.parseInt(process.env.LOAD_TEST_CONCURRENCY || '10', 10)));
const maxErrorRate = Number.parseFloat(process.env.LOAD_TEST_MAX_ERROR_RATE || '0.01');

function requireSafeTarget() {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (process.env.LOAD_TEST_ALLOW_MUTATION !== 'YES') {
    throw new Error('Set LOAD_TEST_ALLOW_MUTATION=YES for an isolated or staging database');
  }
  const hostname = new URL(baseUrl).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname) && process.env.LOAD_TEST_ALLOW_REMOTE !== 'YES') {
    throw new Error('Remote load test requires LOAD_TEST_ALLOW_REMOTE=YES');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Load test seeding is forbidden with NODE_ENV=production');
  }
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue))];
}

async function timedFetch(url, options, timings) {
  const started = performance.now();
  const response = await fetch(url, options);
  timings.push(performance.now() - started);
  return response;
}

async function runConcurrent(items, limit, worker) {
  let cursor = 0;
  const failures = [];
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        await worker(items[index], index);
      } catch (error) {
        failures.push({ index, message: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return failures;
}

async function main() {
  requireSafeTarget();
  const pool = new Pool({ connectionString: databaseUrl, max: concurrency + 2 });
  const suffix = randomBytes(8).toString('hex');
  const prefix = `load_${suffix}_`;
  const invitationCode = `LD${randomBytes(16).toString('hex')}`;
  const timings = [];
  let organizationId = null;

  try {
    const seeded = await pool.query(
      `WITH organization AS (
         INSERT INTO organizations (name, slug)
         VALUES ($1, $2)
         RETURNING id
       ), project AS (
         INSERT INTO projects (organization_id, name, slug)
         SELECT id, $3, $4 FROM organization
         RETURNING id, organization_id
       ), protocol AS (
         INSERT INTO protocols (project_id, name, definition)
         SELECT id, $5, '{}'::jsonb FROM project
         RETURNING id, project_id
       ), invitation AS (
         INSERT INTO invitations (protocol_id, code, max_runs, expires_at)
         SELECT id, $6, $7, current_timestamp + interval '1 hour' FROM protocol
         RETURNING id, protocol_id
       )
       SELECT project.organization_id, invitation.id AS invitation_id
       FROM project, invitation`,
      [
        `Load test ${suffix}`,
        `load-${suffix}`,
        `Load project ${suffix}`,
        `load-project-${suffix}`,
        `Load protocol ${suffix}`,
        invitationCode,
        requests,
      ]
    );
    organizationId = seeded.rows[0].organization_id;

    const failures = await runConcurrent(
      Array.from({ length: requests }, (_, index) => index),
      concurrency,
      async (index) => {
        const sessionId = `${prefix}${index}`;
        const participantId = `p_${suffix}_${index}`;
        const finishId = `finish_${suffix}_${index}`;
        const tokenResponse = await timedFetch(
          `${baseUrl}/invitations/by-code/${invitationCode}/ingest-token`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId }),
          },
          timings
        );
        if (!tokenResponse.ok) throw new Error(`admission returned ${tokenResponse.status}`);
        const token = (await tokenResponse.json()).token;
        const payload = {
          schemaVersion: 'session_feature.v1',
          ids: { session: sessionId, participant: participantId, invitationCode },
          meta: { user: { interfaceLanguage: 'ru' }, tech: {} },
          lifecycle: {
            schemaVersion: 'session_lifecycle.v1',
            state: 'completed',
            status: 'completed',
            finishAttemptId: finishId,
            completedAt: Date.now(),
          },
          events: [],
        };
        const headers = {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'idempotency-key': finishId,
        };
        const first = await timedFetch(
          `${baseUrl}/ingest`,
          { method: 'POST', headers, body: JSON.stringify(payload) },
          timings
        );
        if (!first.ok) throw new Error(`first ingest returned ${first.status}`);
        const replay = await timedFetch(
          `${baseUrl}/ingest`,
          { method: 'POST', headers, body: JSON.stringify(payload) },
          timings
        );
        const replayBody = await replay.json();
        if (!replay.ok || replayBody.idempotent !== true) {
          throw new Error(`idempotent replay returned ${replay.status}`);
        }
      }
    );

    const counts = await pool.query(
      `SELECT
         COUNT(DISTINCT s.id)::int AS sessions,
         COUNT(DISTINCT sf.id)::int AS features,
         COUNT(DISTINCT sq.id)::int AS qc,
         COUNT(DISTINCT sp.id)::int AS proxy
       FROM sessions s
       LEFT JOIN session_features sf ON sf.session_id = s.id
       LEFT JOIN session_qc_summary sq ON sq.session_id = s.id
       LEFT JOIN session_proxy_metrics sp ON sp.session_id = s.id
       WHERE s.session_id LIKE $1`,
      [`${prefix}%`]
    );
    const invitation = await pool.query(
      'SELECT used_runs FROM invitations WHERE code = $1',
      [invitationCode]
    );
    const stored = counts.rows[0];
    const storageValid = ['sessions', 'features', 'qc', 'proxy']
      .every(key => Number(stored[key]) === requests)
      && Number(invitation.rows[0]?.used_runs) === requests;
    if (!storageValid) failures.push({ index: -1, message: `storage mismatch ${JSON.stringify(stored)}` });

    const errorRate = failures.length / requests;
    const result = {
      requests,
      concurrency,
      operations: timings.length,
      failed_sessions: failures.length,
      error_rate: errorRate,
      latency_ms: {
        p50: Math.round(percentile(timings, 0.50)),
        p95: Math.round(percentile(timings, 0.95)),
        p99: Math.round(percentile(timings, 0.99)),
      },
      stored,
    };
    console.log(JSON.stringify(result, null, 2));
    if (errorRate >= maxErrorRate) {
      throw new Error(`error rate ${errorRate} is not below ${maxErrorRate}`);
    }
  } finally {
    try {
      await pool.query('DELETE FROM sessions WHERE session_id LIKE $1', [`${prefix}%`]);
      if (organizationId) await pool.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
    } finally {
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ level: 'error', event: 'load_test_failed', message: error.message }));
  process.exitCode = 1;
});
