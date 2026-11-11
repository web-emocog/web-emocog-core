const schema = require('../../../packages/shared/contracts/session-feature-data.v1.schema.json');

// Deliberately small, closed subset of JSON Schema. No coercion, stripping,
// defaults, arbitrary $refs, executable validators or mutation of submitted data.
function validateSessionDataSchema(payload) {
  const errors = [];
  const pathKey = key => /^[A-Za-z0-9_:.-]{1,128}$/.test(key) ? key : '*';
  function visit(value, rule, path, output = errors, depth = 0) {
    if (output.length >= 100) return;
    const fail = keyword => output.push({ path: path || '/', keyword, message: 'Invalid session data field' });
    if (depth > 12) { fail('maxDepth'); return; }
    if (rule.$ref) {
      const name = rule.$ref.slice('#/$defs/'.length);
      if (!rule.$ref.startsWith('#/$defs/') || !Object.hasOwn(schema.$defs, name)) {
        throw new Error('Unsupported session schema reference');
      }
      return visit(value, schema.$defs[name], path, output, depth);
    }
    if (rule.anyOf) {
      if (!rule.anyOf.some(candidate => {
        const branch = [];
        visit(value, candidate, path, branch, depth);
        return branch.length === 0;
      })) fail('anyOf');
      return;
    }
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (rule.type && !types.some(type => type === actual || (type === 'integer' && Number.isSafeInteger(value)))) {
      fail('type'); return;
    }
    if (Object.hasOwn(rule, 'const') && value !== rule.const) fail('const');
    if (rule.enum && !rule.enum.includes(value)) fail('enum');
    if (actual === 'number' && (!Number.isFinite(value)
      || (rule.minimum != null && value < rule.minimum) || (rule.maximum != null && value > rule.maximum))) fail('range');
    if (actual === 'string' && ((rule.maxLength != null && value.length > rule.maxLength)
      || (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)))) fail('string');
    if (actual === 'array') {
      if (!rule.items || value.length > rule.maxItems) { fail('maxItems'); return; }
      value.forEach((item, index) => visit(item, rule.items, `${path}/${index}`, output, depth + 1));
    }
    if (actual === 'object') {
      const keys = Object.keys(value);
      if (keys.length > (rule.maxProperties ?? 200)) { fail('maxProperties'); return; }
      for (const key of rule.required || []) if (!Object.hasOwn(value, key)) {
        output.push({ path: `${path}/${key}`, keyword: 'required', message: 'Session data field required' });
      }
      for (const key of keys) {
        const childPath = `${path}/${pathKey(key)}`;
        if (Object.hasOwn(rule.properties || {}, key)) visit(value[key], rule.properties[key], childPath, output, depth + 1);
        else if (rule.additionalProperties && typeof rule.additionalProperties === 'object'
          && rule.propertyNames && new RegExp(rule.propertyNames.pattern, 'u').test(key)
          && !['__proto__', 'constructor', 'prototype'].includes(key)) {
          visit(value[key], rule.additionalProperties, childPath, output, depth + 1);
        } else output.push({ path: childPath, keyword: 'additionalProperties', message: 'Unknown session data field' });
        if (output.length >= 100) break;
      }
    }
  }
  // Only module subtrees live here; envelope, temporal and cross-field invariants
  // remain in payload-policy and the dedicated physiology/alignment validators.
  for (const [key, rule] of Object.entries(schema.properties)) {
    if (Object.hasOwn(payload, key)) visit(payload[key], rule, `/${key}`);
  }
  return errors.slice(0, 100);
}

module.exports = { schema, validateSessionDataSchema };
