const crypto = require('crypto');
const { withTransaction } = require('../db/transaction');
const { HttpError } = require('../security/http-error');
const { METRIC_CATALOG } = require('./query');

const ANALYTICS_BACKEND_VERSION = 'analytics-api-1.0.0';
const QC_RULES_VERSION = 'qc-rules-1.0.0';

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function protocolVersion(definition) {
  return String(definition?.version || definition?.schemaVersion || '1.0.0');
}

function normalizeStimulusId(value) {
  return String(value == null ? '' : value).replace(/^api:/, '');
}

function protocolBlocks(definition) {
  return Array.isArray(definition?.blocks) ? definition.blocks : [];
}

function collectProtocolOptions(definition) {
  const blocks = [];
  const stimuli = new Map();
  const aois = [];
  protocolBlocks(definition).forEach((block, blockIndex) => {
    const blockId = String(block?.id || `block-${blockIndex + 1}`);
    blocks.push({
      id: blockId,
      name_ru: block?.title || block?.content?.title || blockId,
      name_en: block?.title_en || block?.content?.title_en || block?.title || blockId,
    });
    const config = block?.blockConfig || block?.content || {};
    const trials = Array.isArray(block?.trials) ? block.trials : [];
    const ids = [
      ...trials.map(trial => trial?.stimulusId),
      ...(Array.isArray(block?.params?.stimuli_ids) ? block.params.stimuli_ids : []),
      ...Object.keys(config.aoiDefinitions || {}),
    ].filter(value => value != null && String(value).trim());
    ids.forEach(value => {
      const id = normalizeStimulusId(value);
      if (!stimuli.has(`${blockId}:${id}`)) {
        stimuli.set(`${blockId}:${id}`, {
          id,
          blockId,
          name_ru: id,
          name_en: id,
        });
      }
    });
    Object.entries(config.aoiDefinitions || {}).forEach(([stimulusRef, definitions]) => {
      const stimulusId = normalizeStimulusId(stimulusRef);
      (Array.isArray(definitions) ? definitions : []).forEach((aoi, index) => {
        if (!aoi || typeof aoi !== 'object') return;
        aois.push({
          id: String(aoi.id || `${blockId}-${stimulusId}-aoi-${index + 1}`),
          stimulusId,
          blockId,
          name_ru: aoi.name || `AOI ${index + 1}`,
          name_en: aoi.name_en || aoi.name || `AOI ${index + 1}`,
        });
      });
    });
  });
  const comparisons = Array.isArray(definition?.analyticsPlan?.comparisons)
    ? definition.analyticsPlan.comparisons
      .filter(item => item && item.id)
      .map(item => ({
        id: String(item.id),
        name_ru: item.name_ru || item.name || String(item.id),
        name_en: item.name_en || item.name || String(item.id),
        factorIds: Array.isArray(item.factorIds) ? item.factorIds.map(String) : [],
        contrastIds: Array.isArray(item.contrastIds) ? item.contrastIds.map(String) : [],
        groupIds: Array.isArray(item.groupIds) ? item.groupIds.map(String) : [],
      }))
    : [];
  return {
    blocks,
    stimuli: Array.from(stimuli.values()),
    aois,
    groups: [],
    conditions: [],
    comparisons,
  };
}

function gazeSummary(features) {
  const summary = features?.gaze_analytics?.summary;
  return summary && typeof summary === 'object' ? summary : null;
}

