const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../../scripts/reference-data/issue143-summarize-gradient.mjs')));
const names = ['baseline', 'eye_patch', 'eye_gradient_all', 'eye_gradient'];
const methods = ['same_eye_iris.v2', 'eye_patch_ridge.experimental.v1',
  'eye_gradient_all_iris.experimental.v1', 'eye_gradient_iris.experimental.v1'];

// Entirely artificial summary, not a participant export or biometric fixture.
function fixture() {
  return { version: 'issue143_eye_gradient.v7', intervalMs: 0,
    temporalScope: 'spatial_only_no_drift_measurement', after: [],
    models: Object.fromEntries(names.map((name, i) => [name, { featureMethod: methods[i], ridgeLambda: 1,
      targetCvRmsPx: 12, correction: { selected: false, independentDecision: { reason: 'correction_not_applied' } } }])),
    before: Array.from({ length: 9 }, (_, index) => {
      const accepted = index ? 1 : 3, mean = index ? 20 : 10;
      return { targetIndex: index, analyzed: 4, signals: Object.fromEntries(names.flatMap(name => ['raw', 'corrected'].map(type => [name + '.' + type,
        { attempted: 4, accepted: name === 'baseline' ? accepted : 1, offScreen: name === 'baseline' ? 1 : 0,
          meanErrorPx: name === 'baseline' ? mean : 7, rmsErrorPx: name === 'baseline' ? mean : 7,
          biasXPx: name === 'baseline' ? mean : 7, biasYPx: 0, withinTargetSdXPx: 3, withinTargetSdYPx: 4 }]))),
        comparisons: names.slice(1).flatMap(name => ['raw', 'corrected'].map(type => ({ baseline: 'baseline.' + type,
          candidate: name + '.' + type, commonAccepted: 1, candidateMinusBaselineMeanErrorPx: -2 }))) };
    }) };
}

test('issue143 gradient analysis separates weighted marginal errors from common-frame deltas', async () => {
  const { summarizeGradientReport } = await load(); const source = fixture();
  const result = summarizeGradientReport(source), b = result.before.signals['baseline.raw'];
  assert.equal(b.accepted, 11); assert.equal(b.attempted, 36);
  assert.equal(b.sampleWeightedMeanErrorPx, 190 / 11);
  assert.equal(b.equalTargetMeanErrorPx, 170 / 9);
  assert.equal(b.rmsErrorPx, Math.sqrt(3500 / 11));
  assert.equal(b.withinTargetRmsSpreadPx, 5);
  assert.equal(result.before.comparisons[0].candidateMinusBaselineMeanErrorPx, -2);
  assert.equal(result.before.comparisons[0].commonAbsoluteErrorsStored, false);
  assert.notEqual(result.before.signals['eye_patch.raw'].sampleWeightedMeanErrorPx - b.sampleWeightedMeanErrorPx, -2);
  assert.equal(result.before.comparisons[0].betterTargets, 9);
  assert.equal(source.before[0].signals['baseline.raw'].accepted, 3);
});

test('issue143 short check cannot become zero drift; absent signals stay null', async () => {
  const { summarizeGradientReport } = await load(); const source = fixture();
  for (const w of source.before) {
    for (const s of Object.values(w.signals)) Object.assign(s, { accepted: 0, offScreen: 0, meanErrorPx: null });
    for (const c of w.comparisons) Object.assign(c, { commonAccepted: 0, candidateMinusBaselineMeanErrorPx: null });
  }
  const result = summarizeGradientReport(source);
  assert.equal(result.before.signals['baseline.raw'].sampleWeightedMeanErrorPx, null);
  assert.equal(result.before.signals['baseline.raw'].missingFraction, 1);
  assert.equal(result.before.comparisons[0].candidateMinusBaselineMeanErrorPx, null);
  assert.equal(result.after.signals['baseline.raw'].missingFraction, null);
  assert.equal(result.after.signals['baseline.raw'].rmsErrorPx, null);
  assert.equal(result.driftAssessment.available, false);
});

test('issue143 gradient analysis fails closed on incompatible or inconsistent summaries', async () => {
  const { summarizeGradientReport } = await load();
  for (const change of [r => { r.version = 'legacy'; }, r => { r.before.pop(); },
    r => { r.after.push(r.before[0]); }, r => { r.intervalMs = 240000; },
    r => { r.before[0].comparisons[0].commonAccepted = 2; },
    r => { r.before[0].comparisons.pop(); },
    r => { r.before[0].targetIndex = r.before[1].targetIndex; },
    r => { r.before[0].signals['baseline.raw'].meanErrorPx = NaN; }]) {
    const source = fixture(); change(source);
    assert.throws(() => summarizeGradientReport(source), /invalid_gradient_summary/);
  }
});

test('issue143 local analysis does not echo arbitrary export fields or retain input references', async () => {
  const { summarizeGradientReport } = await load(); const source = fixture();
  source.rawFrames = ['PRIVATE_SENTINEL']; source.invitation = 'PRIVATE_SENTINEL';
  source.models.baseline.rawImages = 'PRIVATE_SENTINEL';
  const result = summarizeGradientReport(source);
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  source.models.baseline.correction.selected = true;
  assert.equal(result.models.baseline.correctionSelected, false);
});
