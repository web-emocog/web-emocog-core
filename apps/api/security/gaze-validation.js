const counts = ['attempted', 'accepted', 'duplicate', 'beforeWindow', 'missingTimestamp', 'clockChanged'];
const samplingFields = new Set(['stage', 'pointIndex', 'version', 'clock', ...counts]);
const coverageFields = new Set(['version', 'expectedTargets', 'observedTargets', 'missingTargetIndices', 'complete']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

// Optional, bounded metadata only. Legacy validation summaries remain compatible.
function validateGazeValidation(value) {
  const errors = [];
  const invalid = path => errors.push({ path: `/gazeValidation/${path}`, keyword: 'validationMetadata',
    message: 'invalid validation sampling metadata' });
  if (!object(value)) return errors;
  if (value.samplingVersion !== undefined || value.sampling !== undefined) {
    if (value.samplingVersion !== 'unique_capture.v1') invalid('samplingVersion');
    if (value.coverage === undefined) invalid('coverage');
    if (!Array.isArray(value.sampling) || value.sampling.length > 14) invalid('sampling');
    else {
      const seen = new Set();
      value.sampling.forEach((row, index) => {
        if (!object(row) || Object.keys(row).some(key => !samplingFields.has(key))
          || row.version !== 'unique_capture.v1' || !['correction', 'benchmark'].includes(row.stage)
          || !integer(row.pointIndex, 0, row.stage === 'benchmark' ? 4 : 8)
          || ![null, 'monotonic', 'wall'].includes(row.clock)
          || !counts.every(key => integer(row[key], 0, 60))
          || row.attempted !== counts.slice(1).reduce((sum, key) => sum + row[key], 0)
          || (row.accepted > 0) !== (row.clock !== null)) { invalid(`sampling/${index}`); return; }
        const id = `${row.stage}:${row.pointIndex}`;
        if (seen.has(id)) invalid(`sampling/${index}`);
        seen.add(id);
      });
    }
  }
  if (value.coverage !== undefined) {
    const row = value.coverage;
    if (!object(row) || Object.keys(row).some(key => !coverageFields.has(key))
      || row.version !== 'target_coverage.v1' || row.expectedTargets !== 5
      || !integer(row.observedTargets, 0, row.expectedTargets)
      || !Array.isArray(row.missingTargetIndices) || row.missingTargetIndices.length > 9
      || !row.missingTargetIndices.every(index => integer(index, 0, row.expectedTargets - 1))
      || new Set(row.missingTargetIndices).size !== row.missingTargetIndices.length
      || row.observedTargets + row.missingTargetIndices.length !== row.expectedTargets
      || row.complete !== (row.missingTargetIndices.length === 0)
      || (value.passed === true && row.complete !== true)) invalid('coverage');
  }
  if (errors.length === 0 && Array.isArray(value.sampling) && object(value.coverage)) {
    const observed = new Set(value.sampling.filter(row => row.stage === 'benchmark' && row.accepted > 0)
      .map(row => row.pointIndex));
    const claimed = Array.from({ length: 5 }, (_, i) => i).filter(i => !value.coverage.missingTargetIndices.includes(i));
    if (claimed.some(index => !observed.has(index))) invalid('coverage');
  }
  return errors;
}

module.exports = { validateGazeValidation };
