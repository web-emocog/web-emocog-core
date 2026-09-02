const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const config = require('../config');
const {
  OPERATIONS,
  canRolePerform,
  isPlatformAdmin,
  hasProjectMembership,
  resolveCurrentStaffPrincipal,
} = require('../security/permissions');
const {
  issueIngestToken,
  verifyParticipantIngestRequest,
} = require('../security/ingest-token');

describe('role x operation x tenant matrix', () => {
  const readOperations = [
    OPERATIONS.ORGANIZATION_READ,
    OPERATIONS.PROJECT_READ,
    OPERATIONS.PROTOCOL_READ,
    OPERATIONS.INVITATION_READ,
    OPERATIONS.SESSION_READ,
    OPERATIONS.STIMULUS_READ,
  ];

  it('keeps platform-wide scope exclusive to platform admin', () => {
    assert.equal(isPlatformAdmin({ role: 'admin' }), true);
    for (const role of ['org_admin', 'PI', 'researcher', 'analyst', 'assistant', 'developer']) {
      assert.equal(isPlatformAdmin({ role }), false);
      assert.equal(canRolePerform(role, OPERATIONS.PLATFORM_ADMIN), false);
      if (role !== 'developer') {
        for (const operation of readOperations) {
          assert.equal(canRolePerform(role, operation), true, `${role}: ${operation}`);
        }
      }
    }
  });

  it('enforces explicit project membership for own vs foreign tenant', async () => {
    const calls = [];
    const pool = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: params[0] === 11 && params[1] === 7 ? [{ ok: 1 }] : [] };
      },
    };
    const user = { sub: 7, role: 'researcher' };
    assert.equal(await hasProjectMembership(pool, 11, user), true);
    assert.equal(await hasProjectMembership(pool, 12, user), false);
    assert.match(calls[0].sql, /user_organizations/);
    assert.match(calls[0].sql, /user_projects/);

    const before = calls.length;
    assert.equal(await hasProjectMembership(pool, 999, { sub: 1, role: 'admin' }), true);
    assert.equal(calls.length, before, 'platform admin does not require tenant lookup');
  });

  it('lets an organization admin reach every project only through organization membership', async () => {
    let queryText = '';
    const pool = {
      query: async sql => {
        queryText = sql;
        return { rows: [{ ok: 1 }] };
      },
    };
    assert.equal(
      await hasProjectMembership(pool, 44, { sub: 9, role: 'org_admin' }),
      true
    );
    assert.match(queryText, /user_organizations/);
    assert.doesNotMatch(queryText, /user_projects/);
  });

  it('keeps developers technical-only and organization admins tenant-scoped', () => {
    for (const operation of Object.values(OPERATIONS)) {
      assert.equal(canRolePerform('developer', operation), false, operation);
    }
    for (const operation of Object.values(OPERATIONS)) {
      assert.equal(
        canRolePerform('org_admin', operation),
        operation !== OPERATIONS.PLATFORM_ADMIN,
        operation
      );
    }
  });

  it('keeps analyst read-only and assistant outside analytics/export', () => {
    assert.equal(canRolePerform('analyst', OPERATIONS.ANALYTICS_READ), true);
    assert.equal(canRolePerform('analyst', OPERATIONS.EXPORT_READ), true);
    assert.equal(canRolePerform('analyst', OPERATIONS.SESSION_WRITE), false);
    assert.equal(canRolePerform('analyst', OPERATIONS.PROTOCOL_WRITE), false);
    assert.equal(canRolePerform('assistant', OPERATIONS.SESSION_WRITE), true);
    assert.equal(canRolePerform('assistant', OPERATIONS.ANALYTICS_READ), false);
    assert.equal(canRolePerform('assistant', OPERATIONS.EXPORT_READ), false);
  });

  it('uses the current database role and rejects a revoked token version', async () => {
    const token = jwt.sign(
      { sub: 7, email: 'old@example.test', role: 'admin', ver: 3 },
      config.jwt.secret,
      {
        algorithm: 'HS256',
        issuer: config.jwt.staffIssuer,
        audience: config.jwt.staffAudience,
        expiresIn: '5m',
      }
    );
    const current = await resolveCurrentStaffPrincipal(
      {
        query: async () => ({
          rows: [{
            id: 7,
            email: 'current@example.test',
            role: 'analyst',
            token_version: 3,
          }],
        }),
      },
      `Bearer ${token}`
    );
    assert.equal(current.role, 'analyst');
    assert.equal(current.email, 'current@example.test');
    assert.equal(isPlatformAdmin(current), false);

    const revoked = await resolveCurrentStaffPrincipal(
      {
        query: async () => ({
          rows: [{ id: 7, email: 'x@example.test', role: 'admin', token_version: 4 }],
        }),
      },
      `Bearer ${token}`
    );
    assert.equal(revoked, null);
  });
});

