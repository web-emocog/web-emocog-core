const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const enginePath = path.resolve(
  __dirname,
  '../../../lib/rppg_alg_qc_test_web_alg_test_v10/rppg_alg/RppgEngine.js'
);
const publicationGatePath = path.resolve(
  __dirname,
  '../../participant-web/js/session-runtime/bpm-publication-gate.mjs'
);

describe('continuous rPPG runtime', () => {
  it('reduces respiration-adjusted confidence without mutating a readonly binding', async () => {
    const { adjustConfidenceForRespiration } = await import(pathToFileURL(enginePath).href);
    const adjusted = adjustConfidenceForRespiration(
      0.8,
      { conf: 0.9 },
      0.2,
      { minConfForCoupling: 0.2, couplingWeight: 0.25 }
    );
    assert.ok(adjusted < 0.8);
    assert.ok(adjusted > 0);
    assert.equal(
      adjustConfidenceForRespiration(0.8, { conf: 0.1 }, 0, {
        minConfForCoupling: 0.2,
        couplingWeight: 0.25,
      }),
      0.8
    );
  });
});

describe('BPM publication gate', () => {
  it('never promotes a rejected engine estimate or a value outside the hard range', async () => {
    const { BpmPublicationGate } = await import(pathToFileURL(publicationGatePath).href);
    const gate = new BpmPublicationGate();
    assert.equal(gate.evaluate({ published: false, bpmPublished: null, bpmSmoothed: 76, confidence: 0.9 }).accepted, false);
    assert.equal(gate.evaluate({ published: true, bpmPublished: 40, confidence: 0.99 }).reason, 'outside_physiological_range');
  });

  it('requires a stable high-confidence streak before accepting a caution value', async () => {
    const { BpmPublicationGate } = await import(pathToFileURL(publicationGatePath).href);
    const gate = new BpmPublicationGate();
    for (let index = 0; index < 7; index += 1) {
      assert.equal(gate.evaluate({ published: true, bpmPublished: 140 + (index % 2), confidence: 0.82 }).accepted, false);
    }
    const accepted = gate.evaluate({ published: true, bpmPublished: 140, confidence: 0.82 });
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.classification, 'elevated');
  });

  it('keeps a finite engine-held value visible but never promotes an arbitrary candidate', async () => {
    const { BpmPublicationGate } = await import(pathToFileURL(publicationGatePath).href);
    const gate = new BpmPublicationGate();
    const held = gate.evaluate({ published:false, bpmPublished:74, bpmCandidate:130, publishReason:'hold_low_conf', confidence:0.62 });
    assert.equal(held.accepted, true);
    assert.equal(held.bpm, 74);
    assert.equal(held.held, true);
    assert.equal(gate.evaluate({ published:false, bpmPublished:null, bpmCandidate:74, publishReason:'low_conf', confidence:0.9 }).accepted, false);
  });
});
