const path = require('path');
const config = require('../config');
const { referencedDatabaseStimulusIds } = require('../../shared/protocol-stimuli');
const {
  getStoredContentPath,
  resolveReadableServerOwnedUploadPath,
} = require('../security/upload-paths');

const stimuliUploadsRoot = path.join(config.storage.uploadsRoot, 'stimuli');

async function inspectProtocolStimuli(queryable, projectId, definition, options = {}) {
  const ids = referencedDatabaseStimulusIds(definition);
  if (!ids.length) return { ok: true, referencedIds: [], unavailable: [] };

  const result = await queryable.query(
    `SELECT id, name, mime_type, metadata
     FROM stimuli
     WHERE project_id = $1 AND id = ANY($2::int[])
     ORDER BY id`,
    [projectId, ids]
  );
  const rowsById = new Map(result.rows.map(row => [Number(row.id), row]));
  const uploadsRoot = options.uploadsRoot || stimuliUploadsRoot;
  const unavailable = [];

  for (const id of ids) {
    const row = rowsById.get(id);
    if (!row) {
      unavailable.push({ id, code: 'stimulus_record_missing', name: null });
      continue;
    }
    const resolved = await resolveReadableServerOwnedUploadPath(
      uploadsRoot,
      getStoredContentPath(row.metadata)
    );
    if (!resolved.ok) {
      unavailable.push({ id, code: resolved.code, name: row.name || null });
    }
  }

  return { ok: unavailable.length === 0, referencedIds: ids, unavailable };
}

function rejectUnavailableProtocolStimuli(res, report) {
  if (report.ok) return false;
  const labels = report.unavailable
    .slice(0, 8)
    .map(item => item.name ? `${item.name} (ID ${item.id})` : `ID ${item.id}`)
    .join(', ');
  res.status(422).json({
    error: 'Protocol references unavailable stimulus files',
    message: `Недоступны файлы стимулов: ${labels}. Восстановите их в библиотеке перед публикацией протокола.`,
    code: 'protocol_stimulus_unavailable',
    details: report.unavailable,
  });
  return true;
}

module.exports = {
  inspectProtocolStimuli,
  rejectUnavailableProtocolStimuli,
  stimuliUploadsRoot,
};
