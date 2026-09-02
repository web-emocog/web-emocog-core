(function (root, factory) {
  const geometry = typeof module === 'object' && module.exports
    ? require('./aoi-geometry')
    : root.EmocogAoiGeometry;
  const api = factory(geometry);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmocogAoiProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (geometry) {
  'use strict';

  const AOI_SCHEMA_VERSION = '1.2';
  const MAX_STIMULI = 500;
  const MAX_AOIS_PER_STIMULUS = 200;

  function plainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizedAoi(aoi, index) {
    if (!plainObject(aoi) || typeof aoi.id !== 'string' || !aoi.id.trim() || aoi.id.length > 128) {
      return { ok: false, code: 'aoi_id_invalid', index };
    }
    const normalized = geometry && geometry.normalizeGeometry(aoi.shape, aoi.points);
    if (!normalized || !normalized.ok) {
      return { ok: false, code: normalized?.code || 'aoi_geometry_invalid', index };
    }
    const startMs = Number(aoi.validityInterval?.startMs ?? 0);
    const endMs = Number(aoi.validityInterval?.endMs ?? Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      return { ok: false, code: 'aoi_validity_interval_invalid', index };
    }
    const order = Number(aoi.order ?? index + 1);
    if (!Number.isInteger(order) || order < 1) {
      return { ok: false, code: 'aoi_order_invalid', index };
    }
    return {
      ok: true,
      value: {
        id: aoi.id.trim(),
        name: String(aoi.name || aoi.id).slice(0, 255),
        shape: aoi.shape,
        points: normalized.points,
        order,
        isTarget: aoi.isTarget === true,
        validityInterval: { startMs, endMs },
      },
    };
  }

  function validateAoiDefinitions(definitions, schemaVersion) {
    const errors = [];
    if (!plainObject(definitions)) {
      return { ok: false, errors: [{ code: 'aoi_definitions_invalid' }] };
    }
    const entries = Object.entries(definitions);
    if (entries.length > MAX_STIMULI) errors.push({ code: 'aoi_stimulus_limit_exceeded' });
    if (entries.length && schemaVersion !== AOI_SCHEMA_VERSION) {
      errors.push({ code: 'aoi_schema_version_invalid', expected: AOI_SCHEMA_VERSION });
    }
    entries.forEach(([stimulusId, aois]) => {
      if (!stimulusId.trim() || stimulusId.length > 128 || !Array.isArray(aois)) {
        errors.push({ code: 'aoi_stimulus_definition_invalid', stimulusId });
        return;
      }
      if (!aois.length) {
        errors.push({ code: 'aoi_list_empty', stimulusId });
        return;
      }
      if (aois.length > MAX_AOIS_PER_STIMULUS) {
        errors.push({ code: 'aoi_count_limit_exceeded', stimulusId });
        return;
      }
      const ids = new Set();
      aois.forEach((aoi, index) => {
        const result = normalizedAoi(aoi, index);
        if (!result.ok) {
          errors.push({ code: result.code, stimulusId, index });
          return;
        }
        if (ids.has(result.value.id)) {
          errors.push({ code: 'aoi_id_duplicate', stimulusId, index, aoiId: result.value.id });
        }
        ids.add(result.value.id);
      });
    });
    return { ok: errors.length === 0, errors };
  }

  function validateProtocolAois(definition) {
    const errors = [];
    const blocks = Array.isArray(definition?.blocks) ? definition.blocks : [];
    blocks.forEach((block, blockIndex) => {
      const containers = [block?.blockConfig, block?.content]
        .filter(container => plainObject(container)
          && Object.prototype.hasOwnProperty.call(container, 'aoiDefinitions'));
      containers.forEach(container => {
        const result = validateAoiDefinitions(container.aoiDefinitions, container.aoiSchemaVersion);
        result.errors.forEach(error => errors.push({ ...error, blockIndex, blockId: block?.id || null }));
      });
    });
    return { ok: errors.length === 0, errors };
  }

  function buildAoiDefinitions(stimuli, stimulusIds) {
    const byId = new Map((Array.isArray(stimuli) ? stimuli : [])
      .filter(plainObject)
      .map(stimulus => [String(stimulus.id), stimulus]));
    const definitions = {};
    Array.from(new Set((Array.isArray(stimulusIds) ? stimulusIds : [])
      .filter(value => value != null && String(value).trim())
      .map(String))).forEach(stimulusId => {
      const stimulus = byId.get(stimulusId);
      if (!stimulus || !Array.isArray(stimulus.aois) || !stimulus.aois.length) return;
      const normalized = stimulus.aois.map(normalizedAoi);
      if (normalized.some(result => !result.ok)) return;
      definitions[stimulusId] = normalized.map(result => result.value);
    });
    return definitions;
  }

  return {
    AOI_SCHEMA_VERSION,
    buildAoiDefinitions,
    validateAoiDefinitions,
    validateProtocolAois,
  };
});
