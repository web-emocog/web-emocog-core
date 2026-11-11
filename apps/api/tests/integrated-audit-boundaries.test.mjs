import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pinnedInvitationContentUrl } from '../../participant-web/js/session-runtime/invitation-http.mjs';
import { resolveParticipantApiBase } from '../../participant-web/js/session-runtime/api-base.mjs';
import { createPresentationPlan, createTrialBudget, PLAN_LIMITS } from '../../participant-web/js/session-runtime/presentation-plan.mjs';

const require = createRequire(import.meta.url);

test('participant stimulus URL is confined to exact publication, numeric file and API prefix', () => {
  const base = 'https://wecog.test/main/api', path = '/invitations/by-code/publication-1/stimuli/7/content';
  assert.equal(pinnedInvitationContentUrl(base, 'publication-1', '7', path), base + path);
  for (const bad of [null, 'https://attacker.test' + path, '//' + path, base + path,
    path + '?forward=bad', path + '#fragment', '/private' + path,
    path.replace('publication-1', 'other'), path.replace('/7/', '/8/'),
    path.replace('/7/', '/07/'), path.replace('/7/', '/..%2f7/')]) {
    assert.equal(pinnedInvitationContentUrl(base, 'publication-1', '7', bad), null);
  }
  assert.equal(pinnedInvitationContentUrl(base, '../p', '7', path), null);
  assert.equal(pinnedInvitationContentUrl(base, 'publication-1', '2147483648', path), null);
});

test('invalid configured API URL cannot override the default API', () => {
  const runtime = { location: { href: 'https://wecog.test/apps/participant-web/run_new.html' } };
  for (const configuredBase of ['https://user:secret@wecog.test/api',
    'https://wecog.test/api#ignored', 'https://wecog.test/api?query=1']) {
    assert.equal(resolveParticipantApiBase({ runtime, configuredBase }), 'https://wecog.test/api');
  }
  assert.equal(resolveParticipantApiBase({ runtime, configuredBase: '/main/api' }), 'https://wecog.test/main/api');
});

test('trial expansion budget is cumulative and not consumed by a rejected reservation', () => {
  const reserve = createTrialBudget();
  for (const invalid of [Infinity, -1, 1.1, NaN, 1e9]) assert.throws(() => reserve(invalid), { code: 'protocol_trial_limit' });
  assert.equal(reserve(PLAN_LIMITS.trials - 1), PLAN_LIMITS.trials - 1);
  assert.throws(() => reserve(2), { code: 'protocol_trial_limit' });
  assert.equal(reserve(1), 1);
});

test('the generated safety instruction does not count as a cognitive plan block', () => {
  const blocks = Array.from({ length: PLAN_LIMITS.blocks }, (_, i) => ({
    type: 'cognitive_task', id: `t-${i}`, trials: [{ id: 'a', stimulus: { stimulusId: 'std_simple_black_square' } }],
  }));
  assert.equal(createPresentationPlan({ blocks: [{ type: 'instruction', id: 'session_quality_policy' }, ...blocks], seed: 1 }).blocks.length, PLAN_LIMITS.blocks);
  assert.throws(() => createPresentationPlan({ blocks: [...blocks, { ...blocks[0], id: 'overflow' }], seed: 1 }), /block_limit/);
});

test('export publication version respects the PostgreSQL integer range', () => {
  const { parseSelection } = require('../export/reproducibility-route');
  for (const version of ['publication:2147483648', 'invitation:9999999999', ['publication:1']]) {
    assert.throws(() => parseSelection({ project_id: '1', protocol_id: '2', protocol_version: version }), { status: 400 });
  }
  assert.equal(parseSelection({ project_id: '1', protocol_id: '2', protocol_version: 'publication:2147483647' }).version,
    'publication:2147483647');
});
