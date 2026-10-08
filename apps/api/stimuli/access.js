const { isPlatformAdmin } = require('../middleware/auth');

function mayReadStimulus(row, user) {
  return isPlatformAdmin(user) || row.visibility !== 'private'
    || String(row.created_by) === String(user.sub);
}

function mayManageSharing(row, user) {
  return isPlatformAdmin(user) || (row.created_by != null && String(row.created_by) === String(user.sub));
}

function rejectOwnedFields(body) {
  return ['created_by', 'current_version_id', 'sha256', 'content_path', 'preview_path', 'mediaManifest']
    .some(key => Object.prototype.hasOwnProperty.call(body || {}, key));
}

module.exports = { mayReadStimulus, mayManageSharing, rejectOwnedFields };
