const path = require('path');
const config = require('../config');
const { referencedDatabaseStimulusIds, referencedStimulusIds } = require('../../shared/protocol-stimuli');
const { resolveStandardStimulus } = require('../../shared/standard-stimuli');
const { loadPinnedStimuli, hashFile, ensureStimulusVersion } = require('./versions');
const { mayReadStimulus } = require('./access');
const { ensurePlayableVersion } = require('./media-preview');
const {
  getStoredContentPath,
  resolveReadableServerOwnedUploadPath,
} = require('../security/upload-paths');

const stimuliUploadsRoot = path.join(config.storage.uploadsRoot, 'stimuli');

async function inspectProtocolStimuli(queryable, projectId, definition, options = {}) {
  const ids = referencedDatabaseStimulusIds(definition);
  const visualIds = new Set((definition?.blocks || [])
    .filter(block => ['cognitive_task', 'stimuli', 'passive'].includes(block?.type))
    .flatMap(block => referencedDatabaseStimulusIds({ blocks: [block] })));
  const unavailable = referencedStimulusIds(definition)
    .filter(id => !/^[1-9]\d*$/.test(id) && !resolveStandardStimulus(id))
    .map(id => ({ id, code: 'stimulus_not_saved_on_server', name: null }));
  if (!ids.length) return { ok: unavailable.length === 0, referencedIds: [], unavailable };

  const result = definition?.mediaManifest ? { rows: await loadPinnedStimuli(queryable, projectId, definition) } : await queryable.query(
    `SELECT id, name, mime_type, metadata, created_by, visibility
     FROM stimuli
     WHERE project_id = $1 AND id = ANY($2::int[])
     ORDER BY id`,
    [projectId, ids]
  );
  const rowsById = new Map(result.rows.map(row => [Number(row.id), row]));
  const uploadsRoot = options.uploadsRoot || stimuliUploadsRoot;
  for (const id of ids) {
    const row = rowsById.get(id);
    if (!row || (options.user && !mayReadStimulus(row, options.user))) {
      unavailable.push({ id, code: 'stimulus_record_missing', name: null });
      continue;
    }
    if (visualIds.has(id) && row.mime_type && !/^(image|video)\//.test(row.mime_type)) {
      unavailable.push({ id, code: 'stimulus_media_type_unsupported', name: row.name || null });
      continue;
    }
    const resolved = await resolveReadableServerOwnedUploadPath(
      uploadsRoot,
      getStoredContentPath(row.metadata)
    );
    if (!resolved.ok) {
      unavailable.push({ id, code: resolved.code, name: row.name || null });
    } else if (row.sha256 && await hashFile(resolved.absolutePath) !== row.sha256) {
      unavailable.push({ id, code: 'stimulus_checksum_mismatch', name: row.name || null });
    } else if (options.verifyDecoding) {
      try {
        const version = row.pinned_version || await ensureStimulusVersion(queryable, row, { uploadsRoot });
        await ensurePlayableVersion(queryable, version, uploadsRoot);
      } catch (error) {
        unavailable.push({ id, code: error.code || 'media_decode_failed', name: row.name || null });
      }
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
    message: report.unavailable.some(item => item.code === 'stimulus_media_type_unsupported')
      ? `Визуальные блоки поддерживают изображения и видео, но не выбранный тип файла: ${labels}. Замените стимул перед публикацией.`
      : `Недоступны файлы стимулов: ${labels}. Восстановите их в библиотеке перед публикацией протокола.`,
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
