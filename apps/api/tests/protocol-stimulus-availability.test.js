const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  referencedStimulusIds,
  referencedDatabaseStimulusIds,
} = require('../../shared/protocol-stimuli');
const { inspectProtocolStimuli } = require('../stimuli/protocol-availability');

test('collects stimuli from every protocol shape used by the builder', () => {
  const definition = {
    blocks: [
      {
        stimulusId: 'api:11',
        params: {
          stimulus_id: 12,
          stimuli_ids: ['13', 'std_simple_black_square'],
          trials: [{ stimulusId: 14 }, { stimulus: { id: '15' } }],
        },
        content: {
          stimuliIds: ['16'],
          slides: [{ stimulusId: '17' }, { id: 18 }],
          trials: [{ stimulus_id: '19' }],
        },
        blockConfig: {
          slides: ['20'],
          trials: [{ stimulus: { stimulusId: '21' } }],
          nested: { presentation: { stimulus_id: '22' } },
        },
      },
    ],
  };

  assert.deepEqual(referencedStimulusIds(definition), [
    '11', '12', '13', 'std_simple_black_square', '14', '15',
    '16', '17', '18', '19', '20', '21', '22',
  ]);
  assert.deepEqual(referencedDatabaseStimulusIds(definition), [
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  ]);
});

test('reports missing database records and missing stimulus binaries before publication', async t => {
  const uploadsRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wecog-stimuli-'));
  t.after(() => fs.promises.rm(uploadsRoot, { recursive: true, force: true }));
  await fs.promises.writeFile(path.join(uploadsRoot, 'available.png'), Buffer.from('file'));

  const queryable = {
    async query(_sql, params) {
      assert.deepEqual(params, [7, [31, 32, 33]]);
      return {
        rows: [
          { id: 31, name: 'Available', metadata: { content_path: 'available.png' } },
          { id: 32, name: 'Lost', metadata: { content_path: 'missing.png' } },
        ],
      };
    },
  };
  const definition = {
    blocks: [{ content: { slides: [{ id: 31 }, { id: 32 }, { id: 33 }] } }],
  };

  const report = await inspectProtocolStimuli(queryable, 7, definition, { uploadsRoot });
  assert.equal(report.ok, false);
  assert.deepEqual(report.referencedIds, [31, 32, 33]);
  assert.deepEqual(report.unavailable, [
    { id: 32, code: 'content_file_missing', name: 'Lost' },
    { id: 33, code: 'stimulus_record_missing', name: null },
  ]);
});

test('returns an empty successful report for protocols without uploaded media', async () => {
  const queryable = { query: async () => assert.fail('database query should not run') };
  const report = await inspectProtocolStimuli(queryable, 1, {
    blocks: [{ content: { trials: [{ stimulusId: 'std_go_green_circle' }] } }],
  });
  assert.deepEqual(report, { ok: true, referencedIds: [], unavailable: [] });
});
