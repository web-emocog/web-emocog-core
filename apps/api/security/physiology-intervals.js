const schema = require('../../../packages/shared/contracts/physiology-intervals.v1.schema.json');
const MINUTE_MS = 60000;
const { maxItems: maxMinutes } = schema.properties.minutes;
const { maxItems: maxBlocks } = schema.properties.blocks;
const maxTime = schema.$defs.time.maximum;
const maxCount = schema.$defs.channel.properties.count.maximum;
const statuses = new Set(schema.$defs.block.properties.status.enum);

function hasExactKeys(value, required, optional = []) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
    && required.every(key => Object.hasOwn(value, key));
}

function int(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function validChannel(channel, duration, min, max) {
  return hasExactKeys(channel, schema.$defs.channel.required, ['methodVersion'])
    && (!Object.hasOwn(channel, 'methodVersion') || (typeof channel.methodVersion === 'string'
      && /^[A-Za-z0-9_.:-]{1,64}$/.test(channel.methodVersion)))
    && int(channel.count, 0, Math.min(maxCount, duration + 1))
    && int(channel.observedMs, 0, duration)
    && (channel.count > 0
      ? Number.isFinite(channel.mean) && channel.mean >= min && channel.mean <= max
      : channel.mean === null && channel.observedMs === 0);
}

function validRow(row, def, throughMs) {
  if (!hasExactKeys(row, def.required) || !int(row.startMs, 0, throughMs)
      || !int(row.endMs, row.startMs, throughMs)) return false;
  const duration = row.endMs - row.startMs;
  return validChannel(row.heartRate, duration, 45, 180)
    && validChannel(row.respiration, duration, 6, 24);
}

function validatePhysiologyIntervals(data) {
  const invalid = suffix => [{ path: '/physiology_intervals' + suffix, keyword: 'contract',
    message: 'invalid physiology interval data' }];
  if (!hasExactKeys(data, schema.required) || data.schemaVersion !== schema.$id
      || typeof data.truncated !== 'boolean' || !int(data.throughMs, 0, maxTime)
      || !Array.isArray(data.minutes) || !Array.isArray(data.blocks) || data.blocks.length > maxBlocks
      || data.minutes.length !== Math.min(maxMinutes, Math.ceil(data.throughMs / MINUTE_MS))
      || (data.throughMs > maxMinutes * MINUTE_MS && !data.truncated)) return invalid('');
  for (let i = 0; i < data.minutes.length; i++) {
    const row = data.minutes[i];
    if (!validRow(row, schema.$defs.minute, data.throughMs) || row.startMs !== i * MINUTE_MS
        || row.endMs !== Math.min((i + 1) * MINUTE_MS, data.throughMs)) return invalid('/minutes/' + i);
  }
  const lastAttempts = new Map();
  let previousEndMs = 0;
  for (let i = 0; i < data.blocks.length; i++) {
    const row = data.blocks[i];
    if (!validRow(row, schema.$defs.block, data.throughMs) || row.startMs < previousEndMs
        || typeof row.blockId !== 'string' || !row.blockId.trim().length || row.blockId.length > 128
        || !int(row.attempt, (lastAttempts.get(row.blockId) || 0) + 1, maxCount)
        || !statuses.has(row.status)
        || (row.status === 'in_progress' && (i !== data.blocks.length - 1 || row.endMs !== data.throughMs))) {
      return invalid('/blocks/' + i);
    }
    lastAttempts.set(row.blockId, row.attempt);
    previousEndMs = row.endMs;
  }
  return [];
}

module.exports = { validatePhysiologyIntervals };
