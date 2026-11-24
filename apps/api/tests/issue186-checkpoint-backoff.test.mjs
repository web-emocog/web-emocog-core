import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionDelivery, SCHEMA_RETRY_DELAY_MS } from '../../participant-web/js/session-runtime/delivery.mjs';

function fixture() {
    let now = 1000, builds = 0, sends = 0;
    const data = { ids: { invitationCode: 'synthetic' }, consent: { informed_consent: { accepted: true } } };
    const wire = [];
    const options = { sessionData: data, now: () => now, build: async () => {
        builds++; return { lifecycle: {}, cognitiveResults: [{ qualityValid: false, rt: null }], events: [] };
    }, send: async packet => { wire.push(structuredClone(packet)); sends++;
        return sends === 1 ? { ok: false, status: 422, code: 'payload_schema_invalid' } : { ok: true, status: 200 }; } };
    return { data, options, wire, move: ms => { now += ms; }, counts: () => ({ builds, sends }) };
}

test('permanent schema rejection bounds automatic checkpoint work, keeps missing/failed results and probes recovery', async () => {
    const f = fixture(), delivery = new SessionDelivery(f.options);
    assert.equal((await delivery.checkpoint()).status, 422);
    const failed = structuredClone(f.data.serverBackup);
    for (let tick = 0; tick < 9; tick++) {
        f.move(30000);
        assert.equal((await delivery.checkpoint()).deferred, true);
        assert.deepEqual(f.data.serverBackup, failed);
    }
    assert.deepEqual(f.counts(), { builds: 1, sends: 1 }, 'no repeated serialization/requests of an incompatible packet');
    const reload = new SessionDelivery(f.options);
    assert.equal((await reload.checkpoint()).deferred, true);
    f.move(30000);
    assert.equal((await reload.checkpoint()).ok, true);
    assert.equal(f.data.serverBackup.schemaRetryAt, null);
    assert.equal(f.data.serverBackup.status, 'saved');
    assert.deepEqual(f.wire[1].cognitiveResults, [{ qualityValid: false, rt: null }]);
    assert.equal(f.wire[1].delivery.sequence, 2);
});

test('schema cooldown never blocks final delivery or invents a successful server acknowledgement', async () => {
    const f = fixture(), delivery = new SessionDelivery(f.options);
    await delivery.checkpoint();
    assert.equal(delivery.finish().kind, 'final');
    assert.equal(f.data.serverBackup.status, 'failed');
    assert.equal(await delivery.checkpoint(), null);
    assert.deepEqual(f.counts(), { builds: 1, sends: 1 });
});

test('unrelated errors, expired/invalid clocks and absent consent do not create an indefinite schema lock', async () => {
    for (const result of [{ ok: false, status: 503, code: 'network' }, { ok: false, status: 422, code: 'binding' }]) {
        const f = fixture(); f.options.send = async () => result;
        const delivery = new SessionDelivery(f.options);
        await delivery.checkpoint(); await delivery.checkpoint();
        assert.equal(f.counts().builds, 2);
    }
    for (const future of [Infinity, NaN, -1, 1000 + SCHEMA_RETRY_DELAY_MS + 1]) {
        const f = fixture();
        f.data.serverBackup = { errorCode: 'payload_schema_invalid', httpStatus: 422, schemaRetryAt: future };
        await new SessionDelivery(f.options).checkpoint();
        assert.equal(f.counts().sends, 1);
    }
    const f = fixture(); f.data.consent.informed_consent.accepted = false;
    assert.equal(await new SessionDelivery(f.options).checkpoint(), null);
    assert.deepEqual(f.counts(), { builds: 0, sends: 0 });
});