function sessionMatchesQuery(row, query) {
  const filters = query.filters;
  const reasons = [];
  const idMatches = !filters.sessionIds.length || filters.sessionIds.some(value => (
    String(value) === String(row.id) || String(value) === String(row.session_id)
  ));
  if (!idMatches) reasons.push('session_filter');
  if (filters.participantIds.length && !filters.participantIds.some(value => String(value) === String(row.participant_id))) {
    reasons.push('participant_filter');
  }
  if (!filters.includeIncompleteSessions && !row.stopped_at) reasons.push('incomplete_session');
  const validity = String(row.qc_validity || 'not_computed').toLowerCase();
  if (filters.qcMode === 'valid_only' && validity !== 'valid') reasons.push('qc_not_valid');
  if (filters.qcMode === 'valid_and_borderline' && !['valid', 'borderline'].includes(validity)) {
    reasons.push('qc_below_borderline');
  }
  if (filters.dateFrom && (!row.started_at || new Date(row.started_at) < new Date(filters.dateFrom))) {
    reasons.push('date_before_range');
  }
  if (filters.dateTo && (!row.started_at || new Date(row.started_at) > new Date(filters.dateTo))) {
    reasons.push('date_after_range');
  }
  const gaze = gazeSummary(row.features_payload);
  if (filters.minValidFraction != null) {
    if (!gaze || !Number.isFinite(gaze.validFraction)) reasons.push('gaze_valid_fraction_missing');
    else if (gaze.validFraction < filters.minValidFraction) reasons.push('gaze_valid_fraction_below_threshold');
  }
  if (filters.minSignalConfidence != null) {
    if (!gaze || !Number.isFinite(gaze.meanConfidence)) reasons.push('gaze_confidence_missing');
    else if (gaze.meanConfidence < filters.minSignalConfidence) reasons.push('gaze_confidence_below_threshold');
  }
  if (filters.deviceClasses.length) {
    const device = row.features_payload?.meta?.tech?.deviceClass
      || row.features_payload?.meta?.tech?.device
      || null;
    if (!device || !filters.deviceClasses.includes(String(device))) reasons.push('device_filter');
  }
  if (filters.groupIds.length || filters.conditionIds.length) reasons.push('group_or_condition_not_configured');
  if (filters.blockIds.length || filters.stimulusIds.length) {
    const presentations = Array.isArray(row.features_payload?.gaze_analytics?.presentations)
      ? row.features_payload.gaze_analytics.presentations
      : [];
    const hasPresentation = presentations.some(presentation => {
      const blockOk = !filters.blockIds.length
        || filters.blockIds.some(value => String(value) === String(presentation.blockId));
      const stimulusOk = !filters.stimulusIds.length
        || filters.stimulusIds.some(value => normalizeStimulusId(value) === normalizeStimulusId(presentation.stimulusId));
      return blockOk && stimulusOk;
    });
    if (!hasPresentation) reasons.push('requested_gaze_presentation_missing');
  }
  return reasons;
}

async function loadProtocol(queryable, projectId, protocolId) {
  const result = await queryable.query(
    `SELECT id, project_id, name, definition, updated_at
     FROM protocols
     WHERE id = $1 AND project_id = $2`,
    [protocolId, projectId]
  );
  return result.rows[0] || null;
}

async function loadCandidateSessions(queryable, projectId, protocolId) {
  const result = await queryable.query(
    `SELECT s.id, s.session_id, s.participant_id, s.project_id, s.protocol_id,
            s.started_at, s.stopped_at, s.updated_at,
            q.qc_score, q.validity AS qc_validity, q.fail_reasons,
            q.payload AS qc_payload, q.updated_at AS qc_updated_at,
            f.payload AS features_payload, f.updated_at AS features_updated_at
     FROM sessions s
     LEFT JOIN session_qc_summary q ON q.session_id = s.id
     LEFT JOIN session_features f ON f.session_id = s.id
     WHERE s.project_id = $1 AND s.protocol_id = $2
     ORDER BY s.started_at ASC NULLS LAST, s.id ASC
     LIMIT 2000`,
    [projectId, protocolId]
  );
  return result.rows;
}

