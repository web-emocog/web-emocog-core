const { build } = require('../../shared/rt-alignment');
const schema = require('../../../packages/shared/contracts/rt-alignment.v1.schema.json');

// This bounded contract has no references/combinators; keep policy and published schema identical.
function validateAlignment(value) {
  const errors = [];
  function visit(node, rule, path) {
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    const actual = node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node;
    if (!types.some(type => type === actual || (type === 'integer' && Number.isInteger(node)))) {
      errors.push({ path, keyword: 'type', message: 'Invalid alignment field type' }); return;
    }
    if (rule.const !== undefined && node !== rule.const) errors.push({ path, keyword: 'const', message: 'Invalid alignment version or parameter' });
    if (rule.enum && !rule.enum.includes(node)) errors.push({ path, keyword: 'enum', message: 'Invalid alignment field value' });
    if (actual === 'number' && (!Number.isFinite(node) || (rule.minimum != null && node < rule.minimum) || (rule.maximum != null && node > rule.maximum))) errors.push({ path, keyword: 'range', message: 'Alignment number out of range' });
    if (actual === 'string' && node.length > rule.maxLength) errors.push({ path, keyword: 'maxLength', message: 'Alignment string too long' });
    if (actual === 'array') {
      if (node.length > rule.maxItems) { errors.push({ path, keyword: 'maxItems', message: 'Too many aligned trials' }); return; }
      node.forEach((item, index) => visit(item, rule.items, `${path}/${index}`));
    }
    if (actual === 'object') {
      for (const key of rule.required || []) if (!Object.hasOwn(node, key)) errors.push({ path: `${path}/${key}`, keyword: 'required', message: 'Alignment field required' });
      for (const [key, item] of Object.entries(node)) {
        if (!Object.hasOwn(rule.properties || {}, key)) errors.push({ path: `${path}/${key}`, keyword: 'additionalProperties', message: 'Unknown alignment field' });
        else visit(item, rule.properties[key], `${path}/${key}`);
      }
    }
  }
  visit(value, schema, '/rt_alignment');
  if (!errors.length) {
    if (value.trialCountTotal < value.trials.length) errors.push({ path: '/rt_alignment/trialCountTotal', keyword: 'consistency', message: 'Trial count is inconsistent' });
    value.trials.forEach((trial, index) => {
      const trialPath = `/rt_alignment/trials/${index}`;
      if ((trial.responseMs != null && trial.responseMs < trial.onsetMs)
        || (trial.endMs != null && trial.endMs < (trial.responseMs ?? trial.onsetMs))) {
        errors.push({ path: trialPath, keyword: 'consistency', message: 'Trial timestamps are reversed' });
      }
      for (const [name, window] of Object.entries(trial.windows)) {
        const path = `/rt_alignment/trials/${index}/windows/${name}`;
        if (window.startMs != null && window.endMs != null && window.endMs < window.startMs) errors.push({ path, keyword: 'consistency', message: 'Window is reversed' });
        for (const [channel, metric] of Object.entries(window.channels)) {
          if (metric.nValid > metric.n || (metric.status === 'observed') !== (metric.nValid > 0)
            || (metric.n === 0 && metric.validFraction !== null)
            || (metric.n > 0 && (metric.validFraction === null || Math.abs(metric.validFraction - metric.nValid / metric.n) > 0.0001))) {
            errors.push({ path: `${path}/channels/${channel}`, keyword: 'consistency', message: 'Sample counts and missingness are inconsistent' });
          }
        }
      }
    });
  }
  return errors;
}

function buildConnectedness(row, query) {
  const payload = row.features_payload || {};
  const stored = payload.rt_alignment;
  const hasStored = stored && !validateAlignment(stored).length;
  const report = hasStored ? stored : build(payload);
  const filters = query?.filters || {};
  const selected = report.trials.filter(trial => (
    (!filters.blockIds?.length || filters.blockIds.map(String).includes(String(trial.blockId)))
    && (!filters.stimulusIds?.length || filters.stimulusIds.map(id => String(id).replace(/^api:/, '')).includes(String(trial.stimulusId).replace(/^api:/, '')))
    && (!filters.conditionIds?.length || filters.conditionIds.map(String).includes(String(trial.condition)))
  ));
  return { ...report, trials: selected, sessionId: Number(row.id),
    source: hasStored ? 'stored_event_windows' : 'legacy_events_only',
    policy: { observational: true, inference: 'not_computed', videoAvailable: false,
      sampleWeighting: 'one_observation_per_trial', emotionIsProxy: true, bpmIsRollingEstimate: true,
      note: 'Within-session description only. Frames are not independent participants. No causal, clinical or population inference.' } };
}
module.exports = { validateAlignment, buildConnectedness };
