(function initProtocolStimuli(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WecogProtocolStimuli = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createProtocolStimuliApi() {
  function normalizedStimulusId(value) {
    const normalized = String(value ?? '').replace(/^api:/, '').trim();
    return normalized || null;
  }

  function referencedStimulusIds(definition, options = {}) {
    const ids = new Set();
    const visited = new Set();
    const databaseOnly = options.databaseOnly === true;
    const add = value => {
      if (value && typeof value === 'object') {
        add(value.stimulusId ?? value.stimulus_id ?? value.id);
        return;
      }
      const normalized = normalizedStimulusId(value);
      if (!normalized) return;
      if (databaseOnly && !/^[1-9]\d*$/.test(normalized)) return;
      ids.add(normalized);
    };
    const visit = value => {
      if (!value || typeof value !== 'object' || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }

      add(value.stimulusId ?? value.stimulus_id);
      for (const key of ['stimuliIds', 'stimuli_ids', 'slides']) {
        if (!Array.isArray(value[key])) continue;
        value[key].forEach(item => {
          if (item && typeof item === 'object') {
            add(item.stimulusId ?? item.stimulus_id ?? item.id);
          } else {
            add(item);
          }
        });
      }
      if (value.stimulus && typeof value.stimulus === 'object') add(value.stimulus);
      Object.values(value).forEach(visit);
    };

    visit(definition);

    return [...ids];
  }

  function referencedDatabaseStimulusIds(definition) {
    return referencedStimulusIds(definition, { databaseOnly: true })
      .map(Number)
      .filter(Number.isSafeInteger);
  }

  return {
    normalizedStimulusId,
    referencedStimulusIds,
    referencedDatabaseStimulusIds,
  };
});
