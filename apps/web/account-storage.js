/* Isolates researcher workspace caches between staff accounts. */
(function (root, factory) {
  'use strict';

  var exported = { createAccountStorage: factory };
  if (typeof module === 'object' && module.exports) module.exports = exported;
  if (root && root.localStorage) root.WecogAccountStorage = factory(root.localStorage);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAccountStorage(storage) {
  'use strict';

  var OWNER_KEY = 'emocog_workspace_owner_v1';
  var ACCOUNT_PREFIX = 'emocog_account_workspace_v1:';
  var ARCHIVE_PREFIX = 'emocog_workspace_archive_v1:';
  var EXACT_KEYS = new Set([
    'emocog_active_experiment_id',
    'emocog_experiments_tab',
    'emocog_folders',
    'emocog_my_experiments',
    'emocog_protocol_blocks',
    'emocog_protocol_meta_draft',
    'emocog_protocol_step_draft',
    'emocog_selected_project_id',
    'emocog_selected_protocol_id',
    'emocog_selected_session_db_id',
    'emocog_selected_workspace_project_id',
    'emocog_stimuli',
    'emocog_ws_projects'
  ]);
  var KEY_PREFIXES = [
    'emocog_analytics_config_',
    'emocog_analytics_plan_',
    'emocog_builder_api_',
    'emocog_qc_thresholds_',
    'emocog_session_features_'
  ];

  function normalizedUserId(value) {
    var id = String(value == null ? '' : value).trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
  }

  function isWorkspaceKey(key) {
    if (EXACT_KEYS.has(key)) return true;
    return KEY_PREFIXES.some(function (prefix) { return key.indexOf(prefix) === 0; });
  }

  function workspaceKeys() {
    var keys = [];
    for (var i = 0; i < storage.length; i += 1) {
      var key = storage.key(i);
      if (key && isWorkspaceKey(key)) keys.push(key);
    }
    return keys;
  }

  function storedKeysWithPrefix(prefix) {
    var keys = [];
    for (var i = 0; i < storage.length; i += 1) {
      var key = storage.key(i);
      if (key && key.indexOf(prefix) === 0) keys.push(key);
    }
    return keys;
  }

  function accountKey(userId, key) {
    return ACCOUNT_PREFIX + encodeURIComponent(userId) + ':' + encodeURIComponent(key);
  }

  function saveCurrentForOwner(ownerId) {
    workspaceKeys().forEach(function (key) {
      var value = storage.getItem(key);
      if (value != null) storage.setItem(accountKey(ownerId, key), value);
      storage.removeItem(key);
    });
  }

  function archiveUnownedWorkspace() {
    var keys = workspaceKeys();
    if (!keys.length) return null;
    var archiveId = Date.now().toString(36);
    keys.forEach(function (key) {
      var value = storage.getItem(key);
      if (value != null) {
        storage.setItem(ARCHIVE_PREFIX + archiveId + ':' + encodeURIComponent(key), value);
      }
      storage.removeItem(key);
    });
    storage.setItem(ARCHIVE_PREFIX + archiveId + ':manifest', JSON.stringify({
      createdAt: new Date().toISOString(),
      reason: 'unscoped_workspace_migration',
      keys: keys
    }));
    return archiveId;
  }

  function restoreForOwner(ownerId) {
    var prefix = ACCOUNT_PREFIX + encodeURIComponent(ownerId) + ':';
    storedKeysWithPrefix(prefix).forEach(function (scopedKey) {
      var key = decodeURIComponent(scopedKey.slice(prefix.length));
      if (!isWorkspaceKey(key)) return;
      var value = storage.getItem(scopedKey);
      if (value != null) storage.setItem(key, value);
    });
  }

  function activate(userId) {
    var target = normalizedUserId(userId);
    if (!target) return { changed: false, error: 'invalid_user_id' };
    var current = normalizedUserId(storage.getItem(OWNER_KEY));
    if (current === target) return { changed: false, ownerId: target };

    var archiveId = null;
    if (current) saveCurrentForOwner(current);
    else archiveId = archiveUnownedWorkspace();
    restoreForOwner(target);
    storage.setItem(OWNER_KEY, target);
    return { changed: true, ownerId: target, archiveId: archiveId };
  }

  function activateCachedUser() {
    try {
      var user = JSON.parse(storage.getItem('emocog_api_user') || 'null');
      return user && user.id ? activate(user.id) : { changed: false };
    } catch (_) {
      return { changed: false };
    }
  }

  function recoverableArchives() {
    return storedKeysWithPrefix(ARCHIVE_PREFIX)
      .filter(function (key) { return key.slice(-9) === ':manifest'; })
      .map(function (key) {
        try {
          var manifest = JSON.parse(storage.getItem(key) || 'null');
          var archiveId = key.slice(ARCHIVE_PREFIX.length, -9);
          return manifest && !manifest.recoveredAt ? { key: key, archiveId: archiveId, manifest: manifest } : null;
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return Date.parse(b.manifest.createdAt || 0) - Date.parse(a.manifest.createdAt || 0);
      });
  }

  function hasRecoverableArchive() {
    return recoverableArchives().length > 0;
  }

  function mergeArrays(key, archivedValue, currentValue) {
    try {
      var archived = JSON.parse(archivedValue || '[]');
      var current = JSON.parse(currentValue || '[]');
      if (!Array.isArray(archived) || !Array.isArray(current)) return currentValue || archivedValue;
      var byId = new Map();
      archived.concat(current).forEach(function (item, index) {
        var identity = item && item.id != null ? String(item.id) : 'index:' + index;
        byId.set(identity, item);
      });
      var merged = Array.from(byId.values());
      if (key === 'emocog_my_experiments') {
        merged = merged.map(function (entry) {
          var draft = Object.assign({}, entry, { status: 'draft' });
          delete draft.apiProtocolId;
          delete draft.projectId;
          delete draft.invitationCode;
          delete draft.participantLink;
          delete draft.publishVerifiedAt;
          delete draft.publishError;
          return draft;
        });
      }
      return JSON.stringify(merged);
    } catch (_) {
      return currentValue || archivedValue;
    }
  }

  function recoverLatestArchive(userId) {
    var target = normalizedUserId(userId);
    if (!target || normalizedUserId(storage.getItem(OWNER_KEY)) !== target) {
      return { restored: 0, error: 'workspace_owner_mismatch' };
    }
    var archive = recoverableArchives()[0];
    if (!archive) return { restored: 0, error: 'archive_not_found' };
    var prefix = ARCHIVE_PREFIX + archive.archiveId + ':';
    var restored = 0;
    storedKeysWithPrefix(prefix).forEach(function (archiveKey) {
      if (archiveKey === archive.key) return;
      var originalKey = decodeURIComponent(archiveKey.slice(prefix.length));
      if (!isWorkspaceKey(originalKey)) return;
      if (
        originalKey.indexOf('emocog_builder_api_') === 0
        || originalKey === 'emocog_selected_project_id'
        || originalKey === 'emocog_selected_workspace_project_id'
        || originalKey === 'emocog_selected_protocol_id'
        || originalKey === 'emocog_selected_session_db_id'
      ) return;
      var archivedValue = storage.getItem(archiveKey);
      var currentValue = storage.getItem(originalKey);
      if (['emocog_my_experiments', 'emocog_stimuli', 'emocog_folders'].indexOf(originalKey) >= 0) {
        storage.setItem(originalKey, mergeArrays(originalKey, archivedValue, currentValue));
        restored += 1;
      } else if (currentValue == null && archivedValue != null) {
        storage.setItem(originalKey, archivedValue);
        restored += 1;
      }
    });
    archive.manifest.recoveredAt = new Date().toISOString();
    archive.manifest.recoveredByUserId = target;
    storage.setItem(archive.key, JSON.stringify(archive.manifest));
    return { restored: restored, archiveId: archive.archiveId };
  }

  return {
    activate: activate,
    activateCachedUser: activateCachedUser,
    hasRecoverableArchive: hasRecoverableArchive,
    recoverLatestArchive: recoverLatestArchive,
    isWorkspaceKey: isWorkspaceKey
  };
});