describe('server-issued participant ingest token', () => {
  const invitation = {
    id: 5,
    code: 'INV-5',
    protocol_id: 13,
    project_id: 21,
  };

  function requestWith(token) {
    return { headers: { authorization: `Bearer ${token}` } };
  }

  it('accepts only the bound session + invitation tuple', () => {
    const token = issueIngestToken({ sessionId: 'S-1', invitation });
    const matching = verifyParticipantIngestRequest(requestWith(token), {
      sessionId: 'S-1',
      invitationCode: 'INV-5',
      invitation,
    });
    assert.equal(matching.ok, true);

    for (const mismatch of [
      { sessionId: 'S-2', invitationCode: 'INV-5', invitation },
      { sessionId: 'S-1', invitationCode: 'INV-OTHER', invitation },
      { sessionId: 'S-1', invitationCode: 'INV-5', invitation: { ...invitation, id: 6 } },
    ]) {
      const result = verifyParticipantIngestRequest(requestWith(token), mismatch);
      assert.equal(result.ok, false);
      assert.equal(result.status, 409);
    }
  });
});

describe('single typed participant transport', () => {
  it('keeps the network call in ingest-transport and facades fetch-free', () => {
    const participantRoot = path.resolve(__dirname, '../../participant-web/js');
    const transport = fs.readFileSync(
      path.join(participantRoot, 'session-runtime/ingest-transport.mjs'),
      'utf8'
    );
    const facade = fs.readFileSync(
      path.join(participantRoot, 'web-page/data-sender.js'),
      'utf8'
    );
    const testsRuntime = fs.readFileSync(
      path.join(participantRoot, 'web-page/tests-updated.js'),
      'utf8'
    );
    assert.equal(
      transport.includes('fetchWithTimeout(`${apiBase}/ingest`'),
      true
    );
    assert.doesNotMatch(facade, /\bfetch\s*\(/);
    assert.doesNotMatch(facade, /autoDownloadFallback/);
    assert.doesNotMatch(testsRuntime, /\bfetch\s*\([^)]*ingest/);
    assert.match(facade, /sendSessionFeature/);
    assert.match(testsRuntime, /sendSessionFeature/);
  });

  it('keeps canonical participant ML and VPC assets on the application origin', () => {
    const participantRoot = path.resolve(__dirname, '../../participant-web');
    const activeHtml = fs.readFileSync(
      path.join(participantRoot, 'mvp_with_precheck_1-updated.html'),
      'utf8'
    );
    const precheck = fs.readFileSync(
      path.join(participantRoot, 'js/precheck-analyzer.js'),
      'utf8'
    );
    const bodyPose = fs.readFileSync(
      path.join(participantRoot, 'js/session-runtime/continuous-body-pose.js'),
      'utf8'
    );
    const manifest = fs.readFileSync(
      path.join(participantRoot, 'js/gaze-tracker/gaze-tests/vpc/manifest-felidae.js'),
      'utf8'
    );
    assert.doesNotMatch(activeHtml, /cdn\.jsdelivr\.net/);
    assert.doesNotMatch(precheck, /storage\.googleapis\.com/);
    assert.doesNotMatch(bodyPose, /storage\.googleapis\.com/);
    assert.doesNotMatch(manifest, /Special:FilePath/);
    for (const entryPage of [
      'mvp_with_precheck_1-updated.html',
      'run_new.html',
      'invite.html',
    ]) {
      const source = fs.readFileSync(path.join(participantRoot, entryPage), 'utf8');
      assert.match(source, /<meta\s+name="referrer"\s+content="no-referrer">/);
    }
    for (const asset of [
      'face_landmarker.task',
      'pose_landmarker_lite.task',
      'selfie_multiclass_256x256.tflite',
      'selfie_segmenter.tflite',
    ]) {
      assert.equal(
        fs.existsSync(path.join(participantRoot, 'js/vendor/mediapipe/models', asset)),
        true,
        asset
      );
    }
    for (const asset of [
      'lion.jpg',
      'tiger.jpg',
      'leopard.jpg',
      'cheetah.jpg',
      'jaguar.jpg',
      'lynx.jpg',
      'puma.jpg',
      'caracal.jpg',
      'domestic-cat.jpg',
    ]) {
      assert.equal(
        fs.existsSync(path.join(participantRoot, 'assets/vpc/felidae', asset)),
        true,
        asset
      );
    }
  });

  it('does not duplicate invitation bearer codes into diagnostics or event metadata', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../participant-web/js/web-page/app-updated.js'),
      'utf8'
    );
    assert.doesNotMatch(source, /dbg(?:Err)?\([^;\n]+\{\s*code(?:,|\s*:)/);
    assert.doesNotMatch(
      source,
      /recordSessionEvent\('invitation_protocol_(?:loaded|load_failed)'[\s\S]{0,180}invitationCode/
    );
    assert.doesNotMatch(
      source,
      /state\.sessionData\.experimentMeta\s*=\s*\{[\s\S]{0,300}invitationCode/
    );
  });
});

describe('staff account tenant metadata', () => {
  it('limits PI organization aggregation to the shared project scope', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../routes/auth.js'),
      'utf8'
    );
    assert.match(
      source,
      /uo\.organization_id = scope_project\.organization_id/
    );
  });

  it('requires the target account tenant scope to be fully contained', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../routes/auth.js'),
      'utf8'
    );
    assert.match(source, /hasContainedTenantScope/);
    assert.match(source, /organizations_contained/);
    assert.match(source, /projects_contained/);
    assert.match(source, /user_scope_not_contained/);
    assert.doesNotMatch(source, /hasSharedProjectMembership/);
  });
});