function datasetFingerprint(protocol, rows) {
  return sha256({
    protocol: {
      id: protocol.id,
      updatedAt: protocol.updated_at ? new Date(protocol.updated_at).toISOString() : null,
      version: protocolVersion(protocol.definition),
    },
    sessions: rows.map(row => ({
      id: Number(row.id),
      sessionId: row.session_id,
      stoppedAt: row.stopped_at ? new Date(row.stopped_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      featuresUpdatedAt: row.features_updated_at ? new Date(row.features_updated_at).toISOString() : null,
      qcUpdatedAt: row.qc_updated_at ? new Date(row.qc_updated_at).toISOString() : null,
    })),
  });
}

function snapshotVersions(protocol, query) {
  const options = collectProtocolOptions(protocol.definition);
  const stimulusVersions = options.stimuli.map(stimulus => `${stimulus.id}@1`).sort();
  return {
    protocol: query.protocolVersion,
    stimulus: stimulusVersions.join(',') || 'not_configured',
    aoiSchema: String(protocolBlocks(protocol.definition)
      .map(block => block?.blockConfig?.aoiSchemaVersion)
      .find(Boolean) || '1.2'),
    metricsCatalog: String(METRIC_CATALOG.catalogVersion || '1.0'),
    qcRules: QC_RULES_VERSION,
    frontend: 'researcher-web-1.0.0',
    backend: ANALYTICS_BACKEND_VERSION,
  };
}

function publicSnapshot(row) {
  return {
    id: row.id,
    datasetHash: row.dataset_hash,
    createdAt: new Date(row.created_at).toISOString(),
    queryEcho: row.query,
    includedParticipantIds: Array.from(new Set((row.session_rows || [])
      .map(session => session.participant_id)
      .filter(value => value != null)
      .map(String))),
    includedSessionIds: row.included_session_ids,
    excludedSessions: (Array.isArray(row.excluded_sessions) ? row.excluded_sessions : []).map(item => ({
      sessionId: item.sessionId,
      reasonCode: item.reasonCode,
      ...(item.channel ? { channel: item.channel } : {}),
    })),
    versions: row.versions,
  };
}

async function createSnapshot(pool, query, userId) {
  return withTransaction(pool, async client => {
    const protocol = await loadProtocol(client, query.projectId, query.protocolId);
    if (!protocol) throw new HttpError(404, 'Protocol not found', 'analytics_protocol_not_found');
    const actualVersion = protocolVersion(protocol.definition);
    if (actualVersion !== query.protocolVersion) {
      throw new HttpError(409, 'Protocol version does not match', 'analytics_protocol_version_mismatch');
    }
    const candidates = await loadCandidateSessions(client, query.projectId, query.protocolId);
    const included = [];
    const excluded = [];
    candidates.forEach(row => {
      const reasons = sessionMatchesQuery(row, query);
      if (!reasons.length) included.push(row);
      else if (
        !query.filters.sessionIds.length
        || query.filters.sessionIds.some(value => String(value) === String(row.id) || String(value) === String(row.session_id))
      ) {
        excluded.push({ sessionId: Number(row.id), reasonCode: reasons[0], reasons });
      }
    });
    const id = crypto.randomUUID();
    const datasetHash = datasetFingerprint(protocol, included);
    const versions = snapshotVersions(protocol, query);
    const inserted = await client.query(
      `INSERT INTO analysis_snapshots (
         id, project_id, protocol_id, created_by_user_id, query,
         included_session_ids, excluded_sessions, dataset_hash, versions
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9::jsonb)
       RETURNING *`,
      [
        id,
        query.projectId,
        query.protocolId,
        userId,
        JSON.stringify(query),
        JSON.stringify(included.map(row => Number(row.id))),
        JSON.stringify(excluded),
        datasetHash,
        JSON.stringify(versions),
      ]
    );
    return publicSnapshot({ ...inserted.rows[0], session_rows: included });
  }, { isolationLevel: 'REPEATABLE READ' });
}

async function loadSnapshot(pool, snapshotId) {
  const result = await pool.query(
    `SELECT * FROM analysis_snapshots WHERE id = $1`,
    [snapshotId]
  );
  return result.rows[0] || null;
}

async function hydrateSnapshot(pool, snapshotRow) {
  const protocol = await loadProtocol(pool, snapshotRow.project_id, snapshotRow.protocol_id);
  if (!protocol) throw new HttpError(409, 'Snapshot protocol is unavailable', 'analytics_snapshot_stale');
  const allRows = await loadCandidateSessions(pool, snapshotRow.project_id, snapshotRow.protocol_id);
  const ids = new Set((snapshotRow.included_session_ids || []).map(Number));
  const sessionRows = allRows.filter(row => ids.has(Number(row.id)));
  if (sessionRows.length !== ids.size) {
    throw new HttpError(409, 'Snapshot sessions changed', 'analytics_snapshot_stale');
  }
  const currentHash = datasetFingerprint(protocol, sessionRows);
  if (currentHash !== snapshotRow.dataset_hash) {
    throw new HttpError(409, 'Snapshot dataset changed', 'analytics_snapshot_stale');
  }
  return {
    row: snapshotRow,
    protocol,
    sessionRows,
    snapshot: publicSnapshot({ ...snapshotRow, session_rows: sessionRows }),
  };
}

module.exports = {
  ANALYTICS_BACKEND_VERSION,
  QC_RULES_VERSION,
  collectProtocolOptions,
  createSnapshot,
  datasetFingerprint,
  hydrateSnapshot,
  loadProtocol,
  loadSnapshot,
  normalizeStimulusId,
  protocolVersion,
  publicSnapshot,
  sessionMatchesQuery,
  sha256,
};
