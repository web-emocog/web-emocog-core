const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createAccountStorage } = require('../../web/account-storage');

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    entries() { return [...values.entries()]; },
  };
}

describe('researcher account workspace isolation', () => {
  it('archives legacy unscoped protocols instead of assigning them to a new account', () => {
    const storage = memoryStorage({
      emocog_my_experiments: JSON.stringify([{ id: 'old-protocol', invitationCode: 'stale' }]),
      emocog_selected_project_id: '99',
      emocog_theme: 'dark',
    });
    const accountStorage = createAccountStorage(storage);
    const activated = accountStorage.activate('4');

    assert.equal(activated.changed, true);
    assert.ok(activated.archiveId);
    assert.equal(storage.getItem('emocog_my_experiments'), null);
    assert.equal(storage.getItem('emocog_selected_project_id'), null);
    assert.equal(storage.getItem('emocog_theme'), 'dark');
    assert.ok(storage.entries().some(([key]) => key.startsWith('emocog_workspace_archive_v1:')));
  });

  it('restores only the workspace belonging to the active account', () => {
    const storage = memoryStorage();
    const accountStorage = createAccountStorage(storage);
    accountStorage.activate('researcher-a');
    storage.setItem('emocog_my_experiments', JSON.stringify([{ id: 'a' }]));
    storage.setItem('emocog_stimuli', JSON.stringify([{ id: 'stimulus-a' }]));

    accountStorage.activate('researcher-b');
    assert.equal(storage.getItem('emocog_my_experiments'), null);
    assert.equal(storage.getItem('emocog_stimuli'), null);
    storage.setItem('emocog_my_experiments', JSON.stringify([{ id: 'b' }]));

    accountStorage.activate('researcher-a');
    assert.deepEqual(JSON.parse(storage.getItem('emocog_my_experiments')), [{ id: 'a' }]);
    assert.deepEqual(JSON.parse(storage.getItem('emocog_stimuli')), [{ id: 'stimulus-a' }]);
  });

  it('recovers an archived local protocol only as an unpublished draft', () => {
    const storage = memoryStorage({
      emocog_my_experiments: JSON.stringify([{
        id: 'legacy', apiProtocolId: 91, invitationCode: 'dead-code',
        participantLink: 'http://invalid', publishVerifiedAt: '2026-01-01', status: 'active',
      }]),
    });
    const accountStorage = createAccountStorage(storage);
    accountStorage.activate('researcher-current');
    assert.equal(accountStorage.hasRecoverableArchive(), true);

    const recovered = accountStorage.recoverLatestArchive('researcher-current');
    assert.equal(recovered.restored, 1);
    const protocol = JSON.parse(storage.getItem('emocog_my_experiments'))[0];
    assert.equal(protocol.status, 'draft');
    assert.equal(protocol.apiProtocolId, undefined);
    assert.equal(protocol.invitationCode, undefined);
    assert.equal(protocol.participantLink, undefined);
    assert.equal(accountStorage.hasRecoverableArchive(), false);
  });
});
